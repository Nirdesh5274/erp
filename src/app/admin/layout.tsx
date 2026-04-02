"use client";

import {
  Building,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  GraduationCap,
  LayoutDashboard,
  MonitorPlay,
  ReceiptText,
  UserPlus,
  UsersRound,
  Bell,
  BarChart3,
  ClipboardPenLine,
} from "lucide-react";
import { RoleLayout } from "@/components/layout/RoleLayout";
import { useInstitutionType } from "@/hooks/useInstitutionType";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isSchool, isCollege, labels } = useInstitutionType();

  const navItems = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/blocks", label: "Blocks", icon: Building },
    { href: "/admin/rooms", label: "Rooms", icon: DoorOpen },
    { href: "/admin/labs", label: "Labs", icon: ClipboardCheck },
    { href: "/admin/admissions", label: isSchool ? "Enquiries" : "Admissions", icon: UserPlus },
    ...(isCollege ? [{ href: "/admin/departments", label: "Departments", icon: Building }] : []),
    ...(isSchool ? [{ href: "/admin/classes", label: "Classes", icon: Building }] : []),
    { href: "/admin/users", label: "Users", icon: UsersRound },
    { href: "/admin/students", label: "Students", icon: GraduationCap },
    { href: "/admin/fees", label: "Fees", icon: ReceiptText },
    { href: "/admin/fee-structures", label: "Fee Structures", icon: ClipboardPenLine },
    ...(isCollege ? [{ href: "/admin/slots", label: "Schedule", icon: CalendarClock }] : []),
    ...(isSchool ? [{ href: "/admin/timetable", label: "Timetable", icon: CalendarDays }] : []),
    { href: "/admin/monitoring", label: "Monitoring", icon: MonitorPlay },
    { href: "/admin/attendance", label: "Attendance", icon: ClipboardList },
    { href: "/admin/notifications", label: "Notifications", icon: Bell },
    { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <RoleLayout allowedRole="Admin" title="Admin" heading="Operations" navItems={navItems}>
      {children}
    </RoleLayout>
  );
}
