/**
 * Keyboard, mouse and pointer lock. Mouse deltas are passed straight to `onLook` from the
 * event handler (no smoothing, no batching) so the camera turns on the very next frame.
 * Keys use `event.code`, i.e. physical positions, so WASD works on any layout.
 */

const BLOCKED_DEFAULTS = new Set(['Tab', 'Space', 'F2', 'F3', 'F4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);

export class Input {
  readonly keys = new Set<string>();
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

  constructor(readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (BLOCKED_DEFAULTS.has(e.code) && (this.locked || e.code.startsWith('F'))) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.pressed.add(e.code);
      }
      this.onKeyDown(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
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
      if (dx !== 0 || dy !== 0) this.onLook(dx, dy);
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
    this.keys.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
    this.clearPresses();
  }
}
