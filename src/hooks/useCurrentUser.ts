"use client";

import { useAuthStore } from "@/store/authStore";

export const useCurrentUser = () => {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthStore((state) => state.hydrated);

  return {
    hydrated,
    isAuthenticated,
    email: user?.email ?? "",
    role: user?.role ?? "",
    user,
  };
};
