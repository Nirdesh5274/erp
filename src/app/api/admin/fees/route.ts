import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const patchSchema = z.object({
  feeId: z.string().uuid(),
  paidAmount: z.number().nonnegative().optional(),
  paymentMode: z.string().trim().optional(),
  referenceNumber: z.string().trim().optional(),
  receiptNumber: z.string().trim().optional(),
  remind: z.boolean().optional(),
});

interface FeeDbRow {
  id: string;
  amount: number | string;
  paid_amount: number | string;
  due_amount: number | string;
  status: string;
  generated_at: string;
  paid_at: string | null;
  student_id: string;
  admission_id: string;
  due_date: string | null;
  last_reminder_at: string | null;
  payment_mode: string | null;
  reference_number: string | null;
  receipt_number: string | null;
  student: { name: string; email: string } | Array<{ name: string; email: string }> | null;
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("fees")
      .select("id,amount,paid_amount,due_amount,status,generated_at,paid_at,student_id,admission_id,due_date,last_reminder_at,payment_mode,reference_number,receipt_number,student:students(name,email)")
      .eq("college_id", ctx.collegeId)
      .order("generated_at", { ascending: false });

    if (error) return apiError(error.message, 500);

    const fees = ((data ?? []) as FeeDbRow[]).map((item) => {
      const student = Array.isArray(item.student) ? item.student[0] : item.student;

      return {
      id: item.id,
      amount: Number(item.amount),
      paidAmount: Number(item.paid_amount),
      dueAmount: Number(item.due_amount),
      status: item.status,
      generatedAt: item.generated_at,
      paidAt: item.paid_at,
      studentId: item.student_id,
      admissionId: item.admission_id,
      dueDate: item.due_date,
      lastReminderAt: item.last_reminder_at,
      paymentMode: item.payment_mode,
      referenceNumber: item.reference_number,
      receiptNumber: item.receipt_number,
      studentName: student?.name ?? null,
      studentEmail: student?.email ?? null,
    };
    });

    return apiSuccess(fees);
  } catch (error) {
    return apiError("Unable to load fees", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from("fees")
      .select("id,amount,paid_amount,due_amount,paid_at,last_reminder_at,payment_mode,reference_number,receipt_number")
      .eq("id", body.feeId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (existingError) return apiError(existingError.message, 404);

    const totalAmount = Number(existing.amount);
    const paidAmountInput = body.paidAmount ?? 0;
    const nextPaid = Math.min(totalAmount, Number(existing.paid_amount) + paidAmountInput);
    const nextDue = Math.max(totalAmount - nextPaid, 0);

    const updatePayload: Record<string, unknown> = {};
    if (body.paidAmount !== undefined) {
      updatePayload.paid_amount = nextPaid;
      updatePayload.due_amount = nextDue;
      updatePayload.status = nextDue === 0 ? "Paid" : "Pending";
      updatePayload.paid_at = nextDue === 0 ? new Date().toISOString() : existing.paid_at ?? null;
    }
    if (body.paymentMode !== undefined) updatePayload.payment_mode = body.paymentMode;
    if (body.referenceNumber !== undefined) updatePayload.reference_number = body.referenceNumber;
    if (body.receiptNumber !== undefined) updatePayload.receipt_number = body.receiptNumber;
    if (body.remind) updatePayload.last_reminder_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("fees")
      .update(updatePayload)
      .eq("id", body.feeId)
      .eq("college_id", ctx.collegeId)
      .select("id,amount,paid_amount,due_amount,status,generated_at,paid_at,student_id,admission_id,due_date,last_reminder_at,payment_mode,reference_number,receipt_number")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess({
      id: data.id,
      amount: Number(data.amount),
      paidAmount: Number(data.paid_amount),
      dueAmount: Number(data.due_amount),
      status: data.status,
      generatedAt: data.generated_at,
      paidAt: data.paid_at,
      studentId: data.student_id,
      admissionId: data.admission_id,
      dueDate: data.due_date,
      lastReminderAt: data.last_reminder_at,
      paymentMode: data.payment_mode,
      referenceNumber: data.reference_number,
      receiptNumber: data.receipt_number,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update fee", 500, String(error));
  }
}
