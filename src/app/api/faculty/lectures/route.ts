import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();
    const now = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("lectures")
      .select("id,room_id,starts_at,ends_at,department_id,subject_id")
      .eq("college_id", ctx.collegeId)
      .eq("faculty_id", ctx.userId)
      .gte("ends_at", windowStart.toISOString())
      .lte("starts_at", windowEnd.toISOString())
      .order("starts_at", { ascending: true });

    if (error) return apiError(error.message, 500);

    const lectures = data ?? [];
    const roomIds = Array.from(new Set(lectures.map((row) => row.room_id as string).filter(Boolean)));
    const subjectIds = Array.from(new Set(lectures.map((row) => row.subject_id as string | null).filter(Boolean) as string[]));
    const lectureIds = lectures.map((row) => row.id as string);

    const [roomsRes, subjectsRes, attendanceRes] = await Promise.all([
      roomIds.length ? supabase.from("rooms").select("id,name").in("id", roomIds) : Promise.resolve({ data: [], error: null }),
      subjectIds.length ? supabase.from("subjects").select("id,name").in("id", subjectIds) : Promise.resolve({ data: [], error: null }),
      lectureIds.length
        ? supabase.from("attendance").select("lecture_id,status").in("lecture_id", lectureIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (roomsRes.error) return apiError(roomsRes.error.message, 500);
    if (subjectsRes.error) return apiError(subjectsRes.error.message, 500);
    if (attendanceRes.error) return apiError(attendanceRes.error.message, 500);

    const roomMap = new Map((roomsRes.data ?? []).map((r) => [r.id as string, r.name as string]));
    const subjectMap = new Map((subjectsRes.data ?? []).map((s) => [s.id as string, s.name as string]));
    const attendanceMap = new Map<string, { total: number; present: number }>();

    for (const row of attendanceRes.data ?? []) {
      const lectureId = row.lecture_id as string;
      const state = (row.status as string | null)?.toLowerCase() ?? "";
      const entry = attendanceMap.get(lectureId) ?? { total: 0, present: 0 };
      entry.total += 1;
      if (["present", "late", "half_day", "on_duty", "medical_leave"].includes(state)) {
        entry.present += state === "half_day" ? 0.5 : 1;
      }
      attendanceMap.set(lectureId, entry);
    }

    return apiSuccess(
      lectures.map((lecture) => {
        const attendance = attendanceMap.get(lecture.id as string) ?? { total: 0, present: 0 };
        return {
          id: lecture.id,
          starts_at: lecture.starts_at,
          ends_at: lecture.ends_at,
          room_id: lecture.room_id,
          room_name: roomMap.get(lecture.room_id as string) ?? "TBD",
          subject_id: lecture.subject_id,
          subject_name: lecture.subject_id ? subjectMap.get(lecture.subject_id as string) ?? "Subject" : "General",
          student_count: attendance.total,
          marked_present: attendance.present,
        };
      }),
    );
  } catch (error) {
    return apiError("Unable to load faculty lectures", 500, String(error));
  }
}
