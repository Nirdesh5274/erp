import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();
  const isProduction = process.env.NODE_ENV === "production";
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) return apiError("Unauthorized", 401);
    await supabase.from("refresh_tokens").update({ revoked: true }).eq("user_id", userId);
    await supabase.from("auth_logs").insert({
      user_id: userId,
      action: "logout_all",
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
      user_agent: req.headers.get("user-agent") ?? "",
    });
    const res = NextResponse.json({ ok: true, data: true });
    res.cookies.set("access_token", "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 0 });
    res.cookies.set("refresh_token", "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 0 });
    return res;
  } catch (error) {
    return apiError("Logout all failed", 500, String(error));
  }
}
