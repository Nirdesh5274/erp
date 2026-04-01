import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiError } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildAuthCookies, hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/auth";
import type { AuthUser, Role } from "@/types/auth";

interface RefreshPayloadShape {
  collegeId?: string | null;
  departmentId?: string | null;
  name?: string;
  email?: string;
  role: Role;
  sub: string;
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "";

  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get("refresh_token")?.value;
    if (!refreshToken) return apiError("Missing refresh token", 401);

    let payload: RefreshPayloadShape;
    try {
      payload = await verifyRefreshToken(refreshToken);
    } catch (err) {
      return apiError("Invalid refresh token", 401, String(err));
    }

    const { data: tokenRow, error } = await supabase
      .from("refresh_tokens")
      .select("id, user_id, revoked, expires_at, user_agent, ip_address")
      .eq("user_id", payload.sub)
      .eq("token_hash", await hashToken(refreshToken))
      .eq("revoked", false)
      .maybeSingle();

    if (error || !tokenRow) return apiError("Refresh token not found", 401);
    if (new Date(tokenRow.expires_at) < new Date()) return apiError("Refresh token expired", 401);

    const userShape: AuthUser = {
      id: payload.sub,
      role: payload.role,
      collegeId: payload.collegeId ?? null,
      departmentId: payload.departmentId ?? null,
      name: payload.name ?? "",
      email: payload.email ?? "",
    };

    const newAccess = await signAccessToken(userShape);
    const newRefresh = await signRefreshToken(userShape);
    const cookiesBundle = buildAuthCookies(newAccess, newRefresh);

    // rotate: revoke old, insert new
    await supabase.from("refresh_tokens").update({ revoked: true, last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);
    await supabase.from("refresh_tokens").insert({
      user_id: userShape.id,
      token_hash: await hashToken(newRefresh),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ip_address: ip,
      user_agent: userAgent,
    });

    await supabase.from("auth_logs").insert({
      user_id: userShape.id,
      college_id: userShape.collegeId,
      action: "token_refresh",
      ip_address: ip,
      user_agent: userAgent,
      metadata: { previous_ip: tokenRow.ip_address, previous_user_agent: tokenRow.user_agent },
    });

    const res = NextResponse.json({ ok: true, data: { accessToken: true } }, { status: 200 });
    res.cookies.set("access_token", cookiesBundle.access_token.value, cookiesBundle.access_token.options);
    res.cookies.set("refresh_token", cookiesBundle.refresh_token.value, cookiesBundle.refresh_token.options);
    return res;
  } catch (error) {
    return apiError("Token refresh failed", 500, String(error));
  }
}
