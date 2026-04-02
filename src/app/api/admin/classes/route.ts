import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(1).max(100),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    const { institutionId, institutionType } = await getInstitutionContext(ctx);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("classes")
      .select("id,name,type,metadata,created_at")
      .eq("institution_id", institutionId)
      .eq("type", institutionType)
      .order("name", { ascending: true });

    if (error) return apiError(error.message, 500);

    return apiSuccess(
      (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
      })),
    );
  } catch (error) {
    return apiError("Unable to load classes", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const { institutionId, institutionType } = await getInstitutionContext(ctx);

    const body = schema.parse(await request.json());
    const normalizedName = body.name.trim();
    if (!normalizedName) return apiError("Class name is required", 400);

    const supabase = getSupabaseAdmin();
    const { data: existing, error: existingError } = await supabase
      .from("classes")
      .select("id")
      .eq("institution_id", institutionId)
      .ilike("name", normalizedName)
      .maybeSingle();

    if (existingError) return apiError(existingError.message, 500);
    if (existing) return apiError("Class already exists", 400);

    const { data, error } = await supabase
      .from("classes")
      .insert({
        institution_id: institutionId,
        name: normalizedName,
        type: institutionType,
        metadata: body.metadata ?? {},
      })
      .select("id,name,type,metadata,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess(
      {
        id: data.id,
        name: data.name,
        type: data.type,
        metadata: data.metadata ?? {},
        createdAt: data.created_at,
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create class", 500, String(error));
  }
}
