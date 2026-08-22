// ============================================
// SETUP
// ============================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let exercises = [];
let routines = [];
let todaysSets = [];
let currentBlock = []; // sets being built for whichever exercise is selected right now
let lastBlockConfig = null; // used by "Repeat last exercise"
let adminUnlocked = false;
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
  let syncedExercise = false;

  for (const item of queue) {
    // __tempId is just local bookkeeping, strip it before sending to Supabase
    const { __tempId, ...cleanRow } = item.row;

    const query = item.table === "body_weight_log"
      ? sb.from(item.table).upsert(cleanRow, { onConflict: "date" }).select().single()
      : sb.from(item.table).insert(cleanRow).select().single();

    const { data, error } = await query;

    if (error) {
      remaining.push(item);
      continue;
    }

    // A custom exercise created offline just got its real Supabase id.
    // Anything else still in the queue (like a logged set made against it)
    // was using the temporary local id, patch those references now.
    if (item.table === "exercises" && __tempId) {
      syncedExercise = true;
      queue.forEach(other => {
        if (other !== item && other.row.exercise_id === __tempId) {
          other.row.exercise_id = data.id;
        }
      });
      exercises = exercises.map(ex => (ex.id === __tempId ? data : ex));
      localStorage.setItem("exercises_cache", JSON.stringify(exercises));
      todaysSets.forEach(s => { if (s.exercise_id === __tempId) s.exercise_id = data.id; });
    }
  }

  localStorage.setItem("offline_queue", JSON.stringify(remaining));

  if (syncedExercise) {
    populateExerciseDropdowns();
    renderTodaysSets();
  }

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
  document.getElementById("admin-screen").style.display = "none";

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
  const routineMultiSelect = document.getElementById("new-routine-exercises");
  select.innerHTML = "";
  dashSelect.innerHTML = "";
  if (routineMultiSelect) routineMultiSelect.innerHTML = "";

  exercises.forEach(ex => {
    const label = ex.id.startsWith("local-") ? `${ex.name} (pending sync)` : ex.name;
    const opt = `<option value="${ex.id}">${label}</option>`;
    select.innerHTML += opt;
    dashSelect.innerHTML += opt;
    if (routineMultiSelect) routineMultiSelect.innerHTML += opt;
  });

  select.innerHTML += `<option value="__custom__">+ Add new exercise</option>`;
  onExerciseChange();
}

