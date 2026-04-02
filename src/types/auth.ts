export type Role = "SuperAdmin" | "Admin" | "HOD" | "Faculty" | "Student";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  collegeId: string | null;
  departmentId: string | null;
  institutionType?: "college" | "school";
}

export interface AuthSession {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revoked?: boolean;
}
