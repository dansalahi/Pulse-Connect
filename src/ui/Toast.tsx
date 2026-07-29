/**
 * Shared single-slot toast notification system: a Zustand store plus the
 * `toast()` helper for triggering one from anywhere, and the
 * `<ToastContainer>` that renders it — mount the container once near the
 * app root.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import styles from "./Toast.module.css";

// ---------------------------------------------------------------------------
// Single-toast store — at most one toast visible at any time
// ---------------------------------------------------------------------------

type ToastType = "info" | "error" | "success";

interface CurrentToast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  currentToast: CurrentToast | null;
  show: (message: string, type?: ToastType) => void;
  dismiss: () => void;
}

let nextId = 1;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  currentToast: null,

  show: (message, type = "info") => {
    // Cancel any pending auto-dismiss for the previous toast
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    const id = nextId++;
    set({ currentToast: { id, message, type } });
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      set({ currentToast: null });
    }, 3000);
  },

  dismiss: () => {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    set({ currentToast: null });
  },
}));

/** Convenience function usable outside React components. */
export function toast(message: string, type: ToastType = "info") {
  useToastStore.getState().show(message, type);
}

// ---------------------------------------------------------------------------
// ToastContainer — mount once near the root
// ---------------------------------------------------------------------------

function ToastItem({ entry }: { entry: CurrentToast }) {
  const { dismiss } = useToastStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`${styles.toast} ${styles[entry.type]} ${visible ? styles.visible : ""}`}
      role="alert"
    >
      <span className={styles.message}>{entry.message}</span>
      <button className={styles.closeBtn} onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { currentToast } = useToastStore();
  if (!currentToast) return null;
  return (
    <div className={styles.container}>
      <ToastItem key={currentToast.id} entry={currentToast} />
    </div>
  );
}
