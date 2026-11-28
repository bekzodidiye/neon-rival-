import type { PowerUpType, SettingsState, VehicleArchetype, HandlingArchetype } from '../game/types';

export type EngineSoundProfile = 'coupe' | 'muscle' | 'supercar' | 'gt' | 'offroad';

interface ProfileTuning {
  osc1Type: OscillatorType;
  osc2Type: OscillatorType;
  baseHz: number;
  rpmSpanHz: number;
  harmonicRatio: number;
  filterBaseHz: number;
  filterSpanHz: number;
  filterQ: number;
  turboWhineGain: number;
}

const ENGINE_PROFILES: Record<EngineSoundProfile, ProfileTuning> = {
  coupe: {
    osc1Type: 'sawtooth',
    osc2Type: 'triangle',
    baseHz: 52,
    rpmSpanHz: 155,
    harmonicRatio: 2.0,
    filterBaseHz: 240,
    filterSpanHz: 1050,
    filterQ: 3.1,
    turboWhineGain: 0.025,
  },
  muscle: {
    osc1Type: 'sawtooth',
    osc2Type: 'square',
    baseHz: 38,
    rpmSpanHz: 112,
    harmonicRatio: 1.5,
    filterBaseHz: 170,
    filterSpanHz: 760,
    filterQ: 4.2,
    turboWhineGain: 0.01,
  },
  supercar: {
    osc1Type: 'sawtooth',
    osc2Type: 'sawtooth',
    baseHz: 68,
    rpmSpanHz: 220,
    harmonicRatio: 2.5,
    filterBaseHz: 320,
    filterSpanHz: 1480,
    filterQ: 2.6,
    turboWhineGain: 0.055,
  },
  gt: {
    osc1Type: 'sawtooth',
    osc2Type: 'triangle',
    baseHz: 58,
    rpmSpanHz: 185,
    harmonicRatio: 2.01,
    filterBaseHz: 280,
    filterSpanHz: 1260,
    filterQ: 3.4,
    turboWhineGain: 0.045,
  },
  offroad: {
    osc1Type: 'triangle',
    osc2Type: 'sawtooth',
    baseHz: 42,
    rpmSpanHz: 125,
    harmonicRatio: 1.49,
    filterBaseHz: 195,
    filterSpanHz: 820,
    filterQ: 3.8,
    turboWhineGain: 0.02,
  },
};

export function resolveEngineProfile(
  archetype: VehicleArchetype,
  handling?: HandlingArchetype,
): EngineSoundProfile {
  if (handling === 'offroad') return 'offroad';
  return archetype;
}

/**
 * Procedural Web Audio API racing sound engine (V7.0 Part 15):
 * - Five distinct engine archetype synthesis profiles (coupe, muscle, supercar, GT, offroad)
 * - RPM, throttle load, gear-shift transient pop, high-RPM turbo whine
 * - Speed-reactive wind & tire scrub noise + tunnel resonance filter modulation
 * - Priority-based combat SFX & distinct incoming warning chime
 * Respects browser autoplay policies and never causes 404s.
 */
