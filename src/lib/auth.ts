import { SignJWT, jwtVerify } from "jose";
import type { AuthUser, Role } from "@/types/auth";

const ACCESS_EXPIRES_SECONDS = 15 * 60; // 15 minutes
const REFRESH_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getSecret(envKey: string) {
  const secret = process.env[envKey];
  if (!secret) throw new Error(`Missing env: ${envKey}`);
  return new TextEncoder().encode(secret);
}

export interface JwtPayload {
  sub: string;
  role: Role;
  collegeId: string | null;
  departmentId: string | null;
  institutionType?: "college" | "school";
  name: string;
  email: string;
}

export async function signAccessToken(user: AuthUser) {
  const secret = getSecret("JWT_SECRET");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: user.id,
    role: user.role,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    institutionType: user.institutionType,
    name: user.name,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_EXPIRES_SECONDS)
    .sign(secret);
}

export async function signRefreshToken(user: AuthUser) {
  const secret = getSecret("JWT_REFRESH_SECRET");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: user.id,
    role: user.role,
    collegeId: user.collegeId,
    departmentId: user.departmentId,
    institutionType: user.institutionType,
    name: user.name,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_EXPIRES_SECONDS)
    .sign(secret);
  return token;
}

export async function verifyAccessToken(token: string) {
  const secret = getSecret("JWT_SECRET");
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JwtPayload;
}

export async function verifyRefreshToken(token: string) {
  const secret = getSecret("JWT_REFRESH_SECRET");
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as JwtPayload;
}

export async function hashToken(token: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is not available in this runtime");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildAuthCookies(access: string, refresh: string) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookies = {
    access_token: {
      value: access,
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: isProduction,
        path: "/",
        maxAge: ACCESS_EXPIRES_SECONDS,
      },
    },
    refresh_token: {
      value: refresh,
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: isProduction,
        path: "/",
        maxAge: REFRESH_EXPIRES_SECONDS,
      },
    },
  };
  return cookies;
}
