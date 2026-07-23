import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuthStore } from "../store/authStore";
import { useFriendsStore } from "../store/friendsStore";
import { useVoiceStore } from "../store/voiceStore";
import type { Friend, FriendStatus } from "../types/friends";
import styles from "./FriendsPage.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<FriendStatus, string> = {
  Online: "Online",
  InGame: "In Game",
  DND: "Do Not Disturb",
  Offline: "Offline",
};

const STATUS_COLORS: Record<FriendStatus, string> = {
  Online: "#22c55e",
  InGame: "#3b82f6",
  DND: "#ef4444",
  Offline: "#444444",
};

const AVATAR_COLORS = ["#FF6B00", "#3b82f6", "#22c55e", "#8b5cf6"];

const ROW_H = 52;

function stableColorIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(31, h) + id.charCodeAt(i);
  }
  return Math.abs(h) % AVATAR_COLORS.length;
}

// Column layout as inline styles — avoids dynamic CSS class lookup
function colStyle(id: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    avatar:  { flex: "0 0 52px", display: "flex", alignItems: "center", justifyContent: "center" },
    name:    { flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center" },
    status:  { flex: "0 0 100px", display: "flex", alignItems: "center" },
    actions: { flex: "0 0 90px", display: "flex", alignItems: "center", justifyContent: "flex-end" },
  };
  return map[id] ?? {};
}

// ---------------------------------------------------------------------------
// Column helper + cell components
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<Friend>();

function AvatarCell({ friend }: { friend: Friend }) {
  const initials = friend.display_name.slice(0, 2).toUpperCase();
  const bg = AVATAR_COLORS[stableColorIndex(friend.id)];
  return (
    <div className={styles.avatarWrapper}>
      <div className={styles.avatar} style={{ background: bg }}>{initials}</div>
      <div className={styles.statusDot} style={{ background: STATUS_COLORS[friend.status] }} />
    </div>
  );
}

function NameCell({ friend }: { friend: Friend }) {
  return (
    <div className={styles.nameCol}>
      <span className={styles.displayName}>{friend.display_name}</span>
      {friend.status === "InGame" && friend.game && (
        <span className={styles.gameName}>{friend.game}</span>
      )}
    </div>
  );
}

