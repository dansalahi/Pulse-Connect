export interface VoiceState {
  is_in_call: boolean;
  room_name: string | null;
  is_muted: boolean;
  is_deafened: boolean;
}

export interface VoiceJoinResponse {
  token: string;
  url: string;
  room_name: string;
}

export interface IncomingCall {
  fromUserId: string;
  fromDisplayName: string;
  roomName: string;
}

export interface CallingTarget {
  userId: string;
  displayName: string;
  roomName: string;
}

export interface VoiceParticipant {
  identity: string;
  display_name: string;
  is_muted: boolean;
  is_speaking: boolean;
  volume: number; // 0-100
}
