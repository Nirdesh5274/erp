import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { apiError } from "@/lib/api";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

function isHashedPassword(value: string) {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin();
  const isProduction = process.env.NODE_ENV === "production";
  try {
    const body = schema.parse(await req.json());
    const headers = req.headers;
    const userId = headers.get("x-user-id");
    const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const userAgent = headers.get("user-agent") ?? "";

    if (!userId) return apiError("Unauthorized", 401);

    const { data: user, error } = await supabase
      .from("users")
      .select("id, password")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) return apiError("Unauthorized", 401);

    const matches = isHashedPassword(user.password)
      ? await bcrypt.compare(body.currentPassword, user.password)
      : user.password === body.currentPassword;

    if (!matches) return apiError("Invalid current password", 400);

    const hashed = await bcrypt.hash(body.newPassword, 12);
    await supabase.from("users").update({ password: hashed, password_changed_at: new Date().toISOString(), failed_login_attempts: 0 }).eq("id", user.id);
    const { error: studentPasswordStateError } = await supabase
      .from("students")
      .update({
        temp_password: null,
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (studentPasswordStateError) {
      if (!studentPasswordStateError.message.toLowerCase().includes("password_changed_at")) {
        return apiError(studentPasswordStateError.message, 500);
      }

      const { error: fallbackStudentError } = await supabase
        .from("students")
        .update({
          temp_password: null,
          must_change_password: false,
        })
        .eq("user_id", user.id);
      if (fallbackStudentError) return apiError(fallbackStudentError.message, 500);
    }

    await supabase.from("refresh_tokens").update({ revoked: true }).eq("user_id", user.id);
    await supabase.from("auth_logs").insert({ user_id: user.id, action: "password_changed", ip_address: ip, user_agent: userAgent });

    const res = NextResponse.json({ ok: true, data: true });
    res.cookies.set("access_token", "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 0 });
    res.cookies.set("refresh_token", "", { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 0 });
    return res;
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Change password failed", 500, String(error));
  }
}
