"use client";

import { ClipboardCheck, LayoutDashboard, UserPlus } from "lucide-react";
import { RoleLayout } from "@/components/layout/RoleLayout";

const navItems = [
  { href: "/faculty/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/faculty/attendance", label: "Attendance", icon: ClipboardCheck },
  { href: "/faculty/students", label: "Students", icon: UserPlus },
];

export default function FacultyLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleLayout allowedRole="Faculty" title="Faculty" heading="Teaching Console" navItems={navItems}>
      {children}
    </RoleLayout>
  );
}
