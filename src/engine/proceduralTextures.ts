import * as THREE from 'three';
import type { PowerUpType } from '../game/types';
import { POWERUP_DEFS, POWERUP_TYPES } from '../game/powerups';

/**
 * Generates high-craft procedural CanvasTextures for Blur-inspired nighttime urban racing:
 * realistic wet asphalt with markings & curbs, metropolitan architectural glass/concrete facades,
 * overhead expressway directional signs, iconic floating holographic power-up emblems,
 * headlight projection beams, feathered taillight trails, night sky dome, and radial shadow/glow pools.
 */
export interface ProceduralTexturePack {
  roadAlbedo: THREE.CanvasTexture;
  roadRoughness: THREE.CanvasTexture;
  buildingFacade: THREE.CanvasTexture;
  buildingEmissive: THREE.CanvasTexture;
  gantryBanner: THREE.CanvasTexture;
  highwaySign: THREE.CanvasTexture;
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

  // Outer glowing holographic halo
  const rad = ctx.createRadialGradient(128, 128, 22, 128, 128, 124);
  rad.addColorStop(0, `${def.color}CC`);
  rad.addColorStop(0.55, `${def.color}55`);
  rad.addColorStop(0.82, `${def.color}18`);
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 256, 256);

  // Outer geometric frame ring
  ctx.strokeStyle = def.color;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 92, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.arc(128, 128, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Dark translucent core disc for instant high-speed readability
  ctx.fillStyle = 'rgba(6, 10, 22, 0.76)';
  ctx.beginPath();
  ctx.arc(128, 128, 78, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = def.color;
  ctx.shadowBlur = 16;

  switch (type) {
    case 'SHUNT': {
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
  // 1. Realistic Urban Wet Asphalt Albedo (readable dark charcoal slate + aggregate grain + lane markings + rumble curbs)
  const roadCanvas = document.createElement('canvas');
  roadCanvas.width = 512;
  roadCanvas.height = 512;
  const rctx = roadCanvas.getContext('2d')!;

  rctx.fillStyle = '#181E28';
  rctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt concrete aggregate texture
  for (let i = 0; i < 11000; i++) {
    const x = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) * 512;
    const y = Math.abs((Math.sin(i * 78.233) * 43758.5453) % 1) * 512;
    const shade = 20 + (i % 20);
    rctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 9})`;
    rctx.fillRect(x, y, 2, 2);
  }

  // Subtle expansion joint tar seams
  rctx.fillStyle = 'rgba(8, 11, 16, 0.45)';
  rctx.fillRect(0, 254, 512, 3);
  rctx.fillRect(0, 0, 512, 2);

  // Polished dark tire-wear grooves down the 3 racing lanes
  for (const cx of [136, 256, 376]) {
    const grad = rctx.createLinearGradient(cx - 52, 0, cx + 52, 0);
    grad.addColorStop(0, 'rgba(7, 10, 16, 0)');
    grad.addColorStop(0.5, 'rgba(7, 10, 16, 0.48)');
    grad.addColorStop(1, 'rgba(7, 10, 16, 0)');
    rctx.fillStyle = grad;
    rctx.fillRect(cx - 52, 0, 104, 512);
  }

  // Concrete outer shoulder apron + subtle red/white racing kerb blocks
  rctx.fillStyle = '#232B38';
  rctx.fillRect(0, 0, 26, 512);
  rctx.fillRect(486, 0, 26, 512);
  for (let y = 0; y < 512; y += 64) {
    const alt = (y / 64) % 2 === 0;
    rctx.fillStyle = alt ? '#CBD5E1' : '#B91C3C';
    rctx.fillRect(14, y, 10, 64);
    rctx.fillRect(488, y, 10, 64);
  }

  // Crisp reflective urban edge lines (amber inner shoulder + white outer line)
  rctx.fillStyle = '#E6EEF8';
  rctx.fillRect(34, 0, 5, 512);
  rctx.fillRect(473, 0, 5, 512);

  // Center dashed lane dividers (3 wide urban expressway lanes)
  rctx.fillStyle = 'rgba(226, 236, 248, 0.85)';
  for (let y = 0; y < 512; y += 128) {
    rctx.fillRect(177, y + 18, 6, 70);
    rctx.fillRect(329, y + 18, 6, 70);
  }

  // Subtle painted urban lane direction arrow in center lane
  rctx.fillStyle = 'rgba(210, 224, 240, 0.28)';
  rctx.beginPath();
  rctx.moveTo(256, 390);
  rctx.lineTo(278, 340);
  rctx.lineTo(264, 340);
  rctx.lineTo(264, 286);
  rctx.lineTo(248, 286);
  rctx.lineTo(248, 340);
  rctx.lineTo(234, 340);
  rctx.closePath();
  rctx.fill();

  const roadAlbedo = new THREE.CanvasTexture(roadCanvas);
  roadAlbedo.colorSpace = THREE.SRGBColorSpace;
  roadAlbedo.wrapS = THREE.RepeatWrapping;
  roadAlbedo.wrapT = THREE.RepeatWrapping;
  roadAlbedo.anisotropy = Math.min(8, maxAnisotropy);

  // 2. Wet Urban Asphalt Roughness Map (natural satin sheen with damp patches — never mirror-white)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rgCtx = roughCanvas.getContext('2d')!;
  rgCtx.fillStyle = '#C6C6C6';
  rgCtx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 18; i++) {
    const cx = ((i * 73) % 210) + 23;
    const cy = ((i * 131) % 210) + 23;
    const rx = 18 + (i % 5) * 9;
    const ry = 28 + (i % 4) * 12;
    const g = rgCtx.createRadialGradient(cx, cy, 4, cx, cy, ry);
    g.addColorStop(0, 'rgba(84,84,84,0.82)');
    g.addColorStop(1, 'rgba(198,198,198,0)');
    rgCtx.fillStyle = g;
    rgCtx.beginPath();
    rgCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    rgCtx.fill();
  }
  const roadRoughness = new THREE.CanvasTexture(roughCanvas);
  roadRoughness.wrapS = THREE.RepeatWrapping;
  roadRoughness.wrapT = THREE.RepeatWrapping;

  // 3. Realistic Metropolitan Night-City Architectural Facade (Warm Tungsten + Cool Office Glass + Concrete Mullions)
  const bCanvas = document.createElement('canvas');
  bCanvas.width = 512;
  bCanvas.height = 1024;
  const bctx = bCanvas.getContext('2d')!;
  bctx.fillStyle = '#121824';
  bctx.fillRect(0, 0, 512, 1024);

  const eCanvas = document.createElement('canvas');
  eCanvas.width = 512;
  eCanvas.height = 1024;
  const ectx = eCanvas.getContext('2d')!;
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, 512, 1024);

  const cols = 12;
  const rows = 36;
  const cw = 512 / cols;
  const rh = 1024 / rows;

  for (let r = 0; r < rows; r++) {
    // Architectural concrete spandrel floor slab & cornice banding
    bctx.fillStyle = '#1D2534';
    bctx.fillRect(0, r * rh, 512, 7);
    bctx.fillStyle = '#0C1018';
    bctx.fillRect(0, r * rh + 7, 512, 2);

    const isMechFloor = r % 12 === 0;
    const floorOccupancy = Math.abs(Math.sin(r * 4.13));

    for (let c = 0; c < cols; c++) {
      const wx = c * cw + 5;
      const wy = r * rh + 10;
      const ww = cw - 10;
      const wh = rh - 14;

      // Vertical architectural pilaster column every 4 bays
      if (c % 4 === 0) {
        bctx.fillStyle = '#1A2231';
        bctx.fillRect(c * cw, r * rh, 4, rh);
      }

      if (isMechFloor) {
        // Louvered mechanical equipment floor
        bctx.fillStyle = '#101520';
        bctx.fillRect(wx, wy, ww, wh);
        bctx.fillStyle = '#1A2230';
        bctx.fillRect(wx, wy + wh * 0.45, ww, 2);
        continue;
      }

      const hash = Math.abs(Math.sin(r * 19.3 + c * 7.7 + Math.floor(c / 3) * 13.1));
      const lit = floorOccupancy > 0.45 ? hash > 0.56 : hash > 0.82;

      if (lit) {
        // Authentic urban office & apartment night lighting palette (warm amber, soft white, cool glass blue)
        const palettePick = (r * 3 + c * 5) % 10;
        const winColor =
          palettePick < 4
            ? '#F3D6A4' // warm tungsten office / apartment
            : palettePick < 7
              ? '#D7E6F5' // neutral cool daylight fluorescent
              : palettePick < 9
                ? '#98C4E8' // subtle steel-blue interior
                : '#E6B87A'; // amber lamp glow

        // Recessed window interior depth gradient (darker top ceiling -> warmer lit lower desk area)
        const wg = bctx.createLinearGradient(wx, wy, wx, wy + wh);
        wg.addColorStop(0, '#162030');
        wg.addColorStop(0.35, winColor);
        wg.addColorStop(1, winColor);
        bctx.fillStyle = wg;
        bctx.fillRect(wx, wy, ww, wh);

        // Emissive mask (slightly restrained so city skyline looks photorealistic rather than neon checkerboard)
        ectx.fillStyle = winColor;
        ectx.globalAlpha = 0.62;
        ectx.fillRect(wx + 1, wy + Math.floor(wh * 0.25), ww - 2, Math.floor(wh * 0.72));
        ectx.globalAlpha = 1.0;
      } else {
        // Dark reflective architectural glass pane
        bctx.fillStyle = '#0D1422';
        bctx.fillRect(wx, wy, ww, wh);
        bctx.fillStyle = '#141E30';
        bctx.fillRect(wx + 2, wy + 2, ww - 4, 3);
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

  // 4. Start / Finish Illuminated Motorsport Gantry Banner
  const gCanvas = document.createElement('canvas');
  gCanvas.width = 1024;
  gCanvas.height = 192;
  const gctx = gCanvas.getContext('2d')!;
  gctx.fillStyle = '#0A0F1A';
  gctx.fillRect(0, 0, 1024, 192);

  const sq = 24;
  for (let y = 0; y < 192; y += sq) {
    for (let x = 0; x < 144; x += sq) {
      const dark = ((x / sq) + (y / sq)) % 2 === 0;
      gctx.fillStyle = dark ? '#F1F5F9' : '#0E1422';
      gctx.fillRect(x, y, sq, sq);
      gctx.fillRect(1024 - 144 + x, y, sq, sq);
    }
  }
  gctx.fillStyle = accentHex;
  gctx.fillRect(144, 0, 736, 10);
  gctx.fillRect(144, 182, 736, 10);
  gctx.fillStyle = '#F8FAFC';
  gctx.font = 'italic 700 76px sans-serif';
  gctx.textAlign = 'center';
  gctx.textBaseline = 'middle';
  gctx.fillText('NEON RIVALS', 512, 96);

  const gantryBanner = new THREE.CanvasTexture(gCanvas);
  gantryBanner.colorSpace = THREE.SRGBColorSpace;
  gantryBanner.anisotropy = Math.min(8, maxAnisotropy);

  // 4b. Overhead Urban Expressway Directional Sign
  const hwCanvas = document.createElement('canvas');
  hwCanvas.width = 512;
  hwCanvas.height = 160;
  const hwCtx = hwCanvas.getContext('2d')!;
  hwCtx.fillStyle = '#0D3B2E';
  hwCtx.fillRect(0, 0, 512, 160);
  hwCtx.strokeStyle = '#E2E8F0';
  hwCtx.lineWidth = 6;
  hwCtx.strokeRect(8, 8, 496, 144);
  hwCtx.fillStyle = '#F8FAFC';
  hwCtx.font = '700 34px sans-serif';
  hwCtx.textAlign = 'center';
  hwCtx.fillText('DOWNTOWN EXPRESS  •  TUNNEL', 256, 62);
  hwCtx.fillStyle = '#94A3B8';
  hwCtx.font = '600 24px sans-serif';
  hwCtx.fillText('▼   LEFT LANES   |   APEX EXIT   ▼', 256, 118);

  const highwaySign = new THREE.CanvasTexture(hwCanvas);
  highwaySign.colorSpace = THREE.SRGBColorSpace;
  highwaySign.anisotropy = Math.min(8, maxAnisotropy);

  // 5. Soft Radial Contact Shadow Disc
  const sCanvas = document.createElement('canvas');
  sCanvas.width = 128;
  sCanvas.height = 128;
  const sctx = sCanvas.getContext('2d')!;
  const sg = sctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  sg.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
  sg.addColorStop(0.62, 'rgba(0, 0, 0, 0.5)');
  sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(sCanvas);

  // 6. Soft Radial Glow Texture (used for streetlamp pools & subtle car underglow)
  const nCanvas = document.createElement('canvas');
  nCanvas.width = 128;
  nCanvas.height = 128;
  const nctx = nCanvas.getContext('2d')!;
  const ng = nctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  ng.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  ng.addColorStop(0.45, 'rgba(255, 255, 255, 0.42)');
  ng.addColorStop(0.78, 'rgba(255, 255, 255, 0.12)');
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
  hlGrad.addColorStop(0, 'rgba(232, 246, 255, 0.7)');
  hlGrad.addColorStop(0.4, 'rgba(198, 232, 255, 0.3)');
  hlGrad.addColorStop(1, 'rgba(160, 212, 255, 0)');
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

  // 7b. Feathered Taillight Ribbon Trail
  const ttCanvas = document.createElement('canvas');
  ttCanvas.width = 64;
  ttCanvas.height = 256;
  const ttCtx = ttCanvas.getContext('2d')!;
  ttCtx.clearRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    const lenFade = Math.pow(1 - t, 1.85);
    const halfWidth = 28 * (1 - t * 0.58);
    const grad = ttCtx.createLinearGradient(32 - halfWidth, y, 32 + halfWidth, y);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.28, `rgba(255,255,255,${(0.42 * lenFade).toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${(0.95 * lenFade).toFixed(3)})`);
    grad.addColorStop(0.72, `rgba(255,255,255,${(0.42 * lenFade).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ttCtx.fillStyle = grad;
    ttCtx.fillRect(0, y, 64, 1);
  }
  const tailTrail = new THREE.CanvasTexture(ttCanvas);
  tailTrail.colorSpace = THREE.SRGBColorSpace;

  // 8. Atmospheric Night-City Sky Dome (Deep Midnight Blue Zenith -> Urban Twilight Horizon Haze + Stars)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 512;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d')!;
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, '#040814');
  skyGrad.addColorStop(0.32, '#091126');
  skyGrad.addColorStop(0.5, '#16213E');
  skyGrad.addColorStop(0.58, '#23284A');
  skyGrad.addColorStop(0.72, '#0C1222');
  skyGrad.addColorStop(1, '#050811');
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 512, 256);

  for (let i = 0; i < 200; i++) {
    const sx = Math.abs(Math.sin(i * 41.23) * 512) % 512;
    const sy = Math.abs(Math.sin(i * 93.17) * 105) % 105;
    const alpha = 0.22 + (i % 5) * 0.13;
    skyCtx.fillStyle = `rgba(215, 232, 255, ${alpha})`;
    skyCtx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  const nightSky = new THREE.CanvasTexture(skyCanvas);
  nightSky.colorSpace = THREE.SRGBColorSpace;

  // 9. High-Contrast Corner Chevron Warning Panel (Amber/White urban highway standard)
  const chevCanvas = document.createElement('canvas');
  chevCanvas.width = 256;
  chevCanvas.height = 128;
  const cctx = chevCanvas.getContext('2d')!;
  cctx.fillStyle = '#0F1522';
  cctx.fillRect(0, 0, 256, 128);
  cctx.strokeStyle = '#F59E0B';
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

  // 10. All 8 Floating Holographic Power-Up Emblems
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
    highwaySign,
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
      highwaySign.dispose();
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
