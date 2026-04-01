import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const patchSchema = z.object({
  alertId: z.string().uuid(),
  resolved: z.boolean().default(true),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("monitoring_alerts")
      .select("id,room_id,lecture_id,message,severity,resolved,created_at")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return apiError(error.message, 500);

    return apiSuccess({ alerts: data ?? [] });
  } catch (error) {
    return apiError("Unable to load notifications", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("monitoring_alerts")
      .update({ resolved: body.resolved, resolved_by: ctx.userId ?? null })
      .eq("id", body.alertId)
      .eq("college_id", ctx.collegeId);

    if (error) return apiError(error.message, 500);

    return apiSuccess({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update notification", 500, String(error));
  }
}
