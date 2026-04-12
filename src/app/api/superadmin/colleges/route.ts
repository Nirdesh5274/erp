import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const schema = z.object({
  name: z.string().min(2),
  location: z.string().min(2),
  type: z.enum(["college", "school"]).optional(),
  institutionCode: z.string().max(50).optional(),
  status: z.enum(["Active", "Pending", "Suspended"]).optional(),
  logoUrl: z.string().url().optional(),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(4),
});

function isMissingColumnError(message: string | undefined, columnName: string) {
  const text = String(message ?? "").toLowerCase();
  return text.includes(columnName.toLowerCase()) && (text.includes("column") || text.includes("schema cache") || text.includes("does not exist"));
}

function normalizeCollegeRow(row: Record<string, unknown>) {
  return {
    ...row,
    institution_code: (row.institution_code as string | null | undefined) ?? null,
    status: (row.status as string | null | undefined) ?? "Active",
    logo_url: (row.logo_url as string | null | undefined) ?? null,
  };
}

export async function GET() {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const supabase = getSupabaseAdmin();
    const preferred = await supabase
      .from("colleges")
      .select("id,name,location,type,institution_code,status,logo_url,created_at")
      .order("created_at", { ascending: false });

    if (preferred.error) {
      const basic = await supabase
        .from("colleges")
        .select("id,name,location,type,created_at")
        .order("created_at", { ascending: false });

      if (basic.error) return apiError(basic.error.message, 500);
      return apiSuccess((basic.data ?? []).map((row) => normalizeCollegeRow(row as Record<string, unknown>)));
    }

    return apiSuccess((preferred.data ?? []).map((row) => normalizeCollegeRow(row as Record<string, unknown>)));
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

    const createPayload = {
      name: body.name,
      location: body.location,
      type: body.type ?? "college",
      institution_code: body.institutionCode?.trim() || null,
      status: body.status ?? "Pending",
      logo_url: body.logoUrl ?? null,
    };

    let { data: college, error: collegeError } = await supabase
      .from("colleges")
      .insert(createPayload)
      .select("id,name,location,type,institution_code,status,logo_url,created_at")
      .single();

    if (collegeError && (isMissingColumnError(collegeError.message, "institution_code") || isMissingColumnError(collegeError.message, "status") || isMissingColumnError(collegeError.message, "logo_url"))) {
      const fallback = await supabase
        .from("colleges")
        .insert({ name: body.name, location: body.location, type: body.type ?? "college" })
        .select("id,name,location,type,created_at")
        .single();

      college = fallback.data as typeof college;
      collegeError = fallback.error;
    }

    if (collegeError) return apiError(collegeError.message, 500);
    if (!college) return apiError("College creation returned no data", 500);

    const adminPayload: Record<string, unknown> = {
      college_id: college.id,
      name: body.adminName,
      email: body.adminEmail,
      password: body.adminPassword,
      role: "Admin",
      created_by: (await getRequestContext()).userId,
    };

    const { data: admin, error: adminError } = await supabase
      .from("users")
      .insert(adminPayload)
      .select("id, name, email, role, college_id")
      .single();

    if (adminError && isMissingColumnError(adminError.message, "created_by")) {
      const fallbackAdmin = await supabase
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

      if (fallbackAdmin.error) return apiError(fallbackAdmin.error.message, 500);
      return apiSuccess({ college: normalizeCollegeRow(college as unknown as Record<string, unknown>), admin: fallbackAdmin.data }, 201);
    }

    if (adminError) return apiError(adminError.message, 500);

    return apiSuccess({ college: normalizeCollegeRow(college as unknown as Record<string, unknown>), admin }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create college", 500, String(error));
  }
}
