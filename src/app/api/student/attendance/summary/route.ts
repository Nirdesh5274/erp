import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const attendanceStatuses = new Set(["present", "late", "half_day", "on_duty", "medical_leave"]);

async function isSchoolInstitution(collegeId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("colleges")
    .select("type")
    .eq("id", collegeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.type === "school";
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();

    const schoolMode = await isSchoolInstitution(ctx.collegeId);

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id,email,department_id")
      .eq("id", ctx.userId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (userError) return apiError(userError.message, 404);
    const departmentId = user?.department_id as string | null;
    const email = user?.email as string;

    const [studentByUser, studentByEmail] = await Promise.all([
      supabase.from("students").select("id").eq("college_id", ctx.collegeId).eq("user_id", ctx.userId).maybeSingle(),
      supabase.from("students").select("id").eq("college_id", ctx.collegeId).eq("email", email).maybeSingle(),
    ]);

    if (studentByUser.error) return apiError(studentByUser.error.message, 500);
    if (studentByEmail.error) return apiError(studentByEmail.error.message, 500);

    const studentId = (studentByUser.data?.id as string | undefined) ?? (studentByEmail.data?.id as string | undefined);
    if (!studentId) return apiSuccess({ attendancePercent: 0, totalMarked: 0, presentCount: 0, requiredFor75: 0, perSubject: [], calendar: [] });

    if (schoolMode) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const { data: attendanceRows, error: attendanceError } = await supabase
        .from("school_attendance")
        .select("status,timetable_id,date")
        .eq("student_id", studentId);

      if (attendanceError) return apiError(attendanceError.message, 500);

      const parsed = attendanceRows?.map((row) => ({
        status: typeof row.status === "string" ? row.status.toLowerCase() : "",
        timetable_id: row.timetable_id as string | null,
        date: row.date as string | null,
      })) ?? [];

      const timetableIds = Array.from(new Set(parsed.map((r) => r.timetable_id).filter(Boolean) as string[]));
      const { data: timetableData, error: timetableError } = timetableIds.length
        ? await supabase.from("timetable").select("id,subject_id").in("id", timetableIds)
        : { data: [], error: null };

      if (timetableError) return apiError(timetableError.message, 500);

      const timetableToSubject = new Map<string, string | null>();
      for (const row of timetableData ?? []) {
        timetableToSubject.set(row.id as string, (row.subject_id as string | null) ?? null);
      }

      const subjectIds = Array.from(new Set((timetableData ?? []).map((row) => row.subject_id).filter(Boolean) as string[]));
      const { data: subjectsData, error: subjectsError } = subjectIds.length
        ? await supabase.from("subjects").select("id,name").in("id", subjectIds)
        : { data: [], error: null };
      if (subjectsError) return apiError(subjectsError.message, 500);

      const subjectNameMap = new Map<string, string>();
      for (const s of subjectsData ?? []) subjectNameMap.set(s.id as string, s.name as string);

      let presentCount = 0;
      const perSubjectCount = new Map<string, { present: number; total: number }>();

      for (const row of parsed) {
        const status = row.status ?? "";
        const isPresent = attendanceStatuses.has(status);
        if (isPresent) presentCount += status === "half_day" ? 0.5 : 1;
        const subjectId = row.timetable_id ? (timetableToSubject.get(row.timetable_id) ?? "unknown") : "unknown";
        const entry = perSubjectCount.get(subjectId) ?? { present: 0, total: 0 };
        entry.total += 1;
        entry.present += isPresent ? (status === "half_day" ? 0.5 : 1) : 0;
        perSubjectCount.set(subjectId, entry);
      }

      const totalMarked = parsed.length;
      const attendancePercent = totalMarked === 0 ? 0 : Math.round((presentCount / totalMarked) * 100);
      const target = 0.75 * totalMarked;
      const requiredFor75 = Math.max(0, Math.ceil(target - presentCount));

      const perSubject = Array.from(perSubjectCount.entries()).map(([subjectId, counts]) => {
        const percent = counts.total === 0 ? 0 : Math.round((counts.present / counts.total) * 100);
        return {
          subjectId: subjectId === "unknown" ? null : subjectId,
          subjectName: subjectId === "unknown" ? "Unassigned" : subjectNameMap.get(subjectId) ?? "Subject",
          present: counts.present,
          total: counts.total,
          percent,
        };
      });

      const calendar = parsed
        .filter((row) => row.date)
        .filter((row) => {
          const d = new Date(row.date as string);
          return d >= monthStart && d <= monthEnd;
        })
        .map((row) => ({
          date: row.date as string,
          status: attendanceStatuses.has(row.status ?? "") ? "present" : "absent",
        }));

      return apiSuccess({ attendancePercent, totalMarked, presentCount, requiredFor75, perSubject, calendar, departmentId: null });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const { data: attendanceRows, error: attendanceError } = await supabase
      .from("attendance")
      .select("status,lecture_id,date")
      .eq("student_id", studentId);

    if (attendanceError) return apiError(attendanceError.message, 500);

    const parsed = attendanceRows?.map((row) => ({
      status: typeof row.status === "string" ? row.status.toLowerCase() : "",
      lecture_id: row.lecture_id as string | null,
      date: row.date as string | null,
    })) ?? [];

    const lectureIds = Array.from(new Set(parsed.map((r) => r.lecture_id).filter(Boolean) as string[]));

    const { data: lecturesData, error: lecturesError } = lectureIds.length
      ? await supabase.from("lectures").select("id,subject_id").in("id", lectureIds)
      : { data: [], error: null };

    if (lecturesError) return apiError(lecturesError.message, 500);

    const lectureToSubject = new Map<string, string | null>();
    for (const lecture of lecturesData ?? []) {
      lectureToSubject.set(lecture.id as string, (lecture.subject_id as string | null) ?? null);
    }

    const subjectIds = Array.from(
      new Set((lecturesData ?? []).map((lecture) => lecture.subject_id).filter(Boolean) as string[]),
    );
    const { data: subjectsData, error: subjectsError } = subjectIds.length
      ? await supabase.from("subjects").select("id,name").in("id", subjectIds)
      : { data: [], error: null };
    if (subjectsError) return apiError(subjectsError.message, 500);
    const subjectNameMap = new Map<string, string>();
    for (const s of subjectsData ?? []) subjectNameMap.set(s.id as string, s.name as string);

    let presentCount = 0;
    const perSubjectCount = new Map<string, { present: number; total: number }>();

    for (const row of parsed) {
      const status = row.status ?? "";
      const isPresent = attendanceStatuses.has(status);
      if (isPresent) presentCount += status === "half_day" ? 0.5 : 1;
      const subjectId = row.lecture_id ? (lectureToSubject.get(row.lecture_id) ?? "unknown") : "unknown";
      const entry = perSubjectCount.get(subjectId) ?? { present: 0, total: 0 };
      entry.total += 1;
      entry.present += isPresent ? (status === "half_day" ? 0.5 : 1) : 0;
      perSubjectCount.set(subjectId, entry);
    }

    const totalMarked = parsed.length;
    const attendancePercent = totalMarked === 0 ? 0 : Math.round((presentCount / totalMarked) * 100);
    const target = 0.75 * totalMarked;
    const requiredFor75 = Math.max(0, Math.ceil(target - presentCount));

    const perSubject = Array.from(perSubjectCount.entries()).map(([subjectId, counts]) => {
      const percent = counts.total === 0 ? 0 : Math.round((counts.present / counts.total) * 100);
      return {
        subjectId: subjectId === "unknown" ? null : subjectId,
        subjectName: subjectId === "unknown" ? "Unassigned" : subjectNameMap.get(subjectId) ?? "Subject",
        present: counts.present,
        total: counts.total,
        percent,
      };
    });

    const calendar = parsed
      .filter((row) => row.date)
      .filter((row) => {
        const d = new Date(row.date as string);
        return d >= monthStart && d <= monthEnd;
      })
      .map((row) => ({
        date: row.date as string,
        status: attendanceStatuses.has(row.status ?? "") ? "present" : "absent",
      }));

    return apiSuccess({ attendancePercent, totalMarked, presentCount, requiredFor75, perSubject, calendar, departmentId });
  } catch (error) {
    return apiError("Unable to load attendance summary", 500, String(error));
  }
}
