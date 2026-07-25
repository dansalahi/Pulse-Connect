export type FriendStatus = "Online" | "InGame" | "DND" | "Offline";

export type MyStatus = "Online" | "InGame" | "DND";

export interface Friend {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  status: FriendStatus;
  game: string | null;
  is_friend: boolean;
}

export interface FriendRequest {
  id: string;
  from_user_id: string;
  from_display_name: string;
  from_avatar_url: string | null;
  created_at: string;
}

export interface BlockedUser {
  id: string;
  display_name: string;
  avatar_url: string | null;
}
