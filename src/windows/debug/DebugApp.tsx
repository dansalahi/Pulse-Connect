import { useEffect, useState } from "react";
import { ipc } from "../../lib/ipc/commands";
import type { HotkeyBinding as HotkeyBindingData } from "../../types/hotkeys";
import type { VoiceState as VoiceStateData } from "../../types/voice";

// ---------------------------------------------------------------------------
// Styles (inline — no CSS modules in this entry point)
// ---------------------------------------------------------------------------

const S = {
  root: {
    padding: "12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    minHeight: "100vh",
    background: "#0a0a0a",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: "11px",
    color: "#cccccc",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid #1e1e1e",
    paddingBottom: "8px",
    marginBottom: "2px",
  },
  title: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#FF6B00",
    letterSpacing: "0.05em",
  },
  timestamp: {
    color: "#444444",
    fontSize: "10px",
  },
  card: {
    background: "#111111",
    border: "1px solid #1e1e1e",
    borderRadius: "6px",
    padding: "10px 12px",
  },
  cardTitle: {
    fontSize: "10px",
    fontWeight: 700,
    color: "#666666",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    marginBottom: "8px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "2px 0",
    borderBottom: "1px solid #161616",
  },
  label: {
    color: "#666666",
    flexShrink: 0,
    paddingRight: "12px",
  },
  value: {
    color: "#dddddd",
    textAlign: "right" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: "280px",
  },
  pill: (color: string) => ({
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: "10px",
    fontSize: "10px",
    fontWeight: 700,
    background: `${color}22`,
    color,
  }),
  deviceList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "3px",
    paddingTop: "2px",
  },
  deviceItem: {
    padding: "3px 6px",
    background: "#161616",
    borderRadius: "3px",
    color: "#aaaaaa",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  deviceActive: {
    border: "1px solid #FF6B00",
    color: "#FF6B00",
  },
  note: {
    color: "#444444",
    fontStyle: "italic" as const,
    paddingTop: "4px",
  },
} as const;

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <span style={S.value}>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DebugApp
// ---------------------------------------------------------------------------

export function DebugApp() {
  const [wsConnected, setWsConnected] = useState<boolean | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceStateData | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyBindingData[]>([]);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [ws, voice, keys] = await Promise.all([
        ipc.friends.getWsConnected(),
        ipc.voice.getVoiceState(),
        ipc.hotkeys.getHotkeyBindings(),
      ]);
      setWsConnected(ws);
      setVoiceState(voice);
      setHotkeys(keys);
      setError(null);
    } catch (e) {
      setError(String(e));
    }

    // Audio devices via browser API — no Tauri IPC needed
    if (navigator.mediaDevices?.enumerateDevices) {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setInputDevices(all.filter((d) => d.kind === "audioinput"));
        setOutputDevices(all.filter((d) => d.kind === "audiooutput"));
      } catch { /* enumerateDevices unavailable */ }
    }

    setLastUpdate(new Date().toLocaleTimeString());
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(id);
  }, []); // refresh is stable: defined once, no external deps

  const actionLabels: Record<HotkeyBindingData["action"], string> = {
    Mute:   "Mute / Unmute",
    Deafen: "Deafen",
    Ptt:    "Push-to-Talk",
    Leave:  "Leave Call",
  };

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.title}>PULSE DEBUG</span>
        <span style={S.timestamp}>updated {lastUpdate || "…"}</span>
      </div>

      {error && (
        <div style={{ ...S.card, borderColor: "#7f1d1d", color: "#f87171", fontSize: "10px" }}>
          IPC error: {error}
        </div>
      )}

      {/* WebSocket State */}
      <Card title="WebSocket">
        <Row label="Status">
          {wsConnected === null ? (
            <span style={{ color: "#444" }}>loading…</span>
          ) : wsConnected ? (
            <span style={S.pill("#22c55e")}>connected</span>
          ) : (
            <span style={S.pill("#ef4444")}>disconnected</span>
          )}
        </Row>
        <p style={S.note}>Ping/reconnect counters tracked server-side only.</p>
      </Card>

      {/* Voice State */}
      <Card title="Voice State">
        {voiceState ? (
          <>
            <Row label="In call">
              {voiceState.is_in_call ? (
                <span style={S.pill("#3b82f6")}>yes</span>
              ) : (
                <span style={{ color: "#444" }}>no</span>
              )}
            </Row>
            {voiceState.room_name && (
              <Row label="Room">{voiceState.room_name}</Row>
            )}
            <Row label="Muted">
              <span style={{ color: voiceState.is_muted ? "#ef4444" : "#22c55e" }}>
                {voiceState.is_muted ? "yes" : "no"}
              </span>
            </Row>
            <Row label="Deafened">
              <span style={{ color: voiceState.is_deafened ? "#ef4444" : "#22c55e" }}>
                {voiceState.is_deafened ? "yes" : "no"}
              </span>
            </Row>
            <p style={S.note}>
              Peer identities and WebRTC stats are tracked by livekit-client in the
              main window and are not accessible cross-window without IPC bridging.
            </p>
          </>
        ) : (
          <span style={{ color: "#444" }}>loading…</span>
        )}
      </Card>

      {/* Audio Devices */}
      <Card title="Audio Devices">
        <div style={{ ...S.cardTitle, fontSize: "9px", marginBottom: "4px" }}>INPUT</div>
        <div style={S.deviceList}>
          {inputDevices.length === 0 ? (
            <span style={S.note}>none found (grant mic permission first)</span>
          ) : (
            inputDevices.map((d) => (
              <div
                key={d.deviceId}
                style={d.deviceId === "default" ? { ...S.deviceItem, ...S.deviceActive } : S.deviceItem}
                title={d.deviceId}
              >
                {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
              </div>
            ))
          )}
        </div>

        <div style={{ ...S.cardTitle, fontSize: "9px", marginTop: "8px", marginBottom: "4px" }}>OUTPUT</div>
        <div style={S.deviceList}>
          {outputDevices.length === 0 ? (
            <span style={S.note}>none found</span>
          ) : (
            outputDevices.map((d) => (
              <div
                key={d.deviceId}
                style={d.deviceId === "default" ? { ...S.deviceItem, ...S.deviceActive } : S.deviceItem}
                title={d.deviceId}
              >
                {d.label || `Speaker (${d.deviceId.slice(0, 8)})`}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Hotkey Map */}
      <Card title="Hotkey Map">
        {hotkeys.length === 0 ? (
          <span style={{ color: "#444" }}>no bindings registered</span>
        ) : (
          hotkeys.map((b) => (
            <Row key={b.action} label={actionLabels[b.action] ?? b.action}>
              <kbd style={{
                background: "#1a1a1a",
                border: "1px solid #2e2e2e",
                borderRadius: "3px",
                padding: "1px 6px",
                color: "#dddddd",
                fontFamily: "inherit",
              }}>
                {b.accelerator}
              </kbd>
            </Row>
          ))
        )}
      </Card>
    </div>
  );
}
