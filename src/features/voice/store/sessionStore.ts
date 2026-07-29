/**
 * Zustand store owning the live LiveKit room/session once signalingStore
 * reaches "connected": device selection, mute/deafen, speaking detection,
 * and mirroring participant state to the overlay window.
 */
import { create } from "zustand";
import { ipc } from "../../../lib/ipc/commands";
import { events } from "../../../lib/ipc/events";
import {
  Room,
  RoomEvent,
  RemoteAudioTrack,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteParticipant,
  type LocalParticipant,
} from "livekit-client";
import { toast } from "../../../ui/Toast";
import { audioService } from "../../../lib/audio/audioService";
import { useSignalingStore } from "./signalingStore";
import type { VoiceJoinResponse, VoiceParticipant } from "../types/voice";

// ---------------------------------------------------------------------------
// setSinkId is a non-standard extension missing from older TS DOM types.
// ---------------------------------------------------------------------------

interface AudioSinkElement extends HTMLAudioElement {
  setSinkId(sinkId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Store interfaces
// ---------------------------------------------------------------------------

interface SessionState {
  isInCall: boolean;
  roomName: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  participants: VoiceParticipant[];
  room: Room | null;
  error: string | null;
  // Device management
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  selectedInputId: string;
  selectedOutputId: string;
  isOverlayVisible: boolean;
  currentAudioTrack: LocalAudioTrack | null;
}

interface SessionActions {
  // Called by signalingStore once a call has been accepted, to establish the
  // LiveKit connection. friendId is the other party's user id.
  connectToRoom: (friendId: string, roomName: string) => Promise<void>;
  leaveVoice: () => Promise<void>;
  loadDevices: () => Promise<void>;
  setInputDevice: (deviceId: string) => Promise<void>;
  setOutputDevice: (deviceId: string) => Promise<void>;
  toggleMute: () => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  toggleDeafen: () => Promise<void>;
  setParticipantVolume: (identity: string, volume: number) => void;
  clearVoiceError: () => void;
  toggleOverlay: () => void;
  // Invite a friend into the current call
  inviteFriend: (friendId: string, displayName: string) => Promise<void>;
}

type SessionStore = SessionState & SessionActions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  try { return JSON.stringify(error); } catch { return String(error); }
}

function participantFromLK(
  p: RemoteParticipant | LocalParticipant,
  isSpeaking: boolean,
): VoiceParticipant {
  const firstPub = p.audioTrackPublications.values().next().value;
  return {
    identity: p.identity,
    display_name: p.name ?? p.identity,
    is_muted: firstPub?.isMuted ?? false,
    is_speaking: isSpeaking,
    volume: 100,
  };
}

// Interval for local audio-level speaking detection
let speakingPollHandle: ReturnType<typeof setInterval> | null = null;
// Guard against concurrent toggleMute calls (e.g. double-registered listener in StrictMode)
let muteToggleInProgress = false;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSessionStore = create<SessionStore>((set, get) => {

  // Establish the LiveKit connection. Called once signaling has transitioned
  // to "connected" — see signalingStore's acceptCall / handleCallAccepted.
  async function connectToRoom(friendId: string, roomName: string) {
    let resp: VoiceJoinResponse;
    try {
      resp = await ipc.voice.joinVoice(roomName, friendId);
      console.log("[voice] token received:", { url: resp.url, room_name: resp.room_name });
    } catch (error: unknown) {
      const msg = readError(error);
      console.error("[voice] join_voice failed:", error);
      audioService.stopAll();
      useSignalingStore.getState().resetToIdle();
      set({ error: msg });
      return;
    }

    const lkUrl = resp.url;
    const lkToken = resp.token;
    console.log("[voice] connecting to LiveKit:", lkUrl);

    if (!lkUrl?.startsWith("ws")) {
      audioService.stopAll();
      useSignalingStore.getState().resetToIdle();
      set({ error: `Invalid LiveKit URL: "${lkUrl}"` });
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      audioService.stopAll();
      useSignalingStore.getState().resetToIdle();
      set({ error: "Microphone not available. Check System Preferences → Privacy → Microphone." });
      return;
    }

    // Explicitly request microphone permission before LiveKit connects.
    // This triggers the macOS permission dialog; LiveKit will re-acquire the
    // device itself, so we release the stream immediately after the prompt.
    try {
      const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permStream.getTracks().forEach((t) => t.stop());
      console.log("[voice] microphone permission granted");
    } catch (error: unknown) {
      audioService.stopAll();
      useSignalingStore.getState().resetToIdle();
      set({ error: `Microphone permission denied: ${readError(error)}` });
      return;
    }

    const room = new Room({
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48_000,
      },
      audioOutput: {
        deviceId: get().selectedOutputId || undefined,
      },
    });

    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      set((s) => ({ participants: [...s.participants, participantFromLK(p, false)] }));
    });
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      set((s) => ({ participants: s.participants.filter((x) => x.identity !== p.identity) }));
      // End the call when the last remote participant leaves
      if (room.remoteParticipants.size === 0) {
        toast("Call ended", "info");
        void get().leaveVoice();
      }
    });
    // Keep server-side VAD for remote participants only
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const remoteIds = new Set(
        speakers
          .filter((s) => s.identity !== room.localParticipant.identity)
          .map((s) => s.identity),
      );
      set((s) => ({
        participants: s.participants.map((p) =>
          p.identity === room.localParticipant.identity
            ? p // local is handled by the 100 ms audio-level poll below
            : { ...p, is_speaking: remoteIds.has(p.identity) },
        ),
      }));
    });
    room.on(RoomEvent.TrackMuted, (pub, p) => {
      if (pub.kind !== "audio") return;
      if (p.identity === room.localParticipant.identity) return;
      set((s) => ({ participants: s.participants.map((x) => x.identity === p.identity ? { ...x, is_muted: true } : x) }));
    });
    room.on(RoomEvent.TrackUnmuted, (pub, p) => {
      if (pub.kind !== "audio") return;
      if (p.identity === room.localParticipant.identity) return;
      set((s) => ({ participants: s.participants.map((x) => x.identity === p.identity ? { ...x, is_muted: false } : x) }));
    });
    room.on(RoomEvent.Disconnected, () => { void get().leaveVoice(); });

    try {
      await room.connect(lkUrl, lkToken);
      console.log("[voice] connected to LiveKit");
    } catch (error: unknown) {
      console.error("[voice] room.connect failed:", error);
      audioService.stopAll();
      useSignalingStore.getState().resetToIdle();
      set({ error: `Could not connect: ${readError(error)}` });
      return;
    }

    let publishedAudioTrack: LocalAudioTrack | null = null;
    try {
      const audioTrack = await createLocalAudioTrack({
        deviceId: get().selectedInputId || undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48_000,
      });
      await room.localParticipant.publishTrack(audioTrack);
      publishedAudioTrack = audioTrack;
      console.log("[voice] audio track published");

      // Poll local audio level every 100 ms.
      // Threshold > 0.01 → speaking; below threshold for 300 ms → silent.
      // This is lower-latency and more sensitive than LiveKit's server-side VAD.
      let silenceSince: number | null = null;
      const localId = room.localParticipant.identity;
      speakingPollHandle = setInterval(() => {
        const level = room.localParticipant.audioLevel;
        if (level > 0.01) {
          silenceSince = null;
          set((s) => ({
            participants: s.participants.map((p) =>
              p.identity === localId ? { ...p, is_speaking: true } : p,
            ),
          }));
        } else {
          if (silenceSince === null) silenceSince = Date.now();
          if (Date.now() - silenceSince >= 300) {
            set((s) => ({
              participants: s.participants.map((p) =>
                p.identity === localId ? { ...p, is_speaking: false } : p,
              ),
            }));
          }
        }
      }, 100);
    } catch (error: unknown) {
      console.error("[voice] audio track failed (non-fatal):", error);
      set({ error: `Microphone error: ${readError(error)}` });
    }

    const remotes = Array.from(room.remoteParticipants.values()).map((p) => participantFromLK(p, false));
    // Use name from JWT token (set by the mock backend when creating the token)
    const local: VoiceParticipant = {
      identity: room.localParticipant.identity,
      display_name: room.localParticipant.name ?? room.localParticipant.identity,
      is_muted: false,
      is_speaking: false,
      volume: 100,
    };

    set({
      isInCall: true,
      roomName: resp.room_name,
      isMuted: false,
      isDeafened: false,
      room,
      participants: [local, ...remotes],
      currentAudioTrack: publishedAudioTrack,
    });

    // Register PTT shortcut only while in a call so bare keys (e.g. Space) don't
    // fire outside of calls.
    try { await ipc.hotkeys.enablePttHotkey(); } catch { /* best-effort */ }

    toast("Connected to call", "success");
  }

  return {
    // ── state defaults ─────────────────────────────────────────────────────
    isInCall: false,
    roomName: null,
    isMuted: false,
    isDeafened: false,
    participants: [],
    room: null,
    error: null,
    inputDevices: [],
    outputDevices: [],
    selectedInputId: "",
    selectedOutputId: "",
    currentAudioTrack: null,
    isOverlayVisible: false,

    clearVoiceError: () => set({ error: null }),
    toggleOverlay: () => {
      const next = !get().isOverlayVisible;
      set({ isOverlayVisible: next });
      if (next) {
        void ipc.overlay.showOverlay().then(() => {
          // Push current state immediately after the overlay window appears
          const s = get();
          void events.emit("overlay_update", {
            participants: s.participants.map((p) => ({
              identity: p.identity,
              display_name: p.display_name,
              is_muted: p.is_muted,
              is_speaking: p.is_speaking,
            })),
            room_name: s.roomName ?? "",
            is_muted: s.isMuted,
          });
        });
      } else {
        void ipc.overlay.hideOverlay();
      }
    },

    connectToRoom,

    // ── In-call controls ───────────────────────────────────────────────────
    leaveVoice: async () => {
      // Stop audio-level poll before disconnecting
      if (speakingPollHandle !== null) {
        clearInterval(speakingPollHandle);
        speakingPollHandle = null;
      }
      const { room, currentAudioTrack } = get();
      if (currentAudioTrack) {
        if (room) { try { await room.localParticipant.unpublishTrack(currentAudioTrack); } catch { /* ignore */ } }
        currentAudioTrack.stop();
      }
      if (room) await room.disconnect();
      audioService.stopAll();
      try { await ipc.voice.leaveVoice(); } catch { /* ignore */ }
      // Unregister PTT so Space (or whatever key) works normally outside calls
      try { await ipc.hotkeys.disablePttHotkey(); } catch { /* ignore */ }
      // Auto-hide overlay when the call ends
      if (get().isOverlayVisible) {
        try { await ipc.overlay.hideOverlay(); } catch { /* ignore */ }
        set({ isOverlayVisible: false });
      }
      set({ isInCall: false, roomName: null, isMuted: false, isDeafened: false, room: null, participants: [], currentAudioTrack: null });
      useSignalingStore.getState().resetToIdle();
      toast("Left call", "info");
    },

    toggleMute: async () => {
      if (muteToggleInProgress) return;
      muteToggleInProgress = true;
      try {
        const { isMuted, room } = get();
        const next = !isMuted;
        const localIdentity = room?.localParticipant.identity;
        set({
          isMuted: next,
          participants: get().participants.map((p) =>
            p.identity === localIdentity ? { ...p, is_muted: next } : p,
          ),
        });
        if (room?.localParticipant) await room.localParticipant.setMicrophoneEnabled(!next);
        try { await ipc.voice.setMuted(next); } catch { /* best-effort */ }
      } finally {
        muteToggleInProgress = false;
      }
    },

    // Absolute (not toggling) mute setter — used for push-to-talk, where the
    // Rust hotkey manager fires hotkey_ptt_press/hotkey_ptt_release on
    // key-down/key-up (see eventBridge.ts) and each edge must force a known
    // state rather than flip whatever toggleMute last left it in.
    setMuted: async (muted: boolean) => {
      if (muteToggleInProgress) return;
      muteToggleInProgress = true;
      try {
        const { isMuted, room } = get();
        if (isMuted === muted) return;
        const localIdentity = room?.localParticipant.identity;
        set({
          isMuted: muted,
          participants: get().participants.map((p) =>
            p.identity === localIdentity ? { ...p, is_muted: muted } : p,
          ),
        });
        if (room?.localParticipant) await room.localParticipant.setMicrophoneEnabled(!muted);
        try { await ipc.voice.setMuted(muted); } catch { /* best-effort */ }
      } finally {
        muteToggleInProgress = false;
      }
    },

    toggleDeafen: async () => {
      const { isDeafened, room } = get();
      const next = !isDeafened;
      set({ isDeafened: next });
      if (room) {
        room.remoteParticipants.forEach((p) => {
          p.audioTrackPublications.forEach((pub) => {
            if (pub.track instanceof RemoteAudioTrack) pub.track.setVolume(next ? 0 : 1);
          });
        });
      }
      try { await ipc.voice.setDeafened(next); } catch { set({ isDeafened }); }
    },

    setParticipantVolume: (identity, volume) => {
      const { room } = get();
      if (room) {
        const p = room.remoteParticipants.get(identity);
        if (p) p.audioTrackPublications.forEach((pub) => {
          if (pub.track instanceof RemoteAudioTrack) pub.track.setVolume(volume / 100);
        });
      }
      set((s) => ({ participants: s.participants.map((p) => p.identity === identity ? { ...p, volume } : p) }));
    },

    // ── Invite friend into current call ───────────────────────────────────────
    inviteFriend: async (friendId, displayName) => {
      const { roomName } = get();
      if (!roomName) return;
      toast(`Inviting ${displayName}…`, "info");
      try {
        await ipc.voice.inviteToCall(friendId, roomName);
      } catch (error: unknown) {
        toast(readError(error), "error");
      }
    },

    // ── Device management ─────────────────────────────────────────────────
    loadDevices: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputDevices = devices.filter((d) => d.kind === "audioinput");
        const outputDevices = devices.filter((d) => d.kind === "audiooutput");
        const { selectedInputId, selectedOutputId } = get();
        const validInput = inputDevices.some((d) => d.deviceId === selectedInputId)
          ? selectedInputId : inputDevices[0]?.deviceId ?? "";
        const validOutput = outputDevices.some((d) => d.deviceId === selectedOutputId)
          ? selectedOutputId : outputDevices[0]?.deviceId ?? "";
        set({ inputDevices, outputDevices, selectedInputId: validInput, selectedOutputId: validOutput });
      } catch (error: unknown) {
        console.error("[voice] enumerateDevices failed:", error);
      }
    },

    setInputDevice: async (deviceId) => {
      set({ selectedInputId: deviceId });
      const { room, currentAudioTrack } = get();
      if (!room) return;
      try {
        if (currentAudioTrack) {
          await room.localParticipant.unpublishTrack(currentAudioTrack);
          currentAudioTrack.stop();
        }
        const newTrack = await createLocalAudioTrack({
          deviceId,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48_000,
        });
        await room.localParticipant.publishTrack(newTrack);
        set({ currentAudioTrack: newTrack });
      } catch (error: unknown) {
        console.error("[voice] setInputDevice failed:", error);
        set({ error: `Failed to switch microphone: ${readError(error)}` });
      }
    },

    setOutputDevice: async (deviceId) => {
      set({ selectedOutputId: deviceId });
      document.querySelectorAll("audio").forEach((el) => {
        const sinkEl = el as AudioSinkElement;
        if (typeof sinkEl.setSinkId === "function") {
          void sinkEl.setSinkId(deviceId);
        }
      });
    },
  };
});

