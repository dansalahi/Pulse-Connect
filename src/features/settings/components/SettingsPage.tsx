/**
 * Settings page: global hotkey rebinding (records key combos and persists
 * them via IPC to the Rust global-hotkey manager), diagnostics export, and
 * blocked-user management sourced from friendsStore.
 */
import { useEffect, useState } from "react";
import { ipc } from "../../../lib/ipc/commands";
import { useFriendsStore } from "../../friends/store/friendsStore";
import { toast } from "../../../ui/Toast";
import type { HotkeyAction, HotkeyBinding } from "../types/hotkeys";
import styles from "./SettingsPage.module.css";

// ---------------------------------------------------------------------------
// Avatar colours (blocked users section)
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ["#FF6B00", "#3b82f6", "#22c55e", "#8b5cf6"];

function stableColorIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(31, h) + id.charCodeAt(i);
  }
  return Math.abs(h) % AVATAR_COLORS.length;
}

// ---------------------------------------------------------------------------
// Hotkey helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<HotkeyAction, string> = {
  Mute:   "Mute / Unmute",
  Deafen: "Deafen / Undeafen",
  Ptt:    "Push-to-Talk",
  Leave:  "Leave Call",
};

const DEFAULT_ACCELERATORS: Record<HotkeyAction, string> = {
  Mute:   "CmdOrCtrl+Shift+M",
  Deafen: "CmdOrCtrl+Shift+D",
  Ptt:    "Space",
  Leave:  "CmdOrCtrl+Shift+L",
};

const ACTION_ORDER: HotkeyAction[] = ["Mute", "Deafen", "Ptt", "Leave"];

