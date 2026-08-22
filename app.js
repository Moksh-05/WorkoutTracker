// ============================================
// SETUP
// ============================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let exercises = [];
let todaysSets = [];
let lastSetConfig = null; // used by "Repeat last set"
let activeFlags = { warmup: false, failure: false };
const LBS_TO_KG = 0.453592;

const todayDate = () => new Date().toISOString().split("T")[0];

function lbsToKg(lbs) {
  if (lbs == null || isNaN(lbs)) return 0;
  return +(lbs * LBS_TO_KG).toFixed(1);
}

function formatBothUnits(lbs) {
  if (lbs == null) return "-";
  return `${lbs} lbs (${lbsToKg(lbs)} kg)`;
}

// Two-way lbs/kg sync. Setting .value directly doesn't fire another input
// event, so this can't loop back on itself.
function syncWeight(source) {
  const lbsField = document.getElementById("weight-input-lbs");
  const kgField = document.getElementById("weight-input-kg");
  if (source === "lbs") {
    kgField.value = lbsToKg(parseFloat(lbsField.value) || 0);
  } else {
    lbsField.value = +((parseFloat(kgField.value) || 0) / LBS_TO_KG).toFixed(1);
  }
}

function syncBodyWeight(source) {
  const lbsField = document.getElementById("bodyweight-input-lbs");
  const kgField = document.getElementById("bodyweight-input-kg");
  if (source === "lbs") {
    kgField.value = lbsToKg(parseFloat(lbsField.value) || 0);
  } else {
    lbsField.value = +((parseFloat(kgField.value) || 0) / LBS_TO_KG).toFixed(1);
  }
}

// ============================================
// ONLINE / OFFLINE INDICATOR
// ============================================

function updateConnectionIndicator() {
  const badge = document.getElementById("connection-indicator");
  if (navigator.onLine) {
    badge.classList.remove("offline");
    badge.title = "Online";
  } else {
    badge.classList.add("offline");
    badge.title = "Offline";
  }
}

window.addEventListener("online", () => { updateConnectionIndicator(); syncOfflineQueue(); });
window.addEventListener("offline", updateConnectionIndicator);

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

  ["tab-log", "tab-dashboard", "tab-bodyweight"].forEach(id => document.getElementById(id).classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");

  if (name === "dashboard") {
    renderCalendar();
    renderConsistencyStats();
    renderStrengthChart();
    renderVolumeChart();
    renderMuscleGroupChart();
  }
  if (name === "bodyweight") renderBodyWeightChart();
}

// ============================================
// WARM-UP / FAILURE TOGGLES
// ============================================

function toggleFlag(flag) {
  activeFlags[flag] = !activeFlags[flag];
  document.getElementById(flag + "-toggle").classList.toggle("active", activeFlags[flag]);
}

function resetFlags() {
  activeFlags = { warmup: false, failure: false };
  document.getElementById("warmup-toggle").classList.remove("active");
  document.getElementById("failure-toggle").classList.remove("active");
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

  select.innerHTML += `<option value="__custom__">+ Add new exercise</option>`;
  onExerciseChange();
}

function onExerciseChange() {
  const id = document.getElementById("exercise-select").value;

  if (id === "__custom__") {
    document.getElementById("custom-exercise-form").style.display = "block";
    document.getElementById("resistance-fields").style.display = "none";
    document.getElementById("timed-fields").style.display = "none";
    document.getElementById("target-display").textContent = "";
    return;
  }

  document.getElementById("custom-exercise-form").style.display = "none";

  const ex = exercises.find(e => e.id === id);
  if (!ex) return;

  const isTimed = ex.subtype === "timed_hold";
  document.getElementById("resistance-fields").style.display = isTimed ? "none" : "block";
  document.getElementById("timed-fields").style.display = isTimed ? "block" : "none";

  showTarget(ex);
}

function onCustomCategoryChange() {
  const category = document.getElementById("custom-exercise-category").value;
  document.getElementById("custom-subtype-field").style.display = category === "bodyweight" ? "block" : "none";
}

async function saveCustomExercise() {
  const name = document.getElementById("custom-exercise-name").value.trim();
  if (!name) { setStatus("Type a name for the exercise first."); return; }

  const category = document.getElementById("custom-exercise-category").value;
  const subtype = category === "bodyweight" ? document.getElementById("custom-exercise-subtype").value : null;
  const muscleGroup = document.getElementById("custom-exercise-muscle-group").value;

  const { data, error } = await sb.from("exercises").insert({ name, category, subtype, muscle_group: muscleGroup }).select().single();

  if (error) { setStatus("Couldn't save, check your connection and try again."); return; }

  exercises.push(data);
  localStorage.setItem("exercises_cache", JSON.stringify(exercises));
  populateExerciseDropdowns();
  document.getElementById("exercise-select").value = data.id;
  document.getElementById("custom-exercise-name").value = "";
  onExerciseChange();
  setStatus(`"${name}" added.`);
}

