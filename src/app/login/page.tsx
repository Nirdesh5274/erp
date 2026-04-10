"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@/types/auth";
import { useAuthStore } from "@/store/authStore";
import { roleToRoute } from "@/utils/roleRoute";

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const parseApiError = async (response: Response) => {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string | { message?: string };
      };

      return typeof payload.error === "string" ? payload.error : payload.error?.message;
    }

    if (response.status === 404) return "Login API endpoint not found";
    if (response.status >= 500) return "Server error while logging in";
    return "Invalid response from server";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(await parseApiError(response));
      }

      const payload = (await response.json()) as {
        ok: boolean;
        data?: AuthUser;
        error?: string | { message?: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message ?? "Invalid credentials";
        throw new Error(message);
      }

      login(payload.data);
      router.replace(roleToRoute[payload.data.role]);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 app-gradient">
      <div className="absolute left-[-60px] top-[-80px] h-56 w-56 rounded-full bg-amber-300/25 blur-3xl" />
      <div className="absolute bottom-[-80px] right-[-50px] h-56 w-56 rounded-full bg-teal-400/25 blur-3xl" />

      <div className="panel relative w-full max-w-md p-7 md:p-8">
        <p className="text-xs uppercase tracking-[0.25em] text-teal-700">Welcome</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Bireena ERP Login</h1>
        <p className="mt-2 text-sm text-slate-500">Login with credentials from your users table.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none ring-teal-500 transition focus:ring-2"
              placeholder="user@college.edu"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none ring-teal-500 transition focus:ring-2"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white transition hover:bg-teal-800"
          >
            {loading ? "Signing in..." : "Login"}
          </button>

          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