function fmtAccel(acc: string): string {
  const mac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().includes("MAC");
  return acc
    .split("+")
    .map((part) => {
      if (part === "CmdOrCtrl") return mac ? "⌘" : "Ctrl";
      if (part === "Cmd" || part === "Meta") return "⌘";
      if (part === "Ctrl") return mac ? "⌃" : "Ctrl";
      if (part === "Shift") return "⇧";
      if (part === "Alt") return mac ? "⌥" : "Alt";
      return part;
    })
    .join("");
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { blockedUsers, loadBlockedUsers, unblockUser, error } = useFriendsStore();

  const [bindings, setBindings] = useState<HotkeyBinding[]>([]);
  const [editingAction, setEditingAction] = useState<HotkeyAction | null>(null);
  const [recordedAccel, setRecordedAccel] = useState<string | null>(null);
  useEffect(() => {
    void loadBlockedUsers();
    void loadBindings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBindings() {
    try {
      const result = await ipc.hotkeys.getHotkeyBindings();
      const map = new Map(result.map((b) => [b.action, b.accelerator]));
      setBindings(
        ACTION_ORDER.map((action) => ({
          action,
          accelerator: map.get(action) ?? DEFAULT_ACCELERATORS[action],
        })),
      );
    } catch {
      setBindings(
        ACTION_ORDER.map((action) => ({
          action,
          accelerator: DEFAULT_ACCELERATORS[action],
        })),
      );
    }
  }

  // ── Key recording ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editingAction) return;
    setRecordedAccel(null);

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setEditingAction(null);
        return;
      }

      // Ignore lone modifier presses — wait for a main key to complete the combo
      if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");

      let mainKey = e.key;
      if (e.key === " ") mainKey = "Space";
      else if (e.key.length === 1) mainKey = e.key.toUpperCase();
      // else use as-is: F1–F12, ArrowUp, etc.

      parts.push(mainKey);
      setRecordedAccel(parts.join("+"));
    }

    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [editingAction]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function saveBinding(action: HotkeyAction, accelerator: string) {
    try {
      await ipc.hotkeys.setHotkeyBinding(action, accelerator);
      setBindings((prev) =>
        prev.map((b) => (b.action === action ? { ...b, accelerator } : b)),
      );
      setEditingAction(null);
    } catch (e) {
      const msg =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      toast(msg, "error");
    }
  }

  async function resetAll() {
    await ipc.hotkeys.resetHotkeys();
    await loadBindings();
    toast("Hotkeys reset to defaults", "info");
  }

  function resetOne(action: HotkeyAction) {
    void saveBinding(action, DEFAULT_ACCELERATORS[action]);
  }

  async function sendDiagnostics() {
    try {
      await ipc.telemetry.sendDiagnostics();
      toast("Diagnostic report saved to Downloads", "success");
    } catch (e) {
      const msg =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      toast(msg, "error");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <h1 className={styles.pageTitle}>Settings</h1>

        {/* ── Keyboard Shortcuts ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Keyboard Shortcuts</h2>
              <p className={styles.sectionDesc}>
                Global hotkeys — active even when Pulse Connect is in the background.
              </p>
            </div>
            <button className={styles.resetAllBtn} onClick={() => void resetAll()}>
              Reset all
            </button>
          </div>

          <div className={styles.hotkeyTable}>
            {bindings.map((b) => {
              const isEditing = editingAction === b.action;
              return (
                <div
                  key={b.action}
                  className={`${styles.hotkeyRow} ${isEditing ? styles.hotkeyRowEditing : ""}`}
                >
                  <span className={styles.hotkeyLabel}>{ACTION_LABELS[b.action]}</span>

                  <div className={styles.hotkeyBinding}>
                    {isEditing ? (
                      recordedAccel ? (
                        <kbd className={`${styles.kbd} ${styles.kbdRecorded}`}>
                          {fmtAccel(recordedAccel)}
                        </kbd>
                      ) : (
                        <span className={styles.recordingHint}>Press a key combo…</span>
                      )
                    ) : (
                      <kbd className={styles.kbd}>{fmtAccel(b.accelerator)}</kbd>
                    )}
                  </div>

                  <div className={styles.hotkeyBtns}>
                    {isEditing ? (
                      <>
                        <button
                          className={styles.saveBtn}
                          disabled={!recordedAccel}
                          onClick={() =>
                            recordedAccel && void saveBinding(b.action, recordedAccel)
                          }
                        >
                          Save
                        </button>
                        <button
                          className={styles.cancelBtn}
                          onClick={() => setEditingAction(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className={styles.editBtn}
                          onClick={() => setEditingAction(b.action)}
                        >
                          Edit
                        </button>
                        <button
                          className={styles.resetOneBtn}
                          onClick={() => resetOne(b.action)}
                          title="Reset to default"
                        >
                          ↺
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Diagnostics ────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Diagnostics</h2>
          <p className={styles.sectionDesc}>
            Generate a diagnostic report including logs, system info, and recent
            activity. The report is saved to your Downloads folder. No data is
            uploaded automatically.
          </p>
          <button className={styles.diagnosticsBtn} onClick={() => void sendDiagnostics()}>
            Send Diagnostics
          </button>
        </section>

        {/* ── Blocked Users ──────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Blocked Users</h2>
          <p className={styles.sectionDesc}>
            Blocked users are hidden from your friends list and cannot contact you.
          </p>

          {error && <p className={styles.errorText}>{error}</p>}

          {blockedUsers.length === 0 ? (
            <div className={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="#333" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              <p className={styles.emptyText}>No blocked users</p>
            </div>
          ) : (
            <div className={styles.blockedList}>
              {blockedUsers.map((user) => {
                const initials = user.display_name.slice(0, 2).toUpperCase();
                const color = AVATAR_COLORS[stableColorIndex(user.id)];
                return (
                  <div key={user.id} className={styles.blockedRow}>
                    <div className={styles.avatar} style={{ background: color }}>
                      {initials}
                    </div>
                    <span className={styles.displayName}>{user.display_name}</span>
                    <button
                      className={styles.unblockBtn}
                      onClick={() => void unblockUser(user.id)}
                    >
                      Unblock
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
