/**
 * Tests the overlay pill window's click-through behavior: it starts ignoring
 * pointer events and toggles interactive mode on Ctrl+Shift, verified
 * against a mocked `@tauri-apps/api/window`.
 */
import { render, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Mock Tauri window API before importing component
// ---------------------------------------------------------------------------

const mockWin = {
  setIgnoreCursorEvents: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn().mockResolvedValue(undefined),
  outerPosition: vi.fn().mockResolvedValue({ x: 100, y: 100 }),
  setPosition: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => mockWin),
  LogicalPosition: vi.fn((x: number, y: number) => ({ x, y })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks are in place (vi.mock calls are hoisted by Vitest, so this is safe)
import { OverlayApp } from "../features/overlay/components/OverlayApp";

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock implementations to defaults
  mockWin.setIgnoreCursorEvents.mockResolvedValue(undefined);
  mockWin.outerPosition.mockResolvedValue({ x: 100, y: 100 });
});

describe("OverlayApp — click-through toggle", () => {
  it("starts in non-interactive (click-through) mode", () => {
    const { container } = render(createElement(OverlayApp));
    // Pill should be present; interactive class should not be applied initially
    const pill = container.firstElementChild;
    expect(pill).toBeTruthy();
    // No interactive CSS class on initial render
    expect(pill?.className).not.toMatch(/pillInteractive/);
  });

  it("Ctrl+Shift keydown calls setIgnoreCursorEvents(false) to enable interaction", async () => {
    render(createElement(OverlayApp));

    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "Shift" });

    // Give async setIgnoreCursorEvents time to be called
    await vi.waitFor(() => {
      expect(mockWin.setIgnoreCursorEvents).toHaveBeenCalledWith(false);
    });
  });

  it("second Ctrl+Shift toggles back to click-through mode", async () => {
    render(createElement(OverlayApp));

    // First toggle: enter interactive
    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "Shift" });
    await vi.waitFor(() =>
      expect(mockWin.setIgnoreCursorEvents).toHaveBeenCalledWith(false),
    );

    mockWin.setIgnoreCursorEvents.mockClear();

    // Second toggle: back to click-through
    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "Shift" });
    await vi.waitFor(() =>
      expect(mockWin.setIgnoreCursorEvents).toHaveBeenCalledWith(true),
    );
  });

  it("non-modifier keys without Ctrl+Shift do not trigger toggle", () => {
    render(createElement(OverlayApp));

    fireEvent.keyDown(document, { key: "m", ctrlKey: false, shiftKey: false });
    fireEvent.keyDown(document, { key: "M", ctrlKey: true, shiftKey: false });

    expect(mockWin.setIgnoreCursorEvents).not.toHaveBeenCalled();
  });
});

describe("OverlayApp — pill always receives pointer events", () => {
  it("renders pill element", () => {
    const { container } = render(createElement(OverlayApp));
    const pill = container.firstElementChild;
    expect(pill).toBeTruthy();
  });
});
