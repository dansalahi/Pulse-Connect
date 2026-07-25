import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { ipc } from "../../../lib/ipc/commands";
import { events } from "../../../lib/ipc/events";
import type { BlockedUser, Friend, MyStatus } from "../types/friends";

interface FriendsState {
  friends: Friend[];
  blockedUsers: BlockedUser[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  wsConnected: boolean;
  myStatus: MyStatus;
}

interface FriendsActions {
  loadFriends: () => Promise<void>;
  addFriend: (userId: string) => Promise<void>;
  acceptFriend: (requestId: string) => Promise<void>;
  rejectFriend: (requestId: string) => Promise<void>;
  removeFriend: (friendId: string) => Promise<void>;
  blockUser: (userId: string) => Promise<void>;
  unblockUser: (userId: string) => Promise<void>;
  loadBlockedUsers: () => Promise<void>;
  setMyStatus: (status: MyStatus, game?: string) => Promise<void>;
  setSearch: (query: string) => void;
  clearError: () => void;
  initListeners: () => Promise<() => void>;
}

type FriendsStore = FriendsState & FriendsActions;

export const useFriendsStore = create<FriendsStore>((set, get) => ({
  friends: [],
  blockedUsers: [],
  isLoading: false,
  error: null,
  searchQuery: "",
  wsConnected: false,
  myStatus: "Online",

  loadFriends: async () => {
    set({ isLoading: true, error: null });
    try {
      const friends = await ipc.friends.getFriends();
      set({ friends, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: String(err) });
    }
  },

  addFriend: async (userId) => {
    const prev = get().friends;
    set((state) => ({
      friends: state.friends.map((f) =>
        f.user_id === userId ? { ...f, is_friend: true } : f,
      ),
    }));
    try {
      await ipc.friends.addFriend(userId);
    } catch (err) {
      set({ friends: prev, error: String(err) });
    }
  },

  acceptFriend: async (requestId) => {
    try {
      await ipc.friends.acceptFriend(requestId);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  rejectFriend: async (requestId) => {
    try {
      await ipc.friends.rejectFriend(requestId);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  removeFriend: async (friendId) => {
    const prev = get().friends;
    // Optimistic: mark as non-friend (stays visible)
    set((state) => ({
      friends: state.friends.map((f) =>
        f.id === friendId ? { ...f, is_friend: false } : f,
      ),
    }));
    try {
      await ipc.friends.removeFriend(friendId);
    } catch (err) {
      set({ friends: prev, error: String(err) });
    }
  },

  blockUser: async (userId) => {
    const prev = get().friends;
    const prevBlocked = get().blockedUsers;
    const userToBlock = get().friends.find((f) => f.user_id === userId);
    // Optimistic: remove from friends list, add to blocked
    set((state) => ({
      friends: state.friends.filter((f) => f.user_id !== userId),
      blockedUsers: userToBlock
        ? [
            ...state.blockedUsers,
            {
              id: userToBlock.user_id,
              display_name: userToBlock.display_name,
              avatar_url: userToBlock.avatar_url,
            },
          ]
        : state.blockedUsers,
    }));
    try {
      await ipc.friends.blockUser(userId);
    } catch (err) {
      set({ friends: prev, blockedUsers: prevBlocked, error: String(err) });
    }
  },

  unblockUser: async (userId) => {
    const prevBlocked = get().blockedUsers;
    set((state) => ({
      blockedUsers: state.blockedUsers.filter((u) => u.id !== userId),
    }));
    try {
      await ipc.friends.unblockUser(userId);
      // Reload friends so the unblocked user reappears
      await get().loadFriends();
    } catch (err) {
      set({ blockedUsers: prevBlocked, error: String(err) });
    }
  },

  loadBlockedUsers: async () => {
    try {
      const blockedUsers = await ipc.friends.getBlockedUsers();
      set({ blockedUsers });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  setMyStatus: async (status, game) => {
    const prevStatus = get().myStatus;
    set({ myStatus: status });
    try {
      await ipc.friends.setMyStatus(status, game ?? null);
    } catch (err) {
      set({ myStatus: prevStatus, error: String(err) });
    }
  },

  setSearch: (query) => set({ searchQuery: query }),

  clearError: () => set({ error: null }),

  initListeners: async () => {
    const unlisteners: UnlistenFn[] = await Promise.all([
      events.listen("presence_update", (f) => {
        // Ignore updates from blocked users
        const blockedIds = new Set(get().blockedUsers.map((u) => u.id));
        if (blockedIds.has(f.user_id)) return;

        const exists = get().friends.some((existing) => existing.user_id === f.user_id);
        if (!exists) {
          // Unknown friend appeared (e.g. came online after initial load) — refresh
          void get().loadFriends();
          return;
        }

        // Update status AND game so the friend moves to the correct group immediately
        set((state) => ({
          friends: state.friends.map((existing) =>
            existing.user_id === f.user_id
              ? { ...existing, status: f.status, game: f.game, display_name: f.display_name }
              : existing,
          ),
        }));
      }),
      events.listen("ws_disconnected", () => set({ wsConnected: false })),
      events.listen("ws_connected", () => set({ wsConnected: true })),
    ]);

    const connected = await ipc.friends.getWsConnected();
    set({ wsConnected: connected });

    return () => unlisteners.forEach((fn) => fn());
  },
}));
