import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    const institutionId = ctx.collegeId;
    if (!ctx.collegeId || !ctx.userId || !institutionId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id,section_id")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    if (studentError) return apiError(studentError.message, 500);
    if (!student?.section_id) return apiSuccess([]);

    const { data, error } = await supabase
      .from("timetable")
      .select("id,day,period_number,start_time,end_time,subject_id,teacher_id,room_id")
      .eq("institution_id", institutionId)
      .eq("section_id", student.section_id)
      .order("day", { ascending: true })
      .order("period_number", { ascending: true });

    if (error) return apiError(error.message, 500);

    const rows = data ?? [];
    const subjectIds = Array.from(new Set(rows.map((row) => row.subject_id as string | null).filter(Boolean) as string[]));
    const teacherIds = Array.from(new Set(rows.map((row) => row.teacher_id as string | null).filter(Boolean) as string[]));

    const [subjectsRes, teachersRes] = await Promise.all([
      subjectIds.length ? supabase.from("subjects").select("id,name").in("id", subjectIds) : Promise.resolve({ data: [], error: null }),
      teacherIds.length ? supabase.from("users").select("id,name").in("id", teacherIds) : Promise.resolve({ data: [], error: null }),
    ]);

    if (subjectsRes.error) return apiError(subjectsRes.error.message, 500);
    if (teachersRes.error) return apiError(teachersRes.error.message, 500);

    const subjectName = new Map((subjectsRes.data ?? []).map((row) => [row.id as string, row.name as string]));
    const teacherName = new Map((teachersRes.data ?? []).map((row) => [row.id as string, row.name as string]));

    return apiSuccess(
      rows.map((row) => ({
        id: row.id,
        day: row.day,
        periodNumber: row.period_number,
        startTime: row.start_time,
        endTime: row.end_time,
        subjectName: row.subject_id ? subjectName.get(row.subject_id as string) ?? "Subject" : "General",
        teacherName: row.teacher_id ? teacherName.get(row.teacher_id as string) ?? "Teacher" : "Teacher",
      })),
    );
  } catch (error) {
    return apiError("Unable to load student timetable", 500, String(error));
  }
}
