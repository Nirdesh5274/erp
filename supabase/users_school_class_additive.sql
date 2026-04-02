-- Additive support for school-mode user assignment by class.
-- Safe to run multiple times.

alter table if exists users
  add column if not exists class_id uuid references classes(id) on delete set null;

create index if not exists idx_users_college_class on users(college_id, class_id);
