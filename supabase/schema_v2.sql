-- Supabase Schema V2 (additive, non-destructive). Existing schema.sql must be applied first.
-- Enterprise upgrade covering auth, monitoring, attendance, fees, scheduling, notifications, SaaS, audit, and analytics.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- =====================================================
-- DOMAIN TYPES
-- =====================================================
do $$
begin
	if not exists (select 1 from pg_type where typname = 'attendance_extended_status') then
		create type attendance_extended_status as enum ('present','absent','late','half_day','on_duty','medical_leave');
	end if;
end $$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'alert_severity') then
		create type alert_severity as enum ('info','warning','critical');
	end if;
end $$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'notification_target') then
		create type notification_target as enum ('all','department','course','year');
	end if;
end $$;
-- =====================================================
alter table users add column if not exists last_login_at timestamptz;
alter table users add column if not exists failed_login_attempts integer default 0;

create table if not exists refresh_tokens (
	id uuid primary key default gen_random_uuid(),
	user_id uuid references users(id) on delete cascade,
	token_hash text not null unique,
	ip_address inet,
	user_agent text,
	expires_at timestamptz not null,
	created_at timestamptz default now(),
	last_used_at timestamptz default now(),
	revoked boolean default false
);

create index if not exists idx_refresh_tokens_user on refresh_tokens(user_id);
create index if not exists idx_refresh_tokens_expiry on refresh_tokens(expires_at);
create index if not exists idx_refresh_tokens_revoked on refresh_tokens(revoked);

create table if not exists auth_logs (
	id uuid primary key default gen_random_uuid(),
	user_id uuid references users(id) on delete cascade,
	college_id uuid references colleges(id) on delete cascade,
	action text,
	ip_address inet,
	user_agent text,
	metadata jsonb,
	created_at timestamptz default now()
);

create index if not exists idx_auth_logs_user on auth_logs(user_id);
create index if not exists idx_auth_logs_action_time on auth_logs(action, created_at desc);

create table if not exists impersonation_logs (
	id uuid primary key default gen_random_uuid(),
	superadmin_id uuid references users(id) on delete set null,
	target_user_id uuid references users(id) on delete set null,
	college_id uuid references colleges(id) on delete set null,
	started_at timestamptz default now(),
	ended_at timestamptz,
	reason text
);

-- Guardrail to ensure token hashes are not empty
create or replace function ensure_refresh_token_hashed()
returns trigger
language plpgsql
as $$
begin
	if coalesce(new.token_hash, '') = '' then
		raise exception 'token_hash cannot be empty';
	end if;
	return new;
end;
$$;

drop trigger if exists trg_refresh_token_hash on refresh_tokens;
create trigger trg_refresh_token_hash
	before insert on refresh_tokens
	for each row
	execute function ensure_refresh_token_hashed();

-- =====================================================
-- ROOM MONITORING & ALERTS
-- =====================================================
alter table room_monitoring add column if not exists override_by uuid references users(id) on delete set null;
alter table room_monitoring add column if not exists override_reason text;
alter table room_monitoring add column if not exists override_expires_at timestamptz;

create table if not exists room_status_log (
	id uuid primary key default gen_random_uuid(),
	room_id uuid references rooms(id) on delete cascade,
	college_id uuid references colleges(id) on delete cascade,
	status text check (status in ('occupied','vacant','maintenance','cleaning')),
	lecture_id uuid references lectures(id) on delete set null,
	override_by uuid references users(id) on delete set null,
	reason text,
	changed_at timestamptz default now()
);

create table if not exists monitoring_alerts (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	alert_type text,
	room_id uuid references rooms(id) on delete set null,
	lecture_id uuid references lectures(id) on delete set null,
	message text,
	severity alert_severity default 'warning',
	resolved boolean default false,
	resolved_by uuid references users(id) on delete set null,
	created_at timestamptz default now()
);

create index if not exists idx_monitoring_alerts_college_resolved on monitoring_alerts(college_id, resolved, created_at desc);
create index if not exists idx_monitoring_alerts_created on monitoring_alerts(created_at desc);

