import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(1).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const { institutionId, institutionType } = await getInstitutionContext(ctx);

    const body = schema.parse(await request.json());
    const updatePayload: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const normalizedName = body.name.trim();
      if (!normalizedName) return apiError("Class name is required", 400);
      updatePayload.name = normalizedName;
    }

    if (body.metadata !== undefined) {
      updatePayload.metadata = body.metadata;
    }

    if (Object.keys(updatePayload).length === 0) {
      return apiError("No fields provided for update", 400);
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("classes")
      .update(updatePayload)
      .eq("id", id)
      .eq("institution_id", institutionId)
      .eq("type", institutionType)
      .select("id,name,type,metadata,created_at")
      .single();

    if (error) return apiError(error.message, 500);

    return apiSuccess({
      id: data.id,
      name: data.name,
      type: data.type,
      metadata: data.metadata ?? {},
      createdAt: data.created_at,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update class", 500, String(error));
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    const { institutionId, institutionType } = await getInstitutionContext(ctx);

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("classes")
      .delete()
      .eq("id", id)
      .eq("institution_id", institutionId)
      .eq("type", institutionType);

    if (error) return apiError(error.message, 500);
    return apiSuccess({ id, deleted: true });
  } catch (error) {
    return apiError("Unable to delete class", 500, String(error));
  }
}
