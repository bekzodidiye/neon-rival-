import * as THREE from 'three';
import type { CameraMode, RacerState } from '../../game/types';
import type { BuiltTrack } from '../../game/trackMath';
import { projectPointToTrack } from '../../game/trackMath';

const _desiredPos = new THREE.Vector3();
const _desiredLook = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

/**
 * Dedicated spring-damped Chase Camera module (V6.0).
 * Uses a single consistent coordinate convention (+forward = [sin(yaw), cos(yaw)]):
 * - Forward views (near / far / hood) sit behind (or on hood of) the car looking along +forward.
 * - Rear-view sits ahead of the car (+5.8m along +carForward) looking backward (-18m along -carForward)
 *   so the player clearly observes pursuing opponents and incoming attacks.
 * Includes track-corridor + optional Three.js geometry raycast collision avoidance.
 */
export class ChaseCameraController {
  public readonly currentPos = new THREE.Vector3(0, 3.2, -7.2);
  public readonly currentLook = new THREE.Vector3(0, 1.0, 12);
  public trauma = 0;
  private smoothedYaw = 0;
  private smoothedSpeed = 0;
  private initialized = false;
  private prevRearView = false;

  public reset(player: RacerState): void {
    const fwdX = Math.sin(player.heading);
    const fwdZ = Math.cos(player.heading);
    this.smoothedYaw = player.heading;
    this.smoothedSpeed = player.speed;
    this.trauma = 0;
    this.prevRearView = false;
    this.currentPos.set(player.x - fwdX * 6.2, player.y + 2.3, player.z - fwdZ * 6.2);
    this.currentLook.set(player.x + fwdX * 17.5, player.y + 1.05, player.z + fwdZ * 17.5);
    this.initialized = true;
  }

