"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const onResize = () => {
      if (window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onEscape);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onEscape);
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen overflow-x-hidden app-gradient md:flex">
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
            <Sidebar title={title} items={navItems} mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 overflow-x-hidden">
        <TopNavbar heading={heading} onMenuClick={() => setMobileOpen(true)} />
        <div className="p-3 sm:p-4 md:p-6 pb-6">{children}</div>
      </main>
    </div>
  );
}
