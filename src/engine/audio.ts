import type { PowerUpType, SettingsState } from '../game/types';

/**
 * 100% procedural Web Audio API racing sound engine (zero external audio file 404s).
 * Respects browser autoplay restrictions by unlocking smoothly on first user interaction.
 */
export class RacingAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;

  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private driftNoise: AudioBufferSourceNode | null = null;
  private driftGain: GainNode | null = null;

  private settings: SettingsState | null = null;
  private running = false;

  public applySettings(settings: SettingsState): void {
    this.settings = settings;
    if (!this.ctx || !this.masterGain || !this.engineGain || !this.sfxGain || !this.uiGain) return;
    const now = this.ctx.currentTime;
    const master = settings.muted ? 0 : settings.masterVolume;
    this.masterGain.gain.setTargetAtTime(master, now, 0.04);
    this.engineGain.gain.setTargetAtTime(settings.engineVolume * 0.22, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume * 0.45, now, 0.04);
    this.uiGain.gain.setTargetAtTime(settings.uiVolume * 0.35, now, 0.04);
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);

      this.uiGain = this.ctx.createGain();
      this.uiGain.connect(this.masterGain);

      // Continuous Dual-Oscillator Engine Synth
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 260;
      this.engineFilter.Q.value = 3.2;
      this.engineFilter.connect(this.engineGain);

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 55;
      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc1.start();

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 110;
      this.engineOsc2.connect(this.engineFilter);
      this.engineOsc2.start();

      // Continuous Filtered Noise for Tire Drift Screech
      const bufSize = this.ctx.sampleRate * 1.5;
      const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const driftFilter = this.ctx.createBiquadFilter();
      driftFilter.type = 'bandpass';
      driftFilter.frequency.value = 1650;
      driftFilter.Q.value = 4.5;

      this.driftGain = this.ctx.createGain();
      this.driftGain.gain.value = 0;
      driftFilter.connect(this.driftGain);
      this.driftGain.connect(this.sfxGain);

      this.driftNoise = this.ctx.createBufferSource();
      this.driftNoise.buffer = noiseBuf;
      this.driftNoise.loop = true;
      this.driftNoise.connect(driftFilter);
      this.driftNoise.start();

      if (this.settings) this.applySettings(this.settings);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setEngineActive(active: boolean): void {
    this.running = active;
    if (!this.ctx || !this.engineGain || !this.driftGain) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.driftGain.gain.setTargetAtTime(0, now, 0.06);
    } else if (this.settings) {
      this.engineGain.gain.setTargetAtTime(this.settings.engineVolume * 0.22, now, 0.08);
    }
  }

  public updateEngine(speedRatio: number, rpmRatio: number, driftIntensity: number, nitroActive: boolean): void {
    if (!this.running || !this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.driftGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const baseFreq = 48 + rpmRatio * 145 + (nitroActive ? 42 : 0) + speedRatio * 24;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.99, now, 0.03);
    this.engineFilter.frequency.setTargetAtTime(220 + rpmRatio * 980 + (nitroActive ? 550 : 0), now, 0.04);

    const targetDrift = Math.min(0.28, driftIntensity * 0.25);
    this.driftGain.gain.setTargetAtTime(targetDrift, now, 0.04);
  }

  public playUiClick(): void {
    if (!this.ctx || !this.uiGain || this.settings?.muted) return;
    this.playTone(720, 960, 0.055, 'triangle', 0.28, this.uiGain);
  }

  public playCountdown(go: boolean): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    if (go) {
      this.playTone(660, 1046, 0.32, 'sawtooth', 0.35, this.sfxGain);
    } else {
      this.playTone(440, 440, 0.16, 'triangle', 0.3, this.sfxGain);
    }
  }

  public playPickup(): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    this.playTone(540, 1180, 0.14, 'sine', 0.34, this.sfxGain);
  }

  public playPowerUp(type: PowerUpType): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    switch (type) {
      case 'SHUNT':
        this.playTone(320, 140, 0.28, 'sawtooth', 0.42, this.sfxGain);
        break;
      case 'BOLT':
        this.playTone(1120, 380, 0.11, 'square', 0.3, this.sfxGain);
        break;
      case 'BARGE':
        this.playTone(170, 48, 0.38, 'sawtooth', 0.5, this.sfxGain);
        break;
      case 'MINE':
        this.playTone(480, 260, 0.15, 'triangle', 0.3, this.sfxGain);
        break;
      case 'SHOCK':
        this.playTone(960, 220, 0.32, 'sawtooth', 0.36, this.sfxGain);
        break;
      case 'SHIELD':
        this.playTone(360, 820, 0.3, 'sine', 0.34, this.sfxGain);
        break;
      case 'NITRO':
        this.playTone(220, 920, 0.4, 'sawtooth', 0.35, this.sfxGain);
        break;
      case 'REPAIR':
        this.playTone(440, 880, 0.24, 'sine', 0.35, this.sfxGain);
        this.playTone(660, 1320, 0.28, 'triangle', 0.25, this.sfxGain);
        break;
    }
  }

  public playImpact(heavy: boolean): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    this.playTone(heavy ? 130 : 185, 36, heavy ? 0.26 : 0.12, 'sawtooth', heavy ? 0.55 : 0.28, this.sfxGain);
  }

  public playShieldBlock(): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    this.playTone(880, 1320, 0.18, 'sine', 0.38, this.sfxGain);
  }

  public playFinish(): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    this.playTone(523, 523, 0.14, 'triangle', 0.35, this.sfxGain);
    setTimeout(() => this.sfxGain && this.playTone(659, 659, 0.14, 'triangle', 0.35, this.sfxGain), 120);
    setTimeout(() => this.sfxGain && this.playTone(784, 1046, 0.34, 'triangle', 0.4, this.sfxGain), 240);
  }

  private playTone(
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    dest: AudioNode,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public dispose(): void {
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      this.driftNoise?.stop();
      this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
  }
}
