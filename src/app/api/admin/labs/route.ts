import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  blockId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  capacity: z.number().int().nonnegative(),
  systems: z.number().int().nonnegative(),
  workingSystems: z.number().int().nonnegative(),
  internet: z.boolean().default(true),
  labAssistant: z.string().optional().nullable(),
});

export async function GET() {
  const ctx = await getRequestContext();
  if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
  if (!ctx.collegeId) return apiError("Missing college context", 400);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("college_id", ctx.collegeId)
    .eq("room_type", "Lab")
    .order("created_at", { ascending: false });

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
      .from("rooms")
      .insert({
        college_id: ctx.collegeId,
        block_id: body.blockId ?? null,
        name: body.name,
        room_type: "Lab",
        capacity: body.capacity,
        systems: body.systems,
        working_systems: body.workingSystems,
        internet: body.internet,
        lab_assistant: body.labAssistant ?? null,
      })
      .select("*")
      .single();

    if (error) return apiError(error.message, 500);
    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create lab", 500, String(error));
  }
}
