import { useEffect, useState } from "react";
import { ipc } from "../../../lib/ipc/commands";
import { useVoiceStore } from "../store/voiceStore";
import { useFriendsStore } from "../../friends/store/friendsStore";
import type { Friend } from "../../friends/types/friends";
import type { HotkeyBinding } from "../../settings/types/hotkeys";
import type { VoiceParticipant } from "../types/voice";
import styles from "./VoicePage.module.css";

// ---------------------------------------------------------------------------
// Shortcut formatting
// ---------------------------------------------------------------------------

const IS_MAC =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

function formatAccelerator(accel: string): string {
  return accel
    .split("+")
    .map((part) => {
      if (part === "CmdOrCtrl") return IS_MAC ? "⌘" : "Ctrl";
      if (part === "Cmd" || part === "Meta") return "⌘";
      if (part === "Ctrl") return IS_MAC ? "⌃" : "Ctrl";
      if (part === "Shift") return "⇧";
      if (part === "Alt") return IS_MAC ? "⌥" : "Alt";
      return part;
    })
    .join("");
}

const SHORTCUT_LABELS: Record<string, string> = {
  Mute:   "Mute",
  Deafen: "Deafen",
  Ptt:    "PTT",
  Leave:  "Leave",
};

// ---------------------------------------------------------------------------
// Avatar colors (stable hash)
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ["#8b5cf6", "#3b82f6", "#ec4899", "#f59e0b"];