-- Helper to set and log room statuses (used by triggers and manual overrides)
create or replace function set_room_status(
	p_room_id uuid,
	p_college_id uuid,
	p_status text,
	p_lecture_id uuid default null,
	p_reason text default null,
	p_override_by uuid default null
)
returns void
language plpgsql
as $$
begin
	update room_monitoring
	set status = case lower(p_status)
					 when 'occupied' then 'Occupied'
					 when 'maintenance' then 'Occupied'
					 when 'cleaning' then 'Vacant'
					 else 'Vacant'
				 end,
		current_lecture_id = p_lecture_id,
		override_by = p_override_by,
		override_reason = p_reason,
		override_expires_at = case when lower(p_status) in ('maintenance','cleaning') then now() + interval '4 hours' else null end,
		updated_at = now()
	where room_id = p_room_id
		and (college_id is null or college_id = p_college_id);

	insert into room_status_log(room_id, college_id, status, lecture_id, override_by, reason, changed_at)
	values (p_room_id, p_college_id, lower(p_status), p_lecture_id, p_override_by, p_reason, now());
end;
$$;

-- Logging status transitions from room_monitoring into room_status_log
create or replace function log_room_monitoring_change()
returns trigger
language plpgsql
as $$
declare
	v_override uuid;
begin
	begin
		v_override := current_setting('request.jwt.claim.user_id', true)::uuid;
	exception when others then
		v_override := null;
	end;

	insert into room_status_log(room_id, college_id, status, lecture_id, override_by, reason, changed_at)
	values (new.room_id, new.college_id, lower(new.status::text), new.current_lecture_id, coalesce(new.override_by, v_override), new.override_reason, now());
	return new;
end;
$$;

drop trigger if exists trg_room_monitoring_log on room_monitoring;
create trigger trg_room_monitoring_log
	after insert or update on room_monitoring
	for each row
	execute function log_room_monitoring_change();

-- Auto-refresh room_monitoring based on lecture schedule
create or replace function refresh_room_statuses()
returns void
language plpgsql
as $$
declare
	v_now timestamptz := now();
begin
	-- Occupy rooms with ongoing lectures unless manually blocked
	update room_monitoring rm
	set status = 'Occupied',
			current_lecture_id = lec.id,
			updated_at = v_now
	from lectures lec
	where rm.room_id = lec.room_id
		and lec.starts_at <= v_now
		and lec.ends_at > v_now
		and (rm.override_expires_at is null or rm.override_expires_at < v_now);

	-- Vacate rooms when no active lecture and no override
	update room_monitoring rm
	set status = 'Vacant',
			current_lecture_id = null,
			updated_at = v_now
	where (rm.override_expires_at is null or rm.override_expires_at < v_now)
		and not exists (
			select 1 from lectures l
			where l.room_id = rm.room_id
				and l.starts_at <= v_now
				and l.ends_at > v_now
		);
end;
$$;

-- Alerts evaluator: no attendance 20 min after start, overdue rooms, missing faculty
create or replace function evaluate_monitoring_alerts()
returns void
language plpgsql
as $$
declare
	v_now timestamptz := now();
