-- Unified school + college additive migration (non-destructive)
-- Apply after schema.sql, schema_v2.sql, and fee_management_v3.sql

create extension if not exists pgcrypto;

-- Institution type (backward-compatible): keep existing colleges table and add type.
alter table if exists colleges
  add column if not exists type varchar(20) not null default 'college';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'colleges_type_check'
  ) then
    alter table colleges
      add constraint colleges_type_check
      check (type in ('college', 'school'));
  end if;
end $$;

-- Unified classes table (department for college, class for school).
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references colleges(id) on delete cascade,
  name varchar(100) not null,
  type varchar(20) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'classes_type_check'
  ) then
    alter table classes
      add constraint classes_type_check
      check (type in ('college', 'school'));
  end if;
end $$;

-- Unified sections table (slot/batch for college, section for school).
create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references colleges(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  name varchar(50) not null,
  total_seats int not null default 60,
  filled_seats int not null default 0,
  assigned_teacher_id uuid references users(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  academic_year varchar(20),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (total_seats >= 0),
  check (filled_seats >= 0)
);

-- Extend existing subjects to unified fields; keep existing college fields intact.
alter table if exists subjects
  add column if not exists institution_id uuid references colleges(id) on delete cascade,
  add column if not exists class_id uuid references classes(id) on delete set null,
  add column if not exists code varchar(20),
  add column if not exists type varchar(20) not null default 'theory',
  add column if not exists periods_per_week int not null default 5;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subjects_type_check'
  ) then
    alter table subjects
      add constraint subjects_type_check
      check (type in ('theory', 'practical'));
  end if;
end $$;

update subjects
set institution_id = college_id
where institution_id is null;

alter table if exists subjects
  alter column institution_id set not null;

-- Unified timetable table for school period-wise timetable.
create table if not exists timetable (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references colleges(id) on delete cascade,
  section_id uuid not null references sections(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  teacher_id uuid not null references users(id) on delete cascade,
  day varchar(10) not null,
  period_number int not null,
  start_time time,
  end_time time,
  room_id uuid references rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_number between 1 and 12)
);

-- Fee structure mapping for school mode while preserving college fields.
alter table if exists fee_structures
  add column if not exists class_id uuid references classes(id) on delete set null,
  add column if not exists term varchar(20);

-- Attendance period support: nullable for college, required by API for school.
alter table if exists attendance
  add column if not exists period_number int;

-- School lifecycle fields for students/admissions in unified flow.
alter table if exists admissions
  add column if not exists section_id uuid references sections(id) on delete set null,
  add column if not exists roll_number varchar(30),
  add column if not exists term varchar(20);

alter table if exists admissions
  alter column department_id drop not null,
  alter column slot_id drop not null;

alter table if exists students
  add column if not exists institution_id uuid references colleges(id) on delete cascade,
  add column if not exists class_id uuid references classes(id) on delete set null,
  add column if not exists section_id uuid references sections(id) on delete set null,
  add column if not exists roll_number varchar(30),
  add column if not exists term varchar(20);

alter table if exists students
  alter column department_id drop not null,
  alter column slot_id drop not null;

update students
set institution_id = college_id
where institution_id is null;

create index if not exists idx_classes_inst on classes(institution_id);
create index if not exists idx_classes_type on classes(type);
create index if not exists idx_sections_inst on sections(institution_id);
create index if not exists idx_sections_class on sections(class_id);
create index if not exists idx_subjects_inst on subjects(institution_id);
create index if not exists idx_subjects_class on subjects(class_id);
create index if not exists idx_timetable_section on timetable(section_id);
create index if not exists idx_timetable_inst on timetable(institution_id);
create index if not exists idx_students_inst on students(institution_id);
