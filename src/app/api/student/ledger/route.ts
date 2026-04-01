import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id,admission_id,name,email")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .single();

    if (studentError || !student) return apiError("Student not found", 404);

    const { data: fees, error: feesError } = await supabase
      .from("student_fees")
      .select("id,currency,base_total,discount_total,fine_total,extra_total,grand_total,paid_total,due_total,status,due_date,generated_at")
      .eq("college_id", ctx.collegeId)
      .eq("student_id", student.id)
      .order("generated_at", { ascending: false });

    if (feesError) return apiError(feesError.message, 500);

    const feeIds = (fees ?? []).map((fee) => fee.id as string);

    let feeItems: Array<Record<string, unknown>> = [];
    let payments: Array<Record<string, unknown>> = [];
    let receipts: Array<Record<string, unknown>> = [];

    if (feeIds.length > 0) {
      const [itemsRes, paymentsRes, receiptsRes] = await Promise.all([
        supabase
          .from("student_fee_items")
          .select("id,student_fee_id,item_type,label,amount,quantity,metadata,created_at")
          .in("student_fee_id", feeIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("payments")
          .select("id,student_fee_id,amount,payment_mode,transaction_id,receipt_number,paid_at")
          .in("student_fee_id", feeIds)
          .order("paid_at", { ascending: false }),
        supabase
          .from("receipts")
          .select("id,payment_id,student_fee_id,file_url,storage_path,payload,created_at")
          .in("student_fee_id", feeIds)
          .order("created_at", { ascending: false }),
      ]);

      if (itemsRes.error) return apiError(itemsRes.error.message, 500);
      if (paymentsRes.error) return apiError(paymentsRes.error.message, 500);
      if (receiptsRes.error) return apiError(receiptsRes.error.message, 500);

      feeItems = itemsRes.data ?? [];
      payments = paymentsRes.data ?? [];
      receipts = receiptsRes.data ?? [];
    }

    return apiSuccess({
      student,
      fees: fees ?? [],
      feeItems,
      payments,
      receipts,
    });
  } catch (error) {
    return apiError("Unable to load student ledger", 500, String(error));
  }
}
