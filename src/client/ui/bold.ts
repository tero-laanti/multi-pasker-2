import { boldParts } from '../../shared/markup';

/** Puts the text in the element, its **codewords** bold. */
export function setBold(el: HTMLElement, text: string): void {
  el.replaceChildren(
    ...boldParts(text).map((p) => {
      if (!p.bold) return p.text;
      const b = document.createElement('strong');
      b.textContent = p.text;
      return b;
    }),
  );
}
