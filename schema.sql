-- ============================================
-- GYM TRACKER DATABASE SCHEMA (v2)
-- Run this in Supabase SQL Editor. Safe to re-run, drops old tables first.
-- ============================================

drop table if exists logged_sets cascade;
drop table if exists planned_sets cascade;
drop table if exists workout_days cascade;
drop table if exists body_weight_log cascade;
drop table if exists exercises cascade;

-- 1. EXERCISE LIBRARY
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('resistance', 'bodyweight')),
  subtype text check (subtype in ('reps', 'timed_hold')),
  muscle_group text,
  created_at timestamptz default now()
);

-- 2. WORKOUT DAYS
create table workout_days (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  is_rest_day boolean default false,
  day_label text,
  calories_burned numeric,
  created_at timestamptz default now()
);

-- 3. PLANNED SETS (targets set ahead of time)
create table planned_sets (
  id uuid primary key default gen_random_uuid(),
  workout_day_id uuid references workout_days(id) on delete cascade,
  exercise_id uuid references exercises(id) on delete cascade,
  target_reps_min int,
  target_reps_max int,
  target_duration_seconds int,
  target_weight_lbs numeric,
  created_at timestamptz default now()
);

-- 4. LOGGED SETS (what actually happened)
create table logged_sets (
  id uuid primary key default gen_random_uuid(),
  workout_day_id uuid references workout_days(id) on delete cascade,
  exercise_id uuid references exercises(id) on delete cascade,
  planned_set_id uuid references planned_sets(id) on delete set null,
  set_number int not null default 1,
  weight_lbs numeric,
  reps int,
  duration_seconds int,
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  rest_time_seconds int,
  side text check (side in ('left', 'right', 'both')),
  is_warmup boolean default false,
  is_failure boolean default false,
  notes text,
  synced boolean default true,
  created_at timestamptz default now()
);

-- 5. BODY WEIGHT LOG
create table body_weight_log (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  weight_lbs numeric not null,
  created_at timestamptz default now()
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_logged_sets_exercise on logged_sets(exercise_id);
create index idx_logged_sets_day on logged_sets(workout_day_id);
create index idx_planned_sets_exercise on planned_sets(exercise_id);
create index idx_workout_days_date on workout_days(date);

-- ============================================
-- ROW LEVEL SECURITY (open, no login system)
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
-- SEED DATA: exercise library based on actual logged sessions
-- ============================================
insert into exercises (name, category, subtype, muscle_group) values
  ('Machine Shoulder Press', 'resistance', null, 'Shoulders'),
  ('Bench Press', 'resistance', null, 'Chest'),
  ('Incline Bench Press', 'resistance', null, 'Chest'),
  ('Incline Dumbbell Press', 'resistance', null, 'Chest'),
  ('Chest Fly', 'resistance', null, 'Chest'),
  ('Leg Press', 'resistance', null, 'Legs'),
  ('Leg Extension', 'resistance', null, 'Legs'),
  ('Leg Curl', 'resistance', null, 'Legs'),
  ('Squat', 'resistance', null, 'Legs'),
  ('Calf Raise', 'resistance', null, 'Legs'),
  ('Bicep Curl', 'resistance', null, 'Biceps'),
  ('Hammer Curl', 'resistance', null, 'Biceps'),
  ('Zottman Curl', 'resistance', null, 'Biceps'),
  ('Incline Curl', 'resistance', null, 'Biceps'),
  ('Lateral Raise', 'resistance', null, 'Shoulders'),
  ('Reverse Dumbbell Fly', 'resistance', null, 'Shoulders'),
  ('Dumbbell Shrug', 'resistance', null, 'Shoulders'),
  ('Tricep Pushdown', 'resistance', null, 'Triceps'),
  ('Overhead Tricep Extension', 'resistance', null, 'Triceps'),
  ('Tricep Extension Machine', 'resistance', null, 'Triceps'),
  ('Dumbbell Tricep Extension', 'resistance', null, 'Triceps'),
  ('Back Extension', 'resistance', null, 'Back'),
  ('Lat Pulldown', 'resistance', null, 'Back'),
  ('Plank', 'bodyweight', 'timed_hold', 'Core'),
  ('Dead Hang', 'bodyweight', 'timed_hold', 'Back'),
  ('Pull-Up', 'bodyweight', 'reps', 'Back'),
  ('Sit-Up', 'bodyweight', 'reps', 'Core'),
  ('Crunches', 'bodyweight', 'reps', 'Core');
