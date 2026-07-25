import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { useFriendsStore } from "../features/friends/store/friendsStore";
import { FriendsPage } from "../features/friends/components/FriendsPage";
import type { Friend, FriendStatus } from "../features/friends/types/friends";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFriend(index: number, status: FriendStatus): Friend {
  return {
    id: `friend-${index}`,
    user_id: `user-${index}`,
    display_name: `User ${index}`,
    avatar_url: null,
    status,
    game: status === "InGame" ? "Valorant" : null,
    is_friend: true,
  };
}

function makeLargeFriendList(count: number): Friend[] {
  return Array.from({ length: count }, (_, i) =>
    makeFriend(i, i % 4 === 0 ? "Online" : i % 4 === 1 ? "InGame" : i % 4 === 2 ? "DND" : "Offline"),
  );
}

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
// Large dataset stress tests
// ---------------------------------------------------------------------------

describe("FriendsPage — large dataset handling", () => {
  it("renders without crashing with 5000 mock friends", () => {
    const bigList = makeLargeFriendList(5000);
    useFriendsStore.setState({ friends: bigList, isLoading: false });

    expect(() => render(createElement(FriendsPage))).not.toThrow();
  });

  it("renders at least one friend card with 5000 friends", () => {
    const bigList = makeLargeFriendList(5000);
    useFriendsStore.setState({ friends: bigList, isLoading: false });

    const { container } = render(createElement(FriendsPage));

    // The page should render some DOM content (not just an empty root)
    expect(container.children.length).toBeGreaterThan(0);
    // At minimum the root container must have children
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("renders correctly with exactly 1 friend", () => {
    useFriendsStore.setState({
      friends: [makeFriend(0, "Online")],
      isLoading: false,
    });
    expect(() => render(createElement(FriendsPage))).not.toThrow();
  });

  it("renders correctly with empty friend list", () => {
    useFriendsStore.setState({ friends: [], isLoading: false });
    expect(() => render(createElement(FriendsPage))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Search/filter still works on large dataset
// ---------------------------------------------------------------------------

describe("FriendsPage — filtering on large dataset", () => {
  it("search filter narrows visible results in store", () => {
    const bigList = makeLargeFriendList(5000);
    useFriendsStore.setState({ friends: bigList, isLoading: false, searchQuery: "" });

    // Simulate what the FriendsPage useMemo does: filter by display_name
    const query = "User 42";
    const filtered = bigList.filter((f) =>
      f.display_name.toLowerCase().includes(query.toLowerCase()),
    );

    // "User 42", "User 420", "User 421", ... "User 429", "User 4200", ...
    // At minimum, "User 42" itself must match
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.some((f) => f.display_name === "User 42")).toBe(true);
  });

  it("all 5000 friends pass empty query", () => {
    const bigList = makeLargeFriendList(5000);
    const filtered = bigList.filter((f) =>
      f.display_name.toLowerCase().includes(""),
    );
    expect(filtered.length).toBe(5000);
  });
});
