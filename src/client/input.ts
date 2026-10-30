import { DEFAULT_BINDINGS, type Action, type Bindings } from './bindings';
import { padKind, setDevice } from './controls';
import { BUTTON, PadReader, type NavDir } from './gamepad';

/**
 * Keyboard, mouse and pointer lock. Mouse deltas are passed straight to `onLook` from the
 * event handler (no smoothing, no batching) so the camera turns on the very next frame.
 * Keys use `event.code`, i.e. physical positions, so WASD works on any layout; mouse buttons are
 * Mouse0–Mouse4. The game asks for actions (jump, fire…), which `bindings` turns into keys and
 * buttons.
 *
 * A game controller can stand in for them (gamepad.ts), for a player who wants one. It only
 * acts once it is used itself, and keyboard and mouse play puts it to sleep again, so a pad
 * lying on the desk never moves anyone: its actions are kept apart from the keyboard's keys and
 * only added to them while it is in use.
 */

const BLOCKED_DEFAULTS = new Set(['Tab', 'Space', 'F2', 'F3', 'F4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);
const NONE = new Set<Action>();

export class Input {
  /** What keys, mouse buttons and controller buttons do (Settings → Controls). */
  bindings: Bindings = DEFAULT_BINDINGS;
  /** Keys and mouse buttons held, and pressed since they were last asked for. */
  private board = new Set<string>();
  private pressed = new Set<string>();
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
  /** Actions held, and pressed, on the controller in use. */
  private padHeld = NONE;
  private padHit = new Set<Action>();
  private padReader = new PadReader();
  /** Start, A or B pressed on the controller in use: playing, pausing and the menus. */
  onPadButton: (button: 'start' | 'a' | 'b') => void = () => {};
  /** A step through the menus on the controller in use. */
  onPadNav: (dir: NavDir) => void = () => {};
  /** Any button pressed on the controller in use; true takes the press (Settings → Controls binding it). */
  onPadPress: (button: number) => boolean = () => false;

  constructor(readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (BLOCKED_DEFAULTS.has(e.code) && (this.locked || e.code.startsWith('F'))) e.preventDefault();
      this.sleepPad();
      if (!e.repeat) {
        this.board.add(e.code);
        this.pressed.add(e.code);
      }
      this.onKeyDown(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.board.delete(e.code);
    });
    window.addEventListener('blur', () => this.releaseAll());
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.sleepPad();
      this.board.add(`Mouse${e.button}`);
      this.pressed.add(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => {
      this.board.delete(`Mouse${e.button}`);
      // The side buttons would go back a page.
      if (this.locked && e.button >= 3) e.preventDefault();
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
        this.sleepPad();
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

  /** An action held: one of its keys or mouse buttons, or its button on the controller in use. */
  held(a: Action): boolean {
    return this.bindings.keys[a].some((c) => this.board.has(c)) || this.padHeld.has(a);
  }

  /** True once per press of one of the action's keys or buttons since it was last asked for. */
  consume(a: Action): boolean {
    let hit = this.padHit.delete(a);
    for (const c of this.bindings.keys[a]) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  /**
   * Reads the first controller in the standard mapping, once a frame before the game steps.
   * Asleep (after keyboard or mouse play) it only watches for a button or a firm push of a
   * stick to wake it; awake, its buttons hold and press actions like the keyboard's keys.
   */
  pollPad(): void {
    const pad = navigator.getGamepads?.().find((p): p is Gamepad => p !== null && p.connected && p.mapping === 'standard');
    const s = pad ? this.padReader.read(pad, performance.now() / 1000, this.bindings.buttons) : null;
    if (s?.used) this.padActive = true;
    const live = s !== null && this.padActive;
    if (live) setDevice(padKind(pad!.id));
    this.padHeld = live ? s.held : NONE;
    this.padMove.forward = live ? s.forward : 0;
    this.padMove.right = live ? s.right : 0;
    this.padLook.x = live ? s.lookX : 0;
    this.padLook.y = live ? s.lookY : 0;
    if (!live) return;
    for (const b of s.pressed) if (this.onPadPress(b)) return;
    for (const a of s.hit) this.padHit.add(a);
    if (s.pressed.has(BUTTON.START)) this.onPadButton('start');
    else if (s.pressed.has(BUTTON.A)) this.onPadButton('a');
    else if (s.pressed.has(BUTTON.B)) this.onPadButton('b');
    if (s.nav) this.onPadNav(s.nav);
  }

  /** Keyboard or mouse play: the controller sleeps, and hints name keys again. */
  private sleepPad(): void {
    this.padActive = false;
    setDevice('keyboard');
  }

  consumeWheel(): number {
    const w = this.wheelSteps;
    this.wheelSteps = 0;
    return w;
  }

  /** Forget stale presses (e.g. after a menu was open). */
  clearPresses(): void {
    this.pressed.clear();
    this.padHit.clear();
    this.wheelSteps = 0;
  }

  private releaseAll(): void {
    this.board.clear();
    this.clearPresses();
  }
}
