-- ============================================
-- GYM TRACKER DATABASE SCHEMA
-- Run this in Supabase SQL Editor (Project > SQL Editor > New Query)
-- ============================================

-- 1. EXERCISE LIBRARY
-- The master list of exercises you can log against.
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('resistance', 'bodyweight')),
  subtype text check (subtype in ('reps', 'timed_hold')), -- only used for bodyweight
  created_at timestamptz default now()
);

-- 2. WORKOUT DAYS
-- One row per calendar day you interact with the app (workout OR rest day).
create table workout_days (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  is_rest_day boolean default false,
  day_label text, -- optional tag like "Shoulders/Biceps/Legs"
  created_at timestamptz default now()
);

-- 3. PLANNED SETS
-- The target for an exercise on a given day, set before or during the gym session.
-- target_reps_min/max used for resistance + bodyweight reps.
-- target_duration_seconds used for timed holds.
create table planned_sets (
  id uuid primary key default gen_random_uuid(),
  workout_day_id uuid references workout_days(id) on delete cascade,
  exercise_id uuid references exercises(id) on delete cascade,
  target_reps_min int,
  target_reps_max int,
  target_duration_seconds int,
  target_weight_lbs numeric, -- suggested weight, resistance only
  created_at timestamptz default now()
);

-- 4. LOGGED SETS
-- What actually happened. Linked to a planned set if one existed, but can stand alone
-- (freestyle sets with no plan are allowed).
create table logged_sets (
  id uuid primary key default gen_random_uuid(),
  workout_day_id uuid references workout_days(id) on delete cascade,
  exercise_id uuid references exercises(id) on delete cascade,
  planned_set_id uuid references planned_sets(id) on delete set null,
  set_number int not null default 1, -- 1st, 2nd, 3rd set of that exercise that day
  weight_lbs numeric, -- resistance only
  reps int, -- resistance + bodyweight reps
  duration_seconds int, -- timed holds only
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  rest_time_seconds int,
  notes text,
  synced boolean default true, -- flips to false locally when offline, true once synced
  created_at timestamptz default now()
);

-- 5. BODY WEIGHT LOG
-- Weekly entries, independent of workout sessions.
create table body_weight_log (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  weight_lbs numeric not null,
  created_at timestamptz default now()
);

-- ============================================
-- INDEXES for dashboard query speed
-- ============================================
create index idx_logged_sets_exercise on logged_sets(exercise_id);
create index idx_logged_sets_day on logged_sets(workout_day_id);
create index idx_planned_sets_exercise on planned_sets(exercise_id);
create index idx_workout_days_date on workout_days(date);

-- ============================================
-- ROW LEVEL SECURITY
-- No login for now, so we allow full public access via the anon key.
-- This is intentionally open. Revisit if you add auth later.
-- ============================================
alter table exercises enable row level security;
alter table workout_days enable row level security;
alter table planned_sets enable row level security;
alter table logged_sets enable row level security;
alter table body_weight_log enable row level security;

create policy "public full access" on exercises for all using (true) with check (true);
create policy "public full access" on workout_days for all using (true) with check (true);
create policy "public full access" on planned_sets for all using (true) with check (true);
create policy "public full access" on logged_sets for all using (true) with check (true);
create policy "public full access" on body_weight_log for all using (true) with check (true);

-- ============================================
-- SEED DATA: starter exercise library
-- Based on your typical split (shoulders/biceps/legs, chest/triceps/legs, abs/cardio,
-- occasional dead hang/pull-up work). Add more anytime from the app later.
-- ============================================
insert into exercises (name, category, subtype) values
  ('Shoulder Press', 'resistance', null),
  ('Lateral Raise', 'resistance', null),
  ('Bicep Curl', 'resistance', null),
  ('Hammer Curl', 'resistance', null),
  ('Leg Press', 'resistance', null),
  ('Leg Extension', 'resistance', null),
  ('Squat', 'resistance', null),
  ('Bench Press', 'resistance', null),
  ('Incline Bench Press', 'resistance', null),
  ('Chest Fly', 'resistance', null),
  ('Tricep Pushdown', 'resistance', null),
  ('Overhead Tricep Extension', 'resistance', null),
  ('Leg Curl', 'resistance', null),
  ('Calf Raise', 'resistance', null),
  ('Plank', 'bodyweight', 'timed_hold'),
  ('Dead Hang', 'bodyweight', 'timed_hold'),
  ('Pull-Up', 'bodyweight', 'reps'),
  ('Sit-Up', 'bodyweight', 'reps'),
  ('Crunches', 'bodyweight', 'reps');
