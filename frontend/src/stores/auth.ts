import { create } from "zustand";

import * as apiClient from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  booted: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, fullName: string) => Promise<User>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  booted: false,

  bootstrap: async () => {
    const res = await apiClient.refreshSession();
    set({ user: res?.user ?? null, booted: true });
  },

  login: async (email, password) => {
    const res = await apiClient.login(email, password);
    set({ user: res.user, booted: true });
    return res.user;
  },

  register: async (email, password, fullName) => {
    const res = await apiClient.register(email, password, fullName);
    set({ user: res.user, booted: true });
    return res.user;
  },

  logout: async () => {
    await apiClient.logout();
    set({ user: null });
  },
}));

apiClient.setSessionLostHandler(() => {
  useAuth.setState({ user: null });
});

export function isStaff(user: User | null): boolean {
  return user?.role === "staff" || user?.role === "admin";
}
