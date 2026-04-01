import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const componentSchema = z.object({ name: z.string().min(1), amount: z.number().nonnegative(), fine_per_day: z.number().nonnegative().optional() });
const installmentSchema = z.object({ label: z.string().min(1), amount: z.number().nonnegative(), dueDate: z.string().date().optional() });

const postSchema = z.object({
  name: z.string().min(1),
  academicYear: z.string().min(1),
  courseId: z.string().uuid().optional(),
  components: z.array(componentSchema).min(1),
  installments: z.array(installmentSchema).optional(),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("fee_templates")
      .select("id,academic_year,course_id,components,installments,created_at")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if (error) return apiError(error.message, 500);

    return apiSuccess(data ?? []);
  } catch (error) {
    return apiError("Unable to load fee templates", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = postSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const payload = {
      college_id: ctx.collegeId,
      academic_year: body.academicYear,
      course_id: body.courseId ?? null,
      components: body.components,
      installments: body.installments ?? [],
    };

    const { data, error } = await supabase
      .from("fee_templates")
      .insert(payload)
      .select("id,academic_year,course_id,components,installments,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create fee template", 500, String(error));
  }
}
