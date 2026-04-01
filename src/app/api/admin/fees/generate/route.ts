import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const postSchema = z.object({
  templateId: z.string().uuid(),
  studentId: z.string().uuid(),
  dueDate: z.string().date().optional(),
  graceDays: z.number().int().nonnegative().optional(),
});

interface FeeComponent {
  amount?: number | string | null;
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: tpl, error: tplError } = await supabase
      .from("fee_templates")
      .select("id,components,installments")
      .eq("id", body.templateId)
      .eq("college_id", ctx.collegeId)
      .maybeSingle();
    if (tplError || !tpl) return apiError("Template not found", 404);

    const components = (tpl.components as FeeComponent[] | null) ?? [];
    const totalAmount = components.reduce((sum, comp) => sum + Number(comp.amount ?? 0), 0);

    const payload = {
      college_id: ctx.collegeId,
      student_id: body.studentId,
      fee_template_id: body.templateId,
      amount: totalAmount,
      paid_amount: 0,
      due_amount: totalAmount,
      status: "Pending",
      components: tpl.components ?? [],
      installments: tpl.installments ?? [],
      due_date: body.dueDate ?? null,
      grace_days: body.graceDays ?? 0,
    };

    const { data, error } = await supabase
      .from("fees")
      .insert(payload)
      .select("id,amount,paid_amount,due_amount,status,generated_at,student_id,due_date,grace_days,fee_template_id")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to generate fee", 500, String(error));
  }
}