// ---------------------------------------------------------------------------
// Push participant data to overlay window whenever participants change
// ---------------------------------------------------------------------------

let lastOverlayPayload = "";

useSessionStore.subscribe((state) => {
  if (!state.isOverlayVisible) return;

  const payload = {
    participants: state.participants.map((p) => ({
      identity: p.identity,
      display_name: p.display_name,
      is_muted: p.is_muted,
      is_speaking: p.is_speaking,
    })),
    room_name: state.roomName ?? "",
    is_muted: state.isMuted,
  };

  const payloadStr = JSON.stringify(payload);
  if (payloadStr === lastOverlayPayload) return;
  lastOverlayPayload = payloadStr;

  void events.emit("overlay_update", payload);
});

if (typeof navigator !== "undefined" && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    const store = useSessionStore.getState();
    const prevInputId = store.selectedInputId;
    const prevOutputId = store.selectedOutputId;

    void store.loadDevices().then(() => {
      const { inputDevices, outputDevices, isInCall } = useSessionStore.getState();

      if (prevInputId && !inputDevices.some((d) => d.deviceId === prevInputId)) {
        const fallback = inputDevices[0]?.deviceId;
        if (fallback) {
          toast("Microphone disconnected, switched to default", "info");
          if (isInCall) void useSessionStore.getState().setInputDevice(fallback);
          else useSessionStore.setState({ selectedInputId: fallback });
        }
      }

      if (prevOutputId && !outputDevices.some((d) => d.deviceId === prevOutputId)) {
        const fallback = outputDevices[0]?.deviceId;
        if (fallback) {
          toast("Speaker disconnected, switched to default", "info");
          void useSessionStore.getState().setOutputDevice(fallback);
        }
      }
    });
  });
}
