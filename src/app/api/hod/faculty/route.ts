import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(4),
  departmentId: z.string().uuid(),
  subjectName: z.string().min(2),
});

export async function GET() {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("users")
      .select("id,name,email,department_id,created_at")
      .eq("college_id", ctx.collegeId)
      .eq("role", "Faculty")
      .order("created_at", { ascending: false });

    if (ctx.role === "HOD" && ctx.userId) {
      const { data: hodUser } = await supabase
        .from("users")
        .select("department_id")
        .eq("id", ctx.userId)
        .single();

      if (hodUser?.department_id) {
        query = query.eq("department_id", hodUser.department_id);
      }
    }

    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    const faculties = data ?? [];
    const facultyIds = faculties.map((faculty) => faculty.id as string);

    let subjectsByFaculty = new Map<string, string[]>();

    if (facultyIds.length > 0) {
      const { data: links, error: linksError } = await supabase
        .from("faculty_subjects")
        .select("faculty_id,subject_id")
        .in("faculty_id", facultyIds);

      if (linksError) return apiError(linksError.message, 500);

      const subjectIds = Array.from(
        new Set((links ?? []).map((link) => link.subject_id as string).filter(Boolean)),
      );

      const subjectNameById = new Map<string, string>();
      if (subjectIds.length > 0) {
        const { data: subjects, error: subjectsError } = await supabase
          .from("subjects")
          .select("id,name")
          .in("id", subjectIds);

        if (subjectsError) return apiError(subjectsError.message, 500);
        for (const subject of subjects ?? []) {
          subjectNameById.set(subject.id as string, subject.name as string);
        }
      }

      const map = new Map<string, Set<string>>();
      for (const link of links ?? []) {
        const facultyId = link.faculty_id as string;
        const subjectId = link.subject_id as string;
        const subjectName = subjectNameById.get(subjectId);
        if (!facultyId || !subjectName) continue;

        const existing = map.get(facultyId) ?? new Set<string>();
        existing.add(subjectName);
        map.set(facultyId, existing);
      }

      subjectsByFaculty = new Map(
        Array.from(map.entries()).map(([facultyId, names]) => [facultyId, Array.from(names)]),
      );
    }

    return apiSuccess(
      faculties.map((faculty) => ({
        ...faculty,
        subject_names: subjectsByFaculty.get(faculty.id as string) ?? [],
      })),
    );
  } catch (error) {
    return apiError("Unable to load faculty", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["HOD", "Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (ctx.role === "HOD") {
      const hodDepartmentId = ctx.departmentId || null;
      if (!hodDepartmentId) return apiError("HOD department context missing", 400);
      if (body.departmentId !== hodDepartmentId) {
        return apiError("HOD can only create Faculty in own department", 403);
      }
    }

    const { data: faculty, error: facultyError } = await supabase
      .from("users")
      .insert({
        college_id: ctx.collegeId,
        department_id: body.departmentId,
        name: body.name,
        email: body.email,
        password: body.password,
        role: "Faculty",
      })
      .select("id,name,email,department_id")
      .single();

    if (facultyError) return apiError(facultyError.message, 500);

    const { data: existingSubject, error: subjectLookupError } = await supabase
      .from("subjects")
      .select("id")
      .eq("college_id", ctx.collegeId)
      .eq("department_id", body.departmentId)
      .eq("name", body.subjectName)
      .maybeSingle();

    if (subjectLookupError) return apiError(subjectLookupError.message, 500);

    let subjectId = existingSubject?.id;
    if (!subjectId) {
      const { data: subject, error: subjectCreateError } = await supabase
        .from("subjects")
        .insert({
          college_id: ctx.collegeId,
          department_id: body.departmentId,
          name: body.subjectName,
        })
        .select("id")
        .single();

      if (subjectCreateError) return apiError(subjectCreateError.message, 500);
      subjectId = subject.id;
    }

    if (!subjectId) return apiError("Unable to create subject", 500);

    const { error: assignError } = await supabase
      .from("faculty_subjects")
      .insert({ faculty_id: faculty.id, subject_id: subjectId });

    if (assignError && !assignError.message.includes("duplicate key")) {
      return apiError(assignError.message, 500);
    }

    return apiSuccess({ ...faculty, subjectId }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create faculty", 500, String(error));
  }
}
