import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type InstitutionType = "college" | "school";

export interface RequestContext {
  role: string;
  collegeId: string | null;
  userId: string | null;
  departmentId: string | null;
  institutionTypeHeader: string | null;
}

export interface InstitutionContext extends RequestContext {
  institutionId: string;
  institutionType: InstitutionType;
}

const INSTITUTION_TYPE_TTL_MS = 5 * 60 * 1000;
const institutionTypeCache = new Map<string, { type: InstitutionType; expiresAt: number }>();

async function resolveInstitutionType(institutionId: string): Promise<InstitutionType> {
  const now = Date.now();
  const cached = institutionTypeCache.get(institutionId);
  if (cached && cached.expiresAt > now) return cached.type;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("colleges")
    .select("type")
    .eq("id", institutionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const type: InstitutionType = data?.type === "school" ? "school" : "college";
  institutionTypeCache.set(institutionId, { type, expiresAt: now + INSTITUTION_TYPE_TTL_MS });
  return type;
}

export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  return {
    role: h.get("x-role") ?? "",
    collegeId: h.get("x-college-id"),
    userId: h.get("x-user-id"),
    departmentId: h.get("x-department-id"),
    institutionTypeHeader: h.get("x-institution-type"),
  };
}

export async function getInstitutionContext(ctx?: RequestContext): Promise<InstitutionContext> {
  const requestContext = ctx ?? await getRequestContext();
  if (!requestContext.collegeId) {
    throw new Error("Missing institution context");
  }

  const headerType = requestContext.institutionTypeHeader;
  const institutionType: InstitutionType = headerType === "school"
    ? "school"
    : headerType === "college"
      ? "college"
      : await resolveInstitutionType(requestContext.collegeId);

  return {
    ...requestContext,
    institutionId: requestContext.collegeId,
    institutionType,
  };
}

export function ensureRole(actualRole: string, allowed: string[]) {
  return allowed.includes(actualRole);
}
