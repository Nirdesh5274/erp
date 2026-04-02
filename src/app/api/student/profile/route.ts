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
    classId: string | null;
    className: string | null;
    sectionId: string | null;
    sectionName: string | null;
    rollNumber: string | null;
    term: string | null;
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
      .select("id,department_id,slot_id,class_id,section_id,roll_number,term,admission_id,name,email,current_semester")
      .eq("college_id", ctx.collegeId)
      .eq("user_id", ctx.userId)
      .maybeSingle();

    let studentRow = studentRowWithSemester as
      | {
          id: string;
          department_id: string | null;
          slot_id: string | null;
          class_id?: string | null;
          section_id?: string | null;
          roll_number?: string | null;
          term?: string | null;
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
        .select("id,department_id,slot_id,class_id,section_id,roll_number,term,admission_id,name,email")
        .eq("college_id", ctx.collegeId)
        .eq("user_id", ctx.userId)
        .maybeSingle();

      if (fallbackStudentError) return apiError(fallbackStudentError.message, 500);
      studentRow = fallbackStudentRow as typeof studentRow;
    }

    const departmentId = studentRow?.department_id ?? userRow?.department_id ?? null;

    const [{ data: departmentRow }, { data: slotRow }, { data: classRow }, { data: sectionRow }] = await Promise.all([
      departmentId
        ? supabase.from("departments").select("id,name").eq("id", departmentId).eq("college_id", ctx.collegeId).maybeSingle()
        : { data: null, error: null },
      studentRow?.slot_id
        ? supabase.from("slots").select("id,course").eq("id", studentRow.slot_id).eq("college_id", ctx.collegeId).maybeSingle()
        : { data: null, error: null },
      studentRow?.class_id
        ? supabase.from("classes").select("id,name").eq("id", studentRow.class_id).eq("institution_id", ctx.collegeId).maybeSingle()
        : { data: null, error: null },
      studentRow?.section_id
        ? supabase.from("sections").select("id,name").eq("id", studentRow.section_id).eq("institution_id", ctx.collegeId).maybeSingle()
        : { data: null, error: null },
    ]);

    const subjectsQuery = studentRow?.class_id
      ? supabase.from("subjects").select("id,name").eq("class_id", studentRow.class_id).eq("college_id", ctx.collegeId).order("name")
      : departmentId
        ? supabase.from("subjects").select("id,name").eq("department_id", departmentId).eq("college_id", ctx.collegeId).order("name")
        : null;

    const { data: subjectsRows, error: subjectsError } = subjectsQuery
      ? await subjectsQuery
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
        classId: studentRow?.class_id ?? null,
        className: classRow?.name ?? null,
        sectionId: studentRow?.section_id ?? null,
        sectionName: sectionRow?.name ?? null,
        rollNumber: studentRow?.roll_number ?? null,
        term: studentRow?.term ?? null,
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
