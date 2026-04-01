# Campus ERP Full System Flow (Start to End)

## Product
Campus ERP + Classroom Monitoring + Admission + Attendance System (SaaS)

This document maps business flow to actual frontend pages, API routes, and database behavior in this project.

## Quickstart: Who logs in and when
- SuperAdmin: `super@bireena.edu` / `admin123` (creates colleges + admins)
- Admin: `admin@bireena.edu` / `123456` (infrastructure, seats, admissions, fees, monitoring)
- HOD / Faculty / Student: created per-college (steps below). Student user row must exist to log in; the admission flow creates the student record, then you can optionally add a matching `users` row (role=Student) for login.

## Phase 1: System Setup (Foundation)

### Step 1: Super Admin System
- Role: SuperAdmin
- Purpose: platform owner and tenant onboarding
- Frontend:
  - /superadmin/colleges
  - /superadmin/admins
- Backend:
  - GET /api/superadmin/colleges
  - POST /api/superadmin/colleges
  - GET /api/superadmin/admins

### Step 2: College Creation
SuperAdmin creates:
- College name
- Location
- Admin credentials (name, email, password)

Backend flow:
- POST /api/superadmin/colleges inserts into:
  - colleges
  - users (role = Admin)

Output:
- Admin login is ready.

### Step 3: Admin Login
- Frontend: /login
- Backend: POST /api/auth/login
- Output: role-aware redirect to /admin

## Phase 2: Infrastructure Setup (Admin)

### Step 4: Block Setup
- Frontend: /admin/blocks
- Backend:
  - GET /api/admin/blocks
  - POST /api/admin/blocks
- Table: blocks

### Step 5: Room Setup
- Frontend: /admin/rooms
- Backend:
  - GET /api/admin/rooms
  - POST /api/admin/rooms
- Tables:
  - rooms
  - room_monitoring (auto upsert as Vacant on room create)

### Step 6: Lab Setup
- Frontend: /admin/labs
- Backend:
  - GET /api/admin/labs
  - POST /api/admin/labs
- Table: rooms (room_type = Lab)

### Step 7: Department Setup
- Backend API available:
  - GET /api/admin/departments
  - POST /api/admin/departments
- Table: departments

### Step 8: Slot (Seat) Setup
- Frontend: /admin/slots
- Backend:
  - GET /api/admin/slots
  - POST /api/admin/slots
- Table: slots
- Stored values:
  - total_seats
  - filled_seats
  - available = total_seats - filled_seats

### Step 9: Departments (optional UI depends on build)
- Frontend (if enabled): /admin/departments
- Backend:
  - GET /api/admin/departments
  - POST /api/admin/departments
- Table: departments

## Phase 3: User Creation

### Step 9: HOD Creation
- Backend API available:
  - POST /api/admin/users with role = HOD
- Table: users

### Step 10: Faculty Creation
- Frontend: /hod/faculty
- Backend:
  - GET /api/hod/faculty
  - POST /api/hod/faculty
- Tables:
  - users (role = Faculty)
  - subjects
  - faculty_subjects

### Step 10.1: Student Login User (optional manual step)
- Goal: allow Student to log into /login.
- Requirement: a `users` row with role = Student, same `college_id`, and ideally `department_id`. Link to a `students` row via `user_id` or matching email.
- Minimal SQL (example):
  ```sql
  with c as (select id from colleges where name = 'Bireena College' limit 1)
  insert into users (id, college_id, department_id, name, email, password, role)
  select gen_random_uuid(), c.id, null, 'Student One', 'student1@bireena.edu', 'stud123', 'Student'
  from c
  where not exists (select 1 from users where email = 'student1@bireena.edu');

  update students
  set user_id = (select id from users where email = 'student1@bireena.edu')
  where email = 'student1@bireena.edu';
  ```
  (Set `department_id` and email to real values.)

### Step 11: Student Admission Flow (Important)

Business flow:
1. Visitor fills form
2. System checks slot availability
3. Admission record created
4. Fee generated
5. Payment pending/paid lifecycle
6. Student record created
7. Filled seats incremented

Implementation:
- Frontend: /admin/admissions
- Backend: POST /api/admin/admissions
- SQL function: create_admission_flow(...)

