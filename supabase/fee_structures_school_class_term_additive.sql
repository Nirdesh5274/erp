-- School fee structure support: allow class+term mapping without slot/semester requirement.
-- Additive and backward-compatible with existing college flow.

alter table if exists fee_structures
  alter column slot_id drop not null,
  alter column semester drop not null;

create index if not exists idx_fee_structures_school_class_term
  on fee_structures (college_id, class_id, term, is_active);

create unique index if not exists uq_fee_structures_school_name_year
  on fee_structures (college_id, class_id, term, name, academic_year)
  where class_id is not null;
