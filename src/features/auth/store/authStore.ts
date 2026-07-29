/**
 * Zustand store owning auth/session state; delegates credential checks and
 * session persistence to the Rust auth manager over IPC rather than holding
 * tokens client-side.
 */
import { create } from "zustand";
import { ipc } from "../../../lib/ipc/commands";
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
      const user = await ipc.auth.login(email, password);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err as AppError });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await ipc.auth.logout();
    } finally {
      set({ user: null, isAuthenticated: false, isLoading: false, error: null });
    }
  },

  // Called once on app start (see App.tsx). Asks the Rust auth manager for a
  // session restored from its own persisted/keychain-backed token rather than
  // anything stored in the renderer, so a null result just means "logged out".
  bootstrap: async () => {
    set({ isLoading: true });
    try {
      const user = await ipc.auth.getSession();
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