  public addTrauma(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public update(
    camera: THREE.PerspectiveCamera,
    player: RacerState,
    track: BuiltTrack | null,
    mode: CameraMode,
    rearView: boolean,
    reducedMotion: boolean,
    dt: number,
    colliders?: THREE.Object3D[],
  ): void {
    if (!this.initialized) {
      this.reset(player);
    }

    const safeDt = Math.max(0.001, Math.min(0.1, Number.isFinite(dt) ? dt : 1 / 60));
    const speedAbs = Math.abs(player.speed);
    this.smoothedSpeed += (speedAbs - this.smoothedSpeed) * (1 - Math.exp(-7 * safeDt));

    const carFwdX = Math.sin(player.heading);
    const carFwdZ = Math.cos(player.heading);

    // Smooth camera yaw toward blend of car heading & velocity vector (expressive drift camera lag)
    let targetHeading = player.heading;
    if (speedAbs > 10 && !rearView) {
      const velHeading = Math.atan2(player.vx, player.vz);
      let vDiff = velHeading - player.heading;
      while (vDiff > Math.PI) vDiff -= Math.PI * 2;
      while (vDiff < -Math.PI) vDiff += Math.PI * 2;
      targetHeading = player.heading + vDiff * (player.isDrifting ? 0.36 : 0.14);
    }

    let yawDiff = targetHeading - this.smoothedYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const yawLambda = mode === 'hood' || rearView ? 28 : player.isDrifting ? 5.8 : 8.5;
    this.smoothedYaw += yawDiff * (1 - Math.exp(-yawLambda * safeDt));

    const camFwdX = Math.sin(this.smoothedYaw);
    const camFwdZ = Math.cos(this.smoothedYaw);

    // Speed-responsive subtle camera pull-back during Nitro acceleration
    const nitroPull = player.nitroTimer > 0 ? 0.65 : 0;
    const accelPull = Math.min(0.45, Math.max(0, this.smoothedSpeed / 80) * 0.45);

    if (rearView) {
      // Consistent Rear-View Convention:
      // Place camera ahead of the player car (+5.8m along +carFwd) and look backward (-18m along -carFwd)
      // so the player sees their car front & pursuing opponents behind them.
      _desiredPos.set(
        player.x + carFwdX * 5.8,
        player.y + 2.25,
        player.z + carFwdZ * 5.8,
      );
      _desiredLook.set(
        player.x - carFwdX * 18.0,
        player.y + 1.1,
        player.z - carFwdZ * 18.0,
      );
    } else if (mode === 'hood') {
      // Hood camera mounted cleanly at windshield base looking forward along +carFwd
      _desiredPos.set(
        player.x + carFwdX * 0.55,
        player.y + 1.28,
        player.z + carFwdZ * 0.55,
      );
      _desiredLook.set(
        player.x + carFwdX * 32.0,
        player.y + 1.12,
        player.z + carFwdZ * 32.0,
      );
    } else {
      // Near / Far Chase Camera positioned BEHIND player (-backDist along camFwd) looking AHEAD (+17.5m)
      const backDist =
        mode === 'far'
          ? 8.4 + accelPull + nitroPull
          : 6.15 + accelPull + nitroPull;
      const camHeight = mode === 'far' ? 3.15 : 2.3;

      _desiredPos.set(
        player.x - camFwdX * backDist,
        player.y + camHeight,
        player.z - camFwdZ * backDist,
      );
      _desiredLook.set(
        player.x + camFwdX * 17.5,
        player.y + 1.05,
        player.z + camFwdZ * 17.5,
      );
    }

    // 1. Track-corridor barrier containment (prevents clipping outside road barriers or under elevated deck)
    if (track && mode !== 'hood') {
      const camProj = projectPointToTrack(track, _desiredPos.x, _desiredPos.z, player.trackT);
      const maxCamLat = camProj.sample.width * 0.5 - 0.7;
      if (Math.abs(camProj.lateralOffset) > maxCamLat) {
        const clamped = Math.sign(camProj.lateralOffset) * maxCamLat;
        _desiredPos.x = camProj.sample.x + camProj.sample.rx * clamped;
        _desiredPos.z = camProj.sample.z + camProj.sample.rz * clamped;
      }
      _desiredPos.y = Math.max(camProj.sample.y + 1.45, _desiredPos.y);
    }

    // 2. Optional geometry-based raycast collision pull-in against world obstacle meshes
    if (colliders && colliders.length > 0 && mode !== 'hood') {
      _rayOrigin.set(player.x, player.y + 1.2, player.z);
      _rayDir.copy(_desiredPos).sub(_rayOrigin);
      const dist = _rayDir.length();
      if (dist > 0.5) {
        _rayDir.divideScalar(dist);
        _raycaster.set(_rayOrigin, _rayDir);
        _raycaster.near = 0.4;
        _raycaster.far = dist;
        const hits = _raycaster.intersectObjects(colliders, true);
        if (hits.length > 0 && hits[0].distance < dist - 0.35) {
          const safeDist = Math.max(1.8, hits[0].distance - 0.45);
          _desiredPos.copy(_rayOrigin).addScaledVector(_rayDir, safeDist);
        }
      }
    }

    // Snap immediately on rear-view toggle or hood mode; spring-damp smoothly in chase modes
    const snapImmediate = mode === 'hood' || rearView || this.prevRearView !== rearView;
    this.prevRearView = rearView;

    if (snapImmediate) {
      this.currentPos.copy(_desiredPos);
      this.currentLook.copy(_desiredLook);
    } else {
      const posDamp = 1 - Math.exp(-11.5 * safeDt);
      const lookDamp = 1 - Math.exp(-14.0 * safeDt);
      this.currentPos.lerp(_desiredPos, posDamp);
      this.currentLook.lerp(_desiredLook, lookDamp);
    }

    // Decaying trauma^2 camera shake (attenuated under reducedMotion)
    this.trauma = Math.max(0, this.trauma - safeDt * 2.1);
    const motionScale = reducedMotion ? 0.2 : 1.0;
    const shakeAmp = (this.trauma * this.trauma * 0.45 + (player.nitroTimer > 0 ? 0.032 : 0)) * motionScale;
    const shakeX = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
    const shakeY = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;

    camera.position.set(this.currentPos.x + shakeX, this.currentPos.y + shakeY, this.currentPos.z);
    camera.lookAt(this.currentLook);

    // Smooth speed-based + Nitro vertical FOV expansion (58 -> 71 -> 78.5 on Nitro)
    const speedRatio = Math.min(1.2, this.smoothedSpeed / 74);
    const fovExpand = (speedRatio * 13 + (player.nitroTimer > 0 ? 7.5 : 0)) * (reducedMotion ? 0.35 : 1.0);
    const baseFov = mode === 'hood' ? 64 : rearView ? 62 : 58;
    const targetFov = baseFov + fovExpand;
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6.5 * safeDt));
    camera.updateProjectionMatrix();
  }
}
