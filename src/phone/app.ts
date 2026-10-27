import { FI } from '../shared/fi';
import { ACCENTS, PROTOCOL_VERSION, type MsgState, type PhoneConversation, type PhoneMessage, type PhoneServerMsg, type PhoneStatus, type UpgradeOffer } from '../shared/protocol';
import { UI } from '../shared/ui';
import { Keyboard } from './keyboard';
import { Media } from './media';
import { PhoneNet } from './net';

const P = UI.phone;
const TOKEN_KEY = 'kenttaposti.token';
const STARTED_KEY = 'kenttaposti.started';
const CHAT_KEY = 'kenttaposti.chat';

type View = 'connecting' | 'pair' | 'confirm' | 'sound' | 'list' | 'chat' | 'replaced';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}

function store(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

const clock = (at: number) => {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** +358 numbers in groups; short numbers as they are. */
function formatNumber(n: string): string {
  if (!n.startsWith('+') || n.length < 8) return n;
  const cc = n.slice(0, 4);
  const rest = n.slice(4).replace(/(\d{3})(?=\d)/g, '$1 ');
  return `${cc} ${rest}`;
}

const AVATAR_COLORS = ['#6b7a3d', '#8a5a2b', '#3d6b7a', '#7a3d5a', '#5a3d7a', '#3d7a52', '#7a6b3d'];

function avatarColor(name: string): string {
  let x = 0;
  for (const c of name) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[x % AVATAR_COLORS.length]!;
}

const STATE_LABEL: Record<MsgState, string> = { sending: P.sending, sent: P.sent, delivered: P.delivered, read: P.read, failed: P.failed };

/** Kenttäposti: the phone app. One page, a few views, its own keyboard. */
export class PhoneApp {
  private net = new PhoneNet(PROTOCOL_VERSION);
  private media = new Media();
  private kb: Keyboard;
  private view: View = 'connecting';
  private token = store('local')?.getItem(TOKEN_KEY) ?? '';
  private pairSecret = '';
  private code = '';
  private player: { id: number; name: string; color: number } | null = null;
  private convs = new Map<string, PhoneConversation>();
  private status: PhoneStatus | null = null;
  /** An inventory check's deadline (performance.now() ms; 0: none) and its banner ticker. */
  private inventoryEnd = 0;
  private inventoryTimer = 0;
  private chat: string | null = null;
  private drafts = new Map<string, string>();
  private typing = new Set<string>();
  private sim = new URLSearchParams(location.search).has('sim');
  /**
   * The virtual phone: this app in a frame on the player's own screen, for those without a
   * phone. Mouse only (no keyboard), and the phone is in the character's hand while it shows.
   */
  private virtual = new URLSearchParams(location.search).has('virtual');
  private virtualShown = false;
  private dev = false;
  private replacedOld = false;
  private error = '';
  private rid = 0;
  private sheet: { number: string } | null = null;
  private screen: HTMLDivElement;
  private msgs: HTMLDivElement | null = null;
  private field: HTMLDivElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private subtitle: HTMLDivElement | null = null;
  private sheetDisplay: HTMLDivElement | null = null;
  private codeBoxes: HTMLDivElement[] = [];
  private playing: { audio: HTMLAudioElement; bubble: HTMLElement } | null = null;
  /** After sending: the short "Sending…" screen, then back to the chat list. */
  private sending: { rid: string; since: number; timer: number } | null = null;
  /** The upgrade screen, while a choice is waiting. */
  private upgrade: UpgradeOffer | null = null;
  private upgradePick: string | null = null;
  private upgradeSent = false;

  constructor(private root: HTMLElement) {
    this.screen = h('div', 'screen', undefined, root);
    this.kb = new Keyboard(
      {
        input: (ch) => this.input(ch),
        backspace: () => this.backspace(),
        enter: () => this.enter(),
      },
      () => this.net.touch(),
    );
    if (this.virtual) {
      document.body.classList.add('virtual');
      // The game says when the virtual phone is on screen (the phone is out exactly then).
      window.addEventListener('message', (e) => {
        if (e.origin !== location.origin || (e.data as { t?: string })?.t !== 'virtualShown') return;
        this.virtualShown = !!(e.data as { on: boolean }).on;
        this.updateOut();
        if (this.virtualShown) this.caughtUp();
      });
      // No typing on the keyboard here; Esc only puts the virtual phone away.
      window.addEventListener('keydown', (e) => {
        e.preventDefault();
        if (e.key === 'Escape') window.parent.postMessage({ t: 'virtualClose' }, location.origin);
      });
    }
    if (this.sim) {
      document.body.classList.add('sim');
      const t = h('div', 'sim-title', P.simTitle);
      h('div', 'sim-hint', P.simHint, t);
      document.body.insertBefore(t, document.body.firstChild);
      this.kb.attachPhysical();
    }
    // Any touch counts as phone activity (the glow in the player's hand).
    root.addEventListener('pointerdown', () => this.net.touch(), { passive: true });
    // Switching apps or locking the screen puts the phone down.
    document.addEventListener('visibilitychange', () => this.updateOut());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.onStatus = () => this.renderBanner();
    this.net.hello = () => {
      const how = { sim: this.sim, virtual: this.virtual };
      if (this.pairSecret) return { pair: this.pairSecret, ...how };
      if (this.token && !this.virtual) return { token: this.token, ...how };
      if (this.code.length === 4) return { code: this.code, ...how };
      return null;
    };
  }

  start(): void {
    const hash = location.hash.replace(/^#/, '').replace(/^p=/, '');
    if (hash) this.pairSecret = hash;
    if (this.pairSecret || this.token) {
      this.show('connecting');
      this.net.connect(true);
    } else {
      this.show('pair');
    }
  }

  // ---- server ----

  private onMessage(m: PhoneServerMsg): void {
    switch (m.t) {
      case 'phoneWelcome': {
        const fresh = !!this.pairSecret || this.code.length === 4;
        this.token = m.token;
        // The virtual phone pairs afresh each time; a real phone keeps its token to resume.
        if (!this.virtual) store('local')?.setItem(TOKEN_KEY, m.token);
        if (this.pairSecret) history.replaceState(null, '', location.pathname + location.search);
        this.pairSecret = '';
        this.code = '';
        this.player = m.player;
        this.status = m.status;
        this.dev = m.dev;
        this.replacedOld = m.replaced;
        this.convs = new Map(m.convs.map((c) => [c.id, c]));
        this.setUpgrade(m.upgrade);
        if (this.view === 'chat' || this.view === 'list') {
          this.render();
          break;
        }
        const started = store('session')?.getItem(STARTED_KEY) === '1';
        // On the computer there is no screen to keep awake: straight to the chats.
        if (this.virtual) this.show('list');
        else if (fresh || !started || !this.media.started) this.show('confirm');
        else this.openSaved();
        break;
      }
      case 'pairFailed':
        if (m.reason === 'token') {
          this.token = '';
          store('local')?.removeItem(TOKEN_KEY);
        }
        this.net.stop();
        this.pairSecret = '';
        this.code = '';
        this.error = m.reason === 'code' ? P.pairFailed : m.reason === 'version' ? P.pairVersion : m.reason === 'sim' ? P.pairSim : P.pairToken;
        this.show('pair');
        break;
      case 'replaced':
        this.net.stop();
        this.token = '';
        store('local')?.removeItem(TOKEN_KEY);
        this.show('replaced');
        break;
      case 'status':
        this.status = m.s;
        this.renderBanner();
        this.renderRank();
        break;
      case 'inventory':
        this.inventoryEnd = m.left > 0 ? performance.now() + m.left * 1000 : 0;
        window.clearInterval(this.inventoryTimer);
        if (this.inventoryEnd) this.inventoryTimer = window.setInterval(() => this.renderBanner(), 250);
        this.renderBanner();
        break;
      case 'upgrade':
        this.setUpgrade(m.offer);
        break;
      case 'conv':
        if (!this.convs.has(m.c.id)) this.convs.set(m.c.id, m.c);
        if (this.sheet && m.c.id === this.sheet.number) {
          this.sheet = null;
          this.openChat(m.c.id);
        } else if (this.view === 'list') this.render();
        break;
      case 'msg':
        this.addMessage(m.conv, m.m);
        break;
      case 'state':
        this.setState(m.conv, m.id, m.state);
        break;
      case 'typing':
        if (m.on) this.typing.add(m.conv);
        else this.typing.delete(m.conv);
        if (this.view === 'chat' && this.chat === m.conv) {
          this.renderTyping();
          this.renderSubtitle();
        }
        break;
      default:
        break;
    }
  }

  private addMessage(convId: string, msg: PhoneMessage): void {
    let c = this.convs.get(convId);
    if (!c) {
      c = { id: convId, name: convId, messages: [], unread: 0 };
      this.convs.set(convId, c);
    }
    const i = c.messages.findIndex((x) => x.id === msg.id);
    if (i >= 0) {
      c.messages[i] = msg;
      if (this.view === 'chat' && this.chat === convId) this.renderMessages();
      return;
    }
    c.messages.push(msg);
    const viewing = this.view === 'chat' && this.chat === convId && this.onScreen;
    if (msg.from === 'them') {
      if (viewing) this.net.read(convId);
      else c.unread++;
      this.media.play('phone_in', 0.8);
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    }
    if (viewing) this.renderMessages(true);
    else if (this.view === 'list') this.render();
  }

  private setState(convId: string, id: string, state: MsgState): void {
    const m = this.convs.get(convId)?.messages.find((x) => x.id === id);
    if (!m) return;
    m.state = state;
    if (this.view === 'chat' && this.chat === convId) this.renderMessages();
  }

  // ---- keyboard ----

  private input(ch: string): void {
    if (this.view === 'pair') {
      if (!/\d/.test(ch) || this.code.length >= 4) return;
      this.code += ch;
      this.error = '';
      this.renderCode();
      if (this.code.length === 4) {
        this.net.stop();
        this.net.connect(true);
      }
      return;
    }
    if (this.sheet) {
      if (!/[\d+]/.test(ch) || this.sheet.number.length >= 20) return;
      if (ch === '+' && this.sheet.number.length > 0) return;
      this.sheet.number += ch;
      this.renderSheet();
      return;
    }
    if (this.view !== 'chat' || !this.chat) return;
    const d = (this.drafts.get(this.chat) ?? '') + ch;
    if (d.length > 300) return;
    this.setDraft(d);
  }

  private backspace(): void {
    if (this.view === 'pair') {
      this.code = this.code.slice(0, -1);
      this.renderCode();
      return;
    }
    if (this.sheet) {
      this.sheet.number = this.sheet.number.slice(0, -1);
      this.renderSheet();
      return;
    }
    if (this.view !== 'chat' || !this.chat) return;
    const d = this.drafts.get(this.chat) ?? '';
    // Whole characters, including Å/Ä/Ö typed as combining sequences.
    this.setDraft([...d].slice(0, -1).join(''));
  }

  private enter(): void {
    if (this.sheet) {
      this.submitSheet();
      return;
    }
    if (this.view === 'chat') this.sendDraft();
  }

  private setDraft(d: string): void {
    if (!this.chat) return;
    this.drafts.set(this.chat, d);
    this.net.draft(this.chat, d);
    this.renderField();
    this.kb.wantCapital(d.length === 0 || /[.!?]\s$/.test(d));
  }

  private sendDraft(): void {
    const conv = this.chat;
    if (!conv) return;
    const text = (this.drafts.get(conv) ?? '').trim();
    if (!text) return;
    const rid = `${this.token.slice(0, 8)}-${Date.now().toString(36)}-${++this.rid}`;
    const s = this.status;
    this.addMessage(conv, { id: rid, from: 'me', text, at: Date.now(), state: 'sending' });
    this.net.send({ t: 'send', rid, conv, text, life: s?.life ?? 0, round: s?.round ?? 0 });
    this.media.play('phone_out', 0.5);
    this.setDraft('');
    this.showSending(rid);
  }

  /** A moment of "Sending…", then back to the list: the phone goes down. */
  private showSending(rid: string): void {
    const overlay = h('div', 'sending', undefined, this.screen);
    h('div', 'spinner', '', overlay);
    h('div', 'sending-text', P.sendingScreen, overlay);
    const since = performance.now();
    const check = () => {
      const waited = performance.now() - since;
      if ((waited >= 650 && !this.net.pending(rid)) || waited >= 2000) {
        this.sending = null;
        if (this.view === 'chat') {
          this.chat = null;
          store('session')?.removeItem(CHAT_KEY);
          this.show('list');
        }
        return;
      }
      if (this.sending) this.sending.timer = window.setTimeout(check, 50);
    };
    this.sending = { rid, since, timer: window.setTimeout(check, 50) };
  }

  /**
   * The phone is "out" (in the character's hand) while a chat, the number pad or an upgrade is
   * open; the virtual phone whenever it is on screen.
   */
  private updateOut(): void {
    if (this.virtual) {
      this.net.out(this.virtualShown);
      return;
    }
    const visible = document.visibilityState === 'visible';
    this.net.out(visible && (this.view === 'chat' || this.sheetOpen || this.upgrade !== null));
  }

  /** The phone is in front of its player: visible, and (the virtual one) shown in the game. */
  private get onScreen(): boolean {
    return document.visibilityState === 'visible' && (!this.virtual || this.virtualShown);
  }

  /** Back on screen (the virtual phone shown again): what arrived meanwhile, scrolled to the newest. */
  private caughtUp(): void {
    if (this.view === 'chat' && this.chat) {
      const c = this.convs.get(this.chat);
      if (c && c.unread > 0) {
        c.unread = 0;
        this.net.read(c.id);
      }
    }
    if (this.view === 'chat' || this.view === 'list') this.render();
  }

  /** Rank and days left in the list header: "Sotamies · TJ 5". */
  private renderRank(): void {
    const el = this.screen.querySelector<HTMLElement>('.bar-brand');
    if (!el || !this.status) return;
    const rank = FI.ranks[this.status.rank] ?? FI.ranks[0]!;
    el.textContent = `${rank[0]!.toUpperCase()}${rank.slice(1)} · ${fill(P.tj, { n: this.status.tj })}`;
  }

  private setUpgrade(offer: UpgradeOffer | null): void {
    this.upgrade = offer;
    this.upgradePick = null;
    this.upgradeSent = false;
    this.renderUpgrade();
    this.updateOut();
  }

  /**
   * "Kokoa ei ole, ota mikä on." Three upgrades with their exact benefit; tap one, then take it.
   * It sits over whatever the phone shows and comes back after a reconnect until chosen.
   */
  private renderUpgrade(): void {
    this.root.querySelector('.upgrade-wrap')?.remove();
    const offer = this.upgrade;
    if (!offer || this.view === 'pair' || this.view === 'confirm' || this.view === 'sound' || this.view === 'replaced') return;
    const wrap = h('div', 'upgrade-wrap', undefined, this.root);
    const box = h('div', 'upgrade', undefined, wrap);
    h('div', 'upgrade-title', offer.title, box);
    h('div', 'upgrade-sub', P.upgradeChoose, box);
    let take: HTMLButtonElement | null = null;
    for (const o of offer.options) {
      const card = h('div', 'upgrade-card', undefined, box);
      card.classList.toggle('picked', this.upgradePick === o.id);
      const head = h('div', 'upgrade-head', undefined, card);
      h('div', 'upgrade-name', o.name, head);
      if (o.level > 1) h('div', 'upgrade-level', fill(P.upgradeLevel, { n: o.level }), head);
      h('div', 'upgrade-benefit', o.benefit, card);
      card.onclick = () => {
        if (this.upgradeSent) return;
        this.upgradePick = o.id;
        for (const c of box.querySelectorAll('.upgrade-card')) c.classList.remove('picked');
        card.classList.add('picked');
        if (take) take.disabled = false;
      };
    }
    take = h('button', 'btn primary big', this.upgradeSent ? P.sendingScreen : P.upgradeTake, box);
    take.disabled = !this.upgradePick || this.upgradeSent;
    take.onclick = () => {
      const id = this.upgradePick;
      if (!id || this.upgradeSent) return;
      this.upgradeSent = true;
      take!.disabled = true;
      take!.textContent = P.sendingScreen;
      this.net.choose(`${this.token.slice(0, 8)}-u${Date.now().toString(36)}`, id);
    };
  }

  // ---- views ----

  private show(view: View): void {
    this.view = view;
    if (this.sending && view !== 'chat') {
      window.clearTimeout(this.sending.timer);
      this.sending = null;
    }
    this.render();
    this.renderUpgrade();
    this.updateOut();
  }

  private openSaved(): void {
    const saved = store('session')?.getItem(CHAT_KEY);
    if (saved && this.convs.has(saved)) this.openChat(saved);
    else this.show('list');
  }

  private openChat(id: string): void {
    this.chat = id;
    store('session')?.setItem(CHAT_KEY, id);
    const c = this.convs.get(id);
    if (c && c.unread > 0) {
      c.unread = 0;
      this.net.read(id);
    }
    this.show('chat');
  }

  private render(): void {
    const s = this.screen;
    s.innerHTML = '';
    s.className = `screen v-${this.view}`;
    this.msgs = this.field = this.subtitle = this.sheetDisplay = null;
    this.sendBtn = null;
    switch (this.view) {
      case 'connecting':
        this.brand(s);
        h('div', 'center-note', P.connecting, s);
        break;
      case 'pair':
        this.renderPair(s);
        break;
      case 'confirm':
        this.renderConfirm(s);
        break;
      case 'sound':
        this.renderSound(s);
        break;
      case 'list':
        this.renderList(s);
        break;
      case 'chat':
        this.renderChat(s);
        break;
      case 'replaced':
        this.brand(s);
        h('div', 'center-note', fill(P.replaced, { name: this.player?.name ?? '' }), s);
        h('button', 'btn primary', P.pairAgain, s).onclick = () => {
          this.error = '';
          this.show('pair');
        };
        break;
    }
  }

  private brand(parent: HTMLElement): void {
    const b = h('div', 'brand', undefined, parent);
    h('div', 'brand-mark', '✉', b);
    h('div', 'brand-name', P.appName, b);
  }

  private renderPair(s: HTMLElement): void {
    const top = h('div', 'pair-top', undefined, s);
    this.brand(top);
    h('h1', '', P.pairTitle, top);
    h('p', 'muted', P.pairHelp, top);
    h('div', 'label', P.pairCode, top);
    const boxes = h('div', 'code-boxes', undefined, top);
    this.codeBoxes = [0, 1, 2, 3].map(() => h('div', 'code-box', '', boxes));
    h('div', 'error', this.error, top);
    this.kb.setMode('numpad');
    s.appendChild(this.kb.root);
    this.renderCode();
  }

  private renderCode(): void {
    this.codeBoxes.forEach((b, i) => {
      b.textContent = this.code[i] ?? '';
      b.classList.toggle('filled', i < this.code.length);
      b.classList.toggle('next', i === this.code.length);
    });
    const err = this.screen.querySelector('.error');
    if (err) err.textContent = this.code.length === 4 ? P.pairing : this.error;
  }

  private renderConfirm(s: HTMLElement): void {
    this.brand(s);
    const box = h('div', 'confirm', undefined, s);
    h('div', 'muted', P.belongsTo, box);
    const who = h('div', 'who', undefined, box);
    const chip = h('span', 'chip', undefined, who);
    chip.style.background = `#${(ACCENTS[(this.player?.color ?? 0) % ACCENTS.length] ?? 0).toString(16).padStart(6, '0')}`;
    h('span', '', this.player?.name ?? '', who);
    if (this.replacedOld) h('div', 'note', P.replacedOld, box);
    const go = h('button', 'btn primary big', P.start, box);
    go.onclick = () => {
      void this.media.start();
      store('session')?.setItem(STARTED_KEY, '1');
      this.show('sound');
      this.media.play('phone_chime');
    };
    h('div', 'muted small', P.startHint, box);
    h('div', 'muted small', P.notYou, s);
  }

  private renderSound(s: HTMLElement): void {
    h('h1', '', P.soundTitle, s);
    const sp = h('div', 'speaker', '🔊', s);
    sp.onclick = () => this.media.play('phone_chime');
    h('p', '', P.soundQuestion, s);
    const yes = h('button', 'btn primary big', P.soundYes, s);
    yes.onclick = () => this.openSaved();
    const again = h('button', 'btn', P.soundAgain, s);
    again.onclick = () => this.media.play('phone_chime');
    h('p', 'muted small', P.soundHint, s);
  }

  private bar(parent: HTMLElement): HTMLElement {
    const bar = h('div', 'bar', undefined, parent);
    return bar;
  }

  private banner(parent: HTMLElement): void {
    h('div', 'banner hidden', '', parent);
    this.renderBanner();
  }

  private renderBanner(): void {
    const b = this.screen.querySelector<HTMLElement>('.banner');
    if (!b) return;
    const left = this.inventoryEnd ? Math.ceil((this.inventoryEnd - performance.now()) / 1000) : 0;
    if (this.inventoryEnd && left <= 0) {
      this.inventoryEnd = 0;
      window.clearInterval(this.inventoryTimer);
    }
    const text = !this.net.connected ? P.offline : this.status && !this.status.desktop ? P.desktopOff : left > 0 ? fill(P.inventory, { s: left }) : '';
    b.textContent = text;
    b.classList.toggle('hidden', !text);
    b.classList.toggle('urgent', left > 0 && this.net.connected);
  }

  private sortedConvs(): PhoneConversation[] {
    const last = (c: PhoneConversation) => c.messages[c.messages.length - 1]?.at ?? 0;
    return [...this.convs.values()].sort((a, b) => last(b) - last(a));
  }

  private avatar(parent: HTMLElement, c: PhoneConversation): void {
    const a = h('div', 'avatar', undefined, parent);
    const isNumber = /^[\d+]/.test(c.name);
    a.textContent = isNumber ? '#' : c.name.slice(0, 1).toUpperCase();
    a.style.background = avatarColor(c.name);
  }

  private renderList(s: HTMLElement): void {
    const bar = this.bar(s);
    h('div', 'bar-title', P.chats, bar);
    h('div', 'bar-brand', '', bar);
    this.renderRank();
    this.banner(s);
    const list = h('div', 'convs', undefined, s);
    const convs = this.sortedConvs();
    if (convs.length === 0) h('div', 'center-note', P.noChats, list);
    for (const c of convs) {
      const row = h('div', 'conv', undefined, list);
      row.onclick = () => this.openChat(c.id);
      this.avatar(row, c);
      const mid = h('div', 'conv-mid', undefined, row);
      h('div', 'conv-name', c.name, mid);
      const last = [...c.messages].reverse().find((m) => m.from !== 'system');
      h('div', 'conv-preview', last ? (last.voice ? `🎤 ${P.voiceNote}` : (last.from === 'me' ? '✓ ' : '') + (last.text ?? '')) : formatNumber(c.id), mid);
      const right = h('div', 'conv-right', undefined, row);
      if (last) h('div', 'conv-time', clock(last.at), right);
      if (c.unread > 0) h('div', 'badge', String(c.unread), right);
    }
    const fab = h('button', 'fab', '+', s);
    fab.setAttribute('aria-label', P.newChat);
    fab.onclick = () => {
      this.sheet = { number: '' };
      this.renderSheetView();
      this.updateOut();
    };
    if (this.sheet) this.renderSheetView();
  }

  /** New chat: the number pad as a half-height sheet over the list. */
  private renderSheetView(): void {
    const s = this.screen;
    s.querySelector('.sheet-wrap')?.remove();
    if (!this.sheet) return;
    const wrap = h('div', 'sheet-wrap', undefined, s);
    const sheet = h('div', 'sheet', undefined, wrap);
    const head = h('div', 'sheet-head', undefined, sheet);
    h('button', 'link', P.cancel, head).onclick = () => {
      this.sheet = null;
      wrap.remove();
      // The chat's own keyboard comes back.
      if (this.view === 'chat') this.render();
      this.updateOut();
    };
    h('div', 'sheet-title', P.newChat, head);
    h('button', 'link strong', P.open, head).onclick = () => this.submitSheet();
    this.sheetDisplay = h('div', 'sheet-number', '', sheet);
    this.kb.setMode('numpad');
    sheet.appendChild(this.kb.root);
    this.renderSheet();
  }

  private renderSheet(): void {
    if (!this.sheetDisplay || !this.sheet) return;
    const n = this.sheet.number;
    this.sheetDisplay.textContent = n ? formatNumber(n) : P.enterNumber;
    this.sheetDisplay.classList.toggle('empty', !n);
  }

  private submitSheet(): void {
    const n = this.sheet?.number ?? '';
    if (n.length < 3) return;
    if (this.convs.has(n)) {
      this.sheet = null;
      this.openChat(n);
      return;
    }
    this.net.openConversation(n);
  }

  /** The number sheet may be open over the list or over a chat. */
  private get sheetOpen(): boolean {
    return this.sheet !== null;
  }

  private renderChat(s: HTMLElement): void {
    const c = this.chat ? this.convs.get(this.chat) : undefined;
    if (!c) {
      this.show('list');
      return;
    }
    const bar = this.bar(s);
    const back = h('button', 'back', '‹', bar);
    back.setAttribute('aria-label', P.chats);
    back.onclick = () => {
      this.chat = null;
      store('session')?.removeItem(CHAT_KEY);
      this.show('list');
    };
    this.avatar(bar, c);
    const t = h('div', 'bar-who', undefined, bar);
    h('div', 'bar-name', c.name, t);
    this.subtitle = h('div', 'bar-sub', '', t);
    this.renderSubtitle();
    // New chat from inside a conversation: the number pad covers only the bottom half, so a
    // message with the number in it stays readable above.
    const add = h('button', 'bar-add', '+', bar);
    add.setAttribute('aria-label', P.newChat);
    add.onclick = () => {
      this.sheet = { number: '' };
      this.renderSheetView();
      this.updateOut();
    };
    this.banner(s);
    this.msgs = h('div', 'msgs', undefined, s);
    const compose = h('div', 'compose', undefined, s);
    this.field = h('div', 'field', undefined, compose);
    this.sendBtn = h('button', 'send', '➤', compose);
    this.sendBtn.setAttribute('aria-label', P.send);
    this.sendBtn.onpointerdown = (e) => {
      e.preventDefault();
      this.sendDraft();
    };
    this.kb.setMode('letters');
    s.appendChild(this.kb.root);
    this.renderMessages(true);
    this.renderField();
    this.kb.wantCapital((this.drafts.get(c.id) ?? '').length === 0);
  }

  private renderSubtitle(): void {
    if (!this.subtitle || !this.chat) return;
    const c = this.convs.get(this.chat);
    this.subtitle.textContent = this.typing.has(this.chat) ? fill(P.typing, { name: c?.name ?? '' }) : formatNumber(this.chat);
    this.subtitle.classList.toggle('typing', this.typing.has(this.chat));
  }

  private renderField(): void {
    if (!this.field || !this.chat) return;
    const d = this.drafts.get(this.chat) ?? '';
    this.field.innerHTML = '';
    if (d) {
      h('span', 'text', d, this.field);
      h('span', 'caret', '', this.field);
    } else {
      h('span', 'caret', '', this.field);
      h('span', 'placeholder', P.typeMessage, this.field);
    }
    this.sendBtn?.classList.toggle('ready', d.trim().length > 0);
    this.field.scrollTop = this.field.scrollHeight;
  }

  private renderMessages(scrollToEnd = false): void {
    const list = this.msgs;
    const c = this.chat ? this.convs.get(this.chat) : undefined;
    if (!list || !c) return;
    const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = '';
    let prevAt = 0;
    const lastMine = [...c.messages].reverse().find((m) => m.from === 'me');
    for (const m of c.messages) {
      if (m.from === 'system') {
        const round = m.text?.match(/^#round (\d+)$/);
        h('div', round ? 'divider' : 'sys', round ? fill(P.round, { n: round[1]! }) : (m.text ?? ''), list);
        prevAt = m.at;
        continue;
      }
      if (m.at - prevAt > 5 * 60 * 1000) h('div', 'stamp', clock(m.at), list);
      prevAt = m.at;
      const row = h('div', `row ${m.from}`, undefined, list);
      if (m.voice) this.voiceBubble(row, m);
      else {
        const b = h('div', `bubble ${m.from}`, undefined, row);
        b.textContent = m.text ?? '';
      }
      if (m.from === 'me' && m.state && (m === lastMine || m.state === 'failed')) {
        const st = h('div', `state ${m.state}`, STATE_LABEL[m.state] + (m.state === 'read' ? ` ${clock(m.at)}` : ''), list);
        st.dataset.id = m.id;
      }
    }
    if (this.typing.has(c.id)) this.typingBubble(list);
    if (scrollToEnd || nearEnd) list.scrollTop = list.scrollHeight;
  }

  private typingBubble(list: HTMLElement): void {
    const row = h('div', 'row them typing-row', undefined, list);
    const b = h('div', 'bubble them typing', undefined, row);
    for (let i = 0; i < 3; i++) h('span', 'dot', '', b);
  }

  private renderTyping(): void {
    const list = this.msgs;
    if (!list || !this.chat) return;
    list.querySelector('.typing-row')?.remove();
    const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (this.typing.has(this.chat)) this.typingBubble(list);
    if (nearEnd) list.scrollTop = list.scrollHeight;
  }

  /** Voice notes: tap to play, again to pause; replayable, with progress. */
  private voiceBubble(row: HTMLElement, m: PhoneMessage): void {
    const b = h('div', `bubble ${m.from} voice`, undefined, row);
    const btn = h('div', 'vplay', '▶', b);
    const track = h('div', 'vtrack', undefined, b);
    const fillEl = h('div', 'vfill', undefined, track);
    const dur = Math.round(m.voice?.duration ?? 0);
    const time = h('div', 'vtime', `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`, b);
    b.onclick = () => {
      if (this.playing?.bubble === b) {
        const a = this.playing.audio;
        if (a.paused) void a.play();
        else a.pause();
        return;
      }
      this.playing?.audio.pause();
      const a = new Audio(m.voice!.url);
      this.playing = { audio: a, bubble: b };
      a.ontimeupdate = () => {
        const k = a.duration ? a.currentTime / a.duration : 0;
        fillEl.style.width = `${(k * 100).toFixed(1)}%`;
        const left = Math.max(0, Math.ceil((a.duration || dur) - a.currentTime));
        time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      };
      a.onplay = () => (btn.textContent = '❚❚');
      a.onpause = () => (btn.textContent = '▶');
      a.onended = () => {
        btn.textContent = '▶';
        fillEl.style.width = '0%';
        time.textContent = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
      };
      void a.play();
    };
  }
}

/** The varusmestari's number, for tests and the simulator. */
export const ASEVARASTO = FI.varusmestari.number;