begin
	-- No attendance after 20 minutes
	insert into monitoring_alerts (college_id, alert_type, room_id, lecture_id, message, severity)
	select l.college_id, 'no_attendance', l.room_id, l.id,
				 format('Attendance not marked for room %s lecture starting at %s', r.name, l.starts_at),
				 'warning'
	from lectures l
	join rooms r on r.id = l.room_id
	where l.starts_at <= v_now - interval '20 minutes'
		and l.ends_at > v_now
		and not exists (
			select 1 from attendance a where a.lecture_id = l.id
		)
		and not exists (
			select 1 from monitoring_alerts ma where ma.lecture_id = l.id and ma.alert_type = 'no_attendance'
		);

	-- Overdue room still occupied
	insert into monitoring_alerts (college_id, alert_type, room_id, lecture_id, message, severity)
	select rm.college_id, 'room_overdue', rm.room_id, rm.current_lecture_id,
				 'Room still occupied after scheduled end', 'critical'
	from room_monitoring rm
	join lectures l on l.id = rm.current_lecture_id
	where l.ends_at < v_now - interval '5 minutes'
		and rm.status = 'Occupied'
		and not exists (
			select 1 from monitoring_alerts ma where ma.room_id = rm.room_id and ma.alert_type = 'room_overdue' and ma.resolved = false
		);

	-- Faculty not available (substitute needed)
	insert into monitoring_alerts (college_id, alert_type, room_id, lecture_id, message, severity)
	select l.college_id, 'unscheduled_class', l.room_id, l.id,
				 'Faculty unavailable; substitute required', 'warning'
	from lectures l
	join faculty_unavailability fu on fu.faculty_id = l.faculty_id and fu.unavailable_date = l.starts_at::date
	where l.starts_at <= v_now + interval '10 minutes'
		and not exists (
			select 1 from monitoring_alerts ma where ma.lecture_id = l.id and ma.alert_type = 'unscheduled_class'
		);
end;
$$;

-- Low attendance pulse
create or replace function alert_on_low_attendance()
returns trigger
language plpgsql
as $$
declare
	v_total integer;
	v_present numeric;
	v_ratio numeric;
	v_lecture lectures;
begin
	select * into v_lecture from lectures where id = new.lecture_id;
	select count(*) into v_total from attendance where lecture_id = new.lecture_id;
	select sum(case lower(status::text)
					 when 'present' then 1
					 when 'late' then 1
					 when 'half_day' then 0.5
					 when 'on_duty' then 1
					 when 'medical_leave' then 1
					 else 0 end) into v_present
	from attendance where lecture_id = new.lecture_id;

	if coalesce(v_total, 0) > 0 then
		v_ratio := coalesce(v_present, 0) / v_total;
		if v_ratio < 0.6 then
			insert into monitoring_alerts (college_id, alert_type, room_id, lecture_id, message, severity)
			values (v_lecture.college_id, 'low_attendance', v_lecture.room_id, v_lecture.id,
							format('Attendance low: %.0f%%', v_ratio * 100), 'warning')
			on conflict do nothing;
		end if;
	end if;
	return new;
end;
$$;

drop trigger if exists trg_alert_on_low_attendance on attendance;
create trigger trg_alert_on_low_attendance
	after insert or update on attendance
	for each row
	execute function alert_on_low_attendance();

-- Scheduled jobs via pg_cron (guarded if cron is available)
do $$
	begin
	if exists (select 1 from pg_namespace where nspname = 'cron') then
		if not exists (select 1 from cron.job where jobname = 'room_status_refresh') then
			perform cron.schedule('room_status_refresh', '* * * * *', 'select refresh_room_statuses();');
		end if;
		if not exists (select 1 from cron.job where jobname = 'monitoring_alerts_eval') then
			perform cron.schedule('monitoring_alerts_eval', '*/5 * * * *', 'select evaluate_monitoring_alerts();');
		end if;
	end if;
exception when others then
	null;
end;
$$;

-- =====================================================
-- ATTENDANCE ENGINE UPGRADE
do $$
begin
	if exists (
		select 1 from information_schema.columns
		where table_name = 'attendance' and column_name = 'status' and data_type <> 'USER-DEFINED'
	) and not exists (
		select 1 from information_schema.columns
		where table_name = 'attendance' and column_name = 'status_legacy'
	) then
		alter table attendance rename column status to status_legacy;
	end if;
end;
$$;

alter table attendance
	add column if not exists status text
		check (status in ('present','absent','late','half_day','on_duty','medical_leave'))
		default 'absent';

alter table attendance add column if not exists marked_at timestamptz default now();
alter table attendance add column if not exists override_reason text;

alter table students add column if not exists temp_password text;
alter table students add column if not exists must_change_password boolean default true;
alter table students add column if not exists password_generated_at timestamptz;

