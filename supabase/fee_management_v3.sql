-- Fee Management V3 (additive)
-- Apply after schema.sql and schema_v2.sql

create extension if not exists pgcrypto;

create table if not exists fee_structures (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  slot_id uuid not null references slots(id) on delete cascade,
  name text not null,
  description text,
  academic_year text not null,
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(college_id, slot_id, name, academic_year)
);

create table if not exists fee_components (
  id uuid primary key default gen_random_uuid(),
  fee_structure_id uuid not null references fee_structures(id) on delete cascade,
  college_id uuid not null references colleges(id) on delete cascade,
  component_key text not null,
  component_name text not null,
  default_amount numeric(12,2) not null check (default_amount >= 0),
  taxable boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fee_structure_id, component_key)
);

create table if not exists student_fees (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  admission_id uuid references admissions(id) on delete set null,
  slot_id uuid references slots(id) on delete set null,
  fee_structure_id uuid references fee_structures(id) on delete set null,
  currency text not null default 'INR',
  base_total numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  fine_total numeric(12,2) not null default 0,
  extra_total numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,
  paid_total numeric(12,2) not null default 0,
  due_total numeric(12,2) not null default 0,
  status text not null default 'Pending' check (status in ('Pending', 'Partially Paid', 'Paid', 'Cancelled')),
  due_date date,
  grace_days int not null default 0,
  notes text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists student_fee_items (
  id uuid primary key default gen_random_uuid(),
  student_fee_id uuid not null references student_fees(id) on delete cascade,
  college_id uuid not null references colleges(id) on delete cascade,
  source_component_id uuid references fee_components(id) on delete set null,
  item_type text not null check (item_type in ('component', 'discount', 'fine', 'extra')),
  label text not null,
  amount numeric(12,2) not null,
  quantity int not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  student_fee_id uuid not null references student_fees(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('Cash', 'UPI', 'Online', 'Card', 'Bank Transfer')),
  transaction_id text,
  receipt_number text not null,
  paid_at timestamptz not null default now(),
  collected_by uuid references users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique(college_id, receipt_number)
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  student_fee_id uuid not null references student_fees(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  storage_path text,
  file_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(payment_id)
);

create index if not exists idx_fee_structures_college_slot on fee_structures(college_id, slot_id, is_active);

alter table if exists fee_structures add column if not exists description text;
create index if not exists idx_fee_components_structure on fee_components(fee_structure_id, sort_order);
create index if not exists idx_student_fees_student_status on student_fees(college_id, student_id, status);
create index if not exists idx_student_fees_due_date on student_fees(college_id, due_date);
create index if not exists idx_student_fee_items_fee on student_fee_items(student_fee_id, item_type);
create index if not exists idx_payments_fee_date on payments(student_fee_id, paid_at desc);
create index if not exists idx_payments_college_date on payments(college_id, paid_at desc);
create index if not exists idx_receipts_student_fee on receipts(student_fee_id, created_at desc);

create or replace function set_fee_mgmt_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fee_structures_updated_at on fee_structures;
create trigger trg_fee_structures_updated_at
before update on fee_structures
for each row
execute function set_fee_mgmt_updated_at();

drop trigger if exists trg_fee_components_updated_at on fee_components;
create trigger trg_fee_components_updated_at
before update on fee_components
for each row
execute function set_fee_mgmt_updated_at();

drop trigger if exists trg_student_fees_updated_at on student_fees;
create trigger trg_student_fees_updated_at
before update on student_fees
for each row
execute function set_fee_mgmt_updated_at();

drop trigger if exists trg_student_fee_items_updated_at on student_fee_items;
create trigger trg_student_fee_items_updated_at
before update on student_fee_items
for each row
execute function set_fee_mgmt_updated_at();

alter table fee_structures enable row level security;
alter table fee_components enable row level security;
alter table student_fees enable row level security;
alter table student_fee_items enable row level security;
alter table payments enable row level security;
alter table receipts enable row level security;

-- Service role full access
drop policy if exists p_fee_structures_service on fee_structures;
create policy p_fee_structures_service on fee_structures
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists p_fee_components_service on fee_components;
create policy p_fee_components_service on fee_components
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists p_student_fees_service on student_fees;
create policy p_student_fees_service on student_fees
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists p_student_fee_items_service on student_fee_items;
create policy p_student_fee_items_service on student_fee_items
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists p_payments_service on payments;
create policy p_payments_service on payments
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists p_receipts_service on receipts;
create policy p_receipts_service on receipts
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Authenticated users scoped by college claim in JWT
drop policy if exists p_student_fees_college_read on student_fees;
create policy p_student_fees_college_read on student_fees
for select using (
  auth.role() = 'authenticated' and college_id::text = coalesce(auth.jwt() ->> 'college_id', '')
);

drop policy if exists p_payments_college_read on payments;
create policy p_payments_college_read on payments
for select using (
  auth.role() = 'authenticated' and college_id::text = coalesce(auth.jwt() ->> 'college_id', '')
);

drop policy if exists p_receipts_college_read on receipts;
create policy p_receipts_college_read on receipts
for select using (
  auth.role() = 'authenticated' and college_id::text = coalesce(auth.jwt() ->> 'college_id', '')
);

create or replace function recalc_student_fee_totals(p_student_fee_id uuid)
returns void
language plpgsql
as $$
declare
  v_base numeric(12,2);
  v_discount numeric(12,2);
  v_fine numeric(12,2);
  v_extra numeric(12,2);
  v_grand numeric(12,2);
  v_paid numeric(12,2);
  v_due numeric(12,2);
begin
  select coalesce(sum(amount), 0) into v_base
  from student_fee_items
  where student_fee_id = p_student_fee_id and item_type = 'component';

  select coalesce(sum(amount), 0) into v_discount
  from student_fee_items
  where student_fee_id = p_student_fee_id and item_type = 'discount';

  select coalesce(sum(amount), 0) into v_fine
  from student_fee_items
  where student_fee_id = p_student_fee_id and item_type = 'fine';

  select coalesce(sum(amount), 0) into v_extra
  from student_fee_items
  where student_fee_id = p_student_fee_id and item_type = 'extra';

  select coalesce(sum(amount), 0) into v_paid
  from payments
  where student_fee_id = p_student_fee_id;

  v_grand := greatest(v_base + v_fine + v_extra - v_discount, 0);
  v_due := greatest(v_grand - v_paid, 0);

  update student_fees
  set base_total = v_base,
      discount_total = v_discount,
      fine_total = v_fine,
      extra_total = v_extra,
      grand_total = v_grand,
      paid_total = v_paid,
      due_total = v_due,
      status = case
        when v_due = 0 and v_grand > 0 then 'Paid'
        when v_paid > 0 and v_due > 0 then 'Partially Paid'
        when v_grand = 0 then 'Cancelled'
        else 'Pending'
      end,
      updated_at = now()
  where id = p_student_fee_id;
end;
$$;
