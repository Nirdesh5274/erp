import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface LockedLectureRow {
  id: string;
  subject_id: string | null;
  faculty_id: string;
  room_id: string;
  starts_at: string;
  attendance_lock_reason: string | null;
  attendance_lock_expires_at?: string | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    const url = new URL(request.url);
    let departmentId = url.searchParams.get("departmentId");

    if (ctx.role === "HOD" && ctx.userId) {
      const { data: hodRow, error: hodError } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", ctx.userId)
        .single();
      if (hodError) return apiError(hodError.message, 500);
      departmentId = hodRow?.department_id ?? departmentId;
    }

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);

    let facultyCountQuery = supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .eq("role", "Faculty");
    if (departmentId) facultyCountQuery = facultyCountQuery.eq("department_id", departmentId);

    let subjectCountQuery = supabase
      .from("subjects")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId);
    if (departmentId) subjectCountQuery = subjectCountQuery.eq("department_id", departmentId);

    let lecturesThisWeekQuery = supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .gte("starts_at", startOfWeek.toISOString())
      .lt("starts_at", endOfWeek.toISOString());
    if (departmentId) lecturesThisWeekQuery = lecturesThisWeekQuery.eq("department_id", departmentId);

    let lockedCountQuery = supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("college_id", ctx.collegeId)
      .eq("attendance_locked", true);
    if (departmentId) lockedCountQuery = lockedCountQuery.eq("department_id", departmentId);

    const [facultyCountRes, subjectCountRes, lecturesThisWeekRes, lockedCountRes, alertCountRes] = await Promise.all([
      facultyCountQuery,
      subjectCountQuery,
      lecturesThisWeekQuery,
      lockedCountQuery,
      supabase
        .from("monitoring_alerts")
        .select("id", { count: "exact", head: true })
        .eq("college_id", ctx.collegeId)
        .eq("resolved", false),
    ]);

    if (facultyCountRes.error) return apiError(facultyCountRes.error.message, 500);
    if (subjectCountRes.error) return apiError(subjectCountRes.error.message, 500);
    if (lecturesThisWeekRes.error) return apiError(lecturesThisWeekRes.error.message, 500);
    if (lockedCountRes.error) return apiError(lockedCountRes.error.message, 500);
    if (alertCountRes.error) return apiError(alertCountRes.error.message, 500);

    let subjectsQuery = supabase.from("subjects").select("id,name,department_id").eq("college_id", ctx.collegeId);
    if (departmentId) subjectsQuery = subjectsQuery.eq("department_id", departmentId);
    const { data: subjectRows, error: subjectError } = await subjectsQuery;
    if (subjectError) return apiError(subjectError.message, 500);

    const subjectIds = (subjectRows ?? []).map((row: { id: string }) => row.id as string);
    const { data: assignmentRows, error: assignmentError } = subjectIds.length
      ? await supabase
          .from("faculty_subjects")
          .select("faculty_id,subject_id")
          .in("subject_id", subjectIds)
      : { data: [], error: null };
    if (assignmentError) return apiError(assignmentError.message, 500);

    const facultyIds = Array.from(new Set((assignmentRows ?? []).map((row: { faculty_id: string }) => row.faculty_id as string)));
    const { data: facultyRows, error: facultyError } = facultyIds.length
      ? await supabase
          .from("users")
          .select("id,name,email")
          .in("id", facultyIds)
      : { data: [], error: null };
    if (facultyError) return apiError(facultyError.message, 500);

    const subjectMap = new Map<string, { id: string; name: string }>();
    for (const row of subjectRows ?? []) {
      subjectMap.set(row.id as string, { id: row.id as string, name: row.name as string });
    }
    const facultyMap = new Map<string, { id: string; name: string; email: string }>();
    for (const row of facultyRows ?? []) {
      facultyMap.set(row.id as string, { id: row.id as string, name: row.name as string, email: row.email as string });
    }

    const assignments = (assignmentRows ?? []).map((row: { subject_id: string; faculty_id: string }) => ({
      subjectId: row.subject_id as string,
      subjectName: subjectMap.get(row.subject_id as string)?.name ?? "",
      facultyId: row.faculty_id as string,
      facultyName: facultyMap.get(row.faculty_id as string)?.name ?? "",
      facultyEmail: facultyMap.get(row.faculty_id as string)?.email ?? "",
    }));

    let lockedLecturesQuery = supabase
      .from("lectures")
      .select("id,subject_id,faculty_id,room_id,starts_at,attendance_lock_reason,attendance_lock_expires_at")
      .eq("college_id", ctx.collegeId)
      .eq("attendance_locked", true)
      .order("starts_at", { ascending: true })
      .limit(8);
    if (departmentId) lockedLecturesQuery = lockedLecturesQuery.eq("department_id", departmentId);
    const { data: lockedRows, error: lockedError } = await lockedLecturesQuery;
    if (lockedError) return apiError(lockedError.message, 500);

    const roomIds = Array.from(new Set((lockedRows ?? []).map((row: LockedLectureRow) => row.room_id as string))).filter(Boolean);
    const { data: roomRows, error: roomError } = roomIds.length
      ? await supabase.from("rooms").select("id,name").in("id", roomIds)
      : { data: [], error: null };
    if (roomError) return apiError(roomError.message, 500);
    const roomMap = new Map<string, string>();
    for (const row of roomRows ?? []) roomMap.set(row.id as string, row.name as string);

    const lockedLectures = (lockedRows ?? []).map((row: LockedLectureRow) => ({
      id: row.id as string,
      subjectId: row.subject_id as string | null,
      subjectName: row.subject_id ? subjectMap.get(row.subject_id as string)?.name ?? "" : "",
      facultyId: row.faculty_id as string,
      facultyName: facultyMap.get(row.faculty_id as string)?.name ?? "",
      roomId: row.room_id as string,
      roomName: roomMap.get(row.room_id as string) ?? "",
      startsAt: row.starts_at as string,
      attendanceLockReason: row.attendance_lock_reason as string | null,
      attendanceLockExpiresAt: row.attendance_lock_expires_at as string | null,
    }));

    // Attendance rate (last 7 days, department scoped)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    let recentLecturesQuery = supabase
      .from("lectures")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .gte("starts_at", sevenDaysAgo.toISOString())
      .limit(200);
    if (departmentId) recentLecturesQuery = recentLecturesQuery.eq("department_id", departmentId);
    const { data: recentLectures } = await recentLecturesQuery;
    const recentLectureIds = (recentLectures ?? []).map((row: { id: string }) => row.id as string);

    let attendancePercent: number | null = null;
    if (recentLectureIds.length) {
      const { data: attendanceRows } = await supabase
        .from("attendance")
        .select("lecture_id,status")
        .in("lecture_id", recentLectureIds);

      let present = 0;
      let total = 0;
      for (const row of attendanceRows ?? []) {
        const status = (row.status as string | null)?.toLowerCase();
        if (status && ["present", "late", "half_day", "on_duty", "medical_leave"].includes(status)) {
          present += status === "half_day" ? 0.5 : 1;
        }
        total += 1;
      }
      attendancePercent = total > 0 ? Math.round((present / total) * 100) : null;
    }

    return apiSuccess({
      departmentId,
      stats: {
        faculty: facultyCountRes.count ?? 0,
        subjects: subjectCountRes.count ?? 0,
        lecturesThisWeek: lecturesThisWeekRes.count ?? 0,
        attendanceLocked: lockedCountRes.count ?? 0,
        openAlerts: alertCountRes.count ?? 0,
        attendancePercent,
      },
      assignments,
      lockedLectures,
    });
  } catch (error) {
    return apiError("Unable to load dashboard", 500, String(error));
  }
}
