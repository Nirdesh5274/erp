import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getInstitutionContext, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(1).max(150),
  classId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  code: z.string().max(20).optional().nullable(),
  type: z.enum(["theory", "practical"]).default("theory"),
  periodsPerWeek: z.number().int().min(1).max(30).default(5),
});

async function ensureSchoolDepartmentId(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  collegeId: string;
}) {
  const { supabase, collegeId } = params;
  const defaultName = "School Core";

  const { data: existing, error: existingError } = await supabase
    .from("departments")
    .select("id")
    .eq("college_id", collegeId)
    .ilike("name", defaultName)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createError } = await supabase
    .from("departments")
    .insert({ college_id: collegeId, name: defaultName })
    .select("id")
    .single();

  if (createError) throw new Error(createError.message);
  return created.id as string;
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    const { institutionId, collegeId } = await getInstitutionContext(ctx);

    const { searchParams } = new URL(request.url);
    const classId = searchParams.get("classId");
    const departmentId = searchParams.get("departmentId");

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("subjects")
      .select("id,name,department_id,college_id,institution_id,class_id,code,type,periods_per_week,created_at")
      .eq("college_id", collegeId)
      .eq("institution_id", institutionId)
      .order("name", { ascending: true });

    if (classId) query = query.eq("class_id", classId);
    if (departmentId) query = query.eq("department_id", departmentId);
    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    return apiSuccess(
      (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        departmentId: row.department_id,
        collegeId: row.college_id,
        institutionId: row.institution_id,
        classId: row.class_id,
        code: row.code,
        type: row.type,
        periodsPerWeek: row.periods_per_week,
        createdAt: row.created_at,
      })),
    );
  } catch (error) {
    return apiError("Unable to load subjects", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    const { institutionId, institutionType, collegeId } = await getInstitutionContext(ctx);

    const body = schema.parse(await request.json());
    const normalizedName = body.name.trim();
    if (!normalizedName) return apiError("Subject name is required", 400);

    if (institutionType === "school" && !body.classId) {
      return apiError("classId is required for school subjects", 400);
    }

    if (institutionType === "college" && !body.departmentId) {
      return apiError("departmentId is required for college subjects", 400);
    }

    const supabase = getSupabaseAdmin();
    let insertPayload = {
      name: normalizedName,
      college_id: collegeId,
      institution_id: institutionId,
      department_id: body.departmentId ?? null,
      class_id: body.classId ?? null,
      code: body.code?.trim() || null,
      type: body.type,
      periods_per_week: body.periodsPerWeek,
    };

    let { data, error } = await supabase
      .from("subjects")
      .insert(insertPayload)
      .select("id,name,department_id,college_id,institution_id,class_id,code,type,periods_per_week,created_at")
      .single();

    if (
      error
      && institutionType === "school"
      && error.message.toLowerCase().includes("department_id")
      && error.message.toLowerCase().includes("null value")
    ) {
      const fallbackDepartmentId = await ensureSchoolDepartmentId({ supabase, collegeId: institutionId });
      insertPayload = { ...insertPayload, department_id: fallbackDepartmentId };

      const retry = await supabase
        .from("subjects")
        .insert(insertPayload)
        .select("id,name,department_id,college_id,institution_id,class_id,code,type,periods_per_week,created_at")
        .single();

      data = retry.data;
      error = retry.error;
    }

    if (error) return apiError(error.message, 500);
  if (!data) return apiError("Unable to create subject", 500);

    return apiSuccess(
      {
        id: data.id,
        name: data.name,
        departmentId: data.department_id,
        collegeId: data.college_id,
        institutionId: data.institution_id,
        classId: data.class_id,
        code: data.code,
        type: data.type,
        periodsPerWeek: data.periods_per_week,
        createdAt: data.created_at,
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create subject", 500, String(error));
  }
}
