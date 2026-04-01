import { NextResponse } from "next/server";

export type ApiSuccess<T> = {
  ok: true;
  success: true;
  data: T;
};

export type ApiError = {
  ok: false;
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

function sanitizeMessage(message: string) {
  return message.replace(/[<>]/g, "");
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, success: true, data }, { status });
}

export function apiError(message: string, status = 400, details?: unknown, code = "BAD_REQUEST") {
  const safeMessage = sanitizeMessage(message || "Unexpected error");
  return NextResponse.json<ApiError>({ ok: false, success: false, error: { code, message: safeMessage, details } }, { status });
}
