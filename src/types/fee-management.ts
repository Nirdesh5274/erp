export type FeeItemType = "component" | "discount" | "fine" | "extra";

export interface FeeStructureRow {
  id: string;
  college_id: string;
  slot_id: string;
  semester: number;
  name: string;
  academic_year: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeeComponentRow {
  id: string;
  fee_structure_id: string;
  college_id: string;
  component_key: string;
  component_name: string;
  default_amount: number;
  sort_order: number;
}

export interface StudentFeeRow {
  id: string;
  college_id: string;
  student_id: string;
  admission_id: string | null;
  slot_id: string | null;
  fee_structure_id: string | null;
  currency: string;
  base_total: number;
  discount_total: number;
  fine_total: number;
  extra_total: number;
  grand_total: number;
  paid_total: number;
  due_total: number;
  status: string;
  due_date: string | null;
  grace_days: number;
  generated_at: string;
}

export interface StudentFeeItemRow {
  id: string;
  student_fee_id: string;
  college_id: string;
  source_component_id: string | null;
  item_type: FeeItemType;
  label: string;
  amount: number;
  quantity: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  college_id: string;
  student_fee_id: string;
  student_id: string;
  amount: number;
  payment_mode: string;
  transaction_id: string | null;
  receipt_number: string;
  paid_at: string;
}

export interface ReceiptRow {
  id: string;
  college_id: string;
  payment_id: string;
  student_fee_id: string;
  student_id: string;
  storage_path: string | null;
  file_url: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