export class RacingAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;

  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private driftNoise: AudioBufferSourceNode | null = null;
  private driftGain: GainNode | null = null;
  private windNoise: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private settings: SettingsState | null = null;
  private profile: EngineSoundProfile = 'coupe';
  private lastGear = 1;
  private running = false;

  public setEngineProfile(profile: EngineSoundProfile): void {
    this.profile = profile;
    const tuning = ENGINE_PROFILES[profile];
    if (this.engineOsc1) this.engineOsc1.type = tuning.osc1Type;
    if (this.engineOsc2) this.engineOsc2.type = tuning.osc2Type;
    if (this.engineFilter) this.engineFilter.Q.value = tuning.filterQ;
  }

  public applySettings(settings: SettingsState): void {
    this.settings = settings;
    if (!this.ctx || !this.masterGain || !this.engineGain || !this.sfxGain || !this.uiGain) return;
    const now = this.ctx.currentTime;
    const master = settings.muted ? 0 : settings.masterVolume;
    this.masterGain.gain.setTargetAtTime(master, now, 0.04);
    this.engineGain.gain.setTargetAtTime(this.running ? settings.engineVolume * 0.22 : 0, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume * 0.45, now, 0.04);
    this.uiGain.gain.setTargetAtTime(settings.uiVolume * 0.35, now, 0.04);
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

      const tuning = ENGINE_PROFILES[this.profile];

      // Dual-Oscillator Engine Synth + High-RPM Turbo/Induction Whine
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = tuning.filterBaseHz;
      this.engineFilter.Q.value = tuning.filterQ;
      this.engineFilter.connect(this.engineGain);

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = tuning.osc1Type;
      this.engineOsc1.frequency.value = tuning.baseHz;
      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc1.start();

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = tuning.osc2Type;
      this.engineOsc2.frequency.value = tuning.baseHz * tuning.harmonicRatio;
      this.engineOsc2.connect(this.engineFilter);
      this.engineOsc2.start();

      this.turboGain = this.ctx.createGain();
      this.turboGain.gain.value = 0;
      this.turboGain.connect(this.engineGain);
      this.turboOsc = this.ctx.createOscillator();
      this.turboOsc.type = 'sine';
      this.turboOsc.frequency.value = 900;
      this.turboOsc.connect(this.turboGain);
      this.turboOsc.start();

      // Shared white noise buffer for tire drift screech + high-speed wind ambience
      const bufSize = Math.floor(this.ctx.sampleRate * 1.5);
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

      // Speed-scaled aerodynamic wind & road rush
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 420;
      this.windFilter.Q.value = 1.2;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.sfxGain);

      this.windNoise = this.ctx.createBufferSource();
      this.windNoise.buffer = noiseBuf;
      this.windNoise.loop = true;
      this.windNoise.connect(this.windFilter);
      this.windNoise.start();

      if (this.settings) this.applySettings(this.settings);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setEngineActive(active: boolean): void {
    this.running = active;
    if (!this.ctx || !this.engineGain || !this.driftGain || !this.windGain) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.driftGain.gain.setTargetAtTime(0, now, 0.06);
      this.windGain.gain.setTargetAtTime(0, now, 0.08);
    } else if (this.settings) {
      this.engineGain.gain.setTargetAtTime(this.settings.engineVolume * 0.22, now, 0.08);
    }
  }

  public updateEngine(
    speedRatio: number,
    rpmRatio: number,
    driftIntensity: number,
    nitroActive: boolean,
    gear = 1,
    inTunnel = false,
  ): void {
    if (
      !this.running ||
      !this.ctx ||
      !this.engineOsc1 ||
      !this.engineOsc2 ||
      !this.engineFilter ||
      !this.driftGain
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const tuning = ENGINE_PROFILES[this.profile];

    // Subtle exhaust burble/shift pop on upshift
    if (gear > this.lastGear && speedRatio > 0.2 && this.sfxGain && !this.settings?.muted) {
      this.playTone(135, 62, 0.065, 'triangle', 0.14, this.sfxGain);
    }
    this.lastGear = gear;

    const baseFreq = tuning.baseHz + rpmRatio * tuning.rpmSpanHz + (nitroActive ? 44 : 0) + speedRatio * 20;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * tuning.harmonicRatio, now, 0.03);

    const tunnelQBoost = inTunnel ? 2.4 : 0;
    this.engineFilter.Q.setTargetAtTime(tuning.filterQ + tunnelQBoost, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(
      tuning.filterBaseHz + rpmRatio * tuning.filterSpanHz + (nitroActive ? 580 : 0) + (inTunnel ? 280 : 0),
      now,
      0.04,
    );

    if (this.turboOsc && this.turboGain) {
      const whineHz = 950 + rpmRatio * 2100 + (nitroActive ? 650 : 0);
      this.turboOsc.frequency.setTargetAtTime(whineHz, now, 0.04);
      const targetWhine = Math.max(0, (rpmRatio - 0.52) * 2) * tuning.turboWhineGain * (nitroActive ? 1.8 : 1);
      this.turboGain.gain.setTargetAtTime(targetWhine, now, 0.05);
    }

    const targetDrift = Math.min(0.28, driftIntensity * 0.25);
    this.driftGain.gain.setTargetAtTime(targetDrift, now, 0.04);

    if (this.windGain && this.windFilter) {
      const clampedSpd = Math.max(0, Math.min(1.25, speedRatio));
      this.windFilter.frequency.setTargetAtTime(340 + clampedSpd * 880 + (inTunnel ? -120 : 0), now, 0.06);
      this.windGain.gain.setTargetAtTime(clampedSpd * clampedSpd * (inTunnel ? 0.11 : 0.07), now, 0.08);
    }
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

  public playIncomingWarning(): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    this.playTone(1320, 980, 0.12, 'square', 0.22, this.sfxGain);
  }

  public playPowerUp(type: PowerUpType): void {
    if (!this.ctx || !this.sfxGain || this.settings?.muted) return;
    switch (type) {
      case 'SHUNT':
        this.playTone(340, 130, 0.3, 'sawtooth', 0.44, this.sfxGain);
        break;
      case 'BOLT':
        this.playTone(1180, 360, 0.11, 'square', 0.32, this.sfxGain);
        break;
      case 'BARGE':
        this.playTone(165, 44, 0.4, 'sawtooth', 0.52, this.sfxGain);
        break;
      case 'MINE':
        this.playTone(480, 260, 0.16, 'triangle', 0.32, this.sfxGain);
        break;
      case 'SHOCK':
        this.playTone(980, 210, 0.34, 'sawtooth', 0.38, this.sfxGain);
        break;
      case 'SHIELD':
        this.playTone(360, 840, 0.3, 'sine', 0.36, this.sfxGain);
        break;
      case 'NITRO':
        this.playTone(220, 960, 0.42, 'sawtooth', 0.38, this.sfxGain);
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
      this.turboOsc?.stop();
      this.driftNoise?.stop();
      this.windNoise?.stop();
      this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
  }
}
