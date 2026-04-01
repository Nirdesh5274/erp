import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  blockId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  roomType: z.enum(["Classroom", "Lab", "Auditorium", "Library"]),
  capacity: z.number().int().nonnegative(),
  benches: z.number().int().nonnegative().default(0),
});

export async function GET() {
  const ctx = await getRequestContext();
  if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
  if (!ctx.collegeId) return apiError("Missing college context", 400);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("rooms")
    .select("id,name,room_type,capacity,benches,systems,working_systems,internet,lab_assistant,block_id")
    .eq("college_id", ctx.collegeId)
    .order("name", { ascending: true });

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
        room_type: body.roomType,
        capacity: body.capacity,
        benches: body.benches,
      })
      .select("*")
      .single();

    if (error) return apiError(error.message, 500);

    await supabase
      .from("room_monitoring")
      .upsert({ room_id: data.id, college_id: ctx.collegeId, status: "Vacant" }, { onConflict: "room_id" });

    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create room", 500, String(error));
  }
}
