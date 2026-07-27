// ============================================
// SETUP
// ============================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let exercises = [];
let todaysSets = [];
const LBS_TO_KG = 0.453592;

const todayDate = () => new Date().toISOString().split("T")[0];

function lbsToKg(lbs) {
  if (lbs == null || isNaN(lbs)) return 0;
  return +(lbs * LBS_TO_KG).toFixed(1);
}

// Used anywhere a weight needs to display as both units at once, e.g. "150 lbs · 68.0 kg"
function formatBothUnits(lbs) {
  if (lbs == null) return "-";
  return `${lbs} lbs (${lbsToKg(lbs)} kg)`;
}

// You can type into either field. Whichever one you just typed in becomes
// the source, and we calculate the other one from it. Setting .value directly
// (instead of simulating a keystroke) means this doesn't trigger an infinite loop.
function syncWeight(source) {
  const lbsField = document.getElementById("weight-input-lbs");
  const kgField = document.getElementById("weight-input-kg");

  if (source === "lbs") {
    const lbs = parseFloat(lbsField.value) || 0;
    kgField.value = lbsToKg(lbs);
  } else {
    const kg = parseFloat(kgField.value) || 0;
    lbsField.value = +(kg / LBS_TO_KG).toFixed(1);
  }
}

function syncBodyWeight(source) {
  const lbsField = document.getElementById("bodyweight-input-lbs");
  const kgField = document.getElementById("bodyweight-input-kg");

  if (source === "lbs") {
    const lbs = parseFloat(lbsField.value) || 0;
    kgField.value = lbsToKg(lbs);
  } else {
    const kg = parseFloat(kgField.value) || 0;
    lbsField.value = +(kg / LBS_TO_KG).toFixed(1);
  }
}

// ============================================
// OFFLINE QUEUE (localStorage)
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
    if (error) remaining.push(item);
  }
  localStorage.setItem("offline_queue", JSON.stringify(remaining));

  if (remaining.length === 0 && queue.length > 0) {
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

  ["tab-log", "tab-dashboard", "tab-bodyweight"].forEach(id => {
    document.getElementById(id).classList.remove("active");
  });
  document.getElementById("tab-" + name).classList.add("active");

  if (name === "dashboard") {
    renderCalendar();
    renderConsistencyStats();
    renderStrengthChart();
    renderVolumeChart();
  }
  if (name === "bodyweight") {
    renderBodyWeightChart();
  }
}

// ============================================
// LOAD EXERCISE LIBRARY
// ============================================

async function loadExercises() {
  try {
    const { data, error } = await sb.from("exercises").select("*");
    if (error || !data) throw error || new Error("No data");

    exercises = data;
    localStorage.setItem("exercises_cache", JSON.stringify(data));
  } catch (err) {
    // Covers both a clean Supabase error AND a hard network failure (true offline)
    exercises = JSON.parse(localStorage.getItem("exercises_cache") || "[]");
    setStatus("Offline: using cached exercise list.");
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
    display.textContent = `Target: ${formatBothUnits(avgWeight + weightAdjust)} x ${avgReps} reps`;
  }
}

// ============================================
// WORKOUT DAY HELPERS
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
    weight_lbs: exercise.subtype ? null : parseFloat(document.getElementById("weight-input-lbs").value) || null,
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
  document.getElementById("weight-input-lbs").value = "";
  document.getElementById("weight-input-kg").value = "";
}

function renderTodaysSets() {
  const body = document.getElementById("todays-sets-body");
  body.innerHTML = "";
  todaysSets.forEach(s => {
    const weightOrDuration = s.duration_seconds
      ? `${s.duration_seconds}s`
      : formatBothUnits(s.weight_lbs);
    body.innerHTML += `<tr><td>${s.exercise_name}</td><td>${weightOrDuration}</td><td>${s.reps ?? "-"}</td><td>${s.difficulty}</td></tr>`;
  });
}

// ============================================
// BODY WEIGHT
// ============================================

