import type { NavDir } from '../gamepad';

/**
 * The menus on a controller: the D-pad or the left stick steps through the controls on screen,
 * A / ✕ presses the one in focus, B / ○ goes back, and left and right change a slider or a choice.
 * It moves the browser's own focus, so the mouse and keyboard work on the same controls as ever.
 */
export class PadNav {
  /** `layer` is the element whose visible controls are in play now (null: none). */
  constructor(private layer: () => HTMLElement | null) {}

  /** The visible, enabled controls of the layer, in page order. */
  private items(): HTMLElement[] {
    const root = this.layer();
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>('button, input, select, a[href]')].filter((e) => e.getClientRects().length > 0 && !(e as HTMLButtonElement).disabled);
  }

  private focused(items: HTMLElement[]): HTMLElement | null {
    const a = document.activeElement;
    return a instanceof HTMLElement && items.includes(a) ? a : null;
  }

  private focus(e: HTMLElement | undefined): void {
    e?.focus();
    e?.scrollIntoView({ block: 'nearest' });
  }

  /** Focuses the screen's main button (not its way back), or its first control. */
  focusFirst(): void {
    const items = this.items();
    this.focus(items.find((e) => e.classList.contains('primary') && e.dataset.padBack === undefined) ?? items[0]);
  }

  /** Up and down step through the controls; left and right change a slider or a choice, or step. */
  move(dir: NavDir): void {
    const items = this.items();
    const cur = this.focused(items);
    if (!cur) {
      this.focusFirst();
      return;
    }
    const step = dir === 'down' || dir === 'right' ? 1 : -1;
    if (dir === 'left' || dir === 'right') {
      if (cur instanceof HTMLInputElement && cur.type === 'range') {
        if (step > 0) cur.stepUp();
        else cur.stepDown();
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (cur instanceof HTMLSelectElement) {
        this.choose(cur, step);
        return;
      }
    }
    this.focus(items[(items.indexOf(cur) + step + items.length) % items.length]);
  }

  /** Presses the control in focus (a choice steps to its next option); with none, focuses one. */
  accept(): void {
    const cur = this.focused(this.items());
    if (!cur) this.focusFirst();
    else if (cur instanceof HTMLSelectElement) this.choose(cur, 1, true);
    else if (!(cur instanceof HTMLInputElement) || cur.type === 'checkbox') cur.click();
  }

  /** Presses the screen's way back (marked data-pad-back); false if it has none. */
  back(): boolean {
    const b = this.items().find((e) => e.dataset.padBack !== undefined);
    b?.click();
    return b !== undefined;
  }

  private choose(sel: HTMLSelectElement, step: number, wrap = false): void {
    const n = sel.options.length;
    const i = wrap ? (sel.selectedIndex + step + n) % n : Math.min(n - 1, Math.max(0, sel.selectedIndex + step));
    if (i === sel.selectedIndex) return;
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
