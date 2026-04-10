import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  location: z.string().max(200).optional(),
  logoUrl: z.string().url().or(z.literal("")).optional(),
  institutionCode: z.string().max(50).optional(),
});

function isMissingColumnError(message: string | undefined, column: string) {
  const text = String(message ?? "").toLowerCase();
  return text.includes(column.toLowerCase()) && (text.includes("column") || text.includes("schema cache"));
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();

    const withAll = await supabase
      .from("colleges")
      .select("id,name,location,type,logo_url,institution_code,status")
      .eq("id", ctx.collegeId)
      .maybeSingle();

    if (!withAll.error && withAll.data) {
      return apiSuccess({
        id: withAll.data.id,
        name: withAll.data.name,
        location: withAll.data.location,
        type: withAll.data.type,
        logoUrl: String((withAll.data as { logo_url?: string | null }).logo_url ?? ""),
        institutionCode: String((withAll.data as { institution_code?: string | null }).institution_code ?? ""),
        status: String((withAll.data as { status?: string | null }).status ?? "Pending"),
      });
    }

    const fallback = await supabase
      .from("colleges")
      .select("id,name,location,type")
      .eq("id", ctx.collegeId)
      .maybeSingle();

    if (fallback.error) return apiError(fallback.error.message, 500);
    if (!fallback.data) return apiError("Institution not found", 404);

    return apiSuccess({
      id: fallback.data.id,
      name: fallback.data.name,
      location: fallback.data.location,
      type: fallback.data.type,
      logoUrl: "",
      institutionCode: "",
      status: "Pending",
    });
  } catch (error) {
    return apiError("Unable to load institution", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload.name = body.name.trim();
    if (body.location !== undefined) updatePayload.location = body.location.trim();
    if (body.logoUrl !== undefined) updatePayload.logo_url = body.logoUrl.trim() || null;
    if (body.institutionCode !== undefined) updatePayload.institution_code = body.institutionCode.trim() || null;

    if (Object.keys(updatePayload).length === 0) return apiError("No fields provided", 400);

    const result = await supabase
      .from("colleges")
      .update(updatePayload)
      .eq("id", ctx.collegeId)
      .select("id,name,location,type,logo_url,institution_code,status")
      .single();

    if (result.error && (isMissingColumnError(result.error.message, "logo_url") || isMissingColumnError(result.error.message, "institution_code"))) {
      const fallbackPayload: Record<string, unknown> = {};
      if (body.name !== undefined) fallbackPayload.name = body.name.trim();
      if (body.location !== undefined) fallbackPayload.location = body.location.trim();

      const fallbackResult = await supabase
        .from("colleges")
        .update(fallbackPayload)
        .eq("id", ctx.collegeId)
        .select("id,name,location,type")
        .single();

      if (fallbackResult.error) return apiError(fallbackResult.error.message, 500);
      return apiSuccess({
        id: fallbackResult.data.id,
        name: fallbackResult.data.name,
        location: fallbackResult.data.location,
        type: fallbackResult.data.type,
        logoUrl: "",
        institutionCode: "",
        status: "Pending",
      });
    }

    if (result.error) return apiError(result.error.message, 500);

    return apiSuccess({
      id: result.data.id,
      name: result.data.name,
      location: result.data.location,
      type: result.data.type,
      logoUrl: String((result.data as { logo_url?: string | null }).logo_url ?? ""),
      institutionCode: String((result.data as { institution_code?: string | null }).institution_code ?? ""),
      status: String((result.data as { status?: string | null }).status ?? "Pending"),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update institution", 500, String(error));
  }
}
