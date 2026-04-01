create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'role_type') then
    create type role_type as enum ('SuperAdmin', 'Admin', 'HOD', 'Faculty', 'Student');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'room_type') then
    create type room_type as enum ('Classroom', 'Lab', 'Auditorium', 'Library');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('Paid', 'Pending');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type attendance_status as enum ('Present', 'Absent');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'room_live_status') then
    create type room_live_status as enum ('Occupied', 'Vacant');
  end if;
end $$;

create table if not exists colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  created_at timestamptz not null default now()
);

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(college_id, name)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  college_id uuid references colleges(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  name text not null,
  email text unique not null,
  password text not null,
  role role_type not null,
  created_at timestamptz not null default now()
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(college_id, name)
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  block_id uuid references blocks(id) on delete set null,
  name text not null,
  room_type room_type not null,
  capacity integer not null default 0,
  benches integer not null default 0,
  systems integer not null default 0,
  working_systems integer not null default 0,
  internet boolean not null default false,
  lab_assistant text,
  created_at timestamptz not null default now(),
  unique(college_id, name)
);

create table if not exists slots (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  course text not null,
  total_seats integer not null check (total_seats >= 0),
  filled_seats integer not null default 0 check (filled_seats >= 0),
  created_at timestamptz not null default now(),
  unique(college_id, department_id, course)
);

create table if not exists admissions (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  slot_id uuid not null references slots(id) on delete cascade,
  student_name text not null,
  email text not null,
  phone text,
  current_semester int not null default 1 check (current_semester between 1 and 12),
  status text not null default 'Approved',
  created_at timestamptz not null default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  slot_id uuid not null references slots(id) on delete cascade,
  admission_id uuid not null references admissions(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  name text not null,
  email text not null,
  current_semester int not null default 1 check (current_semester between 1 and 12),
  created_at timestamptz not null default now()
);

create table if not exists fees (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  admission_id uuid references admissions(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null default 0,
  due_amount numeric(12,2) not null,
  status payment_status not null default 'Pending',
  generated_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists faculty_subjects (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  unique(faculty_id, subject_id)
);

create table if not exists lectures (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  faculty_id uuid not null references users(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references lectures(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  date date not null,
  status attendance_status not null,
  marked_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(lecture_id, student_id, date)
);

create table if not exists room_monitoring (
  room_id uuid primary key references rooms(id) on delete cascade,
  college_id uuid not null references colleges(id) on delete cascade,
  status room_live_status not null default 'Vacant',
  current_lecture_id uuid references lectures(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function create_admission_flow(
  p_college_id uuid,
  p_department_id uuid,
  p_slot_id uuid,
  p_student_name text,
  p_email text,
  p_phone text,
  p_fee_amount numeric
)
returns table(admission_id uuid, student_id uuid, fee_id uuid, available_seats integer)
language plpgsql
as $$
declare
  v_total integer;
  v_filled integer;
  v_admission uuid;
  v_student uuid;
  v_fee uuid;
begin
  select total_seats, filled_seats into v_total, v_filled
  from slots
  where id = p_slot_id and college_id = p_college_id
  for update;

  if v_total is null then
    raise exception 'Slot not found';
  end if;

  if v_filled >= v_total then
    raise exception 'No seats available';
  end if;

  insert into admissions(college_id, department_id, slot_id, student_name, email, phone, current_semester)
  values (p_college_id, p_department_id, p_slot_id, p_student_name, p_email, p_phone, 1)
  returning id into v_admission;

  insert into students(college_id, department_id, slot_id, admission_id, name, email, current_semester)
  values (p_college_id, p_department_id, p_slot_id, v_admission, p_student_name, p_email, 1)
  returning id into v_student;

  insert into fees(college_id, admission_id, student_id, amount, due_amount, status)
  values (p_college_id, v_admission, v_student, p_fee_amount, p_fee_amount, 'Pending')
  returning id into v_fee;

  update slots
  set filled_seats = filled_seats + 1
  where id = p_slot_id;

  return query
  select v_admission, v_student, v_fee, (v_total - (v_filled + 1));
end;
$$;

create or replace function create_lecture_with_conflict(
  p_college_id uuid,
  p_department_id uuid,
  p_subject_id uuid,
  p_faculty_id uuid,
  p_room_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
as $$
declare
  v_conflict integer;
  v_room_capacity integer;
  v_students integer;
  v_lecture_id uuid;
begin
  select count(*) into v_conflict
  from lectures
  where college_id = p_college_id
    and ((room_id = p_room_id) or (faculty_id = p_faculty_id))
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if v_conflict > 0 then
    raise exception 'Schedule conflict found';
  end if;

  select capacity into v_room_capacity from rooms where id = p_room_id;
  select count(*) into v_students from students where department_id = p_department_id;

  if coalesce(v_room_capacity, 0) < v_students then
    raise exception 'Room capacity insufficient';
  end if;

  insert into lectures(college_id, department_id, subject_id, faculty_id, room_id, starts_at, ends_at)
  values (p_college_id, p_department_id, p_subject_id, p_faculty_id, p_room_id, p_starts_at, p_ends_at)
  returning id into v_lecture_id;

  insert into room_monitoring(room_id, college_id, status, current_lecture_id)
  values (p_room_id, p_college_id, 'Occupied', v_lecture_id)
  on conflict (room_id) do update
    set status = excluded.status,
        current_lecture_id = excluded.current_lecture_id,
        updated_at = now();

  return v_lecture_id;
end;
$$;

-- Seed initial data for local development (idempotent)
insert into colleges (id, name, location)
select gen_random_uuid(), 'Bireena College', 'Main Campus'
where not exists (select 1 from colleges where name = 'Bireena College');

with college as (
  select id from colleges where name = 'Bireena College' limit 1
)
insert into departments (id, college_id, name)
select gen_random_uuid(), college.id, 'Computer Science'
from college
where not exists (
  select 1 from departments where name = 'Computer Science' and college_id = college.id
);

with college as (
  select id from colleges where name = 'Bireena College' limit 1
)
insert into users (id, college_id, name, email, password, role)
select gen_random_uuid(), college.id, 'Admin', 'admin@bireena.edu', '123456', 'Admin'
from college
where not exists (select 1 from users where email = 'admin@bireena.edu');

insert into users (id, name, email, password, role)
select gen_random_uuid(), 'Super Admin', 'super@bireena.edu', 'admin123', 'SuperAdmin'
where not exists (select 1 from users where email = 'super@bireena.edu');

update users
set college_id = college.id
from (select id from colleges where name = 'Bireena College' limit 1) as college
where email = 'admin@bireena.edu' and college_id is null;