function onExerciseChange() {
  const id = document.getElementById("exercise-select").value;

  if (id === "__custom__") {
    document.getElementById("custom-exercise-form").style.display = "block";
    document.getElementById("resistance-fields").style.display = "none";
    document.getElementById("target-display").textContent = "";
    currentBlock = [];
    renderBlockSets();
    return;
  }

  document.getElementById("custom-exercise-form").style.display = "none";

  const ex = exercises.find(e => e.id === id);
  if (!ex) return;

  const showsWeight = !ex.subtype; // plain resistance exercises carry a weight
  document.getElementById("resistance-fields").style.display = showsWeight ? "block" : "none";

  showTarget(ex);

  // Start a fresh block of one empty set whenever the exercise changes
  currentBlock = [{ value: "", weightOverride: null, is_warmup: false, is_failure: false }];
  renderBlockSets();
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
  const row = { name, category, subtype, muscle_group: muscleGroup };

  const { data, error } = await sb.from("exercises").insert(row).select().single();

  let savedExercise;
  if (error) {
    const tempId = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    savedExercise = { ...row, id: tempId };
    queueOffline("exercises", { ...row, __tempId: tempId });
  } else {
    savedExercise = data;
    setStatus(`"${name}" added.`);
  }

  exercises.push(savedExercise);
  localStorage.setItem("exercises_cache", JSON.stringify(exercises));
  populateExerciseDropdowns();
  document.getElementById("exercise-select").value = savedExercise.id;
  document.getElementById("custom-exercise-name").value = "";
  onExerciseChange();
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
// SET BLOCK BUILDER (log multiple sets of one exercise at once)
// ============================================

function currentExercise() {
  const id = document.getElementById("exercise-select").value;
  return exercises.find(e => e.id === id);
}

function currentExerciseIsTimed() {
  const ex = currentExercise();
  return !!ex && ex.subtype === "timed_hold";
}

function currentExerciseShowsWeight() {
  const ex = currentExercise();
  return !!ex && !ex.subtype;
}

function addBlockSet() {
  const prev = currentBlock[currentBlock.length - 1];
  currentBlock.push({
    value: prev ? prev.value : "",
    weightOverride: null,
    is_warmup: false,
    is_failure: false
  });
  renderBlockSets();
}

function removeBlockSet(index) {
  currentBlock.splice(index, 1);
  if (currentBlock.length === 0) {
    currentBlock.push({ value: "", weightOverride: null, is_warmup: false, is_failure: false });
  }
  renderBlockSets();
}

function updateBlockValue(index, value) {
  currentBlock[index].value = value;
}

function toggleBlockFlag(index, flag) {
  const key = flag === "warmup" ? "is_warmup" : "is_failure";
  currentBlock[index][key] = !currentBlock[index][key];
  renderBlockSets();
}

function toggleBlockWeightOverride(index) {
  if (currentBlock[index].weightOverride === null) {
    const shared = parseFloat(document.getElementById("weight-input-lbs").value) || 0;
    currentBlock[index].weightOverride = shared;
  } else {
    currentBlock[index].weightOverride = null;
  }
  renderBlockSets();
}

function updateBlockWeightOverride(index, value) {
  currentBlock[index].weightOverride = parseFloat(value) || 0;
}

function renderBlockSets() {
  const container = document.getElementById("sets-builder");
  if (!container) return;
  const isTimed = currentExerciseIsTimed();
  const showWeight = currentExerciseShowsWeight();

  container.innerHTML = currentBlock.map((s, i) => `
    <div class="set-row">
      <span class="set-num">${i + 1}</span>
      <input type="number" class="set-value-input" placeholder="${isTimed ? 'sec' : 'reps'}" value="${s.value}" oninput="updateBlockValue(${i}, this.value)">
      ${showWeight ? (
        s.weightOverride === null
          ? `<button type="button" class="set-weight-btn" onclick="toggleBlockWeightOverride(${i})">same wt</button>`
          : `<input type="number" class="set-value-input set-weight-input" placeholder="lbs" value="${s.weightOverride}" oninput="updateBlockWeightOverride(${i}, this.value)">`
      ) : ""}
      <button type="button" class="set-flag-btn ${s.is_warmup ? "active" : ""}" onclick="toggleBlockFlag(${i},'warmup')">W</button>
      <button type="button" class="set-flag-btn ${s.is_failure ? "active" : ""}" onclick="toggleBlockFlag(${i},'failure')">F</button>
      <button type="button" class="set-remove-btn" onclick="removeBlockSet(${i})">✕</button>
    </div>
  `).join("");
}

async function saveOneSet(dayId, exerciseId, exercise, blockRow) {
  const sharedWeight = parseFloat(document.getElementById("weight-input-lbs").value) || null;
  const row = {
    workout_day_id: dayId,
    exercise_id: exerciseId,
    set_number: todaysSets.filter(s => s.exercise_id === exerciseId).length + 1,
    weight_lbs: exercise.subtype ? null : (blockRow.weightOverride !== null ? blockRow.weightOverride : sharedWeight),
    reps: exercise.subtype === "timed_hold" ? null : parseInt(blockRow.value) || null,
    duration_seconds: exercise.subtype === "timed_hold" ? parseInt(blockRow.value) || null : null,
    difficulty: document.getElementById("difficulty-select").value,
    rest_time_seconds: null,
    side: document.getElementById("side-select").value,
    is_warmup: blockRow.is_warmup,
    is_failure: blockRow.is_failure,
    notes: document.getElementById("notes-input").value || null
  };

  const tempId = "temp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const { data, error } = await sb.from("logged_sets").insert(row).select().single();

  if (error) {
    queueOffline("logged_sets", { ...row, __tempId: tempId });
  }

  todaysSets.push({ ...row, exercise_name: exercise.name, tempId, dbId: data ? data.id : null });
}

async function logAllSets() {
  const exerciseId = document.getElementById("exercise-select").value;
  if (exerciseId === "__custom__") { setStatus("Save the new exercise first."); return; }

  const exercise = exercises.find(e => e.id === exerciseId);
  if (!exercise) return;

  const validSets = currentBlock.filter(s => s.value !== "" && s.value != null);
  if (validSets.length === 0) { setStatus("Enter at least one set before logging."); return; }

  const day = await getOrCreateWorkoutDay(false);

  for (const blockRow of validSets) {
    await saveOneSet(day.id, exerciseId, exercise, blockRow);
  }

  lastBlockConfig = {
    exerciseId,
    sharedWeightLbs: document.getElementById("weight-input-lbs").value,
    difficulty: document.getElementById("difficulty-select").value,
    side: document.getElementById("side-select").value,
    sets: JSON.parse(JSON.stringify(validSets))
  };

  renderTodaysSets();
  setStatus(`${validSets.length} set${validSets.length > 1 ? "s" : ""} logged.`);

  document.getElementById("notes-input").value = "";
  document.getElementById("weight-input-lbs").value = "";
  document.getElementById("weight-input-kg").value = "";
  currentBlock = [{ value: "", weightOverride: null, is_warmup: false, is_failure: false }];
  renderBlockSets();
}

function repeatLastBlock() {
  if (!lastBlockConfig) { setStatus("No previous exercise to repeat yet."); return; }

  document.getElementById("exercise-select").value = lastBlockConfig.exerciseId;
  onExerciseChange();

  document.getElementById("weight-input-lbs").value = lastBlockConfig.sharedWeightLbs;
  syncWeight("lbs");
  document.getElementById("difficulty-select").value = lastBlockConfig.difficulty;
  document.getElementById("side-select").value = lastBlockConfig.side;

  currentBlock = JSON.parse(JSON.stringify(lastBlockConfig.sets)).map(s => ({ ...s, is_warmup: false, is_failure: false }));
  renderBlockSets();

  setStatus("Loaded last exercise's sets, adjust and tap Log these sets.");
}

async function deleteSet(tempId) {
  const set = todaysSets.find(s => s.tempId === tempId);
  if (!set) return;

  if (set.dbId) {
    await sb.from("logged_sets").delete().eq("id", set.dbId);
  } else {
    const queue = JSON.parse(localStorage.getItem("offline_queue") || "[]");
    const filtered = queue.filter(item => item.row.__tempId !== tempId);
    localStorage.setItem("offline_queue", JSON.stringify(filtered));
  }

  todaysSets = todaysSets.filter(s => s.tempId !== tempId);
  renderTodaysSets();
  setStatus("Set deleted.");
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
// ROUTINES
// ============================================

async function loadRoutines() {
  try {
    const { data, error } = await sb.from("routines").select("*");
    if (error || !data) throw error || new Error("No data");
    routines = data;
    localStorage.setItem("routines_cache", JSON.stringify(data));
  } catch (err) {
    routines = JSON.parse(localStorage.getItem("routines_cache") || "[]");
  }
  populateRoutineDropdown();
}

function populateRoutineDropdown() {
  const select = document.getElementById("routine-select");
  if (!select) return;
  select.innerHTML = `<option value="">-- Choose a routine --</option>`;
  routines.forEach(r => {
    select.innerHTML += `<option value="${r.id}">${r.name}</option>`;
  });
}

function loadRoutine() {
  const id = document.getElementById("routine-select").value;
  const routine = routines.find(r => r.id === id);
  const chipContainer = document.getElementById("routine-chips");
  if (!routine) { chipContainer.innerHTML = ""; return; }

  document.getElementById("day-label-input").value = routine.name;

  chipContainer.innerHTML = (routine.exercise_ids || []).map(exId => {
    const ex = exercises.find(e => e.id === exId);
    if (!ex) return "";
    return `<button type="button" class="chip" onclick="selectExerciseFromChip('${exId}')">${ex.name}</button>`;
  }).join("");

  setStatus(`Loaded "${routine.name}". Tap an exercise chip to log it.`);
}

function selectExerciseFromChip(exerciseId) {
  document.getElementById("exercise-select").value = exerciseId;
  onExerciseChange();
  document.getElementById("exercise-select").scrollIntoView({ behavior: "smooth", block: "center" });
}

function openSaveRoutine() {
  document.getElementById("save-routine-form").style.display = "block";
}

async function saveRoutine() {
  const name = document.getElementById("new-routine-name").value.trim();
  if (!name) { setStatus("Type a name for the routine first."); return; }

  const select = document.getElementById("new-routine-exercises");
  const exerciseIds = Array.from(select.selectedOptions).map(o => o.value);
  if (exerciseIds.length === 0) { setStatus("Select at least one exercise for the routine."); return; }

  const row = { name, exercise_ids: exerciseIds };
  const { data, error } = await sb.from("routines").insert(row).select().single();

  if (error) {
    setStatus("Couldn't save the routine, check your connection and try again.");
    return;
  }

  routines.push(data);
  localStorage.setItem("routines_cache", JSON.stringify(routines));
  populateRoutineDropdown();
  document.getElementById("new-routine-name").value = "";
  document.getElementById("save-routine-form").style.display = "none";
  setStatus(`Routine "${name}" saved.`);
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
// ADMIN PANEL
// ============================================

function openAdmin() {
  document.getElementById("log-screen").style.display = "none";
  document.getElementById("dashboard-screen").style.display = "none";
  document.getElementById("bodyweight-screen").style.display = "none";
  document.getElementById("admin-screen").style.display = "block";

  document.getElementById("admin-pin-card").style.display = adminUnlocked ? "none" : "block";
  document.getElementById("admin-content").style.display = adminUnlocked ? "block" : "none";
  document.getElementById("admin-exercises-card").style.display = adminUnlocked ? "block" : "none";

  if (adminUnlocked) {
    document.getElementById("admin-date-input").value = todayDate();
    loadAdminDay();
    loadAdminExercises();
  }
}

function closeAdmin() {
  document.getElementById("admin-screen").style.display = "none";
  showTab("log");
}

function checkAdminPin() {
  const entered = document.getElementById("admin-pin-input").value;
  if (entered === ADMIN_PIN) {
    adminUnlocked = true;
    document.getElementById("admin-pin-input").value = "";
    openAdmin();
  } else {
    setStatus("Wrong PIN.");
  }
}

async function loadAdminDay() {
  const date = document.getElementById("admin-date-input").value;
  if (!date) return;

  const { data: day } = await sb.from("workout_days").select("*").eq("date", date).single();
  const info = document.getElementById("admin-day-info");
  const body = document.getElementById("admin-sets-body");
  body.innerHTML = "";
  window.__adminCurrentDay = day || null;

  if (!day) {
    info.textContent = "No workout day logged for this date.";
    return;
  }

  info.textContent = `${day.is_rest_day ? "Rest day" : (day.day_label || "Workout day")}${day.calories_burned ? ` · ${day.calories_burned} cal` : ""}`;

  const { data: sets } = await sb
    .from("logged_sets")
    .select("*, exercises(name)")
    .eq("workout_day_id", day.id)
    .order("created_at", { ascending: true });

  (sets || []).forEach(s => {
    const weightOrDuration = s.duration_seconds ? `${s.duration_seconds}s` : formatBothUnits(s.weight_lbs);
    const flags = [s.is_warmup ? "Warm-up" : null, s.is_failure ? "Failure" : null].filter(Boolean).join(", ");
    body.innerHTML += `<tr><td>${s.exercises?.name || "?"}</td><td>${weightOrDuration}</td><td>${s.reps ?? "-"}</td><td>${flags || "-"}</td><td><button class="secondary small-btn" onclick="deleteAdminSet('${s.id}')">Delete</button></td></tr>`;
  });
}

async function deleteAdminSet(id) {
  await sb.from("logged_sets").delete().eq("id", id);
  loadAdminDay();
  setStatus("Set deleted.");
}

async function deleteAdminWorkoutDay() {
  const day = window.__adminCurrentDay;
  if (!day) { setStatus("No day loaded for this date."); return; }
  await sb.from("workout_days").delete().eq("id", day.id);
  loadAdminDay();
  setStatus("Day deleted.");
}

function loadAdminExercises() {
  const body = document.getElementById("admin-exercises-body");
  body.innerHTML = "";
  exercises.forEach(ex => {
    if (ex.id.startsWith("local-")) return; // not synced yet, nothing to delete server-side
    body.innerHTML += `<tr><td>${ex.name}</td><td>${ex.muscle_group || "-"}</td><td><button class="secondary small-btn" onclick="deleteAdminExercise('${ex.id}')">Delete</button></td></tr>`;
  });
}

async function deleteAdminExercise(id) {
  await sb.from("exercises").delete().eq("id", id);
  await loadExercises();
  loadAdminExercises();
  setStatus("Exercise removed from library.");
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
  loadRoutines();
  syncOfflineQueue();
  updateConnectionIndicator();
  document.getElementById("tab-log").classList.add("active");
  document.getElementById("log-date-input").value = todayDate();
  document.getElementById("bodyweight-date-input").value = todayDate();
  renderBlockSets();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js");
  }
});
