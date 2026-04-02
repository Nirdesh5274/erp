CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  phone varchar(15) NOT NULL,
  email varchar(100),
  parent_name varchar(100),
  parent_phone varchar(15),
  interested_class varchar(50),
  interested_section varchar(10),
  academic_year varchar(20),
  status varchar(20) NOT NULL DEFAULT 'new',
  refused_reason text,
  follow_up_date date,
  notes text,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  converted_student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  converted_at timestamptz,
  source varchar(50),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_check CHECK (status IN ('new', 'contacted', 'follow_up', 'converted', 'refused')),
  CONSTRAINT leads_source_check CHECK (source IS NULL OR source IN ('walk_in', 'phone', 'online', 'referral', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_leads_institution ON leads(institution_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);