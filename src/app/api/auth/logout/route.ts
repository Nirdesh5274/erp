import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { apiError } from "@/lib/api";
import { hashToken, verifyRefreshToken } from "@/lib/auth";

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();
  const isProduction = process.env.NODE_ENV === "production";
  try {
    const cookieStore = await cookies();
    const refresh = cookieStore.get("refresh_token")?.value;
    if (refresh) {
      try {
        const payload = await verifyRefreshToken(refresh);
        await supabase
          .from("refresh_tokens")
          .update({ revoked: true })
          .eq("user_id", payload.sub)
          .eq("token_hash", await hashToken(refresh));

        await supabase.from("auth_logs").insert({
          user_id: payload.sub,
          action: "logout",
          ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
          user_agent: req.headers.get("user-agent") ?? "",
        });
      } catch {
        // ignore token verify errors on logout
      }
    }
    const res = NextResponse.json({ ok: true, data: true });
    res.cookies.set("access_token", "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 0 });
    res.cookies.set("refresh_token", "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 0 });
    return res;
  } catch (error) {
    return apiError("Logout failed", 500, String(error));
  }
}
