export type Role = "SuperAdmin" | "Admin" | "HOD" | "Faculty" | "Student";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface CollegeCreatePayload {
  name: string;
  location: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}
