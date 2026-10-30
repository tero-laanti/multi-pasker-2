import { BUTTON, PadReader } from './gamepad';

/**
 * Keyboard, mouse and pointer lock. Mouse deltas are passed straight to `onLook` from the
 * event handler (no smoothing, no batching) so the camera turns on the very next frame.
 * Keys use `event.code`, i.e. physical positions, so WASD works on any layout.
 *
 * A game controller can stand in for them (gamepad.ts), for a player who wants one. It only
 * acts once it is used itself, and keyboard and mouse play puts it to sleep again, so a pad
 * lying on the desk never moves anyone: its buttons are kept apart from the keyboard's keys and
 * only added to them while it is in use.
 */

const BLOCKED_DEFAULTS = new Set(['Tab', 'Space', 'F2', 'F3', 'F4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);

export class Input {
  /** Keys held, on the keyboard or through the controller. */
  readonly keys = new Set<string>();
  private board = new Set<string>();
  private padKeys = new Set<string>();
  private pressed = new Set<string>();
  mouseLeft = false;
  mouseRight = false;
  private leftPressed = false;
  private rightPressed = false;
  private wheelSteps = 0;
  locked = false;
  /** True when the current lock was granted with unadjustedMovement (raw input). */
  rawActive = false;
  private lockTime = 0;
  onLook: (dx: number, dy: number) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  /** Every keydown, locked or not (UI shortcuts). */
  onKeyDown: (code: string, e: KeyboardEvent) => void = () => {};
  /** The controller is in use: used since the last keyboard or locked-mouse input. */
  padActive = false;
  /** The controller's sticks while it is in use (zero otherwise): -1..1. */
  readonly padMove = { forward: 0, right: 0 };
  readonly padLook = { x: 0, y: 0 };
  private padFire = false;
  private padAim = false;
  private padReader = new PadReader();
  /** Start, or A, pressed on the controller in use (to play or pause without the mouse). */
  onPadButton: (button: 'start' | 'a') => void = () => {};

  constructor(readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (BLOCKED_DEFAULTS.has(e.code) && (this.locked || e.code.startsWith('F'))) e.preventDefault();
      this.padActive = false;
      if (!e.repeat) {
        this.board.add(e.code);
        this.keys.add(e.code);
        this.pressed.add(e.code);
      }
      this.onKeyDown(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.board.delete(e.code);
      if (!this.padKeys.has(e.code)) this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.padActive = false;
      if (e.button === 0) {
        this.mouseLeft = true;
        this.leftPressed = true;
      } else if (e.button === 2) {
        this.mouseRight = true;
        this.rightPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      else if (e.button === 2) this.mouseRight = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.wheelSteps += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX;
      const dy = e.movementY;
      // Some browsers report one huge spurious delta right after locking.
      if (performance.now() - this.lockTime < 100 && Math.abs(dx) + Math.abs(dy) > 400) return;
      if (dx !== 0 || dy !== 0) {
        this.padActive = false;
        this.onLook(dx, dy);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      this.lockTime = performance.now();
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });
  }

  /** Requests pointer lock, preferring raw (unaccelerated) mouse input. */
  async lock(raw: boolean): Promise<void> {
    const el = this.target as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    if (raw) {
      try {
        await el.requestPointerLock({ unadjustedMovement: true });
        this.rawActive = true;
        return;
      } catch (err) {
        if ((err as DOMException).name !== 'NotSupportedError') throw err;
      }
    }
    this.rawActive = false;
    await el.requestPointerLock();
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Fire held: the left mouse button, or the controller's right trigger. */
  get fireHeld(): boolean {
    return this.mouseLeft || this.padFire;
  }

  /** Aim held: the right mouse button, or the controller's left trigger. */
  get aimHeld(): boolean {
    return this.mouseRight || this.padAim;
  }

  /**
   * Reads the first controller in the standard mapping, once a frame before the game steps.
   * Asleep (after keyboard or mouse play) it only watches for a button or a firm push of a
   * stick to wake it; awake, its buttons are held keys and presses like the keyboard's.
   */
  pollPad(): void {
    const pad = navigator.getGamepads?.().find((p): p is Gamepad => p !== null && p.connected && p.mapping === 'standard');
    const s = pad ? this.padReader.read(pad) : null;
    if (s?.used) this.padActive = true;
    const live = s !== null && this.padActive;
    const keys = live ? s.keys : new Set<string>();
    for (const c of keys) if (!this.padKeys.has(c)) this.pressed.add(c);
    this.padKeys = keys;
    this.keys.clear();
    for (const c of this.board) this.keys.add(c);
    for (const c of keys) this.keys.add(c);
    if (live && s.fire && !this.padFire) this.leftPressed = true;
    if (live && s.aim && !this.padAim) this.rightPressed = true;
    this.padFire = live && s.fire;
    this.padAim = live && s.aim;
    this.padMove.forward = live ? s.forward : 0;
    this.padMove.right = live ? s.right : 0;
    this.padLook.x = live ? s.lookX : 0;
    this.padLook.y = live ? s.lookY : 0;
    if (!live) return;
    this.wheelSteps += s.wheel;
    if (s.pressed.has(BUTTON.START)) this.onPadButton('start');
    else if (s.pressed.has(BUTTON.A)) this.onPadButton('a');
  }

  /** True once per physical key press since the last call for that key. */
  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  consumeLeftPress(): boolean {
    const p = this.leftPressed;
    this.leftPressed = false;
    return p;
  }

  consumeRightPress(): boolean {
    const p = this.rightPressed;
    this.rightPressed = false;
    return p;
  }

  consumeWheel(): number {
    const w = this.wheelSteps;
    this.wheelSteps = 0;
    return w;
  }

  /** Forget stale presses (e.g. after a menu was open). */
  clearPresses(): void {
    this.pressed.clear();
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheelSteps = 0;
  }

  private releaseAll(): void {
    this.board.clear();
    this.keys.clear();
    for (const c of this.padKeys) this.keys.add(c);
    this.mouseLeft = false;
    this.mouseRight = false;
    this.clearPresses();
  }
}
