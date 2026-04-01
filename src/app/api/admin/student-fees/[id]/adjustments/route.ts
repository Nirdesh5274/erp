import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcStudentFeeTotals } from "@/lib/feeManagement";

const adjustmentSchema = z.object({
  feeId: z.string().uuid(),
  itemType: z.enum(["discount", "fine", "extra"]),
  label: z.string().min(1),
  amount: z.number().positive(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const { id } = await params;
    const body = adjustmentSchema.parse(await request.json());
    if (id !== body.feeId) return apiError("Fee id mismatch", 400);

    const supabase = getSupabaseAdmin();

    const { data: fee, error: feeError } = await supabase
      .from("student_fees")
      .select("id,college_id")
      .eq("id", id)
      .eq("college_id", ctx.collegeId)
      .single();

    if (feeError || !fee) return apiError("Student fee not found", 404);

    const signedAmount = body.itemType === "discount" ? body.amount : body.amount;
    const { data: item, error: itemError } = await supabase
      .from("student_fee_items")
      .insert({
        student_fee_id: id,
        college_id: ctx.collegeId,
        source_component_id: null,
        item_type: body.itemType,
        label: body.label,
        amount: signedAmount,
        quantity: 1,
        metadata: body.metadata ?? {},
      })
      .select("id,item_type,label,amount,created_at")
      .single();

    if (itemError) return apiError(itemError.message, 500);

    const totals = await recalcStudentFeeTotals(supabase, id);

    return apiSuccess({ item, totals }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to add fee adjustment", 500, String(error));
  }
}