// ============================================
// TARGET CALCULATION (average of last 3 sessions)
// ============================================

async function showTarget(exercise) {
  const { data, error } = await sb
    .from("logged_sets")
    .select("*")
    .eq("exercise_id", exercise.id)
    .eq("is_warmup", false)
    .order("created_at", { ascending: false })
    .limit(3);

  const display = document.getElementById("target-display");

  if (error || !data || data.length === 0) {
    display.textContent = "No history yet, log a few sets to start getting targets.";
    return;
  }

  const avgReps = Math.round(data.reduce((s, x) => s + (x.reps || 0), 0) / data.length);
  const avgWeight = Math.round(data.reduce((s, x) => s + (x.weight_lbs || 0), 0) / data.length);
  const avgDuration = Math.round(data.reduce((s, x) => s + (x.duration_seconds || 0), 0) / data.length);
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
  const date = document.getElementById("log-date-input").value || todayDate();
  const dayLabel = document.getElementById("day-label-input").value.trim() || null;
  const caloriesBurned = parseFloat(document.getElementById("calories-burned-input").value) || null;

  const { data: existing } = await sb.from("workout_days").select("*").eq("date", date).single();

  if (existing) {
    // Only touch fields that actually have a new value, so an empty field
    // here doesn't wipe out something you already saved earlier today.
    const updates = {};
    if (dayLabel) updates.day_label = dayLabel;
    if (caloriesBurned) updates.calories_burned = caloriesBurned;
    if (isRestDay) updates.is_rest_day = true;

    if (Object.keys(updates).length > 0) {
      const { data: updated } = await sb.from("workout_days").update(updates).eq("id", existing.id).select().single();
      return updated || existing;
    }
    return existing;
  }

  const { data, error } = await sb
    .from("workout_days")
    .insert({ date, is_rest_day: isRestDay, day_label: dayLabel, calories_burned: caloriesBurned })
    .select()
    .single();

  if (error) return { id: "local-" + date, date, is_rest_day: isRestDay };
  return data;
}

async function logRestDay() {
  await getOrCreateWorkoutDay(true);
  setStatus("Today logged as a rest day.");
}

// ============================================
// ADD A SET / REPEAT LAST SET
// ============================================

function buildSetRow(dayId, exerciseId, exercise) {
  return {
    workout_day_id: dayId,
    exercise_id: exerciseId,
    set_number: todaysSets.filter(s => s.exercise_id === exerciseId).length + 1,
    weight_lbs: exercise.subtype ? null : parseFloat(document.getElementById("weight-input-lbs").value) || null,
    reps: exercise.subtype === "timed_hold" ? null : parseInt(document.getElementById("reps-input").value) || null,
    duration_seconds: exercise.subtype === "timed_hold" ? parseInt(document.getElementById("duration-input").value) || null : null,
    difficulty: document.getElementById("difficulty-select").value,
    rest_time_seconds: parseInt(document.getElementById("rest-time-input").value) || null,
    side: document.getElementById("side-select").value,
    is_warmup: activeFlags.warmup,
    is_failure: activeFlags.failure,
    notes: document.getElementById("notes-input").value || null
  };
}

async function addSet() {
  const exerciseId = document.getElementById("exercise-select").value;
  if (exerciseId === "__custom__") { setStatus("Save the new exercise first."); return; }

  const exercise = exercises.find(e => e.id === exerciseId);
  const day = await getOrCreateWorkoutDay(false);
  const row = buildSetRow(day.id, exerciseId, exercise);
  const tempId = "temp-" + Date.now() + "-" + Math.random().toString(36).slice(2);

  const { data, error } = await sb.from("logged_sets").insert(row).select().single();

  if (error) {
    queueOffline("logged_sets", { ...row, __tempId: tempId });
  } else {
    setStatus("Set saved.");
  }

  todaysSets.push({ ...row, exercise_name: exercise.name, tempId, dbId: data ? data.id : null });
  lastSetConfig = { exerciseId, row: { ...row } };
  renderTodaysSets();

  document.getElementById("notes-input").value = "";
  document.getElementById("weight-input-lbs").value = "";
  document.getElementById("weight-input-kg").value = "";
  resetFlags();
}

