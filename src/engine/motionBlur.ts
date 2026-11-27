import * as THREE from 'three';
import type { CameraMode } from '../game/types';

export interface CameraMotionBlurInput {
  mode: 'title' | 'garage' | 'playing' | 'paused' | 'results';
  enabled: boolean;
  speedMs: number; // Forward speed in m/s
  topSpeedMs: number; // Vehicle reference top speed in m/s
  lateralSpeedMs: number; // Drift/slide lateral speed in m/s
  nitroActive: boolean;
  isDrafting: boolean;
  cameraMode: CameraMode;
  cameraYawDelta: number; // Radians turned since previous frame
  dt: number; // Frame delta in seconds
}

export interface CameraMotionBlurParams {
  /** Overall normalized motion blur strength (0..1) */
  intensity: number;
  /** Radial zoom blur factor along screen-space vector from vanishing point */
  radialStrength: number;
  /** Screen-space lateral/panning blur vector derived from camera yaw & drift */
  camVelocityUv: { x: number; y: number };
  /** Screen-space vanishing point (0..1) shifted subtly into corners */
  vanishingUv: { x: number; y: number };
  /** Peripheral RGB split amount during Nitro / Slipstream high speed */
  chromaticAmount: number;
}

/**
 * Pure, deterministic camera motion-blur parameter solver.
 * Translates camera motion (speed, yaw velocity, drift, Nitro, Slipstream, and camera mode)
 * into shader uniforms and peripheral speed-streak intensities matching Blur (2010)'s feel.
 */
export function computeCameraMotionBlurParams(input: CameraMotionBlurInput): CameraMotionBlurParams {
  if (!input.enabled || input.mode !== 'playing') {
    return {
      intensity: 0,
      radialStrength: 0,
      camVelocityUv: { x: 0, y: 0 },
      vanishingUv: { x: 0.5, y: 0.44 },
      chromaticAmount: 0,
    };
  }

  const safeDt = Math.max(0.004, Math.min(0.1, input.dt || 1 / 60));
  const absSpeed = Math.abs(input.speedMs);
  const refTop = Math.max(45, input.topSpeedMs);

  // Ramp smoothly starting at ~115 km/h (32 m/s) so slow launches stay crisp
  const speedRatio = Math.max(0, Math.min(1.45, (absSpeed - 30) / (refTop - 24)));
  const speedCurve = speedRatio * speedRatio * 0.62;

  const nitroBoost = input.nitroActive ? 0.36 : 0;
  const draftBoost = input.isDrafting ? 0.12 : 0;
  const hoodBoost = input.cameraMode === 'hood' ? 1.18 : input.cameraMode === 'far' ? 0.9 : 1.0;

  // Angular camera sweep velocity (turning / drifting whips peripheral city lights sideways)
  const yawRate = input.cameraYawDelta / safeDt; // rad/s
  const yawBlurX = Math.max(-0.045, Math.min(0.045, yawRate * 0.014));
  const driftBlurX = Math.max(-0.02, Math.min(0.02, (input.lateralSpeedMs / 40) * 0.012));
  const camVelX = yawBlurX + driftBlurX;
  const camVelY = Math.max(-0.012, Math.min(0.012, -speedRatio * 0.005));

  const angularContribution = Math.min(0.28, Math.abs(yawRate) * 0.12);
  const rawIntensity = (speedCurve + nitroBoost + draftBoost + angularContribution) * hoodBoost;
  const intensity = Math.max(0, Math.min(1, rawIntensity));

  // Shift vanishing point slightly toward turn direction & keep center car lower-mid crisp
  const vanishX = Math.max(0.36, Math.min(0.64, 0.5 + yawRate * 0.045));
  const vanishY = input.cameraMode === 'hood' ? 0.48 : 0.43;

  const radialStrength = Math.min(0.048, intensity * (input.nitroActive ? 0.042 : 0.03));
  const chromaticAmount =
    intensity > 0.28
      ? Math.min(0.011, (intensity - 0.28) * (input.nitroActive ? 0.014 : 0.0065))
      : 0;

  return {
    intensity,
    radialStrength,
    camVelocityUv: { x: camVelX, y: camVelY },
    vanishingUv: { x: vanishX, y: vanishY },
    chromaticAmount,
  };
}

