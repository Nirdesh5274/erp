"use client";

import Link from "next/link";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-800">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Something went wrong</p>
          <h1 className="mt-2 text-2xl font-black">We hit a snag</h1>
          <p className="mt-2 text-sm text-slate-600">{error.message || "Unexpected error"}</p>
          <div className="mt-4 flex gap-3 text-sm">
            <button onClick={reset} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Try again</button>
            <Link href="/" className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700">Go home</Link>
          </div>
        </div>
      </body>
    </html>
  );
}
