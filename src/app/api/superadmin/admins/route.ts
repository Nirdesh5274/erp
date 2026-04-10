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
  last_login_at?: string | null;
  is_blocked?: boolean;
  colleges: { name: string } | Array<{ name: string }> | null;
}

const createAdminSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(4),
  collegeId: z.string().uuid(),
});

const patchAdminSchema = z.object({
  adminId: z.string().uuid(),
  action: z.enum(["block", "unblock", "resetPassword"]),
  password: z.string().min(4).optional(),
});

function isMissingColumnError(message: string | undefined, columnName: string) {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes(columnName.toLowerCase())
    && (normalized.includes("column") || normalized.includes("schema cache") || normalized.includes("does not exist"));
}

export async function GET() {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const supabase = getSupabaseAdmin();
    let { data, error } = await supabase
      .from("users")
      .select("id,name,email,role,college_id,last_login_at,is_blocked,colleges(name)")
      .eq("role", "Admin")
      .order("created_at", { ascending: false });

    if (error && (isMissingColumnError(error.message, "last_login_at") || isMissingColumnError(error.message, "is_blocked"))) {
      const fallback = await supabase
        .from("users")
        .select("id,name,email,role,college_id,colleges(name)")
        .eq("role", "Admin")
        .order("created_at", { ascending: false });

      data = (fallback.data ?? []).map((row) => ({ ...row, last_login_at: null, is_blocked: false }));
      error = fallback.error;
    }

    if (error) return apiError(error.message, 500);

    const adminIds = ((data ?? []) as AdminRow[]).map((row) => row.id);

    let usersCreatedByAdmin = new Map<string, number>();
    let hodCreatedByAdmin = new Map<string, number>();

    if (adminIds.length > 0) {
      const creatorsQuery = await supabase
        .from("users")
        .select("id,created_by,role")
        .in("created_by", adminIds);

      if (!creatorsQuery.error) {
        const rows = creatorsQuery.data ?? [];
        for (const row of rows) {
          const creatorId = row.created_by as string | null;
          if (!creatorId) continue;
          usersCreatedByAdmin.set(creatorId, (usersCreatedByAdmin.get(creatorId) ?? 0) + 1);
          if (row.role === "HOD") {
            hodCreatedByAdmin.set(creatorId, (hodCreatedByAdmin.get(creatorId) ?? 0) + 1);
          }
        }
      }
    }

    const admins = ((data ?? []) as AdminRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      collegeId: row.college_id,
      collegeName: Array.isArray(row.colleges) ? row.colleges[0]?.name ?? "-" : row.colleges?.name ?? "-",
      lastLoginAt: row.last_login_at ?? null,
      isBlocked: Boolean(row.is_blocked ?? false),
      usersCreated: usersCreatedByAdmin.get(row.id) ?? 0,
      hodCreated: hodCreatedByAdmin.get(row.id) ?? 0,
      estimatedMonthlyCharge: ((usersCreatedByAdmin.get(row.id) ?? 0) * 20) + ((hodCreatedByAdmin.get(row.id) ?? 0) * 100),
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
    const requestContext = await getRequestContext();

    let { data, error } = await supabase
      .from("users")
      .insert({
        name: body.name,
        email: body.email,
        password: body.password,
        role: "Admin",
        college_id: body.collegeId,
        department_id: null,
        created_by: requestContext.userId,
      })
      .select("id,name,email,role,college_id")
      .single();

    if (error && isMissingColumnError(error.message, "created_by")) {
      const fallback = await supabase
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

      data = fallback.data;
      error = fallback.error;
    }

    if (error) return apiError(error.message, 500);
    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create admin", 500, String(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const { role } = await getRequestContext();
    if (!ensureRole(role, ["SuperAdmin"])) return apiError("Forbidden", 403);

    const body = patchAdminSchema.parse(await request.json());
    const supabase = getSupabaseAdmin();

    if (body.action === "resetPassword") {
      const nextPassword = body.password ?? `Adm@${Math.random().toString(36).slice(-6)}`;
      const { error } = await supabase
        .from("users")
        .update({ password: nextPassword })
        .eq("id", body.adminId)
        .eq("role", "Admin");

      if (error) return apiError(error.message, 500);
      return apiSuccess({ adminId: body.adminId, password: nextPassword });
    }

    const blockState = body.action === "block";
    let { error } = await supabase
      .from("users")
      .update({ is_blocked: blockState })
      .eq("id", body.adminId)
      .eq("role", "Admin");

    if (error && isMissingColumnError(error.message, "is_blocked")) {
      return apiError("Admin block/unblock requires users.is_blocked column migration", 400);
    }

    if (error) return apiError(error.message, 500);
    return apiSuccess({ adminId: body.adminId, isBlocked: blockState });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to update admin", 500, String(error));
  }
}
