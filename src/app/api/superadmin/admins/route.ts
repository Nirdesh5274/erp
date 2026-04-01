import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: string;
  college_id: string | null;
  colleges: { name: string } | Array<{ name: string }> | null;
}

const createAdminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(4),
  collegeId: z.string().uuid(),
});

export async function GET() {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("users")
      .select("id,name,email,role,college_id,colleges(name)")
      .eq("role", "Admin")
      .order("created_at", { ascending: false });

    if (error) return apiError(error.message, 500);

    const admins = ((data ?? []) as AdminRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      collegeId: row.college_id,
      collegeName: Array.isArray(row.colleges) ? row.colleges[0]?.name ?? "-" : row.colleges?.name ?? "-",
    }));

    return apiSuccess(admins);
  } catch (error) {
    return apiError("Unable to load admins", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const body = createAdminSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("users")
      .insert({
        name: body.name,
        email: body.email,
        password: body.password,
        role: "Admin",
        college_id: body.collegeId,
        department_id: null,
      })
      .select("id,name,email,role,college_id")
      .single();

    if (error) return apiError(error.message, 500);
    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create admin", 500, String(error));
  }
}
