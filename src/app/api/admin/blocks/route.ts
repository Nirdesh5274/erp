import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const createSchema = z.object({ name: z.string().min(1) });
const patchSchema = z.object({ id: z.string().uuid(), name: z.string().min(1) });
const deleteSchema = z.object({ id: z.string().uuid() });

export async function GET() {
  const ctx = await getRequestContext();
  if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
  if (!ctx.collegeId) return apiError("Missing college context", 400);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("blocks").select("*").eq("college_id", ctx.collegeId).order("created_at", { ascending: false });
  if (error) return apiError(error.message, 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: Request) {
  const ctx = await getRequestContext();
  if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
  if (!ctx.collegeId) return apiError("Missing college context", 400);

  try {
    const body = createSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("blocks")
      .insert({ college_id: ctx.collegeId, name: body.name })
      .select("*")
      .single();
    if (error) return apiError(error.message, 500);
    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create block", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  const ctx = await getRequestContext();
  if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
  if (!ctx.collegeId) return apiError("Missing college context", 400);

  try {
    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("blocks")
      .update({ name: body.name })
      .eq("id", body.id)
      .eq("college_id", ctx.collegeId)
      .select("*")
      .single();

    if (error) return apiError(error.message, 500);
    return apiSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update block", 500, String(error));
  }
}

export async function DELETE(request: Request) {
  const ctx = await getRequestContext();
  if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
  if (!ctx.collegeId) return apiError("Missing college context", 400);

  try {
    const url = new URL(request.url);
    const body = deleteSchema.parse({ id: url.searchParams.get("id") });
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("id", body.id)
      .eq("college_id", ctx.collegeId);

    if (error) return apiError(error.message, 500);
    return apiSuccess({ deleted: true, id: body.id });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to delete block", 500, String(error));
  }
}