-- Attendance locking metadata stored on lectures
-- Use immutable expression for generated column (timestamptz to date must be timezone-stable)
alter table lectures add column if not exists lecture_date date generated always as ((starts_at at time zone 'UTC')::date) stored;
alter table lectures add column if not exists attendance_lock_expires_at timestamptz;
alter table lectures add column if not exists attendance_locked boolean default false;
alter table lectures add column if not exists attendance_locked_by uuid references users(id) on delete set null;
alter table lectures add column if not exists attendance_lock_reason text;
alter table lectures add column if not exists substitute_faculty_id uuid references users(id) on delete set null;
alter table lectures add column if not exists is_substitute boolean default false;

create or replace function set_attendance_lock_window()
returns trigger
language plpgsql
as $$
begin
	if new.ends_at is not null then
		new.attendance_lock_expires_at := new.ends_at + interval '30 minutes';
	end if;
	return new;
end;
$$;

drop trigger if exists trg_set_attendance_lock_window on lectures;
create trigger trg_set_attendance_lock_window
	before insert or update on lectures
	for each row
	execute function set_attendance_lock_window();

-- Enforce attendance marking window at DB level
create or replace function enforce_attendance_window()
returns trigger
language plpgsql
as $$
declare
	v_lecture lectures;
begin
	select * into v_lecture from lectures where id = new.lecture_id;
	if v_lecture.attendance_locked is true then
		raise exception 'Attendance locked for this lecture';
	end if;
	if v_lecture.starts_at is not null and v_lecture.ends_at is not null then
		if now() > coalesce(v_lecture.attendance_lock_expires_at, v_lecture.ends_at + interval '30 minutes') then
			raise exception 'Attendance window closed';
		end if;
		if now() < v_lecture.starts_at - interval '10 minutes' then
			raise exception 'Attendance window not opened yet';
		end if;
	end if;
	return new;
end;
$$;

drop trigger if exists trg_enforce_attendance_window on attendance;
create trigger trg_enforce_attendance_window
	before insert or update on attendance
	for each row
	execute function enforce_attendance_window();

-- Auto-lock attendance after cutoff
create or replace function lock_expired_attendance_windows()
returns void
language plpgsql
as $$
begin
	update lectures
	set attendance_locked = true,
			attendance_locked_by = null,
			attendance_lock_reason = 'Auto-locked after cutoff',
			attendance_lock_expires_at = attendance_lock_expires_at
	where attendance_locked = false
		and attendance_lock_expires_at is not null
		and now() > attendance_lock_expires_at;
end;
$$;

-- Extended attendance calculation (per subject + overall)
create or replace function calculate_attendance(
	p_student_id uuid,
	p_college_id uuid,
	p_as_of date default current_date
)
returns table(
	subject_id uuid,
	subject_name text,
	total_conducted int,
	total_attended numeric,
	attendance_percent numeric,
	overall_percent numeric,
	shortage boolean,
	needed_classes int
)
language sql
stable
as $$
with lecture_list as (
	select l.id, l.subject_id, coalesce(s.name, 'General') as subject_name
	from lectures l
	left join subjects s on s.id = l.subject_id
	where l.college_id = p_college_id
		and l.starts_at::date <= p_as_of
), conducted as (
	select subject_id, subject_name, count(*) as total_conducted
	from lecture_list
	group by subject_id, subject_name
), attended as (
	select l.subject_id,
				 sum(case lower(a.status::text)
						 when 'present' then 1
						 when 'late' then 1
						 when 'half_day' then 0.5
						 when 'on_duty' then 1
						 when 'medical_leave' then 1
						 else 0 end) as total_attended
	from lectures l
	join attendance a on a.lecture_id = l.id
	where a.student_id = p_student_id
		and l.college_id = p_college_id
		and a.date <= p_as_of
	group by l.subject_id
), overall as (
	select coalesce(sum(att.total_attended), 0)::numeric as attended_sum,
				 coalesce(sum(cond.total_conducted), 0)::numeric as conducted_sum
	from conducted cond
	left join attended att on att.subject_id = cond.subject_id
)
select
	cond.subject_id,
	cond.subject_name,
	cond.total_conducted::int,
	coalesce(att.total_attended, 0) as total_attended,
	case when cond.total_conducted = 0 then 0 else round((coalesce(att.total_attended, 0) / cond.total_conducted) * 100, 2) end as attendance_percent,
	case when overall.conducted_sum = 0 then 0 else round((overall.attended_sum / overall.conducted_sum) * 100, 2) end as overall_percent,
	case when cond.total_conducted = 0 then false else round((coalesce(att.total_attended, 0) / cond.total_conducted) * 100, 2) < 75 end as shortage,
	case
		when cond.total_conducted = 0 then 0
		else greatest(0, ceil(((0.75 * cond.total_conducted) - coalesce(att.total_attended, 0)) / 0.75))::int
	end as needed_classes
