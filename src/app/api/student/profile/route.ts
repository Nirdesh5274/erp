import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface ProfileResponse {
  student: {
    id: string | null;
    name: string;
    email: string;
    departmentId: string | null;
    departmentName: string | null;
    slotId: string | null;
    course: string | null;
    currentSemester: number | null;
    admissionId: string | null;
  };
  subjects: Array<{ id: string; name: string; facultyName: string | null }>;
}

function isMissingCurrentSemesterColumnError(message: string) {
  const text = message.toLowerCase();
  return text.includes("current_semester") && (text.includes("column") || text.includes("schema cache"));
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Student"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId || !ctx.userId) return apiError("Missing user context", 400);

    const supabase = getSupabaseAdmin();

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("id,name,email,department_id")
      .eq("id", ctx.userId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (userError) return apiError(userError.message, 500);

    const { data: studentRowWithSemester, error: studentWithSemesterError } = await supabase
      .from("students")
      .select("id,department_id,slot_id,admission_id,name,email,current_semester")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    let studentRow = studentRowWithSemester as
      | {
          id: string;
          department_id: string | null;
          slot_id: string | null;
          admission_id: string | null;
          name: string;
          email: string;
          current_semester?: number | null;
        }
      | null;

    if (studentWithSemesterError) {
      if (!isMissingCurrentSemesterColumnError(studentWithSemesterError.message)) {
        return apiError(studentWithSemesterError.message, 500);
      }

      const { data: fallbackStudentRow, error: fallbackStudentError } = await supabase
        .from("students")
        .select("id,department_id,slot_id,admission_id,name,email")
        .eq("college_id", ctx.collegeId)
        .eq("user_id", ctx.userId)
        .maybeSingle();

      if (fallbackStudentError) return apiError(fallbackStudentError.message, 500);
      studentRow = fallbackStudentRow as typeof studentRow;
    }

    const departmentId = studentRow?.department_id ?? userRow?.department_id ?? null;

    const [{ data: departmentRow }, { data: slotRow }] = await Promise.all([
      departmentId
        ? supabase.from("departments").select("id,name").eq("id", departmentId).eq("college_id", ctx.collegeId).maybeSingle()
        : { data: null, error: null },
      studentRow?.slot_id
        ? supabase.from("slots").select("id,course").eq("id", studentRow.slot_id).eq("college_id", ctx.collegeId).maybeSingle()
        : { data: null, error: null },
    ]);

    const { data: subjectsRows, error: subjectsError } = departmentId
      ? await supabase.from("subjects").select("id,name").eq("department_id", departmentId).eq("college_id", ctx.collegeId).order("name")
      : { data: [], error: null };

    if (subjectsError) return apiError(subjectsError.message, 500);

    const subjectIds = (subjectsRows ?? []).map((s) => s.id);
    const { data: facultyMapRows, error: facultyMapError } = subjectIds.length
      ? await supabase.from("faculty_subjects").select("subject_id,faculty_id").in("subject_id", subjectIds)
      : { data: [], error: null };

    if (facultyMapError) return apiError(facultyMapError.message, 500);

    const facultyIds = Array.from(new Set((facultyMapRows ?? []).map((row) => row.faculty_id).filter(Boolean) as string[]));
    const { data: facultyRows, error: facultyError } = facultyIds.length
      ? await supabase.from("users").select("id,name").in("id", facultyIds)
      : { data: [], error: null };

    if (facultyError) return apiError(facultyError.message, 500);

    const facultyName = new Map<string, string>();
    for (const f of facultyRows ?? []) {
      facultyName.set(f.id, f.name as string);
    }

    const subjectFaculty = new Map<string, string | null>();
    for (const mapRow of facultyMapRows ?? []) {
      if (!mapRow.subject_id) continue;
      subjectFaculty.set(mapRow.subject_id as string, mapRow.faculty_id ? facultyName.get(mapRow.faculty_id) ?? null : null);
    }

    const payload: ProfileResponse = {
      student: {
        id: studentRow?.id ?? null,
        name: studentRow?.name ?? (userRow?.name as string),
        email: studentRow?.email ?? (userRow?.email as string),
        departmentId,
        departmentName: departmentRow?.name ?? null,
        slotId: studentRow?.slot_id ?? null,
        course: slotRow?.course ?? null,
        currentSemester: studentRow?.current_semester ?? null,
        admissionId: studentRow?.admission_id ?? null,
      },
      subjects: (subjectsRows ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        facultyName: subjectFaculty.get(s.id) ?? null,
      })),
    };

    return apiSuccess(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return apiError(message, 500);
  }
}
