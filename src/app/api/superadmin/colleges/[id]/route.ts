import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2).optional(),
  location: z.string().min(2).optional(),
  type: z.enum(["college", "school"]).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (body.type) {
      const { data: currentCollege, error: currentCollegeError } = await supabase
        .from("colleges")
        .select("id,type")
        .eq("id", id)
        .maybeSingle();

      if (currentCollegeError) return apiError(currentCollegeError.message, 500);
      if (!currentCollege) return apiError("Institution not found", 404);

      if (currentCollege.type !== body.type) {
        const [{ count: admissionsCount, error: admissionsError }, { count: studentsCount, error: studentsError }] = await Promise.all([
          supabase.from("admissions").select("id", { count: "exact", head: true }).eq("college_id", id),
          supabase.from("students").select("id", { count: "exact", head: true }).eq("college_id", id),
        ]);

        if (admissionsError || studentsError) {
          return apiError(admissionsError?.message ?? studentsError?.message ?? "Unable to validate type change", 500);
        }

        if ((admissionsCount ?? 0) > 0 || (studentsCount ?? 0) > 0) {
          return apiError("Cannot change type: existing admission data found", 400);
        }
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.location !== undefined) updatePayload.location = body.location;
    if (body.type !== undefined) updatePayload.type = body.type;

    if (Object.keys(updatePayload).length === 0) return apiError("No fields provided for update", 400);

    const { data, error } = await supabase
      .from("colleges")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return apiError(error.message, 500);
    return apiSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update institution", 500, String(error));
  }
}