from conducted cond
left join attended att on att.subject_id = cond.subject_id
cross join overall;
$$;

create table if not exists attendance_warnings (
	id uuid primary key default gen_random_uuid(),
	student_id uuid references students(id) on delete cascade,
	college_id uuid references colleges(id) on delete cascade,
	subject_id uuid references subjects(id) on delete set null,
	warning_level int check (warning_level in (1,2,3)),
	attendance_percent numeric,
	issued_at timestamptz default now(),
	resolved boolean default false,
	resolved_by uuid references users(id) on delete set null
);

create unique index if not exists idx_attendance_warnings_unique on attendance_warnings(student_id, subject_id, warning_level);
create index if not exists idx_attendance_warnings_student on attendance_warnings(student_id, warning_level);

create or replace function generate_attendance_warnings(p_college_id uuid default null)
returns void
language plpgsql
as $$
declare
	rec record;
begin
	if p_college_id is null then
		for rec in select id from colleges loop
			perform generate_attendance_warnings(rec.id);
		end loop;
		return;
	end if;

		insert into attendance_warnings (student_id, college_id, subject_id, warning_level, attendance_percent)
		select s.id, s.college_id, ca.subject_id,
				least(coalesce((select max(warning_level) from attendance_warnings w where w.student_id = s.id and w.subject_id is not distinct from ca.subject_id and w.resolved = false), 0) + 1, 3),
				ca.attendance_percent
		from students s
		cross join lateral calculate_attendance(s.id, s.college_id, current_date) ca
		where s.college_id = p_college_id
			and ca.attendance_percent < 75
			and coalesce((select max(warning_level) from attendance_warnings w where w.student_id = s.id and w.subject_id is not distinct from ca.subject_id and w.resolved = false), 0) < 3;
end;
$$;

create table if not exists leave_requests (
	id uuid primary key default gen_random_uuid(),
	student_id uuid references students(id) on delete cascade,
	college_id uuid references colleges(id) on delete cascade,
	from_date date not null,
	to_date date not null,
	reason text,
	document_url text,
	status text check (status in ('pending','approved','rejected')) default 'pending',
	reviewed_by uuid references users(id) on delete set null,
	created_at timestamptz default now()
);

create index if not exists idx_leave_requests_student on leave_requests(student_id, status);

-- Attendance indexes
create index if not exists idx_attendance_student_date on attendance(student_id, date);
create index if not exists idx_attendance_lecture on attendance(lecture_id);

-- =====================================================
-- FEE ENGINE UPGRADE
-- =====================================================
create table if not exists courses (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	name text not null,
	academic_year text,
	created_at timestamptz default now(),
	unique(college_id, name)
);

create table if not exists fee_templates (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	course_id uuid references courses(id) on delete set null,
	academic_year text,
	components jsonb,
	installments jsonb,
	created_at timestamptz default now()
);

alter table fees add column if not exists fee_template_id uuid references fee_templates(id) on delete set null;
alter table fees add column if not exists installment_no integer;
alter table fees add column if not exists components jsonb;
alter table fees add column if not exists installments jsonb;
alter table fees add column if not exists due_date date;
alter table fees add column if not exists grace_days integer default 0;
alter table fees add column if not exists late_fine_accumulated numeric(12,2) default 0;
alter table fees add column if not exists payment_mode text;
alter table fees add column if not exists reference_number text;
alter table fees add column if not exists receipt_number text;
alter table fees add column if not exists fee_hold boolean default false;
alter table fees add column if not exists last_reminder_at timestamptz;
alter table fees add column if not exists currency text default 'INR';
alter table fees add column if not exists scholarship_amount numeric(12,2) default 0;
create index if not exists idx_fees_student_status on fees(student_id, status);

