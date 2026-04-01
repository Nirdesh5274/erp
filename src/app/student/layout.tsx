"use client";

import { LayoutDashboard, ReceiptText, CalendarDays, Bell, PieChart, IdCard, FileDown } from "lucide-react";
import { RoleLayout } from "@/components/layout/RoleLayout";

const navItems = [
  { href: "/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/student/attendance", label: "Attendance", icon: PieChart },
  { href: "/student/fees", label: "Fees", icon: ReceiptText },
  { href: "/student/profile", label: "Profile", icon: IdCard },
  { href: "/student/documents", label: "Documents", icon: FileDown },
  { href: "/student/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/student/notifications", label: "Notifications", icon: Bell },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleLayout allowedRole="Student" title="Student" heading="My Academic Day" navItems={navItems}>
      {children}
    </RoleLayout>
  );
}