/**
 * Full-screen GLSL Camera-Based Motion Blur + Peripheral Chromatic Aberration Shader
 * for Three.js EffectComposer ShaderPass.
 *
 * Combines:
 * 1) Reprojected camera-matrix motion delta (uPrevViewProjection * uInvViewProjection)
 * 2) Vanishing-point radial high-speed tunnel streak
 * 3) Lateral camera yaw/drift sweep vector
 * 4) Center car protection mask so the player's chassis & upcoming power-ups stay razor-sharp.
 */
export const CameraMotionBlurShader = {
  name: 'CameraMotionBlurShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uIntensity: { value: 0.0 },
    uRadialStrength: { value: 0.0 },
    uCamVelocity: { value: new THREE.Vector2(0, 0) },
    uVanishingUv: { value: new THREE.Vector2(0.5, 0.43) },
    uChromatic: { value: 0.0 },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uInvViewProj: { value: new THREE.Matrix4() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uRadialStrength;
    uniform vec2 uCamVelocity;
    uniform vec2 uVanishingUv;
    uniform float uChromatic;
    uniform mat4 uPrevViewProj;
    uniform mat4 uInvViewProj;
    varying vec2 vUv;

    void main() {
      if (uIntensity <= 0.004) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Compute camera-matrix reprojected screen velocity on mid-distance focal plane (NDC z = 0.88)
      vec4 clipPos = vec4(vUv * 2.0 - 1.0, 0.88, 1.0);
      vec4 worldPos = uInvViewProj * clipPos;
      worldPos /= max(abs(worldPos.w), 0.0001);
      vec4 prevClip = uPrevViewProj * worldPos;
      vec2 prevUv = (prevClip.xy / max(abs(prevClip.w), 0.0001)) * 0.5 + 0.5;
      vec2 matrixVel = clamp(vUv - prevUv, vec2(-0.04), vec2(0.04)) * 0.55;

      // Radial high-speed vector from vanishing point + lateral camera pan velocity
      vec2 fromCenter = vUv - uVanishingUv;
      float radialDist = length(fromCenter);

      // Protect the player's car & central road horizon while streaking screen edges strongly
      vec2 carCenter = vec2(0.5, 0.34);
      float carDist = length((vUv - carCenter) * vec2(1.0, 1.25));
      float edgeMask = smoothstep(0.16, 0.72, radialDist) * smoothstep(0.14, 0.46, carDist);

      vec2 blurVec =
        (fromCenter * uRadialStrength + uCamVelocity * uIntensity + matrixVel * uIntensity) *
        edgeMask;

      // Clamp total UV velocity to prevent artifacts on sudden camera cuts
      float vLen = length(blurVec);
      if (vLen > 0.055) {
        blurVec *= 0.055 / vLen;
      }

      // 9-tap centered directional Gaussian-weighted gather
      vec3 accum = vec3(0.0);
      float weightSum = 0.0;
      for (int i = -4; i <= 4; i++) {
        float fi = float(i) / 4.0;
        float w = 1.0 - abs(fi) * 0.58;
        vec2 sampleUv = clamp(vUv - blurVec * fi, vec2(0.002), vec2(0.998));
        accum += texture2D(tDiffuse, sampleUv).rgb * w;
        weightSum += w;
      }
      vec3 color = accum / weightSum;

      // Subtle Blur-style peripheral RGB chromatic aberration on Nitro / peak speed
      if (uChromatic > 0.0002) {
        vec2 chromaOffset = fromCenter * uChromatic * edgeMask;
        float r = texture2D(tDiffuse, clamp(vUv + chromaOffset, vec2(0.002), vec2(0.998))).r;
        float b = texture2D(tDiffuse, clamp(vUv - chromaOffset, vec2(0.002), vec2(0.998))).b;
        color.r = mix(color.r, r, 0.65);
        color.b = mix(color.b, b, 0.65);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/**
 * Lightweight 1-draw-call 3D peripheral camera speed-streak rig attached to the camera.
 * Complements the GLSL ShaderPass on hardware GPUs and ensures crisp Blur-style speed
 * motion cues remain visible even on software-WebGL fallback paths.
 */
export interface CameraSpeedStreakRig {
  lines: THREE.LineSegments;
  update: (params: CameraMotionBlurParams, nitroActive: boolean, dt: number) => void;
  dispose: () => void;
}

export function createCameraSpeedStreakRig(): CameraSpeedStreakRig {
  const count = 44;
  const positions = new Float32Array(count * 2 * 3);
  const colors = new Float32Array(count * 2 * 3);

  interface StreakSeed {
    angle: number;
    radius: number;
    z: number;
    speedMult: number;
    length: number;
    tint: number; // 0 = cyan, 1 = magenta, 2 = white
  }

  const seeds: StreakSeed[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute around peripheral edges (avoid blocking the center vehicle/horizon)
    const angle = (i / count) * Math.PI * 2 + Math.sin(i * 19.7) * 0.14;
    const radius = 1.15 + (i % 5) * 0.18;
    seeds.push({
      angle,
      radius,
      z: -1.4 - ((i * 7.3) % 7.5),
      speedMult: 0.78 + (i % 4) * 0.16,
      length: 0.55 + (i % 3) * 0.35,
      tint: i % 3,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 999;
  lines.visible = false;

  const update = (params: CameraMotionBlurParams, nitroActive: boolean, dt: number) => {
    const active = params.intensity > 0.14;
    lines.visible = active;
    if (!active) {
      mat.opacity = 0;
      return;
    }

    const strength = Math.min(1, (params.intensity - 0.14) / 0.86);
    mat.opacity = strength * (nitroActive ? 0.72 : 0.44);

    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;

    const zSpeed = (16 + strength * 28 + (nitroActive ? 16 : 0)) * Math.min(dt, 0.08);
    const yawSkewX = -params.camVelocityUv.x * 8.5;

    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      s.z += zSpeed * s.speedMult;
      if (s.z > -0.65) {
        s.z = -8.6 - (i % 5) * 0.45;
      }

      const x = Math.cos(s.angle) * s.radius * 1.48;
      const y = Math.sin(s.angle) * s.radius * 0.86;
      const segLen = s.length * (0.65 + strength * 1.9 + (nitroActive ? 0.85 : 0));

      const base = i * 6;
      // Front vertex (closer to camera, brighter)
      posArr[base] = x;
      posArr[base + 1] = y;
      posArr[base + 2] = s.z;
      // Back vertex (farther down camera -Z, skewed by camera yaw velocity)
      posArr[base + 3] = x * 0.88 + yawSkewX;
      posArr[base + 4] = y * 0.88;
      posArr[base + 5] = s.z - segLen;

      // Color gradient: vivid nitro emerald/cyan or neon city cyan/magenta/white fading to 0 at tail
      let r = 0.0;
      let g = 0.82;
      let b = 1.0;
      if (nitroActive) {
        if (s.tint === 0) {
          r = 0.15;
          g = 0.96;
          b = 0.65;
        } else if (s.tint === 1) {
          r = 0.0;
          g = 0.84;
          b = 1.0;
        } else {
          r = 0.92;
          g = 1.0;
          b = 0.98;
        }
      } else if (s.tint === 1) {
        r = 1.0;
        g = 0.22;
        b = 0.56;
      } else if (s.tint === 2) {
        r = 0.82;
        g = 0.92;
        b = 1.0;
      }

      colArr[base] = r;
      colArr[base + 1] = g;
      colArr[base + 2] = b;
      colArr[base + 3] = r * 0.08;
      colArr[base + 4] = g * 0.08;
      colArr[base + 5] = b * 0.08;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  };

  return {
    lines,
    update,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}
