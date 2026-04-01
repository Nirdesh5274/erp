"use client";

import { CalendarRange, LayoutDashboard, UsersRound, Lock, UserPlus } from "lucide-react";
import { RoleLayout } from "@/components/layout/RoleLayout";

const navItems = [
  { href: "/hod/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/hod/faculty", label: "Faculty", icon: UsersRound },
  { href: "/hod/admissions", label: "Students", icon: UserPlus },
  { href: "/hod/schedule", label: "Schedule", icon: CalendarRange },
  { href: "/hod/attendance", label: "Attendance Locks", icon: Lock },
];

export default function HodLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleLayout allowedRole="HOD" title="HOD" heading="Department Lead" navItems={navItems}>
      {children}
    </RoleLayout>
  );
}
