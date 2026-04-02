import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { apiError } from "@/lib/api";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildAuthCookies, hashToken, signAccessToken, signRefreshToken } from "@/lib/auth";
import type { AuthUser } from "@/types/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 30;
const RATE_WINDOW_MINUTES = 15;
const DEFAULT_STUDENT_PASSWORD = "stud123";

function isHashedPassword(value: string) {
  return value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$");
}

function getClientInfo(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "";
  return { ip, userAgent };
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();

  try {
    const body = schema.parse(await request.json());
    const { ip, userAgent } = getClientInfo(request);

    // Rate limit by IP on failed attempts in last 15 minutes
    const { count: recentFailures } = await supabase
      .from("auth_logs")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("action", "login_failed")
      .gte("created_at", new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString());

    if ((recentFailures ?? 0) >= MAX_ATTEMPTS) {
      return apiError("Too many attempts. Try again later.", 429);
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, college_id, department_id, password, failed_login_attempts, is_locked, lock_expires_at")
      .eq("email", body.email)
      .maybeSingle();

    if (error) return apiError("Login failed", 500, error.message);
    if (!user) {
      await supabase.from("auth_logs").insert({ action: "login_failed", ip_address: ip, user_agent: userAgent, metadata: { reason: "user_not_found", email: body.email } });
      return apiError("Invalid credentials", 401);
    }

    if (user.is_locked && user.lock_expires_at && new Date(user.lock_expires_at) > new Date()) {
      return apiError("Account locked. Try later.", 423);
    }

    let passwordMatches = isHashedPassword(user.password)
      ? await bcrypt.compare(body.password, user.password)
      : user.password === body.password;

    // Legacy/dev healing: allow Student default password and normalize stored password.
    // This helps when old student rows were created with inconsistent passwords.
    if (!passwordMatches && user.role === "Student" && body.password === DEFAULT_STUDENT_PASSWORD) {
      passwordMatches = true;
      const healedHash = await bcrypt.hash(DEFAULT_STUDENT_PASSWORD, 12);
      await supabase.from("users").update({ password: healedHash }).eq("id", user.id);
    }

    if (!passwordMatches) {
      const failedCount = (user.failed_login_attempts ?? 0) + 1;
      const shouldLock = failedCount >= MAX_ATTEMPTS;
      const lockUntil = shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null;
      await supabase.from("users").update({
        failed_login_attempts: failedCount,
        is_locked: shouldLock,
        lock_expires_at: lockUntil,
      }).eq("id", user.id);
      await supabase.from("auth_logs").insert({
        user_id: user.id,
        college_id: user.college_id,
        action: "login_failed",
        ip_address: ip,
        user_agent: userAgent,
        metadata: { failedCount, lockUntil },
      });
      if (shouldLock) {
        await supabase.from("auth_logs").insert({
          user_id: user.id,
          college_id: user.college_id,
          action: "account_locked",
          ip_address: ip,
          user_agent: userAgent,
          metadata: { reason: "too_many_attempts", lockUntil },
        });
      }
      return apiError("Invalid credentials", 401);
    }

    // Successful login: reset counters
    await supabase.from("users").update({ failed_login_attempts: 0, is_locked: false, lock_expires_at: null, last_login_at: new Date().toISOString() }).eq("id", user.id);

    let institutionType: "college" | "school" = "college";
    if (user.college_id) {
      const { data: college, error: collegeError } = await supabase
        .from("colleges")
        .select("type")
        .eq("id", user.college_id)
        .maybeSingle();

      if (!collegeError && college?.type === "school") {
        institutionType = "school";
      }
    }

    // If legacy plaintext password is still stored, re-hash it on first successful login
    if (!isHashedPassword(user.password)) {
      const hashed = await bcrypt.hash(body.password, 12);
      await supabase.from("users").update({ password: hashed }).eq("id", user.id);
    }

    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      collegeId: user.college_id,
      departmentId: user.department_id,
      institutionType,
    };

    const accessToken = await signAccessToken(authUser);
    const refreshToken = await signRefreshToken(authUser);
    const cookies = buildAuthCookies(accessToken, refreshToken);

    await supabase.from("refresh_tokens").insert({
      user_id: user.id,
      token_hash: await hashToken(refreshToken),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ip_address: ip,
      user_agent: userAgent,
    });

    await supabase.from("auth_logs").insert({
      user_id: user.id,
      college_id: user.college_id,
      action: "login_success",
      ip_address: ip,
      user_agent: userAgent,
    });

    const res = NextResponse.json({ ok: true, data: authUser }, { status: 200 });
    res.cookies.set("access_token", cookies.access_token.value, cookies.access_token.options);
    res.cookies.set("refresh_token", cookies.refresh_token.value, cookies.refresh_token.options);
    return res;
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid payload", 400, error.flatten());
    return apiError("Login failed", 500, String(error));
  }
}
