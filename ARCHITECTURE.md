# Pulse Connect — Architecture Notes

## Module Map

```
src-tauri/src/
  app/
    setup.rs         Post-build startup: logging, panic hook, window state,
                      hotkey registration, gateway bootstrap, --debug window
    state.rs          APP_START / COLD_START_MS — cold-start timing globals
  domains/
    auth/
      manager.rs      AuthManager — login/logout/refresh, keychain token persistence
      commands.rs     #[tauri::command] wrappers around AuthManager
    friends/
      manager.rs      FriendsManager — friend CRUD, presence cache, gateway route handlers
      commands.rs     #[tauri::command] wrappers around FriendsManager
    voice/
      adapter.rs      VoiceAdapter trait — join/leave/mute/deafen, implementation-agnostic
      livekit.rs      LiveKitAdapter — production adapter, emits voice_* Tauri events
      stub.rs         StubAdapter — deterministic no-op adapter for tests/CI
      manager.rs       VoiceManager — holds the active Arc<dyn VoiceAdapter> + call state
      commands.rs     #[tauri::command] wrappers around VoiceManager
    overlay/
      mod.rs          Overlay window show/hide, macOS NSWindow level elevation
      commands.rs     #[tauri::command] wrappers for overlay control
    hotkeys/
      manager.rs      HotkeyManager — global shortcut registration, PTT lifecycle
      commands.rs     #[tauri::command] wrappers around HotkeyManager
    telemetry/
      breadcrumbs.rs  Breadcrumb ring buffer + scrub_pii
      perf.rs         PerfTracker — sysinfo CPU/memory polling, cold-start capture
      commands.rs     #[tauri::command] wrappers (add_breadcrumb, send_diagnostics, ...)
  gateway/
    mod.rs            Gateway — presence WebSocket lifecycle: connect, auth, reconnect
                      with backoff, ping/pong, clean shutdown
    router.rs         Router — maps inbound WS message type tags to domain handlers
  shared/
    error.rs          AppError enum — typed wire envelope (#[serde(tag="code")])
    validation.rs     validate_string — IPC input length/empty guards
  lib.rs              Tauri builder, state management, invoke_handler registration
  main.rs             Entry point (only place .expect() / .unwrap() is permitted)

src-tauri/tests/
  voice_integration.rs  Integration test exercising VoiceManager through a mock Tauri app

src/
  app/                App.tsx (routing/auth gate), MainLayout.tsx, main.tsx (React root)
  features/
    auth/             LoginPage, authStore (Zustand), auth types
    friends/          FriendsPage (virtualized list), friendsStore, friends types
    voice/             VoicePage, IncomingCallDialog, signalingStore + sessionStore, voice types
    overlay/           OverlayApp — always-on-top pill window UI
    settings/          SettingsPage (hotkey rebinding), hotkeys types
  lib/
    ipc/
      commands.ts     Typed wrappers around every Tauri command, grouped by domain
      events.ts       Typed catalog + listen()/emit() wrappers for every Tauri event
    eventBridge.ts    Wires backend-emitted Tauri events to the Zustand stores
    audio/
      audioService.ts Dial tone / ringtone playback via Web Audio API
  ui/                 Design-token-driven primitives: Toast, ConfirmDialog, LoadingScreen
  windows/
    overlay-main.tsx  Separate React root — always-on-top pill during voice calls
    debug/            Separate React root — opened only with --debug CLI flag
  tests/              Vitest suites: eventBridge, friends store, friends virtualization, overlay

mock-backend/
  index.js           Express + ws, LiveKit JWT issuance, 6 fixed in-memory users
```

---

## Layering

Each Rust domain under `src-tauri/src/domains/` splits into a `manager.rs` (owned
state + business logic, no Tauri command attributes) and a `commands.rs`
(`#[tauri::command]` wrappers that validate input and delegate to the manager).
`lib.rs` wires managers into Tauri's managed state and registers every command
in `invoke_handler!`. The frontend mirrors this with feature slices under
`src/features/<domain>/` — each with its own `components/`, `store/` (Zustand),
and `types/` — plus `src/lib/ipc/commands.ts`, a typed wrapper so no call site
invokes a raw Tauri command string or hand-writes a payload shape.

