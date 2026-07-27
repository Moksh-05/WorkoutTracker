// ============================================
// SETUP
// ============================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let exercises = [];              // cached exercise library
let currentUnit = "lbs";         // lbs or kg, toggled by the button
let todaysSets = [];             // sets logged in this session, shown in the table
const LBS_TO_KG = 0.453592;

const todayDate = () => new Date().toISOString().split("T")[0]; // "2026-07-26"

// ============================================
// OFFLINE QUEUE (localStorage)
// If a save fails because there's no signal, it goes here instead.
// When the app comes back online, everything queued gets pushed to Supabase.
// ============================================

function queueOffline(table, row) {
  const queue = JSON.parse(localStorage.getItem("offline_queue") || "[]");
  queue.push({ table, row });
  localStorage.setItem("offline_queue", JSON.stringify(queue));
  setStatus("Saved locally. Will sync once you're back online.");
}

async function syncOfflineQueue() {
  const queue = JSON.parse(localStorage.getItem("offline_queue") || "[]");
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    const { error } = await sb.from(item.table).insert(item.row);
    if (error) remaining.push(item); // keep it queued if it still fails
  }
  localStorage.setItem("offline_queue", JSON.stringify(remaining));

  if (remaining.length === 0) {
    setStatus("All offline data synced.");
  }
}

window.addEventListener("online", syncOfflineQueue);

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
  setTimeout(() => (document.getElementById("status").textContent = ""), 4000);
}

// ============================================
// TAB SWITCHING
// ============================================

function showTab(name) {
  document.getElementById("log-screen").style.display = name === "log" ? "block" : "none";
  document.getElementById("dashboard-screen").style.display = name === "dashboard" ? "block" : "none";
  document.getElementById("bodyweight-screen").style.display = name === "bodyweight" ? "block" : "none";

  if (name === "dashboard") {
    renderStrengthChart();
    renderVolumeChart();
    renderConsistencyStats();
  }
  if (name === "bodyweight") {
    renderBodyWeightChart();
  }
}

// ============================================
// UNIT TOGGLE (lbs <-> kg display only, storage always stays in lbs)
// ============================================

function toggleUnit() {
  currentUnit = currentUnit === "lbs" ? "kg" : "lbs";
  document.getElementById("other-unit").textContent = currentUnit === "lbs" ? "kg" : "lbs";
  document.querySelectorAll(".unit-label").forEach(el => el.textContent = currentUnit);
}

function toDisplayWeight(lbsValue) {
  if (lbsValue == null) return null;
  return currentUnit === "lbs" ? lbsValue : +(lbsValue * LBS_TO_KG).toFixed(1);
}

// ============================================
// LOAD EXERCISE LIBRARY
// Tries Supabase first, falls back to whatever was cached last time (for offline).
// ============================================

async function loadExercises() {
  const { data, error } = await sb.from("exercises").select("*");

  if (error || !data) {
    exercises = JSON.parse(localStorage.getItem("exercises_cache") || "[]");
    setStatus("Offline: using cached exercise list.");
  } else {
    exercises = data;
    localStorage.setItem("exercises_cache", JSON.stringify(data));
  }

  populateExerciseDropdowns();
}

function populateExerciseDropdowns() {
  const select = document.getElementById("exercise-select");
  const dashSelect = document.getElementById("dashboard-exercise-select");
  select.innerHTML = "";
  dashSelect.innerHTML = "";

  exercises.forEach(ex => {
    const opt = `<option value="${ex.id}">${ex.name}</option>`;
    select.innerHTML += opt;
    dashSelect.innerHTML += opt;
  });

  onExerciseChange();
}

function onExerciseChange() {
  const id = document.getElementById("exercise-select").value;
  const ex = exercises.find(e => e.id === id);
  if (!ex) return;

  const isTimed = ex.subtype === "timed_hold";
  document.getElementById("resistance-fields").style.display = isTimed ? "none" : "block";
  document.getElementById("timed-fields").style.display = isTimed ? "block" : "none";

  showTarget(ex);
}

