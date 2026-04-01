import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildAuthCookies, hashToken, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from "@/lib/auth";
import type { AuthUser } from "@/types/auth";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
];

function isPublicPath(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function requiredRole(path: string): string | null {
  if (path.startsWith("/superadmin")) return "SuperAdmin";
  if (path.startsWith("/admin")) return "Admin";
  if (path.startsWith("/hod")) return "HOD";
  if (path.startsWith("/faculty")) return "Faculty";
  if (path.startsWith("/student")) return "Student";
  if (path.startsWith("/api/")) return null;
  return null;
}

function unauthorizedResponse(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ success: false, error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }
  const url = new URL("/login", req.url);
  url.searchParams.set("reason", "session_expired");
  return NextResponse.redirect(url);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const accessToken = req.cookies.get("access_token")?.value;
  const refreshToken = req.cookies.get("refresh_token")?.value;

  let payload: Awaited<ReturnType<typeof verifyAccessToken>> | null = null;
  let response: NextResponse | null = null;

  if (accessToken) {
    try {
      payload = await verifyAccessToken(accessToken);
    } catch {
      payload = null;
    }
  }

  if (!payload && refreshToken) {
    try {
      const refreshPayload = await verifyRefreshToken(refreshToken);
      const supabase = getSupabaseAdmin();
      const { data: tokenRow, error } = await supabase
        .from("refresh_tokens")
        .select("id, user_id, revoked, expires_at")
        .eq("user_id", refreshPayload.sub)
        .eq("token_hash", await hashToken(refreshToken))
        .eq("revoked", false)
        .maybeSingle();

      if (error || !tokenRow) {
        return unauthorizedResponse(req);
      }

      if (new Date(tokenRow.expires_at) < new Date()) {
        return unauthorizedResponse(req);
      }

      payload = refreshPayload;
      const userShape: AuthUser = {
        id: refreshPayload.sub,
        role: refreshPayload.role,
        collegeId: refreshPayload.collegeId ?? null,
        departmentId: refreshPayload.departmentId ?? null,
        name: refreshPayload.name ?? "",
        email: refreshPayload.email ?? "",
      };

      const newAccess = await signAccessToken(userShape);
      const newRefresh = await signRefreshToken(userShape);
      const newCookies = buildAuthCookies(newAccess, newRefresh);

      await supabase.from("refresh_tokens").update({ revoked: true }).eq("id", tokenRow.id);
      await supabase.from("refresh_tokens").insert({
        user_id: userShape.id,
        token_hash: await hashToken(newRefresh),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
        user_agent: req.headers.get("user-agent") ?? "",
      });

      await supabase.from("auth_logs").insert({
        user_id: userShape.id,
        college_id: userShape.collegeId,
        action: "token_refresh",
        ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
        user_agent: req.headers.get("user-agent") ?? "",
      });

      response = NextResponse.next();
      response.cookies.set("access_token", newCookies.access_token.value, newCookies.access_token.options);
      response.cookies.set("refresh_token", newCookies.refresh_token.value, newCookies.refresh_token.options);
    } catch {
      return unauthorizedResponse(req);
    }
  }

  if (!payload) {
    return unauthorizedResponse(req);
  }

  const neededRole = requiredRole(pathname);
  if (neededRole && payload.role !== neededRole) {
    return unauthorizedResponse(req);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-role", String(payload.role));
  requestHeaders.set("x-college-id", String(payload.collegeId ?? ""));
  requestHeaders.set("x-department-id", String(payload.departmentId ?? ""));
  requestHeaders.set("x-user-id", String(payload.sub));

  let res: NextResponse;
  if (response) {
    res = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((c) => {
      res.cookies.set(c);
    });
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }

  res.headers.set("x-role", String(payload.role));
  res.headers.set("x-college-id", String(payload.collegeId ?? ""));
  res.headers.set("x-department-id", String(payload.departmentId ?? ""));
  res.headers.set("x-user-id", String(payload.sub));

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};