The presence WebSocket used to live inside the friends domain; it's now
`src-tauri/src/gateway/`, a domain-agnostic connection owner. `Gateway` handles
connect/auth/reconnect/shutdown, and `Router` lets any domain register a
handler for the inbound message type tags it owns (`FriendsManager::register_routes`
registers `presence_update` and the `call_*` signaling tags) without the gateway
knowing about domain-specific payloads — a future domain (e.g. chat) can add a
handler without touching gateway code.

---

## Auth token storage

### Refresh token: OS keychain via `keyring`

`AuthManager` (`src-tauri/src/domains/auth/manager.rs`) stores the refresh
token in the OS keychain (`keyring::Entry`, service `pulse-connect`, keyed by
the user's email). The user's email — non-sensitive — is separately persisted
in `tauri-plugin-store` (`pulse-connect-auth.bin`) purely so `bootstrap()`
knows which keychain entry to look up on next launch. `access_token` is never
written to disk; it lives only in memory as a `secrecy::SecretString`.

If the keychain entry is missing or inaccessible (`NoEntry` /
`NoStorageAccess`), `load_refresh_token` returns `Ok(None)` rather than an
error, and `bootstrap()` treats the session as expired.

**Why keychain over the encrypted-store approach used earlier in the
project's history:** the OS keychain provides real OS-level encryption at
rest and access control per-application; a self-managed encryption scheme
(deriving a key from install-stable inputs, as an earlier iteration did) is
strictly weaker and adds crypto code to maintain. The tradeoff is that
unsigned/dev builds can trigger a keychain-access prompt on some platforms —
acceptable for this project's stage; production builds should be signed.

---

## Voice Adapter Architecture

### `VoiceAdapter` trait (`src-tauri/src/domains/voice/adapter.rs`)

Four async methods — `join_room`, `leave_room`, `set_muted`, `set_deafened` —
each receiving `&tauri::AppHandle` so adapters can emit events without storing
the handle. `VoiceManager` holds `Arc<dyn VoiceAdapter>` (a trait object, not
`Box`, so `VoiceManager` can derive `Clone` for Tauri's `.manage()`) — no
command knows which implementation is active.

### Implementations

| Adapter | File | Purpose | Behaviour |
|---------|------|---------|-----------|
| `LiveKitAdapter` | `livekit.rs` | Production default | Emits `voice_join / voice_leave / voice_muted / voice_deafened` Tauri events; the frontend JS SDK drives WebRTC |
| `StubAdapter` | `stub.rs` | Testing / CI | Logs to `tracing::info!` and returns `Ok(())` — no network, no audio |

### Switching adapters

```sh
PULSE_VOICE_ADAPTER=stub pnpm tauri dev   # stub — no audio, no backend needed
pnpm tauri dev                             # default — LiveKit
```

`VoiceManager::new()` reads `PULSE_VOICE_ADAPTER` once at startup; any value
other than `"stub"` selects LiveKit. New adapters require only a new match
arm — no changes to commands, frontend, or capabilities.

---

## Voice chat

### LiveKit SFU (chosen over webrtc-rs)

LiveKit was chosen over `webrtc-rs` because a 6-peer mesh is 15 connections
per direction over home internet (not robust), and `livekit-server` provides
built-in NetEq, echo cancellation, and a single binary for local dev. The
Rust side is intentionally thin: it fetches a LiveKit JWT and emits
`voice_join`. All WebRTC negotiation happens in the frontend via
`livekit-client`, driven by `src/features/voice/store/sessionStore.ts` (call
media state: mute/deafen/room) and `signalingStore.ts` (call invite/accept/
decline/cancel state machine, wired to the `call_*` gateway events via
`src/lib/eventBridge.ts`).

**Jitter buffer:**
Pulse Connect does not implement its own jitter buffer. LiveKit's NetEq
adaptive jitter buffer runs inside the SFU and inside the browser's
`RTCPeerConnection` stack. NetEq targets 50–100 ms end-to-end latency and
adapts automatically to network conditions. Adding a second jitter buffer in
Rust would increase latency without any quality benefit.

**USB hot-plug:** `navigator.mediaDevices.ondevicechange` triggers
`setMicrophoneEnabled(true)` to re-acquire the default device; failure shows
a toast.

---

## Presence WebSocket — reconnect strategy

`Gateway::ws_loop` (`src-tauri/src/gateway/mod.rs`) reconnects with exponential
backoff capped at 30s, plus up to 1s of random jitter:

```
delay(attempt) = min(1000ms << attempt, 30000ms) + jitter(0..=1000ms)
```

The cap keeps recovery bounded after a long outage; the jitter prevents every
client from reconnecting in lockstep against the backend the instant it comes
back up (a thundering-herd pattern). `attempt` resets to 0 on a successful
connect. A clean app shutdown (`signal_shutdown`) sends a WS close frame and
exits the loop entirely rather than reconnecting, so the backend marks the
user Offline immediately instead of waiting for a timeout.

---

## Voice-Path Latency Budget

End-to-end from speaker A's mouth to listener B's ear:

| Stage | Typical |
|-------|---------|
| Mic capture (OS) | 5–10 ms |
| WebRTC APM (EC/NS/AGC) | 10–15 ms |
| Opus encode (20 ms frame) | 20 ms |
| LiveKit SFU forward | 5–15 ms |
| Network (LAN) | 1–5 ms |
| Network (typical WAN) | 30–80 ms |
| Jitter buffer (NetEq adaptive) | 50–100 ms |
| Opus decode | 5 ms |
| Speaker playback | 5–10 ms |
| **Total (LAN)** | **~100 ms** |
| **Total (WAN)** | **~150–250 ms** |

The dominant variable cost is the jitter buffer, which adapts to network
conditions. NetEq targets the lowest viable depth while maintaining no
audible underruns.

---

## Overlay Strategy

The overlay is a second Tauri window built programmatically in `setup.rs`:
`decorations: false`, `transparent: true`, `alwaysOnTop: true`,
`skipTaskbar: true`, `visible: false` until the user toggles it during a
call. `src/features/overlay/components/OverlayApp.tsx` is a separate React
root (`src/windows/overlay-main.tsx`) — it never shares state or IPC surface
with the main window's React tree.

**Click-through:** `body { pointer-events: none }` by default; pill has
`pointer-events: auto !important`. Ctrl+Shift toggles
`win.setIgnoreCursorEvents(false)`.

**macOS fullscreen:** `NSWindowLevel 25` + `CanJoinAllSpaces |
FullScreenAuxiliary` works above borderless games but not above apps with
their own Mission Control Space (user-mode limit; Discord's Mac overlay
shares it).

**Cross-window IPC:** Frontend `emit()` does not broadcast across windows in
Tauri 2. Overlay buttons invoke Rust commands (`domains/overlay/commands.rs`)
which use `app.emit()` — the only reliable cross-window channel.

---

## Global Hotkeys & Push-to-Talk lifecycle

`HotkeyManager` (`src-tauri/src/domains/hotkeys/manager.rs`) registers Mute,
Deafen, and Leave globally at startup via `start()`. Push-to-Talk is
deliberately excluded from that global registration — its accelerator
defaults to the bare `Space` key, and registering that globally would fire
on every keypress across the whole OS. Instead PTT is registered only while
a call is active: `enable_ptt` (called by the frontend when a call connects)
registers the shortcut, `disable_ptt` (called on call end) unregisters it.

`emit_for` is the only place that distinguishes key-down from key-up:
`Ptt` emits `hotkey_ptt_press` on `Pressed` and `hotkey_ptt_release` on
`Released`, which the frontend maps to unmute-while-held / mute-on-release
(`src/lib/eventBridge.ts`). Every other action only reacts to `Pressed`.

---

## Friends List Virtualization

The friends list (`src/features/friends/components/FriendsPage.tsx`) uses
TanStack Table (`@tanstack/react-table`) with TanStack Virtual
(`@tanstack/react-virtual`) row virtualization — `overscan: 10` rows beyond
the viewport, fixed `estimateSize`. Only the visible rows plus overscan are
mounted in the DOM at any time regardless of total friend count — DOM cost is
constant, not proportional to dataset size, so the architecture scales to
millions of rows without performance degradation.

Chosen over manual virtualization because:
- TanStack Table handles sorting, filtering, and column logic out-of-the-box
- TanStack Virtual integrates natively via `useVirtualizer`
- Both are headless — full control over styling via CSS Modules / design tokens
- Battle-tested in production at large scale (Linear, Vercel, etc.)

The 5k spec test (`src/tests/friends-virtualization.test.ts`) verifies the
list renders without crashing or producing 5000 DOM rows. The same code path
handles 5k, 50k, or 1M rows identically — only the scroll bar metadata
changes. Smooth scroll under real-world presence-update churn is not yet
load-tested (see Self-Critique).

---

## Telemetry & Crash Reporting

**Design principle: local-only, user-initiated. No automatic uploads.**

### Breadcrumb ring buffer

`Telemetry` (managed Tauri state, `src-tauri/src/domains/telemetry/breadcrumbs.rs`)
holds a `Mutex<VecDeque<Breadcrumb>>` capped at 20 entries (`{ timestamp,
category, message }`). Categories: `call_state` (Zustand subscribe on every
transition), `error` (`window.onerror` / `unhandledrejection`), and `ipc`
(login, join_voice, leave_voice).

All breadcrumbs pass through `scrub_pii()` before storage (emails, bearer
tokens, and strings ≥ 40 chars are replaced with placeholders).
`std::panic::set_hook` (installed in `app/setup.rs`) appends a scrubbed line
to `<app-data>/crash.log` on panic. Settings → Diagnostics zips breadcrumbs,
system info, and scrubbed logs into Downloads and opens Finder/Explorer. No
network call is made.

---

## Security notes

**CSP:** `connect-src` hardcodes localhost URLs; update to real hostnames
before shipping. `style-src` allows `fonts.googleapis.com` (Google sees one
request per session; future: vendor fonts locally).

**Capabilities:** `src-tauri/capabilities/` scopes each window's permitted
Tauri APIs separately (`default.json` for the main window, `overlay.json`,
`debug.json`) — the overlay and debug windows never get broader access than
they need.

---

## Skipped Stretch Tasks

### Auto-Update with Delta Patches

`tauri-plugin-updater` + GitHub Releases (`latest.json`, `.app.tar.gz`,
`.msi.zip`). `updater.check()` on startup; `rollout_percentage` field in
`latest.json` for staged rollout. Signing via `tauri signer generate`;
private key in CI secret. Not implemented: signing + release pipeline adds
no architectural insight for the project's current scope.

### Screen-Share Thumbnail

`xcap` crate (Windows) / `ScreenCaptureKit` FFI (macOS 13+) for capture;
transparent fullscreen Tauri window for region select; 5 fps tokio task
encoding H.264 via x264; LiveKit video track publish. Not implemented:
libvpx/x264 binding setup plus region-select UI is a multi-day effort, ranked
below voice and overlay in priority.

---

## Next Steps

1. Sign the macOS build (removes the keychain-access prompt on unsigned dev builds).
2. Implement Auto-Update once a release server exists.
3. Production CSP: replace localhost `connect-src` with real hostnames; vendor Google Fonts locally.
4. Wire the `specta` export pipeline to auto-generate TypeScript types from Rust structs.
5. Add server-side presence persistence so users see correct status after reconnect.
6. Investigate NSPanel-based overlay on macOS to clear the fullscreen Space limitation.

---

## Self-Critique

**LiveKit over webrtc-rs.** A 6-peer mesh is 15 connections per direction —
not robust over home internet. `VoiceAdapter` keeps the webrtc-rs path open.

**Single-instance plugin disabled** for two-instance demo testing (see the
commented-out block in `lib.rs`); re-enable before shipping.

**Mock backend is in-memory.** Restarts wipe state; production needs Postgres + Redis.

**No load testing.** Friends-list passes the 5k render test but untested under presence-update churn.