// ============================================
// TARGET CALCULATION
// Averages your last 3 logged sets for this exercise, adjusts based on how
// the most recent one felt. This is plain if/else logic, not AI.
// ============================================

async function showTarget(exercise) {
  const { data, error } = await sb
    .from("logged_sets")
    .select("*")
    .eq("exercise_id", exercise.id)
    .order("created_at", { ascending: false })
    .limit(3);

  const display = document.getElementById("target-display");

  if (error || !data || data.length === 0) {
    display.textContent = "No history yet, log a few sets to start getting targets.";
    return;
  }

  const avgReps = Math.round(data.reduce((sum, s) => sum + (s.reps || 0), 0) / data.length);
  const avgWeight = Math.round(data.reduce((sum, s) => sum + (s.weight_lbs || 0), 0) / data.length);
  const avgDuration = Math.round(data.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / data.length);
  const lastDifficulty = data[0].difficulty;

  let weightAdjust = 0;
  if (lastDifficulty === "easy") weightAdjust = 5;
  if (lastDifficulty === "hard") weightAdjust = -5;

  if (exercise.subtype === "timed_hold") {
    display.textContent = `Target: ~${avgDuration} sec hold`;
  } else if (exercise.subtype === "reps") {
    display.textContent = `Target: ~${avgReps} reps`;
  } else {
    display.textContent = `Target: ~${avgWeight + weightAdjust} lbs x ${avgReps} reps`;
  }
}

// ============================================
// WORKOUT DAY HELPERS
// Every log action needs a workout_days row to attach to first.
// ============================================

async function getOrCreateWorkoutDay(isRestDay = false) {
  const date = todayDate();

  const { data: existing } = await sb.from("workout_days").select("*").eq("date", date).single();
  if (existing) return existing;

  const { data, error } = await sb
    .from("workout_days")
    .insert({ date, is_rest_day: isRestDay })
    .select()
    .single();

  if (error) {
    // offline: fake a local id so the rest of the flow still works
    return { id: "local-" + date, date, is_rest_day: isRestDay };
  }
  return data;
}

async function logRestDay() {
  await getOrCreateWorkoutDay(true);
  setStatus("Today logged as a rest day.");
}

// ============================================
// ADD A SET
// ============================================

async function addSet() {
  const exerciseId = document.getElementById("exercise-select").value;
  const exercise = exercises.find(e => e.id === exerciseId);
  const day = await getOrCreateWorkoutDay(false);

  const row = {
    workout_day_id: day.id,
    exercise_id: exerciseId,
    set_number: todaysSets.filter(s => s.exercise_id === exerciseId).length + 1,
    weight_lbs: exercise.subtype ? null : parseFloat(document.getElementById("weight-input").value) || null,
    reps: exercise.subtype === "timed_hold" ? null : parseInt(document.getElementById("reps-input").value) || null,
    duration_seconds: exercise.subtype === "timed_hold" ? parseInt(document.getElementById("duration-input").value) || null : null,
    difficulty: document.getElementById("difficulty-select").value,
    rest_time_seconds: parseInt(document.getElementById("rest-time-input").value) || null,
    notes: document.getElementById("notes-input").value || null
  };

  const { error } = await sb.from("logged_sets").insert(row);

  if (error) {
    queueOffline("logged_sets", row);
  } else {
    setStatus("Set saved.");
  }

  todaysSets.push({ ...row, exercise_name: exercise.name });
  renderTodaysSets();
  document.getElementById("notes-input").value = "";
}

function renderTodaysSets() {
  const body = document.getElementById("todays-sets-body");
  body.innerHTML = "";
  todaysSets.forEach(s => {
    const weightOrDuration = s.duration_seconds ? `${s.duration_seconds}s` : `${toDisplayWeight(s.weight_lbs) ?? "-"} ${currentUnit}`;
    body.innerHTML += `<tr><td>${s.exercise_name}</td><td>${weightOrDuration}</td><td>${s.reps ?? "-"}</td><td>${s.difficulty}</td></tr>`;
  });
}

