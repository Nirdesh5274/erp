import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2).optional(),
  location: z.string().min(2).optional(),
  type: z.enum(["college", "school"]).optional(),
  institutionCode: z.string().max(50).optional().nullable(),
  status: z.enum(["Active", "Pending", "Suspended"]).optional(),
  logoUrl: z.string().url().optional().nullable(),
});

function isMissingColumnError(message: string | undefined, columnName: string) {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes(columnName.toLowerCase())
    && (normalized.includes("does not exist") || normalized.includes("column") || normalized.includes("schema cache"));
}

function normalizeCollegeRow(row: Record<string, unknown>) {
  return {
    ...row,
    institution_code: (row.institution_code as string | null | undefined) ?? null,
    status: (row.status as string | null | undefined) ?? "Active",
    logo_url: (row.logo_url as string | null | undefined) ?? null,
  };
}

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
    if (body.institutionCode !== undefined) updatePayload.institution_code = body.institutionCode || null;
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.logoUrl !== undefined) updatePayload.logo_url = body.logoUrl || null;

    if (Object.keys(updatePayload).length === 0) return apiError("No fields provided for update", 400);

    let { data, error } = await supabase
      .from("colleges")
      .update(updatePayload)
      .eq("id", id)
      .select("id,name,location,type,institution_code,status,logo_url,created_at")
      .single();

    if (error && (isMissingColumnError(error.message, "institution_code") || isMissingColumnError(error.message, "status") || isMissingColumnError(error.message, "logo_url"))) {
      const fallbackPayload: Record<string, unknown> = {};
      if (body.name !== undefined) fallbackPayload.name = body.name;
      if (body.location !== undefined) fallbackPayload.location = body.location;
      if (body.type !== undefined) fallbackPayload.type = body.type;

      if (Object.keys(fallbackPayload).length === 0) {
        return apiError("Requested fields are not available in current database schema", 400);
      }

      const fallback = await supabase
        .from("colleges")
        .update(fallbackPayload)
        .eq("id", id)
        .select("id,name,location,type,created_at")
        .single();

      data = fallback.data as typeof data;
      error = fallback.error;
    }

    if (error) return apiError(error.message, 500);
    return apiSuccess(normalizeCollegeRow(data as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update institution", 500, String(error));
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const supabase = getSupabaseAdmin();
    const { count: usersCount, error: usersError } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("college_id", id);

    if (usersError) return apiError(usersError.message, 500);

    const { error } = await supabase
      .from("colleges")
      .delete()
      .eq("id", id);

    if (error) return apiError(error.message, 500);

    return apiSuccess({ deleted: true, affectedUsers: usersCount ?? 0 });
  } catch (error) {
    return apiError("Unable to delete institution", 500, String(error));
  }
}
