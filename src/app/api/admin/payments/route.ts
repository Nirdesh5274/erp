import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makeReceiptNumber, recalcStudentFeeTotals } from "@/lib/feeManagement";

const postSchema = z.object({
  studentFeeId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMode: z.enum(["Cash", "UPI", "Online", "Card", "Bank Transfer"]),
  transactionId: z.string().trim().optional(),
  receiptNumber: z.string().trim().optional(),
  notes: z.string().trim().max(300).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const url = new URL(request.url);
    const feeId = url.searchParams.get("studentFeeId");

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("payments")
      .select("id,student_fee_id,amount,payment_mode,transaction_id,receipt_number,paid_at,notes")
      .eq("college_id", ctx.collegeId)
      .order("paid_at", { ascending: false });

    if (feeId) query = query.eq("student_fee_id", feeId);

    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    return apiSuccess(data ?? []);
  } catch (error) {
    return apiError("Unable to load payments", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: fee, error: feeError } = await supabase
      .from("student_fees")
      .select("id,college_id,student_id,due_total")
      .eq("id", body.studentFeeId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (feeError || !fee) return apiError("Student fee not found", 404);
    if (Number(fee.due_total ?? 0) <= 0) return apiError("No due amount remaining", 400);

    const receiptNumber = body.receiptNumber?.trim() || makeReceiptNumber();

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        college_id: ctx.collegeId,
        student_fee_id: body.studentFeeId,
        student_id: fee.student_id,
        amount: body.amount,
        payment_mode: body.paymentMode,
        transaction_id: body.transactionId ?? null,
        receipt_number: receiptNumber,
        collected_by: ctx.userId,
        notes: body.notes ?? null,
      })
      .select("id,college_id,student_fee_id,student_id,amount,payment_mode,transaction_id,receipt_number,paid_at")
      .single();

    if (paymentError) return apiError(paymentError.message, 500);

    const totals = await recalcStudentFeeTotals(supabase, body.studentFeeId);

    const { data: receipt, error: receiptError } = await supabase
      .from("receipts")
      .insert({
        college_id: ctx.collegeId,
        payment_id: payment.id,
        student_fee_id: body.studentFeeId,
        student_id: fee.student_id,
        payload: {
          receiptNumber,
          paymentMode: body.paymentMode,
          transactionId: body.transactionId ?? null,
        },
      })
      .select("id,payment_id,student_fee_id,student_id,storage_path,file_url,payload,created_at")
      .single();

    if (receiptError) return apiError(receiptError.message, 500);

    return apiSuccess({ payment, receipt, totals }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to record payment", 500, String(error));
  }
}
