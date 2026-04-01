import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const postSchema = z.object({
  feeId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMode: z.string().min(1),
  referenceNumber: z.string().trim().optional(),
  receiptNumber: z.string().trim().optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const url = new URL(request.url);
    const feeId = url.searchParams.get("feeId");
    if (!feeId) return apiError("feeId is required", 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("payment_receipts")
      .select("id,fee_id,receipt_number,amount,payment_mode,reference_number,paid_at")
      .eq("fee_id", feeId)
      .order("paid_at", { ascending: false });

    if (error) return apiError(error.message, 500);
    return apiSuccess(data ?? []);
  } catch (error) {
    return apiError("Unable to load receipts", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: feeRow, error: feeError } = await supabase
      .from("fees")
      .select("id,college_id,amount,paid_amount,due_amount,paid_at")
      .eq("id", body.feeId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (feeError || !feeRow) return apiError("Fee not found", 404);

    const nextPaid = Math.min(Number(feeRow.paid_amount ?? 0) + body.amount, Number(feeRow.amount ?? 0));
    const nextDue = Math.max(Number(feeRow.amount ?? 0) - nextPaid, 0);

    const { data: receipt, error: receiptError } = await supabase
      .from("payment_receipts")
      .insert({
        fee_id: body.feeId,
        amount: body.amount,
        payment_mode: body.paymentMode,
        reference_number: body.referenceNumber ?? null,
        receipt_number: body.receiptNumber ?? null,
      })
      .select("id,fee_id,receipt_number,amount,payment_mode,reference_number,paid_at")
      .single();

    if (receiptError) return apiError(receiptError.message, 500);

    const { error: updateError } = await supabase
      .from("fees")
      .update({
        paid_amount: nextPaid,
        due_amount: nextDue,
        status: nextDue === 0 ? "Paid" : "Pending",
        paid_at: nextDue === 0 ? new Date().toISOString() : feeRow.paid_at ?? null,
        payment_mode: body.paymentMode,
        reference_number: body.referenceNumber ?? null,
        receipt_number: body.receiptNumber ?? receipt?.receipt_number ?? null,
      })
      .eq("id", body.feeId)
      .eq("college_id", ctx.collegeId);

    if (updateError) return apiError(updateError.message, 500);

    return apiSuccess(receipt, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create receipt", 500, String(error));
  }
}
