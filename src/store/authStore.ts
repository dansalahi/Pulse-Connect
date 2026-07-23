import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AppError, AuthUser } from "../types/auth";

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: AppError | null;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  clearError: () => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const user = await invoke<AuthUser>("login", { email, password });
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err as AppError });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await invoke<void>("logout");
    } finally {
      set({ user: null, isAuthenticated: false, isLoading: false, error: null });
    }
  },

  bootstrap: async () => {
    set({ isLoading: true });
    try {
      const user = await invoke<AuthUser | null>("get_session");
      if (user) {
        set({ user, isAuthenticated: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
