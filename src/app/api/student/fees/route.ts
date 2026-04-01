import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();
    const { data: studentRow, error: studentError } = await supabase
      .from("students")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    if (studentError) return apiError(studentError.message, 500);
    const studentId = studentRow?.id;
    if (!studentId) return apiError("Student record not found", 404);

    const { data: fees, error } = await supabase
      .from("fees")
      .select("id,amount,paid_amount,due_amount,status,due_date,receipt_number,reference_number,payment_mode,generated_at")
      .eq("college_id", ctx.collegeId)
      .eq("student_id", studentId)
      .order("generated_at", { ascending: false });

    if (error) return apiError(error.message, 500);

    const { data: receipts } = await supabase
      .from("payment_receipts")
      .select("id,fee_id,receipt_number,amount,payment_mode,reference_number,paid_at")
      .in("fee_id", (fees ?? []).map((f) => f.id));

    return apiSuccess({ fees: fees ?? [], receipts: receipts ?? [] });
  } catch (error) {
    return apiError("Unable to load student fees", 500, String(error));
  }
}
