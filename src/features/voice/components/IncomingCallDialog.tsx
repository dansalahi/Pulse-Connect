import { useEffect, useState } from "react";
import { useSignalingStore } from "../store/signalingStore";
import styles from "./IncomingCallDialog.module.css";

const TIMEOUT_SEC = 30;

const AVATAR_COLORS = ["#FF6B00", "#3b82f6", "#22c55e", "#8b5cf6"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(31, h) + name.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function IncomingCallDialog() {
  const { callState, incomingCall, acceptCall, declineCall } = useSignalingStore();
  const [remaining, setRemaining] = useState(TIMEOUT_SEC);

  // Reset countdown when a new call arrives
  useEffect(() => {
    if (!incomingCall) return;
    setRemaining(TIMEOUT_SEC);
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(interval);
          void declineCall(); // auto-decline on timeout
          return 0;
        }
        return r - 1;
      });
    }, 1_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall?.fromUserId]);

  if (callState !== "incoming" || !incomingCall) return null;

  const initials = incomingCall.fromDisplayName.slice(0, 2).toUpperCase();
  const bg = colorFor(incomingCall.fromUserId);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Incoming call">
      <div className={styles.card}>
        <div className={styles.avatar} style={{ background: bg }}>
          {initials}
        </div>
        <p className={styles.callerName}>{incomingCall.fromDisplayName}</p>
        <p className={styles.subtitle}>is calling…</p>
        <p className={styles.countdown}>{remaining}s</p>

        <div className={styles.buttons}>
          <button
            className={styles.declineBtn}
            onClick={() => void declineCall()}
            aria-label="Decline call"
          >
            {/* Phone-off icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c1.12.45 2.3.77 3.53.94a2 2 0 0 1 1.75 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72c.17 1.23.49 2.41.94 3.53a2 2 0 0 1-.45 2.11l-1.27 1.27" />
              <line x1="23" y1="1" x2="1" y2="23" />
            </svg>
          </button>

          <button
            className={styles.acceptBtn}
            onClick={() => void acceptCall()}
            aria-label="Accept call"
          >
            {/* Phone icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
