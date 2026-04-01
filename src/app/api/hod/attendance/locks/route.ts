import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const patchSchema = z.object({
  lectureId: z.string().uuid(),
  action: z.enum(["unlock", "lock"]).default("unlock"),
  reason: z.string().trim().max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const url = new URL(request.url);
    let departmentId = url.searchParams.get("departmentId");

    if (ctx.role === "HOD" && ctx.userId) {
      const { data: hodRow } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", ctx.userId)
        .single();
      departmentId = hodRow?.department_id ?? departmentId;
    }

    let query = supabase
      .from("lectures")
      .select("id,subject_id,faculty_id,room_id,starts_at,attendance_lock_reason,attendance_lock_expires_at,attendance_locked_by")
      .eq("college_id", ctx.collegeId)
      .eq("attendance_locked", true)
      .order("starts_at", { ascending: true });

    if (departmentId) {
      query = query.eq("department_id", departmentId);
    }

    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    const subjectIds = Array.from(new Set((data ?? []).map((row) => row.subject_id as string))).filter(Boolean);
    const facultyIds = Array.from(new Set((data ?? []).map((row) => row.faculty_id as string))).filter(Boolean);
    const roomIds = Array.from(new Set((data ?? []).map((row) => row.room_id as string))).filter(Boolean);

    const [subjectRes, facultyRes, roomRes] = await Promise.all([
      subjectIds.length ? supabase.from("subjects").select("id,name").in("id", subjectIds) : { data: [], error: null },
      facultyIds.length ? supabase.from("users").select("id,name,email").in("id", facultyIds) : { data: [], error: null },
      roomIds.length ? supabase.from("rooms").select("id,name").in("id", roomIds) : { data: [], error: null },
    ]);

    if (subjectRes.error) return apiError(subjectRes.error.message, 500);
    if (facultyRes.error) return apiError(facultyRes.error.message, 500);
    if (roomRes.error) return apiError(roomRes.error.message, 500);

    const subjectMap = new Map<string, string>();
    for (const row of subjectRes.data ?? []) subjectMap.set(row.id as string, row.name as string);
    const facultyMap = new Map<string, { name: string; email: string }>();
    for (const row of facultyRes.data ?? []) facultyMap.set(row.id as string, { name: row.name as string, email: row.email as string });
    const roomMap = new Map<string, string>();
    for (const row of roomRes.data ?? []) roomMap.set(row.id as string, row.name as string);

    const lectures = (data ?? []).map((row) => ({
      id: row.id as string,
      subjectId: row.subject_id as string | null,
      subjectName: row.subject_id ? subjectMap.get(row.subject_id as string) ?? "" : "",
      facultyId: row.faculty_id as string,
      facultyName: facultyMap.get(row.faculty_id as string)?.name ?? "",
      facultyEmail: facultyMap.get(row.faculty_id as string)?.email ?? "",
      roomId: row.room_id as string,
      roomName: roomMap.get(row.room_id as string) ?? "",
      startsAt: row.starts_at as string,
      attendanceLockReason: row.attendance_lock_reason as string | null,
      attendanceLockExpiresAt: row.attendance_lock_expires_at as string | null,
      attendanceLockedBy: row.attendance_locked_by as string | null,
    }));

    return apiSuccess({ lectures, departmentId });
  } catch (error) {
    return apiError("Unable to load locks", 500, String(error));
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
      .select("id,department_id,attendance_locked,attendance_lock_expires_at")
      .eq("id", body.lectureId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (lectureError) return apiError(lectureError.message, 404);
    if (ctx.role === "HOD" && ctx.userId) {
      const { data: hodRow } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", ctx.userId)
        .single();
      if (hodRow?.department_id && hodRow.department_id !== lecture.department_id) {
        return apiError("HOD can only unlock their department", 403);
      }
    }

    const shouldLock = body.action === "lock";
    const { error: updateError } = await supabase
      .from("lectures")
      .update({
        attendance_locked: shouldLock,
        attendance_locked_by: shouldLock ? ctx.userId ?? null : null,
        attendance_lock_reason: body.reason ?? null,
        attendance_lock_expires_at: lecture.attendance_lock_expires_at,
      })
      .eq("id", lecture.id)
      .eq("college_id", ctx.collegeId);

    if (updateError) return apiError(updateError.message, 500);

    return apiSuccess({ ok: true, attendanceLocked: shouldLock });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update attendance lock", 500, String(error));
  }
}
