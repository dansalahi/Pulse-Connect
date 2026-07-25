import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { IncomingCallDialog } from "../features/voice/components/IncomingCallDialog";
import { ToastContainer } from "../ui/Toast";
import { useAuthStore } from "../features/auth/store/authStore";
import { useFriendsStore } from "../features/friends/store/friendsStore";
import { useVoiceStore } from "../features/voice/store/voiceStore";
import { FriendsPage } from "../features/friends/components/FriendsPage";
import { SettingsPage } from "../features/settings/components/SettingsPage";
import { VoicePage } from "../features/voice/components/VoicePage";
import type { MyStatus } from "../features/friends/types/friends";
import styles from "./MainLayout.module.css";

type NavItem = "friends" | "settings" | "voice";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

interface IconProps { color: string; }

function IconPeople({ color }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconGear({ color }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconLogOut({ color }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<MyStatus, string> = {
  Online: "#22c55e",
  InGame: "#3b82f6",
  DND:    "#ef4444",
};

const STATUS_OPTIONS: Array<{ value: MyStatus; label: string }> = [
  { value: "Online", label: "Online"           },
  { value: "InGame", label: "In Game"          },
  { value: "DND",    label: "Do Not Disturb"   },
];

// ---------------------------------------------------------------------------
// MainLayout
// ---------------------------------------------------------------------------

export function MainLayout() {
  const { user, logout } = useAuthStore();
  const { wsConnected, myStatus, setMyStatus } = useFriendsStore();
  const { isInCall, callState, incomingCall } = useVoiceStore();
  const [activeNav, setActiveNav] = useState<NavItem>("friends");
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [pendingInGame, setPendingInGame] = useState(false);
  const [gameName, setGameName] = useState("");

  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const avatarAreaRef = useRef<HTMLDivElement>(null);

  // Auto-navigate to voice tab when a call starts; back to friends when it ends
  useEffect(() => {
    if (isInCall) setActiveNav("voice");
    else if (activeNav === "voice") setActiveNav("friends");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInCall]);

  useEffect(() => {
    if (!menuPos) return;
    function onMouseDown(e: MouseEvent) {
      if (avatarAreaRef.current && !avatarAreaRef.current.contains(e.target as Node)) {
        setMenuPos(null);
        setPendingInGame(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuPos]);

  const initials = user?.display_name.slice(0, 2).toUpperCase() ?? "?";

  function toggleMenu() {
    if (menuPos) { setMenuPos(null); setPendingInGame(false); return; }
    const rect = avatarBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ left: 72, bottom: window.innerHeight - rect.top + 8 });
  }

  function openSettings() {
    setMenuPos(null);
    setPendingInGame(false);
    setActiveNav("settings");
  }

  function openSignOutDialog() {
    setMenuPos(null);
    setPendingInGame(false);
    setShowSignOutDialog(true);
  }

  function confirmSignOut() {
    setShowSignOutDialog(false);
    logout();
  }

  function handleStatusSelect(status: MyStatus) {
    if (status === "InGame") {
      setPendingInGame(true);
      return;
    }
    setPendingInGame(false);
    setGameName("");
    void setMyStatus(status);
    setMenuPos(null);
  }

  function confirmInGame() {
    void setMyStatus("InGame", gameName.trim() || undefined);
    setPendingInGame(false);
    setGameName("");
    setMenuPos(null);
  }

  const avatarBorderColor = STATUS_COLORS[myStatus];

  return (
    <div className={styles.root}>
      {/* ── Sidebar ── */}
      <nav className={styles.sidebar}>
        <div className={styles.logo}>N</div>

        <div className={styles.nav}>
          <div className={styles.navItem}>
            <button
              className={`${styles.navBtn} ${activeNav === "friends" ? styles.navBtnActive : ""}`}
              onClick={() => setActiveNav("friends")}
              aria-label="Friends"
            >
              <IconPeople color={activeNav === "friends" ? "#FF6B00" : "#555555"} />
            </button>
            <span className={styles.tooltip}>Friends</span>
          </div>

          <div className={styles.navItem}>
            <button
              className={`${styles.navBtn} ${activeNav === "settings" ? styles.navBtnActive : ""}`}
              onClick={() => setActiveNav("settings")}
              aria-label="Settings"
            >
              <IconGear color={activeNav === "settings" ? "#FF6B00" : "#555555"} />
            </button>
            <span className={styles.tooltip}>Settings</span>
          </div>
        </div>

        {/* Bottom: WS indicator + avatar */}
        <div className={styles.bottom}>
          <div className={styles.navItem}>
            <div className={`${styles.wsDot} ${wsConnected ? styles.wsDotOnline : styles.wsDotOffline}`} />
            <span className={styles.tooltip}>
              {wsConnected ? "Connected" : "Reconnecting..."}
            </span>
          </div>

          <div ref={avatarAreaRef} className={styles.avatarNavItem}>
            <button
              ref={avatarBtnRef}
              className={styles.avatarBtn}
              onClick={toggleMenu}
              aria-label="User menu"
              aria-expanded={menuPos !== null}
            >
              <div
                className={styles.avatar}
                style={{ outline: `2px solid ${avatarBorderColor}`, outlineOffset: "2px" }}
              >
                {initials}
              </div>
            </button>

            {menuPos && (
              <div
                className={styles.avatarMenu}
                style={{ left: menuPos.left, bottom: menuPos.bottom }}
                role="menu"
              >
                {/* Status selector */}
                <div className={styles.statusSection}>
                  <p className={styles.statusSectionLabel}>Status</p>
                  {pendingInGame ? (
                    <div className={styles.inGameInput}>
                      <input
                        className={styles.gameInput}
                        type="text"
                        placeholder="Game name (optional)"
                        value={gameName}
                        onChange={(e) => setGameName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmInGame(); }}
                        autoFocus
                      />
                      <div className={styles.inGameBtns}>
                        <button className={styles.inGameCancel}
                          onClick={() => setPendingInGame(false)}>Cancel</button>
                        <button className={styles.inGameConfirm}
                          onClick={confirmInGame}>Set</button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.statusOptions}>
                      {STATUS_OPTIONS.map(({ value, label }) => (
                        <button
                          key={value}
                          className={`${styles.statusOption} ${myStatus === value ? styles.statusOptionActive : ""}`}
                          onClick={() => handleStatusSelect(value)}
                          role="menuitem"
                        >
                          <span
                            className={styles.statusOptionDot}
                            style={{ background: STATUS_COLORS[value] }}
                          />
                          {label}
                          {value === "InGame" && myStatus === "InGame" && (
                            <span className={styles.statusOptionCheck}>✓</span>
                          )}
                          {value !== "InGame" && myStatus === value && (
                            <span className={styles.statusOptionCheck}>✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.menuDivider} />

                <button className={styles.menuItem} role="menuitem" onClick={openSettings}>
                  <IconGear color="#ffffff" />
                  Profile &amp; Settings
                </button>

                <div className={styles.menuDivider} />

                <button
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  role="menuitem"
                  onClick={openSignOutDialog}
                >
                  <IconLogOut color="#ef4444" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>

      </nav>

      {/* ── Content ── */}
      <div className={styles.content}>
        {activeNav === "friends" && <FriendsPage />}
        {activeNav === "settings" && <SettingsPage />}
        {activeNav === "voice" && <VoicePage />}
      </div>

      <ToastContainer />
      {callState === "incoming" && incomingCall && <IncomingCallDialog />}

      {showSignOutDialog && (
        <ConfirmDialog
          title="Sign Out"
          message="Are you sure you want to sign out?"
          confirmLabel="Sign Out"
          onConfirm={confirmSignOut}
          onCancel={() => setShowSignOutDialog(false)}
        />
      )}
    </div>
  );
}
