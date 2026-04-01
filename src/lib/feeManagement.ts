import type { SupabaseClient } from "@supabase/supabase-js";

export async function recalcStudentFeeTotals(supabase: SupabaseClient, studentFeeId: string) {
  const { data: items, error: itemsError } = await supabase
    .from("student_fee_items")
    .select("item_type,amount")
    .eq("student_fee_id", studentFeeId);

  if (itemsError) throw new Error(itemsError.message);

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select("amount")
    .eq("student_fee_id", studentFeeId);

  if (paymentsError) throw new Error(paymentsError.message);

  const totals = {
    component: 0,
    discount: 0,
    fine: 0,
    extra: 0,
  };

  for (const row of items ?? []) {
    const type = String(row.item_type) as keyof typeof totals;
    const amount = Number(row.amount ?? 0);
    if (type in totals) totals[type] += amount;
  }

  const paidTotal = (payments ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const grandTotal = Math.max(totals.component + totals.fine + totals.extra - totals.discount, 0);
  const dueTotal = Math.max(grandTotal - paidTotal, 0);

  const status = grandTotal === 0
    ? "Cancelled"
    : dueTotal === 0
      ? "Paid"
      : paidTotal > 0
        ? "Partially Paid"
        : "Pending";

  const { error: updateError } = await supabase
    .from("student_fees")
    .update({
      base_total: totals.component,
      discount_total: totals.discount,
      fine_total: totals.fine,
      extra_total: totals.extra,
      grand_total: grandTotal,
      paid_total: paidTotal,
      due_total: dueTotal,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", studentFeeId);

  if (updateError) throw new Error(updateError.message);

  return {
    ...totals,
    grandTotal,
    paidTotal,
    dueTotal,
    status,
  };
}

export function makeReceiptNumber(prefix = "RCPT") {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
  return `${prefix}-${yyyy}${mm}${dd}-${random}`;
}
