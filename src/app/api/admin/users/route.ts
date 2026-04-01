import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(4),
  role: z.enum(["HOD", "Faculty"]),
  departmentId: z.string().uuid().nullable().optional(),
});

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
      .select("id,name,email,role,department_id,college_id,created_at")
      .eq("college_id", ctx.collegeId)
      .order("created_at", { ascending: false });

    if (roleFilter && ["HOD", "Faculty", "Student"].includes(roleFilter)) {
      query = query.eq("role", roleFilter);
    }

    const { data, error } = await query;
    if (error) return apiError(error.message, 500);

    return apiSuccess(data ?? []);
  } catch (error) {
    return apiError("Unable to load users", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const body = schema.parse(await request.json());

    // Creator hierarchy:
    // Admin -> HOD, Faculty
    // HOD   -> Faculty (same department only)
    if (ctx.role === "HOD" && body.role !== "Faculty") {
      return apiError("HOD can only create Faculty", 403);
    }

    if (ctx.role === "HOD") {
      const hodDepartmentId = ctx.departmentId || null;
      if (!hodDepartmentId) return apiError("HOD department context missing", 400);
      if (body.departmentId !== hodDepartmentId) {
        return apiError("HOD can only create Faculty in own department", 403);
      }
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
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

    if (error) return apiError(error.message, 500);
    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create user", 500, String(error));
  }
}
