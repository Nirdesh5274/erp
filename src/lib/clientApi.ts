"use client";

interface ApiEnvelope<T> {
  ok: boolean;
  success?: boolean;
  data?: T;
  error?: string | { code?: string; message?: string; details?: unknown };
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = {
    "content-type": "application/json",
    ...(init?.headers ?? {}),
  };

  const response = await fetch(input, { ...init, headers, credentials: "include" });
  const json = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !json.ok || typeof json.data === "undefined") {
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    throw new Error(message ?? "Request failed");
  }

  return json.data;
}