function StatusCell({ status }: { status: FriendStatus }) {
  return (
    <span
      className={styles.statusPill}
      style={{ color: STATUS_COLORS[status], background: `${STATUS_COLORS[status]}1a` }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

interface ActionsCellProps {
  friend: Friend;
  onRemove: () => void;
  onAddFriend: () => void;
  onBlock: () => void;
}

function ActionsCell({ friend, onRemove, onAddFriend, onBlock }: ActionsCellProps) {
  return (
    <div className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
      {friend.is_friend ? (
        <button className={styles.rowBtnRemove} onClick={onRemove}>Remove</button>
      ) : (
        <button className={styles.rowBtnAdd} onClick={onAddFriend}>Add</button>
      )}
      <button className={styles.rowBtnBlock} onClick={onBlock} title="Block">✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonAvatar} />
          <div className={styles.skeletonLines}>
            <div className={styles.skeletonLine} style={{ width: `${40 + (i % 3) * 20}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPlaceholder() {
  return (
    <div className={styles.detailPlaceholder}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#333"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      <p className={styles.detailPlaceholderText}>Select a friend to view details</p>
    </div>
  );
}

interface FriendDetailProps {
  friend: Friend;
  onRemove: () => void;
  onAddFriend: () => void;
  onBlock: () => void;
  onJoinVoice: () => void;
  onCancelCall: () => void;
}

function FriendDetail({ friend, onRemove, onAddFriend, onBlock, onJoinVoice, onCancelCall }: FriendDetailProps) {
  const initials = friend.display_name.slice(0, 2).toUpperCase();
  const avatarColor = AVATAR_COLORS[stableColorIndex(friend.id)];
  const { isInCall, callState, callingTarget } = useVoiceStore();

  const isCallingThisFriend = callState === "calling" && callingTarget?.userId === friend.user_id;
  const canCall = friend.is_friend && (friend.status === "Online" || friend.status === "InGame");
  const voiceDisabled = !canCall || isInCall || (callState === "calling" && !isCallingThisFriend);
  const voiceTitle = !friend.is_friend
    ? "Add this person as a friend to start a call"
    : !canCall
    ? `${friend.display_name} is ${friend.status === "Offline" ? "offline" : "Do Not Disturb"}`
    : isInCall ? "You are already in a call"
    : undefined;

  return (
    <div className={styles.detailContent}>
      <div className={styles.detailAvatar} style={{ background: avatarColor }}>{initials}</div>
      <h2 className={styles.detailName}>{friend.display_name}</h2>
      <div className={styles.detailStatus}>
        <div className={styles.detailStatusDot} style={{ background: STATUS_COLORS[friend.status] }} />
        <span className={styles.detailStatusText}>{STATUS_LABELS[friend.status]}</span>
      </div>
      {friend.status === "InGame" && friend.game && (
        <p className={styles.detailGame}>{friend.game}</p>
      )}
      <div className={styles.detailDivider} />
      <div className={styles.detailActions}>
        {isCallingThisFriend ? (
          <div className={styles.callingRow}>
            <span className={styles.callingLabel}>Calling…</span>
            <button className={styles.cancelCallBtn} onClick={onCancelCall}>Cancel</button>
          </div>
        ) : (
          <div title={voiceTitle}>
            <button
              className={styles.voiceCallBtn}
              disabled={voiceDisabled}
              onClick={onJoinVoice}
            >
              Start Voice Call
            </button>
          </div>
        )}
        {friend.is_friend ? (
          <button className={styles.removeActionBtn} onClick={onRemove}>Remove Friend</button>
        ) : (
          <button className={styles.addActionBtn} onClick={onAddFriend}>Add Friend</button>
        )}
        <button className={styles.blockActionBtn} onClick={onBlock}>Block User</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FriendsPage
// ---------------------------------------------------------------------------

type PendingAction =
  | { kind: "remove"; friendId: string; displayName: string }
  | { kind: "block"; userId: string; displayName: string };

export function FriendsPage() {
  const {
    friends,
    isLoading,
    error,
    searchQuery,
    loadFriends,
    removeFriend,
    addFriend,
    blockUser,
    setSearch,
    clearError,
    initListeners,
  } = useFriendsStore();

  const { joinVoice, cancelCall, error: voiceError, clearVoiceError } = useVoiceStore();
  const { user } = useAuthStore();

  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);

  const tableBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    loadFriends().then(() => setHasLoaded(true));
    initListeners().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtered data fed into the table
  const tableData = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let result = q ? friends.filter((f) => f.display_name.toLowerCase().includes(q)) : friends;
    if (onlineOnly) result = result.filter((f) => f.status === "Online" || f.status === "InGame");
    return result;
  }, [friends, searchQuery, onlineOnly]);

  // Count of Online + InGame friends (for the ONLINE badge)
  const onlineCount = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const base = q ? friends.filter((f) => f.display_name.toLowerCase().includes(q)) : friends;
    return base.filter((f) => f.status === "Online" || f.status === "InGame").length;
  }, [friends, searchQuery]);

  // Column definitions
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "avatar",
        header: "",
        cell: ({ row }) => <AvatarCell friend={row.original} />,
      }),
      columnHelper.accessor("display_name", {
        id: "name",
        header: "Name",
        cell: ({ row }) => <NameCell friend={row.original} />,
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusCell status={getValue()} />,
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <ActionsCell
            friend={row.original}
            onRemove={() => setPending({ kind: "remove", friendId: row.original.id, displayName: row.original.display_name })}
            onAddFriend={() => void addFriend(row.original.user_id)}
            onBlock={() => setPending({ kind: "block", userId: row.original.user_id, displayName: row.original.display_name })}
          />
        ),
      }),
    ],
    [addFriend],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableBodyRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const selectedFriend = useMemo(
    () => (selectedFriendId ? friends.find((f) => f.id === selectedFriendId) ?? null : null),
    [friends, selectedFriendId],
  );

  const handleJoinVoice = useCallback(async () => {
    if (!selectedFriend || !user) return;
    // Use a deterministic room name so both sides join the same LiveKit room
    const roomName = `room-${[user.id, selectedFriend.user_id].sort().join("-")}`;
    console.log("[voice] inviting", selectedFriend.display_name, "→ room:", roomName);
    await joinVoice(selectedFriend.user_id, selectedFriend.display_name, roomName);
  }, [selectedFriend, user, joinVoice]);

  function handleSelectRow(friendId: string) {
    setSelectedFriendId(friendId);
    setShowDetail(true);
  }

  function handleBack() {
    setShowDetail(false);
    setSelectedFriendId(null);
  }

  function handleConfirm() {
    if (!pending) return;
    if (pending.kind === "remove") void removeFriend(pending.friendId);
    else void blockUser(pending.userId);
    setPending(null);
    setShowDetail(false);
    setSelectedFriendId(null);
  }


  return (
    <div className={styles.root}>

      {/* ── List panel ── */}
      <aside className={`${styles.listPanel} ${showDetail ? styles.listSlideOut : ""}`}>

        {/* Search */}
        <div className={styles.searchWrapper}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search friends…"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search friends"
          />
          {searchQuery && (
            <button className={styles.clearBtn} onClick={() => setSearch("")} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        {/* Filter badges: ALL / ONLINE */}
        <div className={styles.filterBadgesRow}>
          <button
            className={`${styles.filterBadge} ${!onlineOnly ? styles.filterBadgeActive : ""}`}
            onClick={() => setOnlineOnly(false)}
          >
            ALL · {friends.length}
          </button>
          <button
            className={`${styles.filterBadge} ${onlineOnly ? styles.filterBadgeActive : ""}`}
            onClick={() => setOnlineOnly(true)}
          >
            <span className={styles.filterBadgeDot} style={{ background: STATUS_COLORS.Online }} />
            ONLINE · {onlineCount}
          </button>
        </div>

        {/* Table */}
        <div className={styles.tableWrapper}>
          {isLoading && !hasLoaded ? (
            <SkeletonRows />
          ) : error ? (
            <div className={styles.listError}>
              <p className={styles.errorText}>{error}</p>
              <button className={styles.retryBtn} onClick={() => { clearError(); void loadFriends(); }}>
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className={styles.tableHeader}>
                {table.getHeaderGroups().map((hg) => (
                  <div key={hg.id} className={styles.headerRow}>
                    {hg.headers.map((h) => (
                      <div key={h.id} style={colStyle(h.id)} className={styles.headerCell}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Virtual body */}
              <div ref={tableBodyRef} className={styles.tableBody}>
                {rows.length === 0 ? (
                  <div className={styles.listEmpty}>
                    <span className={styles.emptyIcon}>👥</span>
                    <p className={styles.emptyText}>
                      {onlineOnly ? "No friends online right now" : "No friends yet"}
                    </p>
                  </div>
                ) : (
                  <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const row = rows[vRow.index];
                      if (!row) return null;
                      const isSelected = row.original.id === selectedFriendId;
                      return (
                        <div
                          key={row.id}
                          className={`${styles.tableRow} ${isSelected ? styles.tableRowSelected : ""}`}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: vRow.size,
                            transform: `translateY(${vRow.start}px)`,
                          }}
                          onClick={() => handleSelectRow(row.original.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectRow(row.original.id); }}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <div key={cell.id} style={colStyle(cell.column.id)}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ── Detail panel ── */}
      <div className={`${styles.detailPanel} ${showDetail ? styles.detailSlideIn : ""}`}>
        {selectedFriend && (
          <button className={styles.backBtn} onClick={handleBack}>← Back</button>
        )}
        {selectedFriend ? (
          <FriendDetail
            key={selectedFriend.id}
            friend={selectedFriend}
            onRemove={() => setPending({ kind: "remove", friendId: selectedFriend.id, displayName: selectedFriend.display_name })}
            onAddFriend={() => void addFriend(selectedFriend.user_id)}
            onBlock={() => setPending({ kind: "block", userId: selectedFriend.user_id, displayName: selectedFriend.display_name })}
            onJoinVoice={() => void handleJoinVoice()}
            onCancelCall={() => void cancelCall()}
          />
        ) : (
          <DetailPlaceholder />
        )}
      </div>

      {voiceError && (
        <ConfirmDialog
          title="Voice Call Error"
          message={voiceError}
          confirmLabel="OK"
          onConfirm={clearVoiceError}
          onCancel={clearVoiceError}
        />
      )}

      {pending?.kind === "remove" && (
        <ConfirmDialog
          title="Remove Friend"
          message={`Are you sure you want to remove ${pending.displayName}? They will remain visible but won't be able to call you.`}
          confirmLabel="Remove"
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === "block" && (
        <ConfirmDialog
          title="Block User"
          message={`Are you sure you want to block ${pending.displayName}? They will be hidden from your friends list.`}
          confirmLabel="Block"
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
