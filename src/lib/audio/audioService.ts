/**
 * Generates call-signaling tones via the Web Audio API (no audio files needed).
 * Singleton — import `audioService` and call its methods directly.
 */
class AudioService {
  private ctx: AudioContext | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  private beep(freq: number, durationSec: number, volume: number): void {
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + durationSec);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + durationSec);
    } catch {
      // AudioContext may be unavailable in some environments
    }
  }

  /** Outgoing call — steady beep every 1 second (like a phone dialling). */
  playDialTone(): void {
    this.stopAll();
    this.beep(440, 0.5, 0.3);
    this.intervalId = setInterval(() => this.beep(440, 0.5, 0.3), 1_000);
  }

  /**
   * Incoming ring — classic double-ring pattern:
   * beep-beep … pause … beep-beep …
   * Steps: on, on, off, off, off (500 ms each)
   */
  playRingtone(): void {
    this.stopAll();
    let step = 0;
    const pattern = [true, true, false, false, false] as const;
    const tick = () => {
      if (pattern[step % pattern.length]) {
        this.beep(480, 0.4, 0.4);
      }
      step++;
    };
    tick();
    this.intervalId = setInterval(tick, 500);
  }

  /** Stop any playing tone immediately. */
  stopAll(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const audioService = new AudioService();
