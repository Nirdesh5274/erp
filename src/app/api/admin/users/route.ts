import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(4),
  role: z.enum(["HOD", "Faculty"]),
  departmentId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
});

function isMissingColumnError(message: string | undefined, columnName: string) {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes(columnName.toLowerCase())
    && (normalized.includes("does not exist") || normalized.includes("column"));
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get("role");

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("users")
      .select("id,name,email,role,department_id,class_id,college_id,created_at")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if (roleFilter && ["HOD", "Faculty", "Student"].includes(roleFilter)) {
      query = query.eq("role", roleFilter);
    }

    let { data, error } = await query;
    if (error && isMissingColumnError(error.message, "class_id")) {
      let fallbackQuery = supabase
        .from("users")
        .select("id,name,email,role,department_id,college_id,created_at")
        .eq("college_id", ctx.collegeId)
        .order("created_at", { ascending: false });

      if (roleFilter && ["HOD", "Faculty", "Student"].includes(roleFilter)) {
        fallbackQuery = fallbackQuery.eq("role", roleFilter);
      }

      const fallback = await fallbackQuery;
      data = (fallback.data ?? []).map((row) => ({ ...row, class_id: null }));
      error = fallback.error;
    }

    if (error) return apiError(error.message, 500);

    const rows = data ?? [];
    const classIds = Array.from(
      new Set(rows.map((row) => row.class_id as string | null).filter(Boolean) as string[]),
    );
    const facultyIds = rows.filter((row) => row.role === "Faculty").map((row) => row.id as string);

    const [{ data: classRows, error: classError }, { data: facultyLinks, error: facultyLinksError }] = await Promise.all([
      classIds.length
        ? supabase
          .from("classes")
          .select("id,name")
          .in("id", classIds)
          .eq("institution_id", ctx.collegeId)
        : Promise.resolve({ data: [], error: null }),
      facultyIds.length
        ? supabase
          .from("faculty_subjects")
          .select("faculty_id,subject_id")
          .in("faculty_id", facultyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (classError) return apiError(classError.message, 500);
    if (facultyLinksError) return apiError(facultyLinksError.message, 500);

    const subjectIds = Array.from(
      new Set((facultyLinks ?? []).map((link) => link.subject_id as string | null).filter(Boolean) as string[]),
    );

    const { data: subjectRows, error: subjectError } = subjectIds.length
      ? await supabase
        .from("subjects")
        .select("id,name,class_id")
        .in("id", subjectIds)
      : { data: [], error: null };
    if (subjectError) return apiError(subjectError.message, 500);

    const subjectClassIds = Array.from(
      new Set((subjectRows ?? []).map((row) => row.class_id as string | null).filter(Boolean) as string[]),
    );
    const { data: subjectClassRows, error: subjectClassError } = subjectClassIds.length
      ? await supabase
        .from("classes")
        .select("id,name")
        .in("id", subjectClassIds)
        .eq("institution_id", ctx.collegeId)
      : { data: [], error: null };
    if (subjectClassError) return apiError(subjectClassError.message, 500);

    const classById = new Map<string, string>();
    for (const row of classRows ?? []) {
      classById.set(row.id as string, row.name as string);
    }

    const subjectNameById = new Map<string, string>();
    const subjectClassById = new Map<string, string>();
    for (const row of subjectRows ?? []) {
      subjectNameById.set(row.id as string, row.name as string);
      if (row.class_id) {
        subjectClassById.set(row.id as string, row.class_id as string);
      }
    }

    for (const row of subjectClassRows ?? []) {
      classById.set(row.id as string, row.name as string);
    }

    const subjectNamesByFaculty = new Map<string, string[]>();
    const subjectClassNameByFaculty = new Map<string, string>();
    for (const link of facultyLinks ?? []) {
      const facultyId = link.faculty_id as string | null;
      const subjectId = link.subject_id as string | null;
      if (!facultyId || !subjectId) continue;
      const subjectName = subjectNameById.get(subjectId);
      if (!subjectName) continue;

      const current = subjectNamesByFaculty.get(facultyId) ?? [];
      if (!current.includes(subjectName)) {
        current.push(subjectName);
        subjectNamesByFaculty.set(facultyId, current);
      }

      if (!subjectClassNameByFaculty.has(facultyId)) {
        const classId = subjectClassById.get(subjectId);
        const className = classId ? classById.get(classId) ?? "" : "";
        if (className) subjectClassNameByFaculty.set(facultyId, className);
      }
    }

    return apiSuccess(rows.map((row) => ({
      ...row,
      className: row.class_id
        ? classById.get(row.class_id as string) ?? null
        : (row.role === "Faculty" ? subjectClassNameByFaculty.get(row.id as string) ?? null : null),
      subjectNames: subjectNamesByFaculty.get(row.id as string) ?? [],
    })));
  } catch (error) {
    return apiError("Unable to load users", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);
    const { institutionType } = await getInstitutionContext(ctx);

    const body = schema.parse(await request.json());

    // Creator hierarchy:
    // Admin -> HOD, Faculty
    // HOD   -> Faculty (same department only)
    if (ctx.role === "HOD" && body.role !== "Faculty") {
      return apiError("HOD can only create Faculty", 403);
    }

    if (ctx.role === "HOD") {
      if (institutionType === "school") {
        if (!ctx.userId) return apiError("HOD user context missing", 400);

        const supabase = getSupabaseAdmin();
        const { data: hodRow, error: hodError } = await supabase
          .from("users")
          .select("class_id")
          .eq("id", ctx.userId)
          .eq("college_id", ctx.collegeId)
          .maybeSingle();

        if (hodError && isMissingColumnError(hodError.message, "class_id")) {
          // Backward compatibility path for databases where users.class_id is not yet migrated.
          // We cannot enforce class ownership at DB level in this mode.
        } else if (hodError) {
          return apiError(hodError.message, 500);
        }

        if (!hodError) {
          const hodClassId = hodRow?.class_id ?? null;
          if (!hodClassId) return apiError("HOD class context missing", 400);
          if (body.classId !== hodClassId) {
            return apiError("HOD can only create Faculty in own class", 403);
          }
        }
      } else {
        const hodDepartmentId = ctx.departmentId || null;
        if (!hodDepartmentId) return apiError("HOD department context missing", 400);
        if (body.departmentId !== hodDepartmentId) {
          return apiError("HOD can only create Faculty in own department", 403);
        }
      }
    }

    if (institutionType === "school") {
      if (!body.classId) return apiError("classId is required for school users", 400);
      if (body.role === "Faculty" && !body.subjectId) {
        return apiError("subjectId is required for school faculty", 400);
      }
    }

    if (institutionType === "college" && !body.departmentId) {
      return apiError("departmentId is required for college users", 400);
    }

    const supabase = getSupabaseAdmin();

    const insertPayload = {
      college_id: ctx.collegeId,
      department_id: institutionType === "college" ? body.departmentId ?? null : null,
      class_id: institutionType === "school" ? body.classId ?? null : null,
      name: body.name,
      email: body.email,
      password: body.password,
      role: body.role,
    };

    let { data, error } = await supabase
      .from("users")
      .insert(insertPayload)
      .select("id,name,email,role,department_id,class_id,college_id")
      .single();

    if (error && isMissingColumnError(error.message, "class_id") && institutionType === "school") {
      const fallback = await supabase
        .from("users")
        .insert({
          college_id: ctx.collegeId,
          department_id: null,
          name: body.name,
          email: body.email,
          password: body.password,
          role: body.role,
        })
        .select("id,name,email,role,department_id,college_id")
        .single();

      data = fallback.data ? { ...fallback.data, class_id: null } : null;
      error = fallback.error;
    }

    if (error && isMissingColumnError(error.message, "class_id") && institutionType === "college") {
      const fallback = await supabase
        .from("users")
        .insert({
          college_id: ctx.collegeId,
          department_id: body.departmentId ?? null,
          name: body.name,
          email: body.email,
          password: body.password,
          role: body.role,
        })
        .select("id,name,email,role,department_id,college_id")
        .single();
      data = fallback.data ? { ...fallback.data, class_id: null } : null;
      error = fallback.error;
    }

    if (error) return apiError(error.message, 500);

    if (institutionType === "school" && body.role === "Faculty" && body.subjectId && data?.id) {
      const { error: assignError } = await supabase
        .from("faculty_subjects")
        .insert({
          faculty_id: data.id,
          subject_id: body.subjectId,
        });

      if (assignError && !assignError.message.toLowerCase().includes("duplicate key")) {
        await supabase.from("users").delete().eq("id", data.id).eq("college_id", ctx.collegeId);
        return apiError(assignError.message, 500);
      }
    }

    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create user", 500, String(error));
  }
}
