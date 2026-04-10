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
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (response.status === 404) throw new Error("API endpoint not found");
    if (response.status === 401) throw new Error("Unauthorized");
    if (response.status >= 500) throw new Error("Server error");
    throw new Error("Invalid response from server");
  }

  const json = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !json.ok || typeof json.data === "undefined") {
    const message = typeof json.error === "string" ? json.error : json.error?.message;
    throw new Error(message ?? "Request failed");
  }

  return json.data;
}
