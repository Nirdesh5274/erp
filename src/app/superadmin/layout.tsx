"use client";

import { Building2, LayoutDashboard, ShieldCheck } from "lucide-react";
import { RoleLayout } from "@/components/layout/RoleLayout";

const navItems = [
  { href: "/superadmin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/superadmin/colleges", label: "Colleges", icon: Building2 },
  { href: "/superadmin/admins", label: "Admins", icon: ShieldCheck },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleLayout allowedRole="SuperAdmin" title="Super Admin" heading="Control Center" navItems={navItems}>
      {children}
    </RoleLayout>
  );
}
