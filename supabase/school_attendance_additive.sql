-- School attendance table mapped to timetable periods.
-- Additive migration, safe for existing college workflows.

create table if not exists school_attendance (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references colleges(id) on delete cascade,
  timetable_id uuid not null references timetable(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  date date not null,
  period_number int,
  status varchar(20) not null,
  marked_by uuid references users(id) on delete set null,
  override_reason varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(timetable_id, student_id, date),
  check (status in ('present', 'absent', 'late', 'half_day', 'on_duty', 'medical_leave'))
);

create index if not exists idx_school_attendance_student_date on school_attendance(student_id, date);
create index if not exists idx_school_attendance_timetable_date on school_attendance(timetable_id, date);
