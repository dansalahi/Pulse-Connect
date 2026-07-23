# Pulse Connect — Privacy & Data Practices

## What Pulse Connect stores locally

| Data | Where (macOS / Windows) | Cleared by |
|------|-------------------------|-----------|
| User email (plaintext) | `~/Library/Application Support/live.meetdaniel.pulseconnect/pulse-connect-auth.bin` / `%APPDATA%\live.meetdaniel.pulseconnect\pulse-connect-auth.bin` | Logout |
| Encrypted refresh token | same file (AES-256-GCM) | Logout |
| Hotkey bindings | `.../hotkeys.json` | Reset in Settings |
| Rolling daily log files | `.../logs/pulse-connect.YYYY-MM-DD.log` | Manual or OS retention |
| Crash log | `.../crash.log` | Manual |

**Password is NEVER stored anywhere** — sent once at login over the configured API and discarded immediately.

## What Pulse Connect does NOT do

- No analytics, crash reporting services, or telemetry uploads of any kind.
- No data sent to third-party servers beyond the configured backend API and LiveKit SFU.
- No screen capture, screenshot, or screen recording.
- No keystroke logging outside of registered global hotkeys (Mute / Deafen / PTT / Leave).
- No contact list import, address book access, or browser history scanning.

## Microphone & Audio

- Microphone is accessed **only** when the user actively joins a voice call.
- On first call, macOS / Windows prompts for microphone permission. Denial blocks voice but does not affect other features.
- Audio is **never** recorded or saved to disk. WebRTC streams Opus-encoded frames in real time to the LiveKit SFU and discards them on receipt.
- When muted (toolbar button or hotkey), the microphone track is disabled at the source — no audio leaves the device.
- Disconnecting from a call or quitting the app releases the microphone immediately.

## Presence Visibility

- Status (Online / InGame / DND / Offline) and optional game name are sent to your friends via WebSocket.
- Blocked users receive your status as Offline regardless of actual status.
- Setting status to DND or Offline limits who sees you as available.
- Presence is real-time only — no historical log is kept by the client.

## Diagnostics (user-initiated only)

Settings → Diagnostics creates a local zip file in your Downloads folder containing:
- `breadcrumbs.json` — last 20 in-app activity events (call state changes, IPC calls, errors)
- `system-info.txt` — OS name, architecture, app version, timestamp
- Scrubbed log files — email addresses, auth tokens, and strings ≥ 40 chars replaced with placeholders before inclusion
- `crash.log` — panic records if any

The zip is **never uploaded automatically**. You must manually share it (e.g. attach to a bug report).

## Network Connections

At runtime Pulse Connect connects to:
- Your configured backend API (default: `http://localhost:3000` in dev)
- Your configured WebSocket server (default: `ws://localhost:3001` in dev)
- Your configured LiveKit SFU (default: `ws://localhost:7880` in dev)
- `https://fonts.googleapis.com` and `https://fonts.gstatic.com` for Inter font (CSS + woff2)

No other outbound connections are made.

## Uninstall

Removing the Pulse Connect app does **not** automatically delete the local data folder. To fully remove all stored data:

- **macOS:** `rm -rf ~/Library/Application\ Support/live.meetdaniel.pulseconnect`
- **Windows:** delete `%APPDATA%\live.meetdaniel.pulseconnect`

Keychain entries (production builds using the OS keychain): open **Keychain Access** on macOS or **Credential Manager** on Windows and search for "pulse-connect".