This SQL function performs all major steps atomically:
- seat check with row lock
- admissions insert
- students insert
- fees insert
- slots.filled_seats increment

## Phase 4: Academic Flow

### Step 12: Lecture Scheduling
- Frontend: /hod/schedule
- Backend:
  - GET /api/hod/schedule
  - POST /api/hod/schedule
- SQL function: create_lecture_with_conflict(...)

### Step 13: Conflict Check
Implemented in DB function:
- room clash check
- faculty clash check
- room capacity check vs department student count

### Step 14: Schedule Save
- On success, lecture is inserted
- room_monitoring updated to Occupied for scheduled room

## Phase 5: Daily Operations

### Step 15: Faculty Dashboard
- Frontend: /faculty/dashboard
- Backend:
  - GET /api/faculty/lectures
  - GET /api/admin/rooms
- Shows today's lecture timeline

### Step 16: Attendance Marking
- Frontend: /faculty/attendance
- Backend:
  - GET /api/faculty/attendance?lectureId=...
  - POST /api/faculty/attendance
- Table: attendance
- Stored data:
  - lecture_id, student_id, date, status, marked_by

### Step 17: Student Dashboard
- Frontend: /student/dashboard
- Backend:
  - GET /api/student/dashboard
- Shows:
  - next lecture
  - room
  - faculty
  - attendance percentage

## Phase 5.1: Authentication Flow per role
- SuperAdmin → /superadmin/* (tenant onboarding)
- Admin → /admin/* (infra, seats, admissions, fees, monitoring)
- HOD → /hod/* (faculty, schedule, room changes)
- Faculty → /faculty/* (today’s lectures, attendance mark)
- Student → /student/* (next lecture, attendance%) — needs a `users` row with role=Student

## Phase 6: Class Monitoring

### Step 18: Real-Time Monitoring
- Frontend: /admin/class-monitor
- Backend:
  - GET /api/admin/class-monitor
- Source: room_monitoring + rooms

### Step 19: Room Change
- Frontend: /hod/schedule (Room Change section)
- Backend: PATCH /api/hod/schedule
- Behavior:
  - re-validates conflicts and capacity
  - updates lecture room
  - sets old room Vacant
  - sets new room Occupied

### Step 20: Real-Time Update
- Frontend status actions:
  - PATCH /api/admin/class-monitor
- Manual status override for Occupied/Vacant is supported.

## Phase 7: Billing and ERP

### Step 21: Fee Management
- Frontend: /admin/fees
- Backend:
  - GET /api/admin/fees
  - PATCH /api/admin/fees (record payments)
- Table: fees
- Status lifecycle:
  - Pending -> Paid when due_amount reaches 0

### Step 22: Reports
- Backend: GET /api/admin/reports
- Frontend: /admin (dashboard cards)
- Metrics:
  - total students
  - revenue collected
  - revenue due
  - attendance percentage
  - room usage percentage

## Phase 8: End-to-End Functional Chain

SuperAdmin
-> Create College
-> Admin Setup
-> Infrastructure Setup
-> HOD + Faculty Setup
-> Admission
-> Student Created
-> Scheduling
-> Attendance
-> Monitoring
-> Reports

## Phase 9: Technical Flow (Inside System)

Frontend (Next.js app router pages)
-> API Routes (src/app/api/**/route.ts)
-> Supabase access layer (src/lib/supabaseAdmin.ts)
-> PostgreSQL Tables + Functions (supabase/schema.sql)
-> Monitoring updates in room_monitoring

## Final Output Coverage

Implemented and wired in this project:
- Admission handling
- Fee billing and payment updates
- Attendance tracking
- Classroom monitoring
- Lecture scheduling with conflict checks
- Slot management
- Infrastructure management (blocks/rooms/labs)
- ERP reports

## Operational Notes
- Required environment variables:
  - NEXT_PUBLIC_SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
- Auth context is sent through request headers (from client store):
  - x-role
  - x-college-id
  - x-user-id
- Login uses `users` table rows for each role. Admin-created users automatically include `college_id`; ensure `college_id` is set on seeded/SQL users so APIs accept requests.

## Operational Notes

- Required environment variables:
  - NEXT_PUBLIC_SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
- Auth context is sent through request headers:
  - x-role
  - x-college-id
  - x-user-id
- Login must use users table data for each role.