async function deleteSet(tempId) {
  const set = todaysSets.find(s => s.tempId === tempId);
  if (!set) return;

  if (set.dbId) {
    // Already saved to Supabase, delete it there too
    await sb.from("logged_sets").delete().eq("id", set.dbId);
  } else {
    // Still sitting in the offline queue, never made it to Supabase yet
    const queue = JSON.parse(localStorage.getItem("offline_queue") || "[]");
    const filtered = queue.filter(item => item.row.__tempId !== tempId);
    localStorage.setItem("offline_queue", JSON.stringify(filtered));
  }

  todaysSets = todaysSets.filter(s => s.tempId !== tempId);
  renderTodaysSets();
  setStatus("Set deleted.");
}

// Pre-fills the form with your last saved set so you're not re-selecting
// the exercise and retyping everything for back-to-back sets.
function repeatLastSet() {
  if (!lastSetConfig) { setStatus("No previous set to repeat yet."); return; }

  document.getElementById("exercise-select").value = lastSetConfig.exerciseId;
  onExerciseChange();

  const r = lastSetConfig.row;
  if (r.weight_lbs != null) {
    document.getElementById("weight-input-lbs").value = r.weight_lbs;
    syncWeight("lbs");
  }
  if (r.reps != null) document.getElementById("reps-input").value = r.reps;
  if (r.duration_seconds != null) document.getElementById("duration-input").value = r.duration_seconds;
  document.getElementById("difficulty-select").value = r.difficulty;
  document.getElementById("rest-time-input").value = r.rest_time_seconds || "";
  document.getElementById("side-select").value = r.side || "both";

  activeFlags = { warmup: r.is_warmup, failure: r.is_failure };
  document.getElementById("warmup-toggle").classList.toggle("active", activeFlags.warmup);
  document.getElementById("failure-toggle").classList.toggle("active", activeFlags.failure);

  setStatus("Loaded last set, adjust and tap Add Set.");
}

function renderTodaysSets() {
  const body = document.getElementById("todays-sets-body");
  body.innerHTML = "";
  todaysSets.forEach(s => {
    const weightOrDuration = s.duration_seconds ? `${s.duration_seconds}s` : formatBothUnits(s.weight_lbs);
    const flags = [s.is_warmup ? "Warm-up" : null, s.is_failure ? "Failure" : null, s.side !== "both" ? s.side : null].filter(Boolean).join(", ");
    body.innerHTML += `<tr><td>${s.exercise_name}</td><td>${weightOrDuration}</td><td>${s.reps ?? "-"}</td><td>${flags || "-"}</td><td><button class="secondary small-btn" onclick="deleteSet('${s.tempId}')">Delete</button></td></tr>`;
  });
}

// ============================================
// BODY WEIGHT
// ============================================

async function logBodyWeight() {
  const value = parseFloat(document.getElementById("bodyweight-input-lbs").value);
  if (!value) return;

  const date = document.getElementById("bodyweight-date-input").value || todayDate();
  const row = { date, weight_lbs: value };
  const { error } = await sb.from("body_weight_log").upsert(row, { onConflict: "date" });

  if (error) { queueOffline("body_weight_log", row); } else { setStatus("Body weight saved."); renderBodyWeightChart(); }
}

async function deleteBodyWeight(id) {
  await sb.from("body_weight_log").delete().eq("id", id);
  renderBodyWeightChart();
  setStatus("Entry deleted.");
}

async function renderBodyWeightChart() {
  let data;
  try {
    const res = await sb.from("body_weight_log").select("*").order("date", { ascending: true });
    if (res.error || !res.data) throw res.error || new Error("no data");
    data = res.data;
    localStorage.setItem("bodyweight_cache", JSON.stringify(data));
  } catch (err) {
    data = JSON.parse(localStorage.getItem("bodyweight_cache") || "[]");
    setStatus("Offline: showing last saved body weight data.");
  }

  // Merge in anything logged this session that hasn't synced to Supabase yet,
  // so you can see it in the list immediately instead of it looking lost.
  const queue = JSON.parse(localStorage.getItem("offline_queue") || "[]");
  const pending = queue.filter(item => item.table === "body_weight_log").map(item => ({ ...item.row, id: null }));

  const merged = [...data];
  pending.forEach(p => {
    const idx = merged.findIndex(d => d.date === p.date);
    if (idx >= 0) merged[idx] = p; else merged.push(p);
  });
  merged.sort((a, b) => a.date.localeCompare(b.date));

  drawChart("bodyweight-chart", { labels: merged.map(d => d.date), values: merged.map(d => d.weight_lbs) }, "Body Weight (lbs)");

  const body = document.getElementById("bodyweight-entries-body");
  body.innerHTML = "";
  [...merged].reverse().forEach(d => {
    const deleteBtn = d.id
      ? `<button class="secondary small-btn" onclick="deleteBodyWeight('${d.id}')">Delete</button>`
      : `<span class="conversion-hint">pending sync</span>`;
    body.innerHTML += `<tr><td>${d.date}</td><td>${formatBothUnits(d.weight_lbs)}</td><td>${deleteBtn}</td></tr>`;
  });
}

