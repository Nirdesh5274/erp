import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const postSchema = z.object({
  templateId: z.string().uuid().optional(),
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

    const { data: studentRow, error: studentError } = await supabase
      .from("students")
      .select("id,slot_id")
      .eq("id", body.studentId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (studentError || !studentRow) return apiError("Student not found", 404);

    let resolvedTemplateId = body.templateId ?? null;

    if (!resolvedTemplateId) {
      const { data: slotTemplate, error: slotTemplateError } = await supabase
        .from("fee_templates")
        .select("id")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", studentRow.slot_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (slotTemplateError && !slotTemplateError.message.toLowerCase().includes("slot_id")) {
        return apiError(slotTemplateError.message, 500);
      }

      resolvedTemplateId = slotTemplate?.id ?? null;
    }

    if (!resolvedTemplateId) return apiError("No fee template mapped for student slot", 400);

    const { data: tpl, error: tplError } = await supabase
      .from("fee_templates")
      .select("id,components,installments,slot_id")
      .eq("id", resolvedTemplateId)
      .eq("college_id", ctx.collegeId)
      .maybeSingle();

    let template = tpl as { id: string; components: unknown; installments: unknown; slot_id?: string | null } | null;
    if (tplError && tplError.message.toLowerCase().includes("slot_id")) {
      const fallback = await supabase
        .from("fee_templates")
        .select("id,components,installments")
        .eq("id", resolvedTemplateId)
        .eq("college_id", ctx.collegeId)
        .maybeSingle();
      if (fallback.error || !fallback.data) return apiError("Template not found", 404);
      template = { ...fallback.data, slot_id: null };
    }
    if (!template || (tplError && !tplError.message.toLowerCase().includes("slot_id"))) return apiError("Template not found", 404);

    const templateSlotId = template.slot_id ?? null;
    if (templateSlotId && templateSlotId !== studentRow.slot_id) {
      return apiError("Selected template is not mapped to this student's slot", 400);
    }

    const components = (template.components as FeeComponent[] | null) ?? [];
    const totalAmount = components.reduce((sum, comp) => sum + Number(comp.amount ?? 0), 0);

    const payload = {
      college_id: ctx.collegeId,
      student_id: body.studentId,
      fee_template_id: resolvedTemplateId,
      amount: totalAmount,
      paid_amount: 0,
      due_amount: totalAmount,
      status: "Pending",
      components: template.components ?? [],
      installments: template.installments ?? [],
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
