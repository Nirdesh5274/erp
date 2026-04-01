import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2),
  location: z.string().min(2),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(4),
});

export async function GET() {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("colleges").select("*").order("created_at", { ascending: false });
    if (error) return apiError(error.message, 500);
    return apiSuccess(data ?? []);
  } catch (error) {
    return apiError("Unable to load colleges", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const body = schema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    const { data: college, error: collegeError } = await supabase
      .from("colleges")
      .insert({ name: body.name, location: body.location })
      .select("*")
      .single();

    if (collegeError) return apiError(collegeError.message, 500);

    const { data: admin, error: adminError } = await supabase
      .from("users")
      .insert({
        college_id: college.id,
        name: body.adminName,
        email: body.adminEmail,
        password: body.adminPassword,
        role: "Admin",
      })
      .select("id, name, email, role, college_id")
      .single();

    if (adminError) return apiError(adminError.message, 500);

    return apiSuccess({ college, admin }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create college", 500, String(error));
  }
}
