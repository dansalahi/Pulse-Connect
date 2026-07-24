import { useEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
} from "@tauri-apps/api/window";
import { ipc } from "../../lib/ipc/commands";
import { events } from "../../lib/ipc/events";
import type { OverlayParticipantPayload } from "../../lib/ipc/events";
import styles from "./OverlayApp.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OverlayParticipant = OverlayParticipantPayload;

// ---------------------------------------------------------------------------
// Avatar colours (no green — reserved for speaking ring)
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ["#8b5cf6", "#3b82f6", "#ec4899", "#f59e0b"];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function IconMicOff() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function IconMicOn() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function IconPhoneOff() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c1.12.45 2.3.77 3.53.94a2 2 0 0 1 1.75 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72c.17 1.23.49 2.41.94 3.53a2 2 0 0 1-.45 2.11L7.56 10.57" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// OverlayApp
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 4; // leave room for 3 action buttons

export function OverlayApp() {
  const [participants, setParticipants] = useState<OverlayParticipant[]>([]);
  const [roomName, setRoomName] = useState<string>("");
  const [isMuted, setIsMuted] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const win = getCurrentWindow();

  // ── Receive overlay updates ───────────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    events
      .listen("overlay_update", (payload) => {
        console.log("[overlay] overlay_update received:", payload);
        setParticipants(payload.participants);
        setRoomName(payload.room_name);
        setIsMuted(payload.is_muted);
        setLocalMuted(payload.is_muted);
      })
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // ── Ctrl+Shift: toggle interactive / click-through mode ───────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey) {
        setInteractive((v) => {
          const next = !v;
          void win.setIgnoreCursorEvents(!next);
          console.log("[overlay] interactive mode:", next);
          return next;
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drag + edge snap ─────────────────────────────────────────────────────
  async function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    await win.startDragging();
    function onMouseUp() {
      document.removeEventListener("mouseup", onMouseUp);
      void snapToEdges();
    }
    document.addEventListener("mouseup", onMouseUp);
  }

  async function snapToEdges() {
    const pos = await win.outerPosition();
    const sf = window.devicePixelRatio || 1;
    const mw = window.screen.width;
    const mh = window.screen.height;
    const pw = window.innerWidth;   // actual overlay window width
    const ph = window.innerHeight;  // actual overlay window height
    const SNAP = 20;
    let lx = pos.x / sf;
    let ly = pos.y / sf;
    if (lx < SNAP) lx = 0;
    else if (lx + pw > mw - SNAP) lx = mw - pw;
    if (ly < SNAP) ly = 0;
    else if (ly + ph > mh - SNAP) ly = mh - ph;
    await win.setPosition(new LogicalPosition(lx, ly));
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  // Emit events to the main window — no invoke/capability needed.
  // App.tsx listens to these and delegates to voiceStore actions.
  async function handleMute() {
    console.log("[overlay] invoking overlay_toggle_mute");
    setLocalMuted((prev) => !prev); // optimistic — corrected by overlay_update
    try {
      await ipc.overlay.overlayToggleMute();
      console.log("[overlay] invoke done");
    } catch (e) {
      console.error("[overlay] overlay_toggle_mute failed:", e);
      setLocalMuted(isMuted); // revert on failure
    }
  }

  async function handleLeave() {
    console.log("[overlay] invoking overlay_leave_call");
    try {
      await ipc.overlay.overlayLeaveCall();
    } catch (e) {
      console.error("[overlay] overlay_leave_call failed:", e);
    }
  }

  async function handleClose() {
    console.log("[overlay] invoking overlay_close");
    try {
      await ipc.overlay.overlayClose();
    } catch (e) {
      console.error("[overlay] overlay_close failed:", e);
    }
  }

  // Stop drag propagation from button area — pill's onMouseDown fires before
  // button onClick, which would start a drag instead of registering the click.
  function stopDrag(e: React.MouseEvent) {
    e.stopPropagation();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const visible = participants.slice(0, MAX_VISIBLE);
  const overflow = participants.length - MAX_VISIBLE;

  return (
    <div
      ref={pillRef}
      className={`${styles.pill} ${interactive ? styles.pillInteractive : ""}`}
      onMouseDown={(e) => void handleMouseDown(e)}
    >
      {roomName && (
        <>
          <span className={styles.roomName} title={roomName}>{roomName}</span>
          <div className={styles.divider} />
        </>
      )}

      <div className={styles.avatarRow}>
        {visible.map((p, index) => (
          <div key={p.identity} className={styles.avatarWrap} title={p.display_name}>
            <div
              className={`${styles.avatar} ${p.is_speaking ? styles.avatarSpeaking : ""}`}
              style={{ background: index === 0 ? "#FF6B00" : colorFor(p.identity) }}
            >
              {p.display_name.slice(0, 2).toUpperCase()}
            </div>
            {p.is_muted && <div className={styles.mutedDot} />}
          </div>
        ))}
        {overflow > 0 && <div className={styles.overflow}>+{overflow}</div>}
      </div>

      <div className={styles.divider} />

      {/* Buttons: onMouseDown stops drag; onClick triggers action */}
      <div className={styles.actions} onMouseDown={stopDrag}>
        <button
          className={`${styles.actionBtn} ${localMuted ? styles.actionBtnMuted : ""}`}
          onClick={() => void handleMute()}
          title={localMuted ? "Unmute" : "Mute"}
        >
          {localMuted ? <IconMicOff /> : <IconMicOn />}
        </button>

        <button
          className={`${styles.actionBtn} ${styles.actionBtnLeave}`}
          onClick={() => void handleLeave()}
          title="Leave call"
        >
          <IconPhoneOff />
        </button>

        <button
          className={`${styles.actionBtn} ${styles.actionBtnClose}`}
          onClick={() => void handleClose()}
          title="Hide overlay"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
