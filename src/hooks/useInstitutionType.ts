"use client";

import { useMemo } from "react";
import { LABELS } from "@/config/labels";
import { useAuthStore } from "@/store/authStore";
import type { InstitutionType } from "@/config/labels";

export function useInstitutionType() {
  const user = useAuthStore((state) => state.user);

  const rawType = (user as { institutionType?: string } | null)?.institutionType;
  const type: InstitutionType = rawType === "school" ? "school" : "college";
  const labels = useMemo(() => LABELS[type], [type]);
  const isSchool = type === "school";
  const isCollege = type === "college";

  return { type, labels, isSchool, isCollege };
}
