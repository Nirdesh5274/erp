import { headers } from "next/headers";

export interface RequestContext {
  role: string;
  collegeId: string | null;
  userId: string | null;
  departmentId: string | null;
}

export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  return {
    role: h.get("x-role") ?? "",
    collegeId: h.get("x-college-id"),
    userId: h.get("x-user-id"),
    departmentId: h.get("x-department-id"),
  };
}

export function ensureRole(actualRole: string, allowed: string[]) {
  return allowed.includes(actualRole);
}