create table if not exists fee_discounts (
	id uuid primary key default gen_random_uuid(),
	fee_id uuid references fees(id) on delete cascade,
	student_id uuid references students(id) on delete cascade,
	discount_type text check (discount_type in ('percentage','fixed')),
	value numeric,
	reason text,
	approved_by uuid references users(id) on delete set null,
	created_at timestamptz default now()
);

create table if not exists payment_receipts (
	id uuid primary key default gen_random_uuid(),
	fee_id uuid references fees(id) on delete cascade,
	receipt_number text unique,
	amount numeric,
	payment_mode text,
	reference_number text,
	paid_at timestamptz default now(),
	generated_pdf_url text
);

-- =====================================================
-- SMART SCHEDULING
-- =====================================================
create table if not exists timetable_templates (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	department_id uuid references departments(id) on delete cascade,
	name text,
	academic_year text,
	schedule jsonb,
	created_at timestamptz default now()
);

create table if not exists substitute_assignments (
	id uuid primary key default gen_random_uuid(),
	lecture_id uuid references lectures(id) on delete cascade,
	original_faculty_id uuid references users(id) on delete set null,
	substitute_faculty_id uuid references users(id) on delete set null,
	reason text,
	assigned_by uuid references users(id) on delete set null,
	created_at timestamptz default now()
);

create table if not exists faculty_unavailability (
	id uuid primary key default gen_random_uuid(),
	faculty_id uuid references users(id) on delete cascade,
	unavailable_date date not null,
	reason text,
	created_at timestamptz default now(),
	unique(faculty_id, unavailable_date)
);

create index if not exists idx_substitute_assignments_lecture on substitute_assignments(lecture_id);

-- =====================================================
-- NOTIFICATIONS & ANNOUNCEMENTS
-- =====================================================
create table if not exists notifications (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	user_id uuid references users(id) on delete cascade,
	type text,
	title text,
	message text,
	link text,
	read boolean default false,
	metadata jsonb,
	created_at timestamptz default now()
);
create index if not exists idx_notifications_user_read on notifications(user_id, read);
create index if not exists idx_notifications_created on notifications(created_at desc);

create table if not exists announcements (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	created_by uuid references users(id) on delete set null,
	title text,
	body text,
	target_type notification_target,
	target_id uuid,
	pinned boolean default false,
	expires_at timestamptz,
	created_at timestamptz default now()
);

create table if not exists push_subscriptions (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	user_id uuid references users(id) on delete cascade,
	endpoint text not null,
	p256dh text not null,
	auth text not null,
	created_at timestamptz default now(),
	revoked boolean default false,
	unique(user_id, endpoint)
);

-- =====================================================
-- SUPERADMIN SAAS PANEL
-- =====================================================
create table if not exists plans (
	id uuid primary key default gen_random_uuid(),
	name text,
	max_students int,
	max_faculty int,
	features jsonb,
	price_monthly numeric,
	price_annual numeric,
	created_at timestamptz default now()
);

create table if not exists college_subscriptions (
	id uuid primary key default gen_random_uuid(),
	college_id uuid references colleges(id) on delete cascade,
	plan_id uuid references plans(id) on delete set null,
	status text check (status in ('trial','active','expired','suspended')) default 'trial',
	trial_ends_at timestamptz,
	current_period_start timestamptz,
	current_period_end timestamptz,
	created_at timestamptz default now()
);

-- =====================================================
-- ANALYTICS / AUDIT / ERROR LOGGING
-- =====================================================
create table if not exists audit_logs (
	id uuid primary key default gen_random_uuid(),
	table_name text,
	action text,
	record_id uuid,
	old_data jsonb,
	new_data jsonb,
	performed_by uuid references users(id) on delete set null,
	created_at timestamptz default now()
);

