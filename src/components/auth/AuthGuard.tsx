"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/types/auth";
import { useAuthStore } from "@/store/authStore";
import { roleToRoute } from "@/utils/roleRoute";

interface AuthGuardProps {
  allowedRoles: Role[];
  children: React.ReactNode;
}

export function AuthGuard({ allowedRoles, children }: AuthGuardProps) {
  const router = useRouter();
  const hydrated = useAuthStore((state) => state.hydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.user?.role ?? "Student");

  useEffect(() => {
    if (!hydrated) return;

    if (!isAuthenticated) {
      router.replace("/login");
      return;
    }

    if (!allowedRoles.includes(role)) {
      router.replace(roleToRoute[role]);
    }
  }, [allowedRoles, hydrated, isAuthenticated, role, router]);

  if (!hydrated || !isAuthenticated || !allowedRoles.includes(role)) {
    return (
      <div className="flex min-h-screen items-center justify-center app-gradient">
        <p className="text-sm font-semibold text-slate-600">Loading Bireena workspace...</p>
      </div>
    );
  }

  return <>{children}</>;
}