function colorFor(identity: string): string {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = Math.imul(31, h) + identity.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ---------------------------------------------------------------------------
// Icons (inline SVG)
// ---------------------------------------------------------------------------

function IconMic({ muted }: { muted: boolean }) {
  return muted ? (
    // Mic with slash
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function IconPhoneOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c1.12.45 2.3.77 3.53.94a2 2 0 0 1 1.75 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72c.17 1.23.49 2.41.94 3.53a2 2 0 0 1-.45 2.11L7.56 10.57" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  );
}

function IconPersonAdd() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}


// ---------------------------------------------------------------------------
// Participant card
// ---------------------------------------------------------------------------

function ParticipantCard({ participant, isLocal }: { participant: VoiceParticipant; isLocal: boolean }) {
  const initials = participant.display_name.slice(0, 2).toUpperCase();
  const bg = isLocal ? "#FF6B00" : colorFor(participant.identity);

  return (
    <div className={`${styles.card} ${participant.is_speaking ? styles.cardSpeaking : ""}`}>
      <div className={styles.cardAvatarWrap}>
        <div className={styles.cardAvatar} style={{ background: bg }}>
          {initials}
        </div>
        {participant.is_muted && (
          <div className={styles.mutedBadge} title="Muted">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            </svg>
          </div>
        )}
      </div>
      <p className={styles.cardName}>
        {participant.display_name}{isLocal && <span className={styles.youBadge}> (You)</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite modal (standalone, triggered from control bar)
// ---------------------------------------------------------------------------

function InviteModal({
  invitableFriends,
  onInvite,
  onClose,
}: {
  invitableFriends: Friend[];
  onInvite: (friendId: string, displayName: string) => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.inviteOverlay} onClick={onClose}>
      <div className={styles.inviteModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inviteModalHeader}>
          <h3 className={styles.inviteModalTitle}>Invite to Call</h3>
          <button className={styles.inviteClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        {invitableFriends.length === 0 ? (
          <p className={styles.inviteEmpty}>No friends online</p>
        ) : (
          <div className={styles.inviteList}>
            {invitableFriends.map((f) => {
              const initials = f.display_name.slice(0, 2).toUpperCase();
              const bg = colorFor(f.user_id);
              return (
                <div key={f.user_id} className={styles.inviteRow}>
                  <div className={styles.inviteAvatar} style={{ background: bg }}>{initials}</div>
                  <span className={styles.inviteName}>{f.display_name}</span>
                  <button
                    className={styles.inviteBtn}
                    onClick={() => { onInvite(f.user_id, f.display_name); onClose(); }}
                  >
                    Invite
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debug panel
// ---------------------------------------------------------------------------

interface DebugInfo {
  room: string;
  participants: number;
  quality: string;
}

function DebugPanel({ info }: { info: DebugInfo }) {
  return (
    <div className={styles.debugPanel}>
      <p className={styles.debugTitle}>Debug</p>
      <p className={styles.debugRow}><span>Room</span><span>{info.room}</span></p>
      <p className={styles.debugRow}><span>Participants</span><span>{info.participants}</span></p>
      <p className={styles.debugRow}><span>Quality</span><span>{info.quality}</span></p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VoicePage
// ---------------------------------------------------------------------------

export function VoicePage() {
  const {
    isInCall,
    roomName,
    isMuted,
    participants,
    room,
    leaveVoice,
    toggleMute,
    inputDevices,
    outputDevices,
    selectedInputId,
    selectedOutputId,
    setInputDevice,
    setOutputDevice,
    loadDevices,
    inviteFriend,
    isOverlayVisible,
    toggleOverlay,
  } = useVoiceStore();

  const { friends } = useFriendsStore();

  const invitableFriends = friends.filter(
    (f) =>
      f.is_friend &&
      (f.status === "Online" || f.status === "InGame") &&
      !participants.some((p) => p.identity === f.user_id),
  );

  const [hotkeys, setHotkeys] = useState<HotkeyBinding[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    room: roomName ?? "—",
    participants: participants.length,
    quality: "Good",
  });

  // Close mic menu on outside click
  useEffect(() => {
    if (!micMenuOpen) return;
    function onDown() { setMicMenuOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [micMenuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "d") { e.preventDefault(); setShowDebug((v) => !v); }
      if (e.key === "Escape") { setInviteOpen(false); setMicMenuOpen(false); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debug info refresh every second
  useEffect(() => {
    if (!showDebug) return;
    const id = setInterval(() => {
      setDebugInfo({
        room: roomName ?? "—",
        participants: participants.length,
        quality: room?.localParticipant.connectionQuality ?? "Unknown",
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [showDebug, roomName, participants.length, room]);

  // Load available audio devices on mount (and when the call starts).
  // The module-level devicechange listener in voiceStore handles hot-plug.
  useEffect(() => {
    void loadDevices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInCall]);

  // Load hotkey bindings once so the legend stays in sync with user settings.
  useEffect(() => {
    ipc.hotkeys
      .getHotkeyBindings()
      .then(setHotkeys)
      .catch(() => { /* legend is cosmetic — silently ignore */ });
  }, []);

  if (!isInCall) {
    return (
      <div className={styles.root}>
        <p className={styles.noCall}>No active call</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.roomName}>{roomName}</span>
        <span className={styles.participantCount}>{participants.length} in call</span>
      </div>

      {/* Shortcut legend */}
      {hotkeys.length > 0 && (
        <div className={styles.shortcutBar}>
          {hotkeys.map((b, i) => (
            <span key={b.action} className={styles.shortcutItem}>
              <kbd className={styles.shortcutKey}>{formatAccelerator(b.accelerator)}</kbd>
              <span className={styles.shortcutLabel}>{SHORTCUT_LABELS[b.action] ?? b.action}</span>
              {i < hotkeys.length - 1 && <span className={styles.shortcutDot}>·</span>}
            </span>
          ))}
        </div>
      )}

      {/* Participant grid — no invite card here */}
      <div className={styles.grid}>
        {participants.map((p) => (
          <ParticipantCard
            key={p.identity}
            participant={p}
            isLocal={p.identity === room?.localParticipant.identity}
          />
        ))}
      </div>

      {/* Bottom section: controls + device selectors in normal flow */}
      <div className={styles.bottomSection}>
      {/* ── Control bar ── */}
      <div className={styles.controlBar}>

        {/* Left pill: Mute + dropdown arrow (opens device selector) */}
        <div className={`${styles.pillGroup} ${isMuted ? styles.pillGroupMuted : ""}`}>
          <button
            className={styles.pillMain}
            onClick={() => void toggleMute()}
            title={isMuted ? "Unmute" : "Mute"}
          >
            <IconMic muted={isMuted} />
          </button>
          <button
            className={styles.pillArrow}
            title="Audio settings"
            onClick={() => setMicMenuOpen((v) => !v)}
          >
            <span className={styles.chevron}>▾</span>
          </button>

          {micMenuOpen && (
            <div className={styles.micMenu} onClick={(e) => e.stopPropagation()}>
              <p className={styles.micMenuSection}>Microphone</p>
              {inputDevices.map((d) => (
                <button
                  key={d.deviceId}
                  className={`${styles.micMenuItem} ${d.deviceId === selectedInputId ? styles.micMenuItemActive : ""}`}
                  onClick={() => { void setInputDevice(d.deviceId); setMicMenuOpen(false); }}
                >
                  {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                </button>
              ))}
              <p className={styles.micMenuSection}>Speaker</p>
              {outputDevices.map((d) => (
                <button
                  key={d.deviceId}
                  className={`${styles.micMenuItem} ${d.deviceId === selectedOutputId ? styles.micMenuItemActive : ""}`}
                  onClick={() => { void setOutputDevice(d.deviceId); setMicMenuOpen(false); }}
                >
                  {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Second pill: Invite + dropdown arrow */}
        <div className={styles.pillGroup}>
          <button
            className={styles.pillMain}
            onClick={() => setInviteOpen(true)}
            title="Invite to call"
          >
            <IconPersonAdd />
          </button>
          <button className={styles.pillArrow} title="Invite options" disabled>
            <span className={styles.chevron}>▾</span>
          </button>
        </div>

        {/* Individual icon buttons */}
        <button
          className={`${styles.overlayBtn} ${isOverlayVisible ? styles.overlayBtnActive : ""}`}
          title="Toggle Overlay"
          onClick={toggleOverlay}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <rect x="12" y="10" width="9" height="6" rx="1" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {/* Leave — red pill, far right */}
        <button
          className={styles.leaveBtn}
          onClick={() => void leaveVoice()}
          title="Leave call"
        >
          <IconPhoneOff />
          <span>Leave</span>
        </button>
      </div>


      </div>{/* end bottomSection */}

      {/* Debug panel (Ctrl+D) */}
      {showDebug && <DebugPanel info={debugInfo} />}

      {/* Invite modal */}
      {inviteOpen && (
        <InviteModal
          invitableFriends={invitableFriends}
          onInvite={(friendId, displayName) => void inviteFriend(friendId, displayName)}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
}