async function logBodyWeight() {
  const value = parseFloat(document.getElementById("bodyweight-input-lbs").value);
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
    values: data.map(d => d.weight_lbs)
  }, "Body Weight (lbs)");
}

// ============================================
// CALENDAR HEATMAP (this month)
// ============================================

async function renderCalendar() {
  const { data } = await sb.from("workout_days").select("*");
  const dayMap = {};
  (data || []).forEach(d => dayMap[d.date] = d.is_rest_day);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const container = document.getElementById("calendar-container");
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  // Empty filler cells so day 1 lands on the correct weekday column
  for (let i = 0; i < firstWeekday; i++) {
    const filler = document.createElement("div");
    filler.className = "calendar-day future";
    grid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    cell.title = dateStr;

    const cellDate = new Date(year, month, day);
    const isFuture = cellDate > now;

    if (isFuture) {
      cell.classList.add("future");
    } else if (dateStr in dayMap) {
      cell.classList.add(dayMap[dateStr] ? "rest" : "workout");
    } else {
      cell.classList.add("missed");
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
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
    values: data.map(d => d.weight_lbs ?? d.duration_seconds ?? d.reps)
  }, "Progress");
}

async function renderVolumeChart() {
  const { data } = await sb.from("logged_sets").select("*").order("created_at", { ascending: true });
  if (!data) return;

  const volumeByDay = {};
  data.forEach(s => {
    if (!s.weight_lbs || !s.reps) return;
    const day = new Date(s.created_at).toLocaleDateString();
    volumeByDay[day] = (volumeByDay[day] || 0) + s.weight_lbs * s.reps;
  });

  drawChart("volume-chart", {
    labels: Object.keys(volumeByDay),
    values: Object.values(volumeByDay)
  }, "Volume (lbs)");
}

async function renderConsistencyStats() {
  const { data } = await sb.from("workout_days").select("*").order("date", { ascending: true });
  const box = document.getElementById("consistency-stats");

  if (!data || data.length === 0) {
    box.innerHTML = "<p>No data yet.</p>";
    return;
  }

  const workoutDays = data.filter(d => !d.is_rest_day).length;
  const restDays = data.filter(d => d.is_rest_day).length;

  const firstDate = new Date(data[0].date);
  const lastDate = new Date();
  const totalDaysInRange = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;
  const missedDays = Math.max(0, totalDaysInRange - data.length);

  box.innerHTML = `
    <div class="stat-box"><div class="stat-number">${workoutDays}</div><div class="stat-label">Workouts</div></div>
    <div class="stat-box"><div class="stat-number">${restDays}</div><div class="stat-label">Rest days</div></div>
    <div class="stat-box"><div class="stat-number">${missedDays}</div><div class="stat-label">Missed</div></div>
  `;
}

// ============================================
// CHART HELPER
// ============================================

const chartInstances = {};

function drawChart(canvasId, dataset, label) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

  chartInstances[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: dataset.labels,
      datasets: [{ label, data: dataset.values, borderColor: "#e5484d", backgroundColor: "rgba(229,72,77,0.1)", fill: true, tension: 0.3 }]
    },
    options: {
      scales: {
        x: { ticks: { color: "#8b8d92" }, grid: { color: "#2a2d32" } },
        y: { ticks: { color: "#8b8d92" }, grid: { color: "#2a2d32" } }
      },
      plugins: { legend: { labels: { color: "#f5f4f0" } } }
    }
  });
}

// ============================================
// FORCE REFRESH
// Wipes the service worker + cached files from inside the app, so you never
// have to dig through phone settings when new code gets pushed.
// ============================================

async function forceRefresh() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) await reg.unregister();
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    for (const key of keys) await caches.delete(key);
  }
  location.reload(true);
}

// ============================================
// INIT
// ============================================

window.addEventListener("load", () => {
  loadExercises();
  syncOfflineQueue();
  document.getElementById("tab-log").classList.add("active");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
  }
});
