"use client";

import type { Role } from "@/types/auth";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AppShell } from "@/components/layout/AppShell";
import type { NavItem } from "@/components/layout/Sidebar";

interface RoleLayoutProps {
  allowedRole: Role;
  title: string;
  heading: string;
  navItems: NavItem[];
  children: React.ReactNode;
}

export function RoleLayout({ allowedRole, title, heading, navItems, children }: RoleLayoutProps) {
  return (
    <AuthGuard allowedRoles={[allowedRole]}>
      <AppShell title={title} heading={heading} navItems={navItems}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
