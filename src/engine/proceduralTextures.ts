import * as THREE from 'three';
import type { PowerUpType } from '../game/types';
import { POWERUP_DEFS, POWERUP_TYPES } from '../game/powerups';

/**
 * Generates crisp, zero-404 procedural CanvasTextures for Blur-inspired wet midnight asphalt,
 * high-rise cyberpunk facades, iconic floating holographic power-up emblems, headlight beams,
 * night skyline dome, start/finish gantry, and soft radial shadow/glow pools.
 */
export interface ProceduralTexturePack {
  roadAlbedo: THREE.CanvasTexture;
  roadRoughness: THREE.CanvasTexture;
  buildingFacade: THREE.CanvasTexture;
  buildingEmissive: THREE.CanvasTexture;
  gantryBanner: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  neonGlow: THREE.CanvasTexture;
  headlightBeam: THREE.CanvasTexture;
  tailTrail: THREE.CanvasTexture;
  nightSky: THREE.CanvasTexture;
  chevronSign: THREE.CanvasTexture;
  powerUpIcons: Record<PowerUpType, THREE.CanvasTexture>;
  dispose: () => void;
}

function createPowerUpIconTexture(type: PowerUpType): THREE.CanvasTexture {
  const def = POWERUP_DEFS[type];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  // Outer glowing neon halo (authentic Blur holographic float emblem)
  const rad = ctx.createRadialGradient(128, 128, 22, 128, 128, 124);
  rad.addColorStop(0, `${def.color}CC`);
  rad.addColorStop(0.55, `${def.color}55`);
  rad.addColorStop(0.82, `${def.color}18`);
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 256, 256);

  // Crisp glowing geometric outer frame ring
  ctx.strokeStyle = def.color;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 92, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.arc(128, 128, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Inner dark translucent disc for instant icon silhouette readability
  ctx.fillStyle = 'rgba(6, 10, 22, 0.72)';
  ctx.beginPath();
  ctx.arc(128, 128, 78, 0, Math.PI * 2);
  ctx.fill();

  // High-contrast Blur-style power-up glyph in bright neon + white core
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = def.color;
  ctx.shadowBlur = 16;

  switch (type) {
    case 'SHUNT': {
      // Homing target reticle + glowing red orb core
      ctx.strokeStyle = def.color;
      ctx.beginPath();
      ctx.arc(128, 128, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(128, 128, 22, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        ctx.beginPath();
        ctx.moveTo(128 + dx * 32, 128 + dy * 32);
        ctx.lineTo(128 + dx * 64, 128 + dy * 64);
        ctx.stroke();
      }
      break;
    }
    case 'BOLT': {
      // 3 aggressive forward-pointing laser bolts
      for (const offset of [-32, 0, 32]) {
        ctx.fillStyle = offset === 0 ? '#FFFFFF' : def.color;
        ctx.beginPath();
        ctx.moveTo(128 + offset, 64);
        ctx.lineTo(142 + offset, 118);
        ctx.lineTo(128 + offset, 192);
        ctx.lineTo(114 + offset, 118);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'BARGE': {
      // Expanding concentric shockwave arcs
      for (const r of [24, 44, 62]) {
        ctx.strokeStyle = r === 24 ? '#FFFFFF' : def.color;
        ctx.lineWidth = r === 24 ? 10 : 8;
        ctx.beginPath();
        ctx.arc(128, 128, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'MINE': {
      // Spiked proximity naval/energy mine
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 10;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(128 + Math.cos(a) * 26, 128 + Math.sin(a) * 26);
        ctx.lineTo(128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62);
        ctx.stroke();
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(128, 128, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FF2A55';
      ctx.beginPath();
      ctx.arc(128, 128, 12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'SHOCK': {
      // Classic Blur electric lightning bolt
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(142, 62);
      ctx.lineTo(90, 134);
      ctx.lineTo(126, 134);
      ctx.lineTo(112, 196);
      ctx.lineTo(168, 118);
      ctx.lineTo(132, 118);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'SHIELD': {
      // Glowing cyan hexagonal barrier emblem
      ctx.strokeStyle = '#FFFFFF';
      ctx.fillStyle = `${def.color}66`;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(128, 66);
      ctx.lineTo(180, 92);
      ctx.lineTo(174, 154);
      ctx.lineTo(128, 192);
      ctx.lineTo(82, 154);
      ctx.lineTo(76, 92);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'NITRO': {
      // Classic Blur triple upward speed chevrons
      for (const dy of [-34, 0, 34]) {
        ctx.strokeStyle = dy === -34 ? '#FFFFFF' : def.color;
        ctx.lineWidth = 13;
        ctx.beginPath();
        ctx.moveTo(86, 136 + dy);
        ctx.lineTo(128, 96 + dy);
        ctx.lineTo(170, 136 + dy);
        ctx.stroke();
      }
      break;
    }
    case 'REPAIR': {
      // Bold glowing medical/chassis repair cross
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(112, 74, 32, 108);
      ctx.fillRect(74, 112, 108, 32);
      break;
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createProceduralTexturePack(maxAnisotropy: number, accentHex = '#00C8FF'): ProceduralTexturePack {
  // 1. Deep Wet Midnight Asphalt Road Albedo + Crisp Blur Lane Markings
  const roadCanvas = document.createElement('canvas');
  roadCanvas.width = 512;
  roadCanvas.height = 512;
  const rctx = roadCanvas.getContext('2d')!;

  rctx.fillStyle = '#0A0E18';
  rctx.fillRect(0, 0, 512, 512);

  // Fine asphalt grain
  for (let i = 0; i < 8000; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    const px = Math.abs(x) * 512;
    const py = Math.abs(y) * 512;
    const shade = 10 + (i % 18);
    rctx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 9})`;
    rctx.fillRect(px, py, 2, 2);
  }

  // Dark tire-wear racing lines
  for (const cx of [140, 256, 372]) {
    const grad = rctx.createLinearGradient(cx - 48, 0, cx + 48, 0);
    grad.addColorStop(0, 'rgba(3,5,10,0)');
    grad.addColorStop(0.5, 'rgba(3,5,10,0.55)');
    grad.addColorStop(1, 'rgba(3,5,10,0)');
    rctx.fillStyle = grad;
    rctx.fillRect(cx - 48, 0, 96, 512);
  }

  // Glowing outer neon kerb stripes
  rctx.fillStyle = accentHex;
  rctx.fillRect(8, 0, 12, 512);
  rctx.fillRect(492, 0, 12, 512);

  // Crisp reflective edge lines
  rctx.fillStyle = '#DCEBFF';
  rctx.fillRect(32, 0, 6, 512);
  rctx.fillRect(474, 0, 6, 512);

  // Center dashed lane dividers (3 wide racing lanes)
  rctx.fillStyle = '#C9DEF5';
  for (let y = 0; y < 512; y += 128) {
    rctx.fillRect(178, y + 16, 7, 74);
    rctx.fillRect(327, y + 16, 7, 74);
  }

  const roadAlbedo = new THREE.CanvasTexture(roadCanvas);
  roadAlbedo.colorSpace = THREE.SRGBColorSpace;
  roadAlbedo.wrapS = THREE.RepeatWrapping;
  roadAlbedo.wrapT = THREE.RepeatWrapping;
  roadAlbedo.anisotropy = Math.min(8, maxAnisotropy);

  // 2. Wet Asphalt Roughness Map (controlled satin puddles without blinding glare)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rgCtx = roughCanvas.getContext('2d')!;
  rgCtx.fillStyle = '#B8B8B8';
  rgCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 20; i++) {
    const cx = ((i * 73) % 220) + 18;
    const cy = ((i * 131) % 220) + 18;
    const rx = 18 + (i % 5) * 9;
    const ry = 28 + (i % 4) * 12;
    const g = rgCtx.createRadialGradient(cx, cy, 4, cx, cy, ry);
    g.addColorStop(0, 'rgba(72,72,72,0.85)');
    g.addColorStop(1, 'rgba(184,184,184,0)');
    rgCtx.fillStyle = g;
    rgCtx.beginPath();
    rgCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    rgCtx.fill();
  }
  const roadRoughness = new THREE.CanvasTexture(roughCanvas);
  roadRoughness.wrapS = THREE.RepeatWrapping;
  roadRoughness.wrapT = THREE.RepeatWrapping;

  // 3. Dense High-Rise Illuminated Skyscraper Window Facade (Albedo + Emissive)
  const bCanvas = document.createElement('canvas');
  bCanvas.width = 512;
  bCanvas.height = 1024;
  const bctx = bCanvas.getContext('2d')!;
  bctx.fillStyle = '#060A14';
  bctx.fillRect(0, 0, 512, 1024);

  const eCanvas = document.createElement('canvas');
  eCanvas.width = 512;
  eCanvas.height = 1024;
  const ectx = eCanvas.getContext('2d')!;
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, 512, 1024);

  const cols = 16;
  const rows = 44;
  const cw = 512 / cols;
  const rh = 1024 / rows;

  for (let r = 0; r < rows; r++) {
    bctx.fillStyle = '#0B1222';
    bctx.fillRect(0, r * rh, 512, 4);

    const isMechFloor = r % 11 === 0;
    const floorBandLit = Math.abs(Math.sin(r * 3.7)) > 0.35;

    for (let c = 0; c < cols; c++) {
      const wx = c * cw + 4;
      const wy = r * rh + 6;
      const ww = cw - 8;
      const wh = rh - 10;

      if (isMechFloor) {
        bctx.fillStyle = '#090E1B';
        bctx.fillRect(wx, wy, ww, wh);
        continue;
      }

      const hash = Math.abs(Math.sin(r * 23.7 + c * 9.3));
      const lit = floorBandLit ? hash > 0.6 : hash > 0.8;

      if (lit) {
        const huePick = (r * 3 + c * 5) % 9;
        const winColor =
          huePick === 0
            ? '#00D8FF'
            : huePick === 1
              ? '#FF2A85'
              : huePick === 2
                ? '#FFB347'
                : huePick === 3
                  ? '#8B5CF6'
                  : '#9AD4F5';
        bctx.fillStyle = winColor;
        bctx.fillRect(wx, wy, ww, wh);
        ectx.fillStyle = winColor;
        ectx.fillRect(wx, wy, ww, wh);
      } else {
        bctx.fillStyle = '#0B1324';
        bctx.fillRect(wx, wy, ww, wh);
      }
    }
  }

  const buildingFacade = new THREE.CanvasTexture(bCanvas);
  buildingFacade.colorSpace = THREE.SRGBColorSpace;
  buildingFacade.wrapS = THREE.RepeatWrapping;
  buildingFacade.wrapT = THREE.RepeatWrapping;

  const buildingEmissive = new THREE.CanvasTexture(eCanvas);
  buildingEmissive.colorSpace = THREE.SRGBColorSpace;
  buildingEmissive.wrapS = THREE.RepeatWrapping;
  buildingEmissive.wrapT = THREE.RepeatWrapping;

  // 4. Start / Finish Gantry Banner
  const gCanvas = document.createElement('canvas');
  gCanvas.width = 1024;
  gCanvas.height = 192;
  const gctx = gCanvas.getContext('2d')!;
  gctx.fillStyle = '#070B16';
  gctx.fillRect(0, 0, 1024, 192);

  const sq = 24;
  for (let y = 0; y < 192; y += sq) {
    for (let x = 0; x < 144; x += sq) {
      const dark = ((x / sq) + (y / sq)) % 2 === 0;
      gctx.fillStyle = dark ? '#F5F7FA' : '#0B1020';
      gctx.fillRect(x, y, sq, sq);
      gctx.fillRect(1024 - 144 + x, y, sq, sq);
    }
  }
  gctx.fillStyle = accentHex;
  gctx.fillRect(144, 0, 736, 10);
  gctx.fillRect(144, 182, 736, 10);
  gctx.fillStyle = '#F5F7FA';
  gctx.font = 'italic 700 78px sans-serif';
  gctx.textAlign = 'center';
  gctx.textBaseline = 'middle';
  gctx.fillText('NEON RIVALS', 512, 96);

  const gantryBanner = new THREE.CanvasTexture(gCanvas);
  gantryBanner.colorSpace = THREE.SRGBColorSpace;
  gantryBanner.anisotropy = Math.min(8, maxAnisotropy);

  // 5. Soft Radial Contact Shadow Disc
  const sCanvas = document.createElement('canvas');
  sCanvas.width = 128;
  sCanvas.height = 128;
  const sctx = sCanvas.getContext('2d')!;
  const sg = sctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  sg.addColorStop(0, 'rgba(0, 0, 0, 0.88)');
  sg.addColorStop(0.62, 'rgba(0, 0, 0, 0.48)');
  sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(sCanvas);

  // 6. Soft Radial Neon Underglow Texture
  const nCanvas = document.createElement('canvas');
  nCanvas.width = 128;
  nCanvas.height = 128;
  const nctx = nCanvas.getContext('2d')!;
  const ng = nctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  ng.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  ng.addColorStop(0.45, 'rgba(255, 255, 255, 0.52)');
  ng.addColorStop(0.78, 'rgba(255, 255, 255, 0.14)');
  ng.addColorStop(1, 'rgba(255, 255, 255, 0)');
  nctx.fillStyle = ng;
  nctx.fillRect(0, 0, 128, 128);
  const neonGlow = new THREE.CanvasTexture(nCanvas);

  // 7. Tapered Headlight Road Projection Beam Texture
  const hlCanvas = document.createElement('canvas');
  hlCanvas.width = 128;
  hlCanvas.height = 256;
  const hlCtx = hlCanvas.getContext('2d')!;
  const hlGrad = hlCtx.createLinearGradient(64, 256, 64, 0);
  hlGrad.addColorStop(0, 'rgba(220, 244, 255, 0.65)');
  hlGrad.addColorStop(0.4, 'rgba(180, 230, 255, 0.28)');
  hlGrad.addColorStop(1, 'rgba(140, 210, 255, 0)');
  hlCtx.fillStyle = hlGrad;
  hlCtx.beginPath();
  hlCtx.moveTo(46, 256);
  hlCtx.lineTo(82, 256);
  hlCtx.lineTo(124, 0);
  hlCtx.lineTo(4, 0);
  hlCtx.closePath();
  hlCtx.fill();
  const headlightBeam = new THREE.CanvasTexture(hlCanvas);
  headlightBeam.colorSpace = THREE.SRGBColorSpace;

  // 7b. Sleek Feathered Blur Taillight Neon Light-Trail Ribbon (bright core at v=0, fades smoothly to tail & sides)
  const ttCanvas = document.createElement('canvas');
  ttCanvas.width = 64;
  ttCanvas.height = 256;
  const ttCtx = ttCanvas.getContext('2d')!;
  ttCtx.clearRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y++) {
    // y=0 is near taillight (brightest), y=255 is far tail (0 alpha)
    const t = y / 255;
    const lenFade = Math.pow(1 - t, 1.8);
    const halfWidth = 30 * (1 - t * 0.55);
    const grad = ttCtx.createLinearGradient(32 - halfWidth, y, 32 + halfWidth, y);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.28, `rgba(255,255,255,${(0.45 * lenFade).toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${(0.98 * lenFade).toFixed(3)})`);
    grad.addColorStop(0.72, `rgba(255,255,255,${(0.45 * lenFade).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ttCtx.fillStyle = grad;
    ttCtx.fillRect(0, y, 64, 1);
  }
  const tailTrail = new THREE.CanvasTexture(ttCanvas);
  tailTrail.colorSpace = THREE.SRGBColorSpace;

  // 8. Atmospheric Blur Night Sky Dome Gradient (Deep Midnight Indigo -> Magenta/Cyan Horizon Haze + Stars)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 512;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d')!;
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, '#030611');
  skyGrad.addColorStop(0.35, '#070C20');
  skyGrad.addColorStop(0.52, '#1A1138');
  skyGrad.addColorStop(0.6, '#2D1446');
  skyGrad.addColorStop(0.75, '#080B18');
  skyGrad.addColorStop(1, '#04060E');
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 512, 256);

  // Subtle crisp zenith stars
  for (let i = 0; i < 220; i++) {
    const sx = Math.abs(Math.sin(i * 41.23) * 512) % 512;
    const sy = Math.abs(Math.sin(i * 93.17) * 110) % 110;
    const alpha = 0.25 + (i % 5) * 0.14;
    skyCtx.fillStyle = `rgba(210, 232, 255, ${alpha})`;
    skyCtx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  const nightSky = new THREE.CanvasTexture(skyCanvas);
  nightSky.colorSpace = THREE.SRGBColorSpace;

  // 9. Blur Neon Corner Chevron Warning Panel
  const chevCanvas = document.createElement('canvas');
  chevCanvas.width = 256;
  chevCanvas.height = 128;
  const cctx = chevCanvas.getContext('2d')!;
  cctx.fillStyle = '#070B18';
  cctx.fillRect(0, 0, 256, 128);
  cctx.strokeStyle = '#FF2A85';
  cctx.lineWidth = 14;
  cctx.lineCap = 'round';
  cctx.lineJoin = 'round';
  for (const ox of [44, 118, 192]) {
    cctx.beginPath();
    cctx.moveTo(ox - 24, 24);
    cctx.lineTo(ox + 18, 64);
    cctx.lineTo(ox - 24, 104);
    cctx.stroke();
  }
  const chevronSign = new THREE.CanvasTexture(chevCanvas);
  chevronSign.colorSpace = THREE.SRGBColorSpace;

  // 10. All 8 Blur Floating Holographic Power-Up Emblems
  const powerUpIcons = {} as Record<PowerUpType, THREE.CanvasTexture>;
  for (const type of POWERUP_TYPES) {
    powerUpIcons[type] = createPowerUpIconTexture(type);
  }

  return {
    roadAlbedo,
    roadRoughness,
    buildingFacade,
    buildingEmissive,
    gantryBanner,
    contactShadow,
    neonGlow,
    headlightBeam,
    tailTrail,
    nightSky,
    chevronSign,
    powerUpIcons,
    dispose: () => {
      roadAlbedo.dispose();
      roadRoughness.dispose();
      buildingFacade.dispose();
      buildingEmissive.dispose();
      gantryBanner.dispose();
      contactShadow.dispose();
      neonGlow.dispose();
      headlightBeam.dispose();
      tailTrail.dispose();
      nightSky.dispose();
      chevronSign.dispose();
      for (const type of POWERUP_TYPES) {
        powerUpIcons[type].dispose();
      }
    },
  };
}