// ============================================
// BODY WEIGHT
// ============================================

async function logBodyWeight() {
  const value = parseFloat(document.getElementById("bodyweight-input").value);
  if (!value) return;

  const row = { date: todayDate(), weight_lbs: value };
  const { error } = await sb.from("body_weight_log").upsert(row, { onConflict: "date" });

  if (error) {
    queueOffline("body_weight_log", row);
  } else {
    setStatus("Body weight saved.");
    renderBodyWeightChart();
  }
}

async function renderBodyWeightChart() {
  const { data } = await sb.from("body_weight_log").select("*").order("date", { ascending: true });
  if (!data) return;

  drawChart("bodyweight-chart", {
    labels: data.map(d => d.date),
    values: data.map(d => toDisplayWeight(d.weight_lbs))
  }, `Body Weight (${currentUnit})`);
}

// ============================================
// DASHBOARD CHARTS
// ============================================

async function renderStrengthChart() {
  const exerciseId = document.getElementById("dashboard-exercise-select").value;
  if (!exerciseId) return;

  const { data } = await sb
    .from("logged_sets")
    .select("*")
    .eq("exercise_id", exerciseId)
    .order("created_at", { ascending: true });

  if (!data) return;

  drawChart("strength-chart", {
    labels: data.map(d => new Date(d.created_at).toLocaleDateString()),
    values: data.map(d => toDisplayWeight(d.weight_lbs) ?? d.duration_seconds ?? d.reps)
  }, "Progress");
}

async function renderVolumeChart() {
  const { data } = await sb.from("logged_sets").select("*").order("created_at", { ascending: true });
  if (!data) return;

  // Group by day, sum weight x reps for each day
  const volumeByDay = {};
  data.forEach(s => {
    if (!s.weight_lbs || !s.reps) return;
    const day = new Date(s.created_at).toLocaleDateString();
    volumeByDay[day] = (volumeByDay[day] || 0) + s.weight_lbs * s.reps;
  });

  drawChart("volume-chart", {
    labels: Object.keys(volumeByDay),
    values: Object.values(volumeByDay).map(v => toDisplayWeight(v))
  }, `Volume (${currentUnit})`);
}

async function renderConsistencyStats() {
  const { data } = await sb.from("workout_days").select("*").order("date", { ascending: true });
  if (!data || data.length === 0) return;

  const workoutDays = data.filter(d => !d.is_rest_day).length;
  const restDays = data.filter(d => d.is_rest_day).length;

  const firstDate = new Date(data[0].date);
  const lastDate = new Date();
  const totalDaysInRange = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;
  const missedDays = totalDaysInRange - data.length;

  document.getElementById("consistency-stats").innerHTML = `
    <p>Workout days: ${workoutDays}</p>
    <p>Rest days: ${restDays}</p>
    <p>Missed days: ${missedDays < 0 ? 0 : missedDays}</p>
  `;
}

// ============================================
// SIMPLE CHART HELPER
// Wraps Chart.js so we're not repeating the same setup code everywhere.
// ============================================

const chartInstances = {};

function drawChart(canvasId, dataset, label) {
  const ctx = document.getElementById(canvasId).getContext("2d");

  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

  chartInstances[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: dataset.labels,
      datasets: [{ label, data: dataset.values, borderColor: "#4ade80", tension: 0.2 }]
    },
    options: {
      scales: {
        x: { ticks: { color: "#ffffff" } },
        y: { ticks: { color: "#ffffff" } }
      },
      plugins: { legend: { labels: { color: "#ffffff" } } }
    }
  });
}

// ============================================
// INIT
// ============================================

window.addEventListener("load", () => {
  loadExercises();
  syncOfflineQueue();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
  }
});
