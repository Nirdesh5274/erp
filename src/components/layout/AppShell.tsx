"use client";

import { useState } from "react";
import { Sidebar, type NavItem } from "@/components/layout/Sidebar";
import { TopNavbar } from "@/components/layout/TopNavbar";

interface AppShellProps {
  title: string;
  heading: string;
  navItems: NavItem[];
  children: React.ReactNode;
}

export function AppShell({ title, heading, navItems, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen app-gradient md:flex overflow-x-hidden">
      <Sidebar title={title} items={navItems} />

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
          <div className="relative z-50 h-full w-[86vw] max-w-[20rem] bg-white shadow-xl">
            <Sidebar title={title} items={navItems} mobile />
          </div>
        </div>
      ) : null}

      <main className="flex-1 min-w-0">
        <TopNavbar heading={heading} onMenuClick={() => setMobileOpen(true)} />
        <div className="p-3 sm:p-4 md:p-6 pb-6">{children}</div>
      </main>
    </div>
  );
}
