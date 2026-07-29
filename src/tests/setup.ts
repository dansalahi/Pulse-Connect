/**
 * Global Vitest setup (registered in the Vitest config) — stubs the Tauri
 * `core`/`event` APIs so every test file runs against mocked invoke/listen
 * instead of a real Tauri backend.
 */
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  // Default to empty array so loadFriends doesn't write undefined into the store
  invoke: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
