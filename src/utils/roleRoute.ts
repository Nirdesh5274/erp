import type { Role } from "@/types/auth";

export const roleToRoute: Record<Role, string> = {
  SuperAdmin: "/superadmin",
  Admin: "/admin",
  HOD: "/hod",
  Faculty: "/faculty",
  Student: "/student",
};

export const normalizeRole = (role: string): Role => {
  const safe = role.trim();
  if (safe === "SuperAdmin" || safe === "Admin" || safe === "HOD" || safe === "Faculty") {
    return safe;
  }
  return "Student";
};
