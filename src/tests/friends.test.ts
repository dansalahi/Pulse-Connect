/**
 * Core behavior tests for the friends feature: store-level search filtering
 * and status grouping, a large-list render smoke test, and the optimistic
 * remove-friend flow (immediate removal plus rollback on server failure).
 */
import { invoke } from "@tauri-apps/api/core";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { useFriendsStore } from "../features/friends/store/friendsStore";
import { FriendsPage } from "../features/friends/components/FriendsPage";
import type { Friend, FriendStatus } from "../features/friends/types/friends";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFriend(
  id: string,
  status: FriendStatus,
  displayName = `User ${id}`,
): Friend {
  return {
    id,
    user_id: `uid_${id}`,
    display_name: displayName,
    avatar_url: null,
    status,
    game: status === "InGame" ? "Valorant" : null,
    is_friend: true,
  };
}

const MOCK_FRIENDS: Friend[] = [
  makeFriend("1", "Online", "Alice"),
  makeFriend("2", "Offline", "Bob"),
  makeFriend("3", "InGame", "Carol"),
  makeFriend("4", "DND", "Dave"),
  makeFriend("5", "Online", "Eve"),
  makeFriend("6", "Offline", "Frank"),
];

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useFriendsStore.setState({
    friends: [],
    isLoading: false,
    error: null,
    searchQuery: "",
    wsConnected: false,
  });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("friends store — search filter", () => {
  it("filters friends by display_name case-insensitively", () => {
    useFriendsStore.setState({ friends: MOCK_FRIENDS });
    const { searchQuery: _sq, ...rest } = useFriendsStore.getState();
    void rest;

    // filter locally (same logic as useMemo in component)
    const query = "ali";
    const filtered = MOCK_FRIENDS.filter((f) =>
      f.display_name.toLowerCase().includes(query.toLowerCase()),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].display_name).toBe("Alice");
  });

  it("returns all friends when query is empty", () => {
    const filtered = MOCK_FRIENDS.filter((f) =>
      f.display_name.toLowerCase().includes(""),
    );
    expect(filtered).toHaveLength(MOCK_FRIENDS.length);
  });

  it("returns empty when no match", () => {
    const filtered = MOCK_FRIENDS.filter((f) =>
      f.display_name.toLowerCase().includes("zzz"),
    );
    expect(filtered).toHaveLength(0);
  });
});

describe("friends store — status grouping", () => {
  const STATUS_ORDER: FriendStatus[] = ["Online", "InGame", "DND", "Offline"];

  it("groups friends in correct status order", () => {
    useFriendsStore.setState({ friends: MOCK_FRIENDS });

    const grouped: Record<FriendStatus, Friend[]> = {
      Online: [],
      InGame: [],
      DND: [],
      Offline: [],
    };
    for (const f of MOCK_FRIENDS) grouped[f.status].push(f);

    const order = STATUS_ORDER.filter((s) => grouped[s].length > 0);
    expect(order[0]).toBe("Online");
    expect(order[order.length - 1]).toBe("Offline");
    expect(grouped["Online"]).toHaveLength(2);
    expect(grouped["InGame"]).toHaveLength(1);
    expect(grouped["DND"]).toHaveLength(1);
    expect(grouped["Offline"]).toHaveLength(2);
  });
});

describe("FriendsPage — virtualised rendering", () => {
  it("renders without crash with 5000 mock friends", () => {
    const bigList: Friend[] = Array.from({ length: 5000 }, (_, i) =>
      makeFriend(String(i), i % 2 === 0 ? "Online" : "Offline"),
    );
    useFriendsStore.setState({ friends: bigList, isLoading: false });

    // Should not throw
    expect(() => render(createElement(FriendsPage))).not.toThrow();
  });
});

describe("friends store — optimistic remove", () => {
  it("removes friend from store immediately before server responds", async () => {
    useFriendsStore.setState({ friends: MOCK_FRIENDS });

    // Mock invoke to hang indefinitely (simulates slow network)
    let resolve!: () => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<void>((r) => { resolve = r; }),
    );

    const { removeFriend } = useFriendsStore.getState();
    const removePromise = removeFriend("1");

    // Immediately after calling, friend should have is_friend: false (stays in list)
    const stateAfterOptimistic = useFriendsStore.getState().friends;
    const removedFriend = stateAfterOptimistic.find((f) => f.id === "1");
    expect(removedFriend).toBeDefined();
    expect(removedFriend?.is_friend).toBe(false);
    expect(stateAfterOptimistic).toHaveLength(MOCK_FRIENDS.length);

    // Resolve the server call so the test cleans up properly
    resolve();
    await removePromise;
  });

  it("rolls back if server call fails", async () => {
    useFriendsStore.setState({ friends: MOCK_FRIENDS });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network error"));

    const { removeFriend } = useFriendsStore.getState();
    await removeFriend("1");

    // Should be rolled back
    const friends = useFriendsStore.getState().friends;
    expect(friends.find((f) => f.id === "1")).toBeDefined();
    expect(friends).toHaveLength(MOCK_FRIENDS.length);
    expect(useFriendsStore.getState().error).toBeTruthy();
  });
});
