import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const patchSchema = z.object({
  roomId: z.string().uuid(),
  status: z.enum(["Occupied", "Vacant"]),
  currentLectureId: z.string().uuid().nullable().optional(),
});

interface RoomRow {
  id: string;
  name: string;
  room_type: string;
  capacity: number;
}

interface MonitoringRow {
  room_id: string;
  status: "Occupied" | "Vacant";
  current_lecture_id: string | null;
  updated_at: string;
}

function isKnownRoomStatusTriggerError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("lower(room_live_status)") || normalized.includes("function lower(room_live_status)");
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();

    const { data: monitoringRows, error: monitoringError } = await supabase
      .from("room_monitoring")
      .select("room_id,status,current_lecture_id,updated_at")
      .eq("college_id", ctx.collegeId);

    if (monitoringError) return apiError(monitoringError.message, 500);

    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id,name,room_type,capacity")
      .eq("college_id", ctx.collegeId);

    if (roomsError) return apiError(roomsError.message, 500);

    const roomById = new Map<string, RoomRow>(((rooms ?? []) as RoomRow[]).map((room) => [room.id, room]));

    const monitor = ((monitoringRows ?? []) as MonitoringRow[]).map((item) => ({
      roomId: item.room_id,
      roomName: roomById.get(item.room_id)?.name ?? "Unknown",
      roomType: roomById.get(item.room_id)?.room_type ?? "Unknown",
      roomCapacity: roomById.get(item.room_id)?.capacity ?? 0,
      status: item.status,
      currentLectureId: item.current_lecture_id,
      updatedAt: item.updated_at,
    }));

    return apiSuccess(monitor);
  } catch (error) {
    return apiError("Unable to load class monitor", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("room_monitoring")
      .upsert(
        {
          room_id: body.roomId,
          college_id: ctx.collegeId,
          status: body.status,
          current_lecture_id: body.status === "Vacant" ? null : body.currentLectureId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      )
      .select("room_id,status,current_lecture_id,updated_at")
      .single();

    if (error && !isKnownRoomStatusTriggerError(error.message)) return apiError(error.message, 500);
    return apiSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update class monitor", 500, String(error));
  }
}
