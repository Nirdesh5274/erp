import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const patchSchema = z.object({
  roomId: z.string().uuid(),
  status: z.enum(["occupied", "vacant", "maintenance", "cleaning"]),
  lectureId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(200).optional(),
});

interface RoomRow {
  id: string;
  name: string;
  room_type: string;
  capacity: number;
}

interface RoomMonitoringRow {
  room_id: string;
  status: string | null;
  current_lecture_id: string | null;
  override_reason: string | null;
  updated_at: string | null;
}

interface LectureRow {
  id: string;
  faculty_id: string | null;
  subject_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

interface AttendanceRow {
  lecture_id: string;
  status: string;
}

interface MonitoringAlertRow {
  id: string;
  college_id: string;
  room_id: string | null;
  lecture_id: string | null;
  message: string | null;
  severity: string | null;
  resolved: boolean | null;
  created_at: string | null;
}

interface StatusLogRow {
  id: string;
  room_id: string | null;
  lecture_id: string | null;
  status: string | null;
  reason: string | null;
  override_by: string | null;
  changed_at: string | null;
}

function isKnownRoomStatusTriggerError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("lower(room_live_status)") || normalized.includes("function lower(room_live_status)");
}

const statusToEnumValue: Record<"occupied" | "vacant" | "maintenance" | "cleaning", "Occupied" | "Vacant"> = {
  occupied: "Occupied",
  maintenance: "Occupied",
  vacant: "Vacant",
  cleaning: "Vacant",
};

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "SuperAdmin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();

    const { data: roomsData, error: roomsError } = await supabase
      .from("rooms")
      .select("id,name,room_type,capacity")
      .eq("college_id", ctx.collegeId);

    if (roomsError) return apiError(roomsError.message, 500);

    const { data: roomMonitoringData, error: roomMonitoringError } = await supabase
      .from("room_monitoring")
      .select("room_id,status,current_lecture_id,override_reason,updated_at")
      .eq("college_id", ctx.collegeId);

    if (roomMonitoringError) return apiError(roomMonitoringError.message, 500);

    const roomMonitoringByRoomId = new Map<string, RoomMonitoringRow>();
    for (const row of (roomMonitoringData ?? []) as RoomMonitoringRow[]) {
      roomMonitoringByRoomId.set(row.room_id, row);
    }

    const lectureIds = Array.from(
      new Set(
        ((roomMonitoringData ?? []) as RoomMonitoringRow[])
          .map((row) => row.current_lecture_id)
          .filter(Boolean) as string[],
      ),
    );

    const lectureById = new Map<string, LectureRow>();
    if (lectureIds.length > 0) {
      const { data: lectureRows, error: lectureError } = await supabase
        .from("lectures")
        .select("id,faculty_id,subject_id,starts_at,ends_at")
        .in("id", lectureIds);
      if (lectureError) return apiError(lectureError.message, 500);

      for (const row of (lectureRows ?? []) as LectureRow[]) {
        lectureById.set(row.id, row);
      }
    }

    const rooms = (roomsData ?? []) as RoomRow[];
    const facultyIds = Array.from(
      new Set(Array.from(lectureById.values()).map((row) => row.faculty_id).filter(Boolean) as string[]),
    );
    const subjectIds = Array.from(
      new Set(Array.from(lectureById.values()).map((row) => row.subject_id).filter(Boolean) as string[]),
    );

    const attendanceMap = new Map<string, { present: number; total: number }>();
    if (lectureIds.length > 0) {
      const { data: attendance, error: attendanceError } = await supabase
        .from("attendance")
        .select("lecture_id,status")
        .in("lecture_id", lectureIds);

      if (attendanceError) return apiError(attendanceError.message, 500);

      for (const row of (attendance ?? []) as AttendanceRow[]) {
        const key = row.lecture_id;
        const entry = attendanceMap.get(key) ?? { present: 0, total: 0 };
        const status = row.status ? row.status.toLowerCase() : "";
        if (["present", "late", "half_day", "on_duty", "medical_leave"].includes(status)) {
          entry.present += status === "half_day" ? 0.5 : 1;
        }
        entry.total += 1;
        attendanceMap.set(key, entry);
      }
    }

    const facultyMap = new Map<string, string>();
    if (facultyIds.length > 0) {
      const { data: facultyRows, error } = await supabase
        .from("users")
        .select("id,name")
        .in("id", facultyIds);
      if (error) return apiError(error.message, 500);
      for (const row of facultyRows ?? []) {
        facultyMap.set(row.id as string, row.name as string);
      }
    }

    const subjectMap = new Map<string, string>();
    if (subjectIds.length > 0) {
      const { data: subjectRows, error } = await supabase
        .from("subjects")
        .select("id,name")
        .in("id", subjectIds);
      if (error) return apiError(error.message, 500);
      for (const row of subjectRows ?? []) {
        subjectMap.set(row.id as string, row.name as string);
      }
    }

    const { data: logRowsForStatus, error: logRowsForStatusError } = await supabase
      .from("room_status_log")
      .select("room_id,status,changed_at")
      .eq("college_id", ctx.collegeId)
      .order("changed_at", { ascending: false })
      .limit(300);

    if (logRowsForStatusError) return apiError(logRowsForStatusError.message, 500);

    const latestStatusByRoom = new Map<string, string>();
    for (const row of (logRowsForStatus ?? []) as Array<{ room_id: string | null; status: string | null }>) {
      if (!row.room_id || !row.status) continue;
      if (!latestStatusByRoom.has(row.room_id)) {
        latestStatusByRoom.set(row.room_id, row.status.toLowerCase());
      }
    }

    const now = new Date();
    const roomPayload = rooms.map((room) => {
      const monitor = roomMonitoringByRoomId.get(room.id);
      const lecture = monitor?.current_lecture_id ? lectureById.get(monitor.current_lecture_id) : undefined;
      const startsAt = lecture?.starts_at ? new Date(lecture.starts_at) : null;
      const endsAt = lecture?.ends_at ? new Date(lecture.ends_at) : null;
      const attendance = monitor?.current_lecture_id ? attendanceMap.get(monitor.current_lecture_id) : undefined;
      const present = attendance?.present ?? 0;
      const total = attendance?.total ?? 0;
      const attendancePercent = total > 0 ? Math.round((present / total) * 100) : null;

      const state = (latestStatusByRoom.get(room.id) ?? monitor?.status ?? "Vacant").toString().toLowerCase();
      const isOverdue = endsAt ? now.getTime() > endsAt.getTime() + 5 * 60 * 1000 : false;
      const isStartingSoon = startsAt ? startsAt.getTime() - now.getTime() <= 10 * 60 * 1000 && startsAt > now : false;
      const timeRemainingMinutes = endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 60000)) : null;

      return {
        roomId: room.id,
        roomName: room.name,
        roomType: room.room_type,
        capacity: room.capacity,
        status: state,
        currentLectureId: monitor?.current_lecture_id ?? null,
        facultyId: lecture?.faculty_id ?? null,
        facultyName: lecture?.faculty_id ? facultyMap.get(lecture.faculty_id) ?? "" : "",
        subjectId: lecture?.subject_id ?? null,
        subjectName: lecture?.subject_id ? subjectMap.get(lecture.subject_id) ?? "" : "",
        startsAt: startsAt?.toISOString() ?? null,
        endsAt: endsAt?.toISOString() ?? null,
        attendancePercent,
        presentCount: present,
        totalMarked: total,
        timeRemainingMinutes,
        isOverdue,
        isStartingSoon,
      };
    });

    const roomMeta = new Map<string, { roomName: string; roomType: string }>();
    for (const room of roomPayload) {
      roomMeta.set(room.roomId, { roomName: room.roomName, roomType: room.roomType });
    }

    const [{ data: alertRows, error: alertsError }, { data: logRows, error: logError }] = await Promise.all([
      supabase
        .from("monitoring_alerts")
        .select("id,college_id,room_id,lecture_id,message,severity,resolved,created_at")
        .eq("college_id", ctx.collegeId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("room_status_log")
        .select("id,room_id,lecture_id,status,reason,override_by,changed_at")
        .eq("college_id", ctx.collegeId)
        .order("changed_at", { ascending: false })
        .limit(50),
    ]);

    if (alertsError) return apiError(alertsError.message, 500);
    if (logError) return apiError(logError.message, 500);

    const overrideIds = Array.from(
      new Set((logRows ?? []).map((row) => (row as StatusLogRow).override_by).filter(Boolean) as string[]),
    );
    const overrideNameMap = new Map<string, string>();

    if (overrideIds.length > 0) {
      const { data: userRows, error } = await supabase.from("users").select("id,name").in("id", overrideIds);
      if (error) return apiError(error.message, 500);
      for (const row of userRows ?? []) {
        overrideNameMap.set(row.id as string, row.name as string);
      }
    }

    const alerts = (alertRows ?? []).map((row) => {
      const alert = row as MonitoringAlertRow;
      return {
        id: alert.id,
        roomId: alert.room_id,
        lectureId: alert.lecture_id,
        message: alert.message ?? "",
        severity: alert.severity ?? "warning",
        resolved: Boolean(alert.resolved),
        createdAt: alert.created_at ?? new Date().toISOString(),
      };
    });

    const events = (logRows ?? []).map((row) => {
      const log = row as StatusLogRow;
      const meta = log.room_id ? roomMeta.get(log.room_id) : undefined;
      return {
        id: log.id,
        roomId: log.room_id ?? "",
        lectureId: log.lecture_id ?? null,
        status: (log.status ?? "vacant").toLowerCase(),
        reason: log.reason ?? null,
        changedAt: log.changed_at ?? new Date().toISOString(),
        changedBy: log.override_by ? overrideNameMap.get(log.override_by) ?? null : null,
        roomName: meta?.roomName ?? "",
        roomType: meta?.roomType ?? "",
      };
    });

    return apiSuccess({ rooms: roomPayload, alerts, events });
  } catch (error) {
    return apiError("Unable to load monitoring", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const mappedStatus = statusToEnumValue[body.status];
    const overrideExpiry = body.status === "maintenance" || body.status === "cleaning"
      ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      : null;

    const { error: updateError } = await supabase
      .from("room_monitoring")
      .upsert(
        {
          room_id: body.roomId,
          college_id: ctx.collegeId,
          status: mappedStatus,
          current_lecture_id: body.lectureId ?? null,
          override_by: ctx.userId ?? null,
          override_reason: body.reason ?? null,
          override_expires_at: overrideExpiry,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      );

    if (updateError && !isKnownRoomStatusTriggerError(updateError.message)) {
      return apiError(updateError.message, 500);
    }

    const { error: logError } = await supabase.from("room_status_log").insert({
      room_id: body.roomId,
      college_id: ctx.collegeId,
      status: body.status,
      lecture_id: body.lectureId ?? null,
      override_by: ctx.userId ?? null,
      reason: body.reason ?? null,
    });

    if (logError) return apiError(logError.message, 500);

    return apiSuccess({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update monitoring", 500, String(error));
  }
}