// ============================================
// CALENDAR HEATMAP
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
    if (cellDate > now) {
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

  const { data } = await sb.from("logged_sets").select("*").eq("exercise_id", exerciseId).eq("is_warmup", false).order("created_at", { ascending: true });
  if (!data) return;

  drawChart("strength-chart", {
    labels: data.map(d => new Date(d.created_at).toLocaleDateString()),
    values: data.map(d => d.weight_lbs ?? d.duration_seconds ?? d.reps)
  }, "Progress (working sets only)");
}

async function renderVolumeChart() {
  const { data } = await sb.from("logged_sets").select("*").eq("is_warmup", false).order("created_at", { ascending: true });
  if (!data) return;

  const volumeByDay = {};
  data.forEach(s => {
    if (!s.weight_lbs || !s.reps) return;
    const day = new Date(s.created_at).toLocaleDateString();
    volumeByDay[day] = (volumeByDay[day] || 0) + s.weight_lbs * s.reps;
  });

  drawChart("volume-chart", { labels: Object.keys(volumeByDay), values: Object.values(volumeByDay) }, "Volume (lbs)");
}

async function renderMuscleGroupChart() {
  // Embedded query: pulls each logged set together with its exercise's muscle group in one call.
  const { data } = await sb
    .from("logged_sets")
    .select("weight_lbs, reps, is_warmup, exercises(muscle_group)")
    .eq("is_warmup", false);

  if (!data) return;

  const volumeByGroup = {};
  data.forEach(s => {
    const group = s.exercises?.muscle_group || "Other";
    if (!s.weight_lbs || !s.reps) return;
    volumeByGroup[group] = (volumeByGroup[group] || 0) + s.weight_lbs * s.reps;
  });

  const ctx = document.getElementById("muscle-group-chart").getContext("2d");
  if (chartInstances["muscle-group-chart"]) chartInstances["muscle-group-chart"].destroy();

  chartInstances["muscle-group-chart"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(volumeByGroup),
      datasets: [{ label: "Volume (lbs)", data: Object.values(volumeByGroup), backgroundColor: "#e5484d" }]
    },
    options: {
      scales: { x: { ticks: { color: "#8b8d92" }, grid: { display: false } }, y: { ticks: { color: "#8b8d92" }, grid: { color: "#2a2d32" } } },
      plugins: { legend: { display: false } }
    }
  });
}

async function renderConsistencyStats() {
  const { data } = await sb.from("workout_days").select("*").order("date", { ascending: true });
  const box = document.getElementById("consistency-stats");
  if (!data || data.length === 0) { box.innerHTML = "<p>No data yet.</p>"; return; }

  const workoutDays = data.filter(d => !d.is_rest_day).length;
  const restDays = data.filter(d => d.is_rest_day).length;
  const firstDate = new Date(data[0].date);
  const totalDaysInRange = Math.round((new Date() - firstDate) / 86400000) + 1;
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
    data: { labels: dataset.labels, datasets: [{ label, data: dataset.values, borderColor: "#e5484d", backgroundColor: "rgba(229,72,77,0.1)", fill: true, tension: 0.3 }] },
    options: {
      scales: { x: { ticks: { color: "#8b8d92" }, grid: { color: "#2a2d32" } }, y: { ticks: { color: "#8b8d92" }, grid: { color: "#2a2d32" } } },
      plugins: { legend: { labels: { color: "#f5f4f0" } } }
    }
  });
}

// ============================================
// FORCE REFRESH
// ============================================

async function forceRefresh() {
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  }
  location.reload(true);
}

// ============================================
// INIT
// ============================================

window.addEventListener("load", () => {
  loadExercises();
  syncOfflineQueue();
  updateConnectionIndicator();
  document.getElementById("tab-log").classList.add("active");
  document.getElementById("log-date-input").value = todayDate();
  document.getElementById("bodyweight-date-input").value = todayDate();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
  }
});
