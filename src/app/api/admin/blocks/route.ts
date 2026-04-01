import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({ name: z.string().min(1) });

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
    const body = schema.parse(await request.json());
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