create table if not exists error_logs (
	id uuid primary key default gen_random_uuid(),
	message text,
	stack text,
	context jsonb,
	created_at timestamptz default now()
);

create index if not exists idx_audit_logs_table_created on audit_logs(table_name, created_at desc);

create or replace function audit_trigger()
returns trigger
language plpgsql
as $$
declare
	v_user uuid;
begin
	begin
		v_user := current_setting('request.jwt.claim.user_id', true)::uuid;
	exception when others then
		v_user := null;
	end;

	insert into audit_logs(table_name, action, record_id, old_data, new_data, performed_by, created_at)
	values (tg_table_name, tg_op, coalesce(new.id, old.id), to_jsonb(old), to_jsonb(new), v_user, now());
	return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_lectures on lectures;
create trigger trg_audit_lectures
	after insert or update or delete on lectures
	for each row
	execute function audit_trigger();

drop trigger if exists trg_audit_fees on fees;
create trigger trg_audit_fees
	after insert or update or delete on fees
	for each row
	execute function audit_trigger();

drop trigger if exists trg_audit_attendance on attendance;
create trigger trg_audit_attendance
	after insert or update or delete on attendance
	for each row
	execute function audit_trigger();

-- =====================================================
-- PERFORMANCE INDEXES (ADDITIVE)
-- =====================================================
create index if not exists idx_lectures_room_date on lectures(room_id, lecture_date);
create index if not exists idx_room_status_log_changed on room_status_log(changed_at desc);
create index if not exists idx_notifications_user_read on notifications(user_id, read);
create index if not exists idx_monitoring_alerts_college on monitoring_alerts(college_id, created_at desc);
create index if not exists idx_auth_logs_action_time on auth_logs(action, created_at desc);

-- =====================================================
-- SUPPORTING VIEWS / HELPERS
-- =====================================================
-- Drop first to avoid column rename errors when adding columns
drop view if exists v_room_live_status;
create view v_room_live_status as
select
	r.id as room_id,
	r.college_id,
	r.name as room_name,
	r.room_type,
	r.capacity,
	rm.status as live_status,
	rm.current_lecture_id,
	l.faculty_id,
	l.subject_id,
	l.starts_at,
	l.ends_at
from rooms r
left join room_monitoring rm on rm.room_id = r.id
left join lectures l on l.id = rm.current_lecture_id;

-- Apply late fees with a conservative default (idempotent and bounded)
create or replace function apply_late_fees()
returns void
language plpgsql
as $$
begin
	-- Mark overdue items
	update fees
	set status = 'overdue'
	where status in ('pending','overdue')
		and due_date is not null
		and current_date > (due_date + coalesce(grace_days, 0));

	-- Accrue a flat fine per overdue day; capped to avoid runaway amounts
	update fees
	set late_fine_accumulated = least(coalesce(late_fine_accumulated, 0) + greatest(0, date_part('day', current_date - (due_date + coalesce(grace_days, 0)))) * 10, 100000)
	where status = 'overdue'
		and due_date is not null
		and current_date > (due_date + coalesce(grace_days, 0));
end;
$$;

-- =====================================================
-- SCHEDULED JOBS (GUARDED)
-- =====================================================
do $$
begin
	if exists (select 1 from pg_namespace where nspname = 'cron') then
		if not exists (select 1 from cron.job where jobname = 'attendance_auto_lock') then
			perform cron.schedule('attendance_auto_lock', '*/10 * * * *', 'select lock_expired_attendance_windows();');
		end if;
		if not exists (select 1 from cron.job where jobname = 'late_fee_apply') then
			perform cron.schedule('late_fee_apply', '0 2 * * *', 'select apply_late_fees();');
		end if;
		if not exists (select 1 from cron.job where jobname = 'attendance_warning_weekly') then
			perform cron.schedule('attendance_warning_weekly', '0 1 * * MON', 'select generate_attendance_warnings();');
		end if;
	end if;
exception when others then
	null;
end;
$$;

