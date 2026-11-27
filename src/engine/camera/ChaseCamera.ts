import * as THREE from 'three';
import type { CameraMode, RacerState } from '../../game/types';
import type { BuiltTrack } from '../../game/trackMath';
import { projectPointToTrack } from '../../game/trackMath';

const _desiredPos = new THREE.Vector3();
const _desiredLook = new THREE.Vector3();

/**
 * Dedicated spring-damped Chase Camera module (V5.0 Stage 4).
 * Tuned for Blur-style lower-center hero car framing, smooth velocity look-ahead,
 * expressive drift swing, speed/Nitro FOV expansion, and road-barrier collision avoidance.
 */
export class ChaseCameraController {
  public readonly currentPos = new THREE.Vector3(0, 3.2, -7.2);
  public readonly currentLook = new THREE.Vector3(0, 1.0, 12);
  public trauma = 0;
  private smoothedYaw = 0;
  private smoothedSpeed = 0;
  private initialized = false;

  public reset(player: RacerState): void {
    const fwdX = Math.sin(player.heading);
    const fwdZ = Math.cos(player.heading);
    this.smoothedYaw = player.heading;
    this.smoothedSpeed = player.speed;
    this.trauma = 0;
    this.currentPos.set(player.x - fwdX * 6.4, player.y + 2.35, player.z - fwdZ * 6.4);
    this.currentLook.set(player.x + fwdX * 16, player.y + 1.05, player.z + fwdZ * 16);
    this.initialized = true;
  }

  public addTrauma(amount: number): void {
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
  ): void {
    if (!this.initialized) {
      this.reset(player);
    }

    // Smooth camera yaw toward blend of car heading & velocity vector (expressive drift camera lag)
    const speedAbs = Math.abs(player.speed);
    this.smoothedSpeed += (speedAbs - this.smoothedSpeed) * (1 - Math.exp(-7 * dt));

    let targetHeading = player.heading;
    if (speedAbs > 10 && !rearView) {
      const velHeading = Math.atan2(player.vx, player.vz);
      let vDiff = velHeading - player.heading;
      while (vDiff > Math.PI) vDiff -= Math.PI * 2;
      while (vDiff < -Math.PI) vDiff += Math.PI * 2;
      // Blend 35% toward velocity heading during powerslides so player sees corner apex & rear quarter
      targetHeading = player.heading + vDiff * (player.isDrifting ? 0.36 : 0.14);
    }

    let yawDiff = targetHeading - this.smoothedYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const yawLambda = mode === 'hood' || rearView ? 28 : player.isDrifting ? 5.8 : 8.5;
    this.smoothedYaw += yawDiff * (1 - Math.exp(-yawLambda * dt));

    const camFwdX = Math.sin(this.smoothedYaw);
    const camFwdZ = Math.cos(this.smoothedYaw);
    const carFwdX = Math.sin(player.heading);
    const carFwdZ = Math.cos(player.heading);
    const dir = rearView ? -1 : 1;

    // Speed-responsive subtle camera pull-back during Nitro acceleration
    const nitroPull = player.nitroTimer > 0 ? 0.65 : 0;
    const accelPull = Math.min(0.45, Math.max(0, this.smoothedSpeed / 80) * 0.45);

    // Stage 4 proposed Blur sweet-spot tuning: Near distance 6.2m, height 2.3m, base FOV 58 deg
    let backDist =
      mode === 'far'
        ? 8.4 + accelPull + nitroPull
        : mode === 'hood'
          ? -0.45
          : 6.15 + accelPull + nitroPull;
    let camHeight = mode === 'far' ? 3.15 : mode === 'hood' ? 1.28 : 2.3;

    if (rearView) {
      backDist = -6.2;
      camHeight = 2.4;
    }

    const useFwdX = mode === 'hood' || rearView ? carFwdX : camFwdX;
    const useFwdZ = mode === 'hood' || rearView ? carFwdZ : camFwdZ;

    _desiredPos.set(
      player.x - useFwdX * backDist * dir,
      player.y + camHeight,
      player.z - useFwdZ * backDist * dir,
    );

    // Camera barrier collision avoidance (keep camera inside urban barrier envelope so walls never block view)
    if (track && mode !== 'hood') {
      const camProj = projectPointToTrack(track, _desiredPos.x, _desiredPos.z, player.trackT);
      const maxCamLat = camProj.sample.width * 0.5 - 0.65;
      if (Math.abs(camProj.lateralOffset) > maxCamLat) {
        const clamped = Math.sign(camProj.lateralOffset) * maxCamLat;
        _desiredPos.x = camProj.sample.x + camProj.sample.rx * clamped;
        _desiredPos.z = camProj.sample.z + camProj.sample.rz * clamped;
      }
      _desiredPos.y = Math.max(camProj.sample.y + 1.45, _desiredPos.y);
    }

    // Look ahead slightly above car roof so car stays grounded in lower-center third of viewport
    const lookDist = mode === 'hood' ? 32 : 17.5;
    _desiredLook.set(
      player.x + useFwdX * lookDist * dir,
      player.y + (mode === 'hood' ? 1.12 : 1.05),
      player.z + useFwdZ * lookDist * dir,
    );

    if (mode === 'hood' || rearView) {
      this.currentPos.copy(_desiredPos);
      this.currentLook.copy(_desiredLook);
    } else {
      const posDamp = 1 - Math.exp(-11.5 * dt);
      const lookDamp = 1 - Math.exp(-14.0 * dt);
      this.currentPos.lerp(_desiredPos, posDamp);
      this.currentLook.lerp(_desiredLook, lookDamp);
    }

    // Decaying trauma^2 camera shake (attenuated under reducedMotion)
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    const motionScale = reducedMotion ? 0.2 : 1.0;
    const shakeAmp = (this.trauma * this.trauma * 0.45 + (player.nitroTimer > 0 ? 0.032 : 0)) * motionScale;
    const shakeX = (Math.random() - 0.5) * shakeAmp;
    const shakeY = (Math.random() - 0.5) * shakeAmp;

    camera.position.set(this.currentPos.x + shakeX, this.currentPos.y + shakeY, this.currentPos.z);
    camera.lookAt(this.currentLook);

    // Smooth speed-based + Nitro vertical FOV expansion (58 -> 72 -> 79 on Nitro)
    const speedRatio = Math.min(1.2, this.smoothedSpeed / 74);
    const fovExpand = (speedRatio * 13 + (player.nitroTimer > 0 ? 7.5 : 0)) * (reducedMotion ? 0.35 : 1.0);
    const targetFov = (mode === 'hood' ? 64 : 58) + fovExpand;
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6.5 * dt));
    camera.updateProjectionMatrix();
  }
}
