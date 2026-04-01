"use client";

import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/authStore";

interface TopNavbarProps {
  heading: string;
  onMenuClick: () => void;
}

export function TopNavbar({ heading, onMenuClick }: TopNavbarProps) {
  const { email, role } = useCurrentUser();
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 p-2 text-slate-700 md:hidden"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Bireena Dashboard</p>
            <h2 className="text-lg font-bold text-slate-900">{heading}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden rounded-xl bg-slate-100 px-3 py-2 text-sm md:block">
            <p className="font-semibold text-slate-800">{email}</p>
            <p className="text-xs text-slate-500">{role}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
