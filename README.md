# Pulse Connect

**Real-time voice, presence, and team communication for desktop — built with Tauri 2, React 19, and Rust.**

Pulse Connect is a cross-platform desktop app for people who talk while they work and play: low-latency voice calls, live friend presence, a transparent in-call overlay, and global hotkeys that work even when the app is in the background. Think of it as the communication layer for your team — whether that team is a five-stack queuing into a match or a care group coordinating a shift handoff.

Built by [Daniel Salahi](https://meetdaniel.live) · [GitHub](https://github.com/dansalahi)

---

## Why Pulse Connect

Most voice chat apps are heavyweight, closed, and web-first. Pulse Connect takes a different path: a native desktop shell (Tauri 2) with a Rust core for everything security- and OS-sensitive, and a React 19 frontend for everything else. The result is a small binary, fast cold start, and voice latency that holds up in real use.

- **Voice calls over LiveKit SFU** — Opus at 48 kHz with WebRTC's acoustic echo cancellation and noise suppression
- **Live presence** — see who's Online, In-Game, DND, or Offline over a persistent WebSocket with automatic reconnect and backoff
- **In-call overlay** — a transparent, always-on-top pill with mute/leave controls that stays out of your way
- **Global hotkeys** — rebindable Mute / Deafen / Push-to-Talk / Leave, active system-wide
- **Secure token storage** — refresh tokens live in the OS keychain; access tokens never touch disk
- **Privacy by default** — telemetry is local-only; diagnostics leave your machine only when you export them yourself ([details](./PRIVACY.md))
- **Scales absurdly** — the friends list is virtualized and stays smooth into the millions of entries

## Tech stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri 2.x |
| UI | React 19 + TypeScript + Zustand |
| Core / IPC | Rust (tokio, tracing, thiserror) |
| Voice | LiveKit (SFU), livekit-client, WebRTC |
| Testing | Vitest, cargo test, GitHub Actions CI |

---

## Getting started

You'll need Node.js ≥ 22, pnpm ≥ 11, stable Rust ≥ 1.80, and Docker (for the local LiveKit server). On macOS, the Xcode CLI tools.

```sh
pnpm install
```

Then one command brings up the whole dev environment — Docker LiveKit, the mock backend, and the app itself:

```bash
pnpm dev:all                       # 1 instance
pnpm dev:all -- --debug            # 1 instance with debug window
pnpm dev:all -- --2                # 2 instances, for testing calls with yourself
pnpm dev:all -- --2 --debug:all    # 2 instances, debug window on both
```

Ctrl+C tears everything down cleanly.

### Running pieces by hand

Start the mock backend (HTTP on `:3000`, presence WebSocket on `:3001`):

```sh
cd mock-backend && node index.js
```

Then, in another terminal:

```sh
pnpm tauri dev
```

Sign in with any of the six test accounts — password is `pulse123` for all of them:

| Email | Display name |
|-------|--------------|
| alice@pulse.gg | Alice |
| bob@pulse.gg | Bob |
| charlie@pulse.gg | Charlie |
| diana@pulse.gg | Diana |
| evan@pulse.gg | Evan |
| fiona@pulse.gg | Fiona |

Tip: when testing a two-instance voice call on one machine, wear headphones — shared speakers trip the echo canceller and it will eat your audio.

---

## Tests and linting

```sh
pnpm ci                                       # tsc + eslint + vitest in one go
cd src-tauri && cargo clippy -- -D warnings   # Rust lint, zero warnings policy
cd src-tauri && cargo test                    # 22 tests across 4 suites
```

CI runs the same checks on every push — see `.github/workflows/ci.yml`.

## Building for production

```sh
pnpm tauri build
```

Outputs land in `src-tauri/target/release/bundle/`:

- macOS: `macos/Pulse Connect.app`
- Windows: `msi/Pulse Connect_*.msi`

To run a release build with the debug tools window attached:

```sh
"./src-tauri/target/release/bundle/macos/Pulse Connect.app/Contents/MacOS/pulse-connect" --debug
```

---

## Voice adapters

Voice transport sits behind a Rust `VoiceAdapter` trait, so the whole audio path can be swapped with an environment variable:

```sh
PULSE_VOICE_ADAPTER=stub pnpm tauri dev    # deterministic no-op adapter: no audio, no backend
pnpm tauri dev                             # default: LiveKit
```

The stub adapter logs every call and returns `Ok(())`, which makes CI and integration tests possible without standing up a LiveKit server.

## Debug mode

Launch with `--debug` and a second window opens with live runtime state, refreshed every second: WebSocket connection status, voice state (room / muted / deafened), enumerated audio devices, and the current hotkey map. The debug window is sandboxed away from auth and store APIs and never opens in normal use.

```sh
pnpm tauri dev -- -- --debug
```

## Known issues

- **Overlay vs. macOS fullscreen** — the overlay can't draw above other apps' fullscreen Spaces; use borderless windowed mode. Every user-mode tool (Discord, OBS) shares this limitation.
- **Single-instance lock is off in dev** — deliberately, so you can run two instances for call testing. Re-enable the `tauri_plugin_single_instance` block in `src-tauri/src/lib.rs` before shipping.

## Project layout

```
pulse-connect/
├── dev.sh                    # one-command dev environment
├── mock-backend/             # Express + ws mock server, 6 in-memory users
├── src/                      # React + TypeScript frontend
│   ├── app/                  # App.tsx (routing/auth gate), MainLayout, React root
│   ├── features/             # one slice per domain — components/ store/ types/
│   │   ├── auth/             # login, authStore
│   │   ├── friends/          # virtualized friends list, friendsStore
│   │   ├── voice/            # VoicePage, signalingStore + sessionStore
│   │   ├── overlay/           # in-call overlay pill UI
│   │   └── settings/         # hotkey rebinding UI
│   ├── lib/
│   │   ├── ipc/               # typed Tauri command/event wrappers
│   │   ├── eventBridge.ts    # wires backend events into the Zustand stores
│   │   └── audio/             # dial tone / ringtone playback
│   ├── ui/                   # design-token primitives: Toast, ConfirmDialog, LoadingScreen
│   ├── windows/               # separate React roots: overlay, debug
│   └── tests/                 # Vitest suites
└── src-tauri/                # Rust core
    ├── src/
    │   ├── app/                # setup.rs (startup wiring), state.rs (cold-start timing)
    │   ├── domains/
    │   │   ├── auth/           # login/refresh, keychain token storage
    │   │   ├── friends/       # friend CRUD, presence cache, gateway route handlers
    │   │   ├── voice/          # VoiceAdapter trait, LiveKit + stub adapters
    │   │   ├── overlay/        # overlay window control, NSWindow level
    │   │   ├── hotkeys/        # global shortcuts, PTT lifecycle
    │   │   └── telemetry/     # local breadcrumbs, PII scrubbing, diagnostics export
    │   ├── gateway/            # presence WebSocket lifecycle + message router
    │   ├── shared/             # AppError, IPC input validation
    │   └── lib.rs              # Tauri builder, plugins, panic hook
    └── capabilities/          # per-window permission sets
```

More depth in [ARCHITECTURE.md](./ARCHITECTURE.md) — module map, voice latency budget, overlay strategy, and the reasoning behind the bigger design calls.

## Author

**Daniel Salahi**
Website: [meetdaniel.live](https://meetdaniel.live)
GitHub: [@dansalahi](https://github.com/dansalahi)
