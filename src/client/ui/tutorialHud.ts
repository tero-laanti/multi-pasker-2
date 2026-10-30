import { UI } from '../../shared/ui';
import { TUTORIAL_STEPS, type TutorialStep } from '../game/tutorial';
import { WEB } from '../web';
import { PairPanel } from './pair';
import { device, onControls, withKeys } from '../controls';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export interface TutorialHudActions {
  /** Back to the range after pairing: lock the mouse again. */
  resume(): void;
  openSimulator(): void;
  /** Use the virtual phone on this screen instead of one's own. */
  openVirtual(): void;
}

/**
 * The training's instructions at the top of the screen, and the pairing screen shown when the
 * phone is picked up: why it is safe to use your own phone, the QR code, and the way out.
 */
export class TutorialHud {
  readonly pair: PairPanel;
  private panel: HTMLDivElement;
  private count: HTMLDivElement;
  private title: HTMLDivElement;
  private body: HTMLDivElement;
  private modal: HTMLDivElement;
  private modalBody: HTMLDivElement;
  private connected: HTMLDivElement;

  constructor(hudRoot: HTMLElement, appRoot: HTMLElement, private a: TutorialHudActions) {
    this.panel = el('div', 'tutorial hidden', hudRoot);
    const head = el('div', 'tutorial-head', this.panel);
    el('div', 'tutorial-label', head, UI.tutorial.label);
    this.count = el('div', 'tutorial-count', head);
    this.title = el('div', 'tutorial-title', this.panel);
    this.body = el('div', 'tutorial-body', this.panel);

    this.modal = el('div', 'tutorial-modal hidden', appRoot);
    const card = el('div', 'tutorial-card', this.modal);
    el('div', 'tutorial-card-title', card, UI.tutorial.pairTitle);
    this.modalBody = el('div', 'tutorial-card-body', card);
    const cols = el('div', 'tutorial-cols', this.modalBody);
    const why = el('div', 'tutorial-why', cols);
    el('div', 'tutorial-lead', why, WEB ? UI.web.trainingLead : UI.tutorial.pairLead);
    // What the phone page is and isn't (nothing to install, the local network only): the web version has no phone page.
    if (!WEB) {
      const list = el('ul', 'tutorial-points', why);
      for (const point of UI.tutorial.pairPoints) el('li', '', list, point);
    }
    this.pair = new PairPanel(() => a.openSimulator(), () => a.openVirtual());
    cols.appendChild(this.pair.root);
    this.connected = el('div', 'tutorial-connected hidden', card);
    el('div', 'tutorial-ok', this.connected, UI.tutorial.pairedTitle);
    el('div', 'tutorial-card-body', this.connected, UI.tutorial.pairedBody);
    const go = el('button', 'btn primary', this.connected, UI.tutorial.pairedButton);
    go.onclick = () => a.resume();
    go.dataset.padBack = '';
    onControls(() => this.render());
  }

  /** The pairing card over the range, when open (a controller moves through its buttons). */
  get modalRoot(): HTMLElement {
    return this.modal;
  }

  /** Writes the panel's text; again when the player switches between keys and a controller. */
  private render: () => void = () => {};

  get modalOpen(): boolean {
    return !this.modal.classList.contains('hidden');
  }

  setVisible(on: boolean): void {
    this.panel.classList.toggle('hidden', !on);
    if (!on) this.hideModal();
  }

  /** The instructions for a step (and the count, "3 / 5"). */
  show(step: TutorialStep): void {
    const s = step === 'pair' ? 'phone' : step;
    const i = TUTORIAL_STEPS.indexOf(s);
    this.count.textContent = step === 'done' ? '' : `${i + 1} / ${TUTORIAL_STEPS.length}`;
    this.render = () => {
      const pad = UI.tutorial.padSteps[step];
      const text = WEB && step === 'pair' ? UI.web.pairStep : device() !== 'keyboard' && pad ? pad : UI.tutorial.steps[step]!;
      this.title.textContent = text.title;
      this.body.textContent = withKeys(text.body);
    };
    this.render();
    this.panel.classList.toggle('done', step === 'done');
    this.panel.classList.toggle('lesson', step === 'reload');
    this.panel.classList.remove('settled');
  }

  /** After a while the finished panel shrinks to one line under the range's drill line. */
  settle(): void {
    this.panel.classList.add('settled');
    this.render = () => {
      this.body.textContent = withKeys(UI.tutorial.settled);
    };
    this.render();
  }

  /** Hidden under the pause menu (it would cover its title). */
  setPanelVisible(on: boolean): void {
    this.panel.classList.toggle('paused', !on);
  }

  /** The reload lesson: there is no spare magazine. */
  noSpare(): void {
    this.render = () => {
      this.title.textContent = UI.tutorial.noSpareTitle;
      this.body.textContent = UI.tutorial.noSpare;
    };
    this.render();
  }

  showModal(): void {
    this.modal.classList.remove('hidden');
    this.modalBody.classList.remove('hidden');
    this.connected.classList.add('hidden');
  }

  /** The phone came online while the pairing screen was up. */
  showConnected(): void {
    this.modalBody.classList.add('hidden');
    this.connected.classList.remove('hidden');
  }

  hideModal(): void {
    this.modal.classList.add('hidden');
  }
}
