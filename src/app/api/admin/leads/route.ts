import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const leadStatus = ["new", "contacted", "follow_up", "converted", "refused"] as const;

type LeadStatus = (typeof leadStatus)[number];

const querySchema = z.object({
  status: z.enum(["all", ...leadStatus]).default("all"),
  academicYear: z.string().max(20).optional(),
  class: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(120).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(15),
  email: z.string().email().optional().or(z.literal("")),
  parentName: z.string().trim().max(100).optional().or(z.literal("")),
  parentPhone: z.string().trim().max(15).optional().or(z.literal("")),
  interestedClass: z.string().trim().max(50).optional().or(z.literal("")),
  interestedSection: z.string().trim().max(10).optional().or(z.literal("")),
  academicYear: z.string().trim().max(20).optional().or(z.literal("")),
  source: z.enum(["walk_in", "phone", "online", "referral", "other"]).optional(),
  notes: z.string().max(1500).optional().or(z.literal("")),
  assignedTo: z.string().uuid().optional(),
});

function normalizeEmpty(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function applySharedFilters(
  query: any,
  filters: { academicYear?: string; interestedClass?: string; search?: string },
) {
  let current = query;

  if (filters.academicYear) {
    current = current.eq("academic_year", filters.academicYear);
  }

  if (filters.interestedClass) {
    current = current.eq("interested_class", filters.interestedClass);
  }

  if (filters.search) {
    const escaped = filters.search.replace(/[%_]/g, "").trim();
    if (escaped) {
      current = current.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }
  }

  return current;
}

async function isSchoolInstitution(collegeId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("colleges")
    .select("type")
    .eq("id", collegeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.type === "school";
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(ctx.collegeId))) return apiError("Leads pipeline is available only for school mode", 400);

    const url = new URL(request.url);
    const parsed = querySchema.parse({
      status: url.searchParams.get("status") ?? "all",
      academicYear: url.searchParams.get("academic_year") ?? undefined,
      class: url.searchParams.get("class") ?? undefined,
      page: url.searchParams.get("page") ?? 1,
      limit: url.searchParams.get("limit") ?? 20,
      search: url.searchParams.get("search") ?? undefined,
    });

    const supabase = getSupabaseAdmin();
    const offset = (parsed.page - 1) * parsed.limit;
    const filters = {
      academicYear: parsed.academicYear,
      interestedClass: parsed.class,
      search: parsed.search,
    };

    let listQuery = supabase
      .from("leads")
      .select("id,name,phone,email,parent_name,parent_phone,interested_class,interested_section,academic_year,status,refused_reason,follow_up_date,notes,assigned_to,converted_student_id,converted_at,source,created_at,updated_at", { count: "exact" })
      .eq("institution_id", ctx.collegeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    listQuery = applySharedFilters(listQuery, filters);

    if (parsed.status !== "all") {
      listQuery = listQuery.eq("status", parsed.status);
    }

    const { data: leads, error: listError, count: total } = await listQuery.range(offset, offset + parsed.limit - 1);

    if (listError) return apiError(listError.message, 500);

    const countByStatus = async (status: LeadStatus) => {
      let q = supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("institution_id", ctx.collegeId)
        .is("deleted_at", null)
        .eq("status", status);

      q = applySharedFilters(q, filters);
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      return Number(count ?? 0);
    };

    const [newCount, contactedCount, followUpCount, convertedCount, refusedCount] = await Promise.all([
      countByStatus("new"),
      countByStatus("contacted"),
      countByStatus("follow_up"),
      countByStatus("converted"),
      countByStatus("refused"),
    ]);

    return apiSuccess({
      leads: leads ?? [],
      counts: {
        new: newCount,
        contacted: contactedCount,
        follow_up: followUpCount,
        converted: convertedCount,
        refused: refusedCount,
        total: Number(total ?? 0),
      },
      page: parsed.page,
      limit: parsed.limit,
      totalPages: Math.max(Math.ceil(Number(total ?? 0) / parsed.limit), 1),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid query", 400, error.flatten());
    return apiError("Unable to load leads", 500, String(error));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin", "HOD", "Faculty"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing institution context", 400);
    if (!(await isSchoolInstitution(ctx.collegeId))) return apiError("Leads pipeline is available only for school mode", 400);

    const body = createSchema.parse(await request.json());
    const normalizedPhone = body.phone.replace(/\s+/g, "").trim();

    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from("leads")
      .select("id,name,status")
      .eq("institution_id", ctx.collegeId)
      .eq("phone", normalizedPhone)
      .is("deleted_at", null)
      .not("status", "in", "(refused,converted)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) return apiError(existingError.message, 500);

    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: { code: "CONFLICT", message: "DUPLICATE_LEAD" },
          existing: {
            id: existing.id,
            name: existing.name,
            status: existing.status,
          },
        },
        { status: 409 },
      );
    }

    const insertPayload = {
      institution_id: ctx.collegeId,
      name: body.name.trim(),
      phone: normalizedPhone,
      email: normalizeEmpty(body.email),
      parent_name: normalizeEmpty(body.parentName),
      parent_phone: normalizeEmpty(body.parentPhone),
      interested_class: normalizeEmpty(body.interestedClass),
      interested_section: normalizeEmpty(body.interestedSection),
      academic_year: normalizeEmpty(body.academicYear),
      status: "new",
      notes: normalizeEmpty(body.notes),
      assigned_to: body.assignedTo ?? null,
      source: body.source ?? null,
    };

    const { data, error } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select("id,name,phone,email,parent_name,parent_phone,interested_class,interested_section,academic_year,status,refused_reason,follow_up_date,notes,assigned_to,converted_student_id,converted_at,source,created_at,updated_at")
      .single();

    if (error) return apiError(error.message, 400);
    return apiSuccess(data, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Unable to create lead", 500, String(error));
  }
}
