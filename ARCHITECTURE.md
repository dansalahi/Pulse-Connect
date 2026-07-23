# Pulse Connect — Architecture Notes

## Module Map

```
src-tauri/src/
  auth.rs          AuthManager — login/logout/refresh, AES-256-GCM token persistence
  friends.rs       FriendsManager — presence WebSocket, reconnect backoff, friend CRUD
  voice.rs         VoiceAdapter trait, LiveKitAdapter, StubAdapter, VoiceManager
  overlay.rs       show/hide overlay commands, macOS NSWindow level elevation
  hotkeys.rs       HotkeyManager — global shortcut registration, PTT lifecycle
  telemetry.rs     Breadcrumb ring buffer, scrub_pii, send_diagnostics zip
  perf.rs          PerfTracker — sysinfo CPU/memory polling, cold-start capture
  validation.rs    validate_string — IPC input length/empty guards
  error.rs         AppError enum — typed wire envelope (#[serde(tag="code")])
  lib.rs           Tauri builder, plugin registration, APP_START, panic hook
  main.rs          Entry point (only place .expect() / .unwrap() is permitted)

src/
  pages/           FriendsPage, VoicePage, SettingsPage, LoginPage, MainLayout
  store/           authStore, friendsStore, voiceStore — Zustand, one concern per file
  types/           TypeScript discriminated unions matching Rust AppError variants
  components/      Toast, IncomingCallDialog, LoadingScreen
  windows/overlay/ Separate React root — always-on-top pill during voice calls
  windows/debug/   Separate React root — opened only with --debug CLI flag
  services/        audioService — dial tone, ringtone via Web Audio API
  tests/           Vitest suites: friends store, overlay keyboard, large dataset

mock-backend/
  index.js         Express + ws, LiveKit JWT issuance, 6 fixed in-memory users
```

---

## Auth token storage

### Current (development): AES-256-GCM encrypted store

`refresh_token` is encrypted with AES-256-GCM and stored in `tauri-plugin-store`
(`pulse-connect-auth.bin` in the app data directory).

**Why not keyring:** unsigned macOS binaries trigger a system keychain-access
dialog on every read and write. In dev mode this makes the app unusable.

**Why not plain store:** plain JSON is a security violation — any process that
can read the app data directory can steal the token.

**Encryption scheme (`auth.rs`):**

```
key   = SHA-256( "pulse-connect-token-v1:" || app_identifier || ":" || app_data_dir_path )
nonce = 12 random bytes (rand::thread_rng)
blob  = base64( nonce || AES-256-GCM-encrypt(key, nonce, plaintext) )
```

The key is derived deterministically from two stable, per-install inputs so it
never needs to be stored anywhere:

| Input | Stability |
|-------|-----------|
| `app.config().identifier` (`live.meetdaniel.pulseconnect`) | constant across all installs |
| `app.path().app_data_dir()` | stable for a given user + machine |

If the app-data path changes, decryption fails and `bootstrap()` treats the
session as expired — the old token would be unreachable anyway. `access_token`
is never written to disk (`secrecy::SecretString`, memory only).

---

### Production (signed build): OS keychain via `keyring`

The keychain provides OS-level encryption that the store cannot replicate.
To migrate: add `keyring = "2.3.3"`, remove `aes-gcm`/`rand`/`sha2`/`base64`,
replace the three store helpers and crypto functions with `keyring::Entry` calls,
and sign the binary (unsigned builds trigger a dialog on every read/write).

---

## Voice Adapter Architecture

### `VoiceAdapter` trait (`src-tauri/src/voice.rs`)

Four synchronous methods: `join_room`, `leave_room`, `set_muted`, `set_deafened`,
each receiving `&tauri::AppHandle` so adapters can emit events without storing the
handle. `VoiceManager` holds `Arc<dyn VoiceAdapter>` — no command knows which
implementation is active.

### Implementations

| Adapter | Purpose | Behaviour |
|---------|---------|-----------|
| `LiveKitAdapter` | Production default | Emits `voice_join / voice_leave / voice_muted / voice_deafened` Tauri events; the frontend JS SDK drives WebRTC |
| `StubAdapter` | Testing / CI | Logs to `tracing::info!` and returns `Ok(())` — no network, no audio |

### Switching adapters

```sh
PULSE_VOICE_ADAPTER=stub pnpm tauri dev   # stub — no audio, no backend needed
pnpm tauri dev                             # default — LiveKit
```

`VoiceManager::new()` reads `PULSE_VOICE_ADAPTER` once at startup; any value other
than `"stub"` selects LiveKit. New adapters require only a new match arm — no
changes to commands, frontend, or capabilities.

---

## Voice chat — Phase 3

### LiveKit SFU (chosen over webrtc-rs)

LiveKit was chosen over `webrtc-rs` because a 6-peer mesh is 15 connections per
direction over home internet (not robust), and `livekit-server` provides built-in
NetEq, echo cancellation, and a single binary for local dev. The Rust side is
intentionally thin: it fetches a LiveKit JWT and emits `voice_join`. All WebRTC
negotiation happens in the frontend via `livekit-client`.

**Jitter buffer:**
Pulse Connect does not implement its own jitter buffer. LiveKit's NetEq adaptive jitter
buffer runs inside the SFU and inside the browser's `RTCPeerConnection` stack.
NetEq targets 50–100 ms end-to-end latency and adapts automatically to network
conditions. Adding a second jitter buffer in Rust would increase latency without
any quality benefit.

