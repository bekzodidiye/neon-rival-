import type { ControlInput } from '../game/types';

export interface MobileTouchState {
  steerLeft: boolean;
  steerRight: boolean;
  gas: boolean;
  brake: boolean;
  drift: boolean;
}

/**
 * Unified desktop keyboard + mobile multi-touch input hub.
 * Cleanly separates continuous held intents from single-frame edge-triggered actions,
 * prevents page scroll during racing, and resets held keys on window blur.
 */
export class RacingInputHub {
  private held = new Set<string>();
  private justPressed = new Set<string>();
  private touch: MobileTouchState = {
    steerLeft: false,
    steerRight: false,
    gas: false,
    brake: false,
    drift: false,
  };
  private queuedActions = {
    usePowerUp: false,
    useNitro: false,
    cycleSlot: false,
    discardSlot: false,
    selectSlot: -1,
    toggleRearFire: false,
    toggleCamera: false,
    recover: false,
    pause: false,
  };
  private gameplayActive = false;
  private autoAccelerate = false;

  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onBlurBound: () => void;
  private onVisChangeBound: () => void;

  constructor() {
    this.onKeyDownBound = this.handleKeyDown.bind(this);
    this.onKeyUpBound = this.handleKeyUp.bind(this);
    this.onBlurBound = this.clearAll.bind(this);
    this.onVisChangeBound = () => {
      if (document.hidden) this.clearAll();
    };

    window.addEventListener('keydown', this.onKeyDownBound, { passive: false });
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    document.addEventListener('visibilitychange', this.onVisChangeBound);
  }

  public setGameplayActive(active: boolean): void {
    this.gameplayActive = active;
    if (!active) this.clearAll();
  }

  public setAutoAccelerate(enabled: boolean): void {
    this.autoAccelerate = enabled;
  }

  public setTouchButton(key: keyof MobileTouchState, pressed: boolean): void {
    this.touch[key] = pressed;
  }

  public triggerAction(
    action: 'usePowerUp' | 'useNitro' | 'cycleSlot' | 'discardSlot' | 'toggleRearFire' | 'toggleCamera' | 'recover' | 'pause',
  ): void {
    this.queuedActions[action] = true;
  }

  public selectSlot(index: number): void {
    this.queuedActions.selectSlot = index;
  }

  public clearAll(): void {
    this.held.clear();
    this.justPressed.clear();
    this.touch.steerLeft = false;
    this.touch.steerRight = false;
    this.touch.gas = false;
    this.touch.brake = false;
    this.touch.drift = false;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const code = e.code;
    if (
      this.gameplayActive &&
      (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight')
    ) {
      e.preventDefault();
    }

    if (!this.held.has(code)) {
      this.justPressed.add(code);
    }
    this.held.add(code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.held.delete(e.code);
  }

  /** Consume one simulation frame of input and reset single-frame edge triggers. */
  public sampleFrame(): {
    control: ControlInput;
    toggleCamera: boolean;
    toggleRearFire: boolean;
    pausePressed: boolean;
  } {
    const gasHeld = this.held.has('KeyW') || this.held.has('ArrowUp') || this.touch.gas || this.autoAccelerate;
    const brakeHeld = this.held.has('KeyS') || this.held.has('ArrowDown') || this.touch.brake;
    const leftHeld = this.held.has('KeyA') || this.held.has('ArrowLeft') || this.touch.steerLeft;
    const rightHeld = this.held.has('KeyD') || this.held.has('ArrowRight') || this.touch.steerRight;

    const steer = (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);

    let selectSlot = this.queuedActions.selectSlot;
    if (this.justPressed.has('Digit1')) selectSlot = 0;
    else if (this.justPressed.has('Digit2')) selectSlot = 1;
    else if (this.justPressed.has('Digit3')) selectSlot = 2;

    const instantRearFire =
      this.justPressed.has('KeyG') ||
      this.justPressed.has('KeyX') ||
      (this.justPressed.has('Space') && brakeHeld);

    const control: ControlInput = {
      throttle: gasHeld && !brakeHeld ? 1 : gasHeld ? 0.5 : 0,
      brake: brakeHeld ? 1 : 0,
      steer,
      drift: this.held.has('ControlLeft') || this.held.has('KeyB') || this.touch.drift || (brakeHeld && Math.abs(steer) > 0),
      useNitro: this.justPressed.has('ShiftLeft') || this.justPressed.has('ShiftRight') || this.queuedActions.useNitro,
      usePowerUp:
        this.justPressed.has('Space') ||
        this.justPressed.has('KeyG') ||
        this.justPressed.has('KeyX') ||
        this.queuedActions.usePowerUp,
      cycleSlot: this.justPressed.has('KeyQ') || this.queuedActions.cycleSlot,
      discardSlot: this.justPressed.has('KeyE') || this.queuedActions.discardSlot,
      selectSlot,
      rearView: this.held.has('KeyV'),
      rearFire: instantRearFire,
      instantRearFire,
      recover: this.justPressed.has('KeyR') || this.queuedActions.recover,
    };

    const toggleCamera = this.justPressed.has('KeyC') || this.queuedActions.toggleCamera;
    const toggleRearFire = this.justPressed.has('KeyF') || this.queuedActions.toggleRearFire;
    const pausePressed = this.justPressed.has('Escape') || this.justPressed.has('KeyP') || this.queuedActions.pause;

    // Clear edge-triggered flags
    this.justPressed.clear();
    this.queuedActions.usePowerUp = false;
    this.queuedActions.useNitro = false;
    this.queuedActions.cycleSlot = false;
    this.queuedActions.discardSlot = false;
    this.queuedActions.selectSlot = -1;
    this.queuedActions.toggleRearFire = false;
    this.queuedActions.toggleCamera = false;
    this.queuedActions.recover = false;
    this.queuedActions.pause = false;

    return { control, toggleCamera, toggleRearFire, pausePressed };
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    document.removeEventListener('visibilitychange', this.onVisChangeBound);
  }
}
