"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarProps {
  role?: string;
  navItems?: NavItem[];
  title: string;
  items: NavItem[];
  mobile?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ title, items, navItems, role, mobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { email, user } = useCurrentUser();
  const activeRole = role ?? user?.role ?? title;
  const menuItems = navItems ?? items;

  return (
    <aside
      className={`${mobile ? "flex h-full min-h-0 w-full" : "hidden md:flex min-h-screen w-72"} flex-col border-r border-slate-200 bg-white shadow-sm`}
    >
      <div className="h-16 border-b border-slate-100 bg-gradient-to-r from-teal-700 to-teal-600 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
            <span className="text-sm font-bold text-white">B</span>
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight text-white">Bireena ERP</p>
            <p className="text-xs capitalize text-teal-100">{activeRole}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "border-l-2 border-teal-600 bg-teal-50 pl-[10px] text-teal-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-slate-100 p-4">
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Bell size={16} />
            <span>Notifications</span>
          </div>
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">0</span>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
            {(email || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">{email}</p>
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{activeRole}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
