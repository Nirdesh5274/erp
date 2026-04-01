import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  departmentId: z.string().uuid(),
  subjectId: z.string().uuid().nullable().optional(),
  facultyId: z.string().uuid(),
  roomId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  substituteFacultyId: z.string().uuid().optional(),
  isSubstitute: z.boolean().optional(),
});

const patchSchema = z.object({
  lectureId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  roomId: z.string().uuid().optional(),
  facultyId: z.string().uuid().optional(),
  substituteFacultyId: z.string().uuid().optional(),
  isSubstitute: z.boolean().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  attendanceLocked: z.boolean().optional(),
});

const querySchema = z.object({
  departmentId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(["csv"]).optional(),
  includeMonitoring: z.enum(["true", "false"]).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

interface LectureRow {
  id: string;
  department_id: string;
  subject_id: string | null;
  faculty_id: string;
  substitute_faculty_id: string | null;
  is_substitute: boolean | null;
  room_id: string;
  starts_at: string;
  ends_at: string;
  attendance_locked: boolean | null;
  attendance_lock_reason: string | null;
  attendance_lock_expires_at: string | null;
}

interface RoomStatusRow {
  room_id: string;
  status: string;
  current_lecture_id: string | null;
  override_reason: string | null;
  updated_at: string | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin", "Faculty", "Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const url = new URL(request.url);
    const parsedQuery = querySchema.parse(Object.fromEntries(url.searchParams));

    // Resolve department scope
    let departmentId = parsedQuery.departmentId ?? null;
    if (ctx.role === "HOD" && ctx.userId) {
      const { data: hodRow } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", ctx.userId)
        .single();
      departmentId = hodRow?.department_id ?? departmentId;
    }

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const defaultTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const windowFrom = parsedQuery.from ? new Date(parsedQuery.from) : defaultFrom;
    const windowTo = parsedQuery.to ? new Date(parsedQuery.to) : defaultTo;

    const [departmentsRes, roomsRes, facultiesRes, subjectsRes] = await Promise.all([
      supabase.from("departments").select("id,name,college_id").eq("college_id", ctx.collegeId).order("name"),
      supabase.from("rooms").select("id,name,room_type,capacity").eq("college_id", ctx.collegeId).order("name"),
      supabase
        .from("users")
        .select("id,name,email,department_id")
        .eq("college_id", ctx.collegeId)
        .eq("role", "Faculty")
        .order("name"),
      supabase.from("subjects").select("id,name,department_id").eq("college_id", ctx.collegeId).order("name"),
    ]);

    if (departmentsRes.error) return apiError(departmentsRes.error.message, 500);
    if (roomsRes.error) return apiError(roomsRes.error.message, 500);
    if (facultiesRes.error) return apiError(facultiesRes.error.message, 500);
    if (subjectsRes.error) return apiError(subjectsRes.error.message, 500);

    const departments = departmentsRes.data ?? [];
    const rooms = roomsRes.data ?? [];
    const faculties = (facultiesRes.data ?? []).filter((faculty) => !departmentId || faculty.department_id === departmentId);
    const subjects = (subjectsRes.data ?? []).filter((subject) => !departmentId || subject.department_id === departmentId);

    let lectureQuery = supabase
      .from("lectures")
      .select(
        "id,department_id,subject_id,faculty_id,substitute_faculty_id,is_substitute,room_id,starts_at,ends_at,attendance_locked,attendance_lock_reason,attendance_lock_expires_at",
      )
      .eq("college_id", ctx.collegeId)
      .gte("starts_at", windowFrom.toISOString())
      .lte("ends_at", windowTo.toISOString())
      .order("id", { ascending: true })
      .limit(parsedQuery.limit ?? 200);

    if (parsedQuery.cursor) {
      lectureQuery = lectureQuery.gt("id", parsedQuery.cursor);
    }

    if (departmentId) {
      lectureQuery = lectureQuery.eq("department_id", departmentId);
    }

    const { data: lectureRows, error: lectureError } = await lectureQuery;
    if (lectureError) return apiError(lectureError.message, 500);

    const lectures = (lectureRows ?? []) as LectureRow[];
    const lectureIds = lectures.map((l) => l.id);
    const roomIds = Array.from(new Set(lectures.map((l) => l.room_id)));

    const attendanceMap = new Map<string, { present: number; total: number }>();
    if (lectureIds.length > 0) {
      const { data: attendanceRows, error: attendanceError } = await supabase
        .from("attendance")
        .select("lecture_id,status")
        .in("lecture_id", lectureIds);
      if (attendanceError) return apiError(attendanceError.message, 500);
      for (const row of attendanceRows ?? []) {
        const entry = attendanceMap.get(row.lecture_id) ?? { present: 0, total: 0 };
        const status = (row.status as string | null)?.toLowerCase();
        if (status && ["present", "late", "half_day", "on_duty", "medical_leave"].includes(status)) {
          entry.present += status === "half_day" ? 0.5 : 1;
        }
        entry.total += 1;
        attendanceMap.set(row.lecture_id, entry);
      }
    }

    const monitoringMap = new Map<string, RoomStatusRow>();
    if (parsedQuery.includeMonitoring !== "false" && roomIds.length > 0) {
      const { data: roomMonitoringRows, error: monitoringError } = await supabase
        .from("room_monitoring")
        .select("room_id,status,current_lecture_id,override_reason,updated_at")
        .in("room_id", roomIds)
        .eq("college_id", ctx.collegeId);
      if (monitoringError) return apiError(monitoringError.message, 500);
      for (const row of roomMonitoringRows ?? []) {
        monitoringMap.set(row.room_id as string, row as RoomStatusRow);
      }
    }

    let alertRows: Array<{ room_id: string | null }> = [];
    if (roomIds.length) {
      const { data, error: alertsError } = await supabase
        .from("monitoring_alerts")
        .select("id,room_id,message,severity,resolved")
        .eq("resolved", false)
        .eq("college_id", ctx.collegeId)
        .in("room_id", roomIds);
      if (alertsError) return apiError(alertsError.message, 500);
      alertRows = (data ?? []) as Array<{ room_id: string | null }>;
    }

    const alertMap = new Map<string, number>();
    for (const alert of alertRows ?? []) {
      const roomId = alert.room_id as string | null;
      if (!roomId) continue;
      alertMap.set(roomId, (alertMap.get(roomId) ?? 0) + 1);
    }

    const facultyName = new Map<string, string>();
    for (const faculty of faculties) {
      facultyName.set(faculty.id, faculty.name as string);
    }
    const subjectName = new Map<string, string>();
    for (const subject of subjects) {
      subjectName.set(subject.id, subject.name as string);
    }
    const roomName = new Map<string, string>();
    for (const room of rooms) {
      roomName.set(room.id, room.name as string);
    }
    const departmentName = new Map<string, string>();
    for (const dept of departments) {
      departmentName.set(dept.id, dept.name as string);
    }

    const conflicts = new Map<string, string[]>();
    for (const lecture of lectures) {
      const overlap = lectures.filter((candidate) => {
        if (candidate.id === lecture.id) return false;
        const overlaps =
          new Date(candidate.starts_at).getTime() < new Date(lecture.ends_at).getTime() &&
          new Date(candidate.ends_at).getTime() > new Date(lecture.starts_at).getTime();
        const sameRoom = candidate.room_id === lecture.room_id;
        const sameFaculty = candidate.faculty_id === lecture.faculty_id ||
          (candidate.substitute_faculty_id && candidate.substitute_faculty_id === lecture.faculty_id) ||
          (lecture.substitute_faculty_id && lecture.substitute_faculty_id === candidate.faculty_id);
        return overlaps && (sameRoom || sameFaculty);
      });
      if (overlap.length > 0) {
        const reasons = overlap.map((c) =>
          c.room_id === lecture.room_id
            ? `Room overlap with lecture ${c.id}`
            : `Faculty overlap with lecture ${c.id}`,
        );
        conflicts.set(lecture.id, reasons);
      }
    }

    const payload = lectures.map((lecture) => {
      const attendance = attendanceMap.get(lecture.id) ?? { present: 0, total: 0 };
      const attendancePercent = attendance.total > 0 ? Math.round((attendance.present / attendance.total) * 100) : null;
      const monitor = monitoringMap.get(lecture.room_id);
      const nowMs = now.getTime();
      const endsAtMs = new Date(lecture.ends_at).getTime();
      const startsAtMs = new Date(lecture.starts_at).getTime();
      const isOverdue = nowMs > endsAtMs + 5 * 60 * 1000;
      const isStartingSoon = startsAtMs - nowMs <= 10 * 60 * 1000 && startsAtMs > nowMs;

      return {
        id: lecture.id,
        departmentId: lecture.department_id,
        departmentName: departmentName.get(lecture.department_id) ?? "",
        subjectId: lecture.subject_id,
        subjectName: lecture.subject_id ? subjectName.get(lecture.subject_id) ?? "" : "",
        facultyId: lecture.faculty_id,
        facultyName: facultyName.get(lecture.faculty_id) ?? "",
        substituteFacultyId: lecture.substitute_faculty_id,
        substituteFacultyName: lecture.substitute_faculty_id ? facultyName.get(lecture.substitute_faculty_id) ?? "" : "",
        isSubstitute: Boolean(lecture.is_substitute),
        roomId: lecture.room_id,
        roomName: roomName.get(lecture.room_id) ?? "",
        startsAt: lecture.starts_at,
        endsAt: lecture.ends_at,
        attendanceLocked: Boolean(lecture.attendance_locked),
        attendanceLockReason: lecture.attendance_lock_reason ?? null,
        attendancePercent,
        presentCount: attendance.present,
        totalMarked: attendance.total,
        liveStatus: monitor?.status?.toString().toLowerCase() ?? "vacant",
        overrideReason: monitor?.override_reason ?? null,
        alerts: alertMap.get(lecture.room_id) ?? 0,
        isOverdue,
        isStartingSoon,
        conflicts: conflicts.get(lecture.id) ?? [],
      };
    });

    if (parsedQuery.format === "csv") {
      const header = [
        "Lecture ID",
        "Department",
        "Subject",
        "Faculty",
        "Room",
        "Starts At",
        "Ends At",
        "Attendance %",
        "Live Status",
        "Alerts",
      ];
      const rows = payload.map((row) => [
        row.id,
        row.departmentName,
        row.subjectName,
        row.facultyName,
        row.roomName,
        row.startsAt,
        row.endsAt,
        row.attendancePercent ?? "",
        row.liveStatus,
        row.alerts,
      ]);
      const csv = [header, ...rows]
        .map((columns) => columns.map((col) => `"${String(col ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\n");
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=hod-schedule.csv",
        },
      });
    }

    return apiSuccess({
      window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
      departments,
      rooms,
      faculties,
      subjects,
      lectures: payload,
      nextCursor: payload[payload.length - 1]?.id ?? null,
    });
  } catch (error) {
    return apiError("Unable to load schedule", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (endsAt <= startsAt) return apiError("End time must be after start time", 400);

    let departmentId = body.departmentId;
    if (ctx.role === "HOD" && ctx.userId) {
      const { data: hodRow, error: hodError } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", ctx.userId)
        .single();
      if (hodError) return apiError(hodError.message, 500);
      departmentId = hodRow?.department_id ?? departmentId;
      if (departmentId !== body.departmentId) return apiError("HOD can only schedule inside their department", 403);
    }

    const { data: conflicts, error: conflictsError } = await supabase
      .from("lectures")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .or(`room_id.eq.${body.roomId},faculty_id.eq.${body.facultyId}`)
      .lt("starts_at", endsAt.toISOString())
      .gt("ends_at", startsAt.toISOString())
      .limit(1);

    if (conflictsError) return apiError(conflictsError.message, 500);
    if ((conflicts ?? []).length > 0) {
      return apiError("Schedule conflict found (room or faculty busy)", 400);
    }

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id,capacity")
      .eq("id", body.roomId)
      .eq("college_id", ctx.collegeId)
      .single();
    if (roomError) return apiError(roomError.message, 400);

    const { count: studentsCount, error: studentsError } = await supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .eq("department_id", departmentId);

    if (studentsError) return apiError(studentsError.message, 500);
    if (Number(room.capacity ?? 0) < Number(studentsCount ?? 0)) {
      return apiError("Room capacity insufficient", 400);
    }

    const { data: inserted, error: insertError } = await supabase
      .from("lectures")
      .insert({
        college_id: ctx.collegeId,
        department_id: departmentId,
        subject_id: body.subjectId ?? null,
        faculty_id: body.facultyId,
        substitute_faculty_id: body.substituteFacultyId ?? null,
        is_substitute: body.isSubstitute ?? false,
        room_id: body.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      .select("id,department_id,subject_id,faculty_id,room_id,starts_at,ends_at")
      .single();

    if (insertError) return apiError(insertError.message, 500);

    await supabase
      .from("room_monitoring")
      .upsert(
        {
          room_id: body.roomId,
          college_id: ctx.collegeId,
          status: "Occupied",
          current_lecture_id: inserted.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      );

    return apiSuccess({ lectureId: inserted.id }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create lecture", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = patchSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: lecture, error: lectureError } = await supabase
      .from("lectures")
      .select(
        "id,college_id,department_id,subject_id,faculty_id,substitute_faculty_id,is_substitute,room_id,starts_at,ends_at,attendance_locked,attendance_lock_reason,attendance_lock_expires_at",
      )
      .eq("id", body.lectureId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (lectureError) return apiError(lectureError.message, 404);

    if (ctx.role === "HOD" && ctx.userId && body.departmentId && body.departmentId !== lecture.department_id) {
      return apiError("HOD can only manage their department", 403);
    }

    const nextRoomId = body.roomId ?? lecture.room_id;
    const nextFacultyId = body.facultyId ?? lecture.faculty_id;
    const nextSubstituteId = body.substituteFacultyId ?? lecture.substitute_faculty_id;
    const nextSubjectId = body.subjectId ?? lecture.subject_id;
    const nextStartsAt = body.startsAt ?? lecture.starts_at;
    const nextEndsAt = body.endsAt ?? lecture.ends_at;

    if (new Date(nextEndsAt) <= new Date(nextStartsAt)) {
      return apiError("End time must be after start time", 400);
    }

    const { data: conflicts, error: conflictsError } = await supabase
      .from("lectures")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .neq("id", lecture.id)
      .or(`room_id.eq.${nextRoomId},faculty_id.eq.${nextFacultyId}`)
      .lt("starts_at", nextEndsAt)
      .gt("ends_at", nextStartsAt)
      .limit(1);

    if (conflictsError) return apiError(conflictsError.message, 500);
    if ((conflicts ?? []).length > 0) {
      return apiError("Schedule conflict found (room or faculty busy)", 400);
    }

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("capacity")
      .eq("id", nextRoomId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (roomError) return apiError(roomError.message, 400);

    const { count: studentsCount, error: studentsError } = await supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .eq("department_id", lecture.department_id);

    if (studentsError) return apiError(studentsError.message, 500);
    if (Number(room.capacity ?? 0) < Number(studentsCount ?? 0)) {
      return apiError("Room capacity insufficient", 400);
    }

    const payload = {
      room_id: nextRoomId,
      faculty_id: nextFacultyId,
      substitute_faculty_id: nextSubstituteId,
      is_substitute: body.isSubstitute ?? lecture.is_substitute ?? false,
      subject_id: nextSubjectId,
      starts_at: nextStartsAt,
      ends_at: nextEndsAt,
      attendance_locked: body.attendanceLocked ?? lecture.attendance_locked,
      attendance_lock_reason: body.attendanceLocked === false ? null : lecture.attendance_lock_reason,
    };

    const { data: updated, error: updateError } = await supabase
      .from("lectures")
      .update(payload)
      .eq("id", lecture.id)
      .eq("college_id", ctx.collegeId)
      .select(
        "id,department_id,subject_id,faculty_id,substitute_faculty_id,is_substitute,room_id,starts_at,ends_at,attendance_locked,attendance_lock_reason",
      )
      .single();

    if (updateError) return apiError(updateError.message, 500);

    if (lecture.room_id !== nextRoomId) {
      await supabase
        .from("room_monitoring")
        .upsert(
          {
            room_id: lecture.room_id,
            college_id: ctx.collegeId,
            status: "Vacant",
            current_lecture_id: null,
          },
          { onConflict: "room_id" },
        );
    }

    await supabase
      .from("room_monitoring")
      .upsert(
        {
          room_id: nextRoomId,
          college_id: ctx.collegeId,
          status: "Occupied",
          current_lecture_id: lecture.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      );

    return apiSuccess(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update lecture", 500, String(error));
  }
}