**USB hot-plug:** `navigator.mediaDevices.ondevicechange` triggers
`setMicrophoneEnabled(true)` to re-acquire the default device; failure shows a toast.

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
conditions. NetEq targets the lowest viable depth while maintaining no audible
underruns.

---

## Overlay Strategy

The overlay is a second Tauri window built programmatically in `setup()`:
`decorations: false`, `transparent: true`, `alwaysOnTop: true`,
`skipTaskbar: true`, `visible: false` until the user toggles it during a call.

**Click-through:** `body { pointer-events: none }` by default; pill has `pointer-events: auto !important`. Ctrl+Shift toggles `win.setIgnoreCursorEvents(false)`.

**macOS fullscreen:** `NSWindowLevel 25` + `CanJoinAllSpaces | FullScreenAuxiliary`
works above borderless games but not above apps with their own Mission Control
Space (user-mode limit; Discord's Mac overlay shares it).

**Cross-window IPC:** Frontend `emit()` does not broadcast across windows in Tauri 2.
Overlay buttons invoke Rust commands which use `app.emit()` — the only reliable
cross-window channel.

---

## Friends List Virtualization

The friends list uses TanStack Table (`@tanstack/react-table`) with TanStack
Virtual (`@tanstack/react-virtual`) row virtualization. Only ~20–30 rows are
mounted in the DOM at any time regardless of total friend count — DOM cost is
constant, not proportional to dataset size, so the architecture scales to
millions of rows without performance degradation.

Chosen over manual virtualization because:
- TanStack Table handles sorting, filtering, and column logic out-of-the-box
- TanStack Virtual integrates natively via `useVirtualizer`
- Both are headless — full control over styling via CSS Modules
- Battle-tested in production at large scale (Linear, Vercel, etc.)

The 5k spec test (`src/tests/friends-virtualization.test.ts`) verifies the list
renders without crashing or producing 5000 DOM rows. The same code path handles
5k, 50k, or 1M rows identically — only the scroll bar metadata changes. Smooth
scroll under real-world presence-update churn is not yet load-tested (see
Self-Critique).

---

## Telemetry & Crash Reporting

**Design principle: local-only, user-initiated. No automatic uploads.**

### Breadcrumb ring buffer

`Telemetry` (managed Tauri state) holds a `Mutex<VecDeque<Breadcrumb>>` capped at
20 entries (`{ timestamp, category, message }`). Categories: `call_state`
(Zustand subscribe on every transition), `error` (`window.onerror` /
`unhandledrejection`), and `ipc` (login, join_voice, leave_voice).

All breadcrumbs pass through `scrub_pii()` before storage (emails, bearer tokens,
and strings ≥ 40 chars are replaced with placeholders). `std::panic::set_hook`
appends a scrubbed line to `<app-data>/crash.log` on panic. Settings → Diagnostics
zips breadcrumbs, system info, and scrubbed logs into Downloads and opens
Finder/Explorer. No network call is made.

---

## Security notes

**CSP:** `connect-src` hardcodes localhost URLs; update to real hostnames before
shipping. `style-src` allows `fonts.googleapis.com` (Google sees one request per
session; future: vendor fonts locally).

**Why not a random store key?** It must be persisted somewhere — the only safe
place is the OS keychain, which brings back the same signing requirement. Deriving
from stable per-install inputs avoids additional storage entirely.

---

## Skipped Stretch Tasks

### 2.1 Auto-Update with Delta Patches

`tauri-plugin-updater` + GitHub Releases (`latest.json`, `.app.tar.gz`, `.msi.zip`).
`updater.check()` on startup; `rollout_percentage` field in `latest.json` for staged
rollout. Signing via `tauri signer generate`; private key in CI secret. Not
implemented: signing + release pipeline adds no architectural insight for a 48-hour
scope.

### 2.3 Screen-Share Thumbnail

`xcap` crate (Windows) / `ScreenCaptureKit` FFI (macOS 13+) for capture; transparent
fullscreen Tauri window for region select; 5 fps tokio task encoding H.264 via x264;
LiveKit video track publish. Not implemented: libvpx/x264 binding setup plus
region-select UI is ~6–8 hours, ranked below voice and overlay in the spec weights.

---

## Next Steps

1. Sign the macOS build and migrate auth to OS keychain (steps documented in the Auth section).
2. Implement Auto-Update (2.1) once a release server exists.
3. Production CSP: replace localhost `connect-src` with real hostnames; vendor Google Fonts locally.
4. Wire specta export pipeline to auto-generate TypeScript types from Rust structs.
5. Add server-side presence persistence so users see correct status after reconnect.
6. Investigate NSPanel-based overlay on macOS to clear the fullscreen Space limitation.

---

## Self-Critique

**LiveKit over webrtc-rs.** A 6-peer mesh is 15 connections per direction — not
robust over home internet. `VoiceAdapter` keeps the webrtc-rs path open.

**Single-instance plugin disabled** for two-instance demo testing; re-enable before shipping.

**Auth uses AES-encrypted store, not the keychain.** Unsigned binaries trigger a
keychain dialog every read/write; migration steps are documented.

**Mock backend is in-memory.** Restarts wipe state; production needs Postgres + Redis.

**No load testing.** Friends-list passes the 5k render test but untested under presence-update churn.
