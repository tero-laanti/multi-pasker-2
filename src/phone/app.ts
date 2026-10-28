import { SERVICE, SOTKU } from '../shared/config';
import { FI } from '../shared/fi';
import { ACCENTS, PROTOCOL_VERSION, type MsgState, type PhoneConversation, type PhoneMessage, type PhoneServerMsg, type PhoneStatus } from '../shared/protocol';
import { CAFE_IDS, GEAR_IDS, PATHS, benefit, canBuy, effects, isCafeId, isShopId, pathItems, payFor, rises, shopItem, type PathId, type ShopId, type StoreState } from '../shared/service';
import { UI } from '../shared/ui';
import { Keyboard } from './keyboard';
import { Media } from './media';
import { PhoneNet } from './net';

const P = UI.phone;
const S = UI.sotku;
const TOKEN_KEY = 'kenttaposti.token';
const STARTED_KEY = 'kenttaposti.started';
const CHAT_KEY = 'kenttaposti.chat';
const CLIP_KEY = 'kenttaposti.clip';

/** Phone numbers in a message: the 4-digit office numbers and the long +358 ones. */
function numbersIn(text: string | undefined): string[] {
  return [...new Set(text?.match(/\+?\d{4,}/g) ?? [])];
}

type View = 'connecting' | 'pair' | 'confirm' | 'sound' | 'list' | 'chat' | 'sotku' | 'replaced';

const ICON_CHATS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const ICON_SOTKU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>';

/** The paths' short marks on the shop's cards, like unit abbreviations. */
const PATH_MARK: Record<PathId, string> = { sp: 'SP', ta: 'TA', vm: 'VM', pi: 'PI' };

/** Codes in a message: runs of capitalised words (the commands have chips of their own). */
export function codesIn(text: string): string[] {
  const runs = text.match(/[A-ZÅÄÖ0-9]{2,}(?: [A-ZÅÄÖ0-9]{2,})*/gu) ?? [];
  return runs.filter((r) => r.length >= 3 && !/^\d+$/.test(r) && !/^TJ\b/.test(r));
}

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
/** Messages kept per chat (as many as the server keeps), and how many of the latest are drawn. */
const KEEP_MESSAGES = 200;
const DRAW_MESSAGES = 100;
const stateText = (m: PhoneMessage) => STATE_LABEL[m.state!] + (m.state === 'read' ? ` ${clock(m.at)}` : '');

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
  /** The phone's own clipboard (the keyboard is the app's, so the system's can't be pasted from). */
  private clip: string | null = store('session')?.getItem(CLIP_KEY) ?? null;
  private screen: HTMLDivElement;
  private msgs: HTMLDivElement | null = null;
  /** Where the autofill chips go, between the message field and the keyboard. */
  private chipRow: HTMLDivElement | null = null;
  private field: HTMLDivElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private subtitle: HTMLDivElement | null = null;
  private sheetDisplay: HTMLDivElement | null = null;
  private codeBoxes: HTMLDivElement[] = [];
  private playing: { audio: HTMLAudioElement; bubble: HTMLElement } | null = null;
  /** After sending: the short "Sending…" screen, then back to the chat list. */
  private sending: { rid: string; since: number; timer: number } | null = null;
  /** The Sotku App: the wallet and gear as the server last told us, which path is open, which item's sheet. */
  private store: StoreState | null = null;
  private sotkuPath: PathId | null = null;
  private sotkuItem: string | null = null;
  /** A Buy sent and not answered yet. */
  private buying: string | null = null;

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
        // A "typing" that ended while the phone was away never got here: start clean.
        this.typing.clear();
        this.store = m.store;
        if (this.view === 'chat' || this.view === 'list' || this.view === 'sotku') {
          this.render();
          this.renderDead();
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
        this.renderDead();
        break;
      case 'inventory':
        this.inventoryEnd = m.left > 0 ? performance.now() + m.left * 1000 : 0;
        window.clearInterval(this.inventoryTimer);
        if (this.inventoryEnd) this.inventoryTimer = window.setInterval(() => this.renderBanner(), 250);
        this.renderBanner();
        break;
      case 'store':
        this.setStore(m.s);
        break;
      case 'convs':
        // A new match: the chats it started are gone.
        this.convs = new Map(m.convs.map((c) => [c.id, c]));
        for (const id of [...this.drafts.keys()]) if (!this.convs.has(id)) this.drafts.delete(id);
        if (this.view === 'chat' && this.chat && !this.convs.has(this.chat)) {
          this.chat = null;
          store('session')?.removeItem(CHAT_KEY);
          this.show('list');
        } else if (this.view === 'list') this.render();
        break;
      case 'killed':
        this.killed(m);
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
      const old = c.messages[i]!;
      c.messages[i] = msg;
      // The server's copy of one I sent: usually only its delivery state is new.
      if (this.view === 'chat' && this.chat === convId) {
        if (old.text === msg.text && !msg.voice && !old.voice) this.updateLabel(msg);
        else this.renderMessages();
      }
      return;
    }
    c.messages.push(msg);
    if (c.messages.length > KEEP_MESSAGES) c.messages.splice(0, c.messages.length - KEEP_MESSAGES);
    const viewing = this.view === 'chat' && this.chat === convId && this.onScreen;
    if (msg.from === 'them') {
      if (viewing) this.net.read(convId);
      else c.unread++;
      this.media.play('phone_in', 0.8);
      if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    }
    if (this.view === 'chat' && this.chat === convId) {
      this.appendMessage(msg);
      if (viewing) this.renderChips();
    } else if (this.view === 'list') this.render();
  }

  private setState(convId: string, id: string, state: MsgState): void {
    const m = this.convs.get(convId)?.messages.find((x) => x.id === id);
    if (!m) return;
    m.state = state;
    if (this.view === 'chat' && this.chat === convId) this.updateLabel(m);
  }

  /** Sending, delivered, read: just the label under the message, when it has one. */
  private updateLabel(m: PhoneMessage): void {
    const label = [...(this.msgs?.querySelectorAll<HTMLElement>('.state') ?? [])].find((el) => el.dataset.id === m.id);
    if (label && m.state) {
      label.className = `state ${m.state}`;
      label.textContent = stateText(m);
    } else if (m.state === 'failed' || label) this.renderMessages();
  }

  // ---- keyboard ----

  private input(ch: string): void {
    if (this.isDead() && this.view !== 'pair') return;
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
    if (!conv || this.isDead()) return;
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
   * The phone is "out" (in the character's hand) while a chat, the number pad or the Sotku App
   * is open; the virtual phone whenever it is on screen.
   */
  private updateOut(): void {
    if (this.virtual) {
      this.net.out(this.virtualShown);
      return;
    }
    const visible = document.visibilityState === 'visible';
    this.net.out(visible && (this.view === 'chat' || this.view === 'sotku' || this.sheetOpen));
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
    if (this.view === 'chat' || this.view === 'list' || this.view === 'sotku') this.render();
  }

  /** Rank, days left and the wallet in the list header: "Sotamies · TJ 287", "145 €". */
  private renderRank(): void {
    const el = this.screen.querySelector<HTMLElement>('.bar-brand');
    if (!el || !this.status) return;
    const rank = FI.ranks[this.status.rank] ?? FI.ranks[0]!;
    el.textContent = `${rank[0]!.toUpperCase()}${rank.slice(1)} · ${fill(P.tj, { n: this.status.tj })}`;
    const money = this.screen.querySelector<HTMLElement>('.bar .money');
    if (money) money.textContent = `${this.store?.money ?? 0} €`;
  }

  /** The server's word on the wallet and gear: an answered Buy closes its sheet. */
  private setStore(st: StoreState): void {
    this.store = st;
    if (this.buying) {
      this.buying = null;
      this.sotkuItem = null;
    }
    if (this.view === 'sotku' || this.view === 'list') this.render();
  }

  /**
   * Killed with the phone out: back to the chat list, the text typed in the open chat is gone,
   * and a note over it all says so (quoting the message that never got sent).
   */
  private killed(m: Extract<PhoneServerMsg, { t: 'killed' }>): void {
    const conv = this.chat;
    const draft = (conv && this.drafts.get(conv)?.trim()) || m.draft;
    if (conv) {
      this.drafts.delete(conv);
      this.net.draft(conv, '');
    }
    this.sheet = null;
    this.sotkuItem = null;
    if (this.view === 'chat' || this.view === 'sotku') {
      this.chat = null;
      store('session')?.removeItem(CHAT_KEY);
      this.show('list');
    } else if (this.view === 'list') {
      this.render();
      this.updateOut();
    }
    if (navigator.vibrate) navigator.vibrate(300);
    this.root.querySelector('.killed-wrap')?.remove();
    const K = P.killed;
    const pick = (list: readonly string[]) => list[Math.floor(Math.random() * list.length)]!;
    const line = !m.by ? pick(K.self) : m.w === 'grenade' ? pick(K.grenade) : m.w === 'knife' ? pick(K.knife) : m.head ? pick(K.head) : pick(K.by);
    const wrap = h('div', 'killed-wrap', undefined, this.root);
    const box = h('div', 'killed', undefined, wrap);
    h('div', 'killed-title', pick(K.title), box);
    h('div', 'killed-text', fill(line, { name: m.by }), box);
    if (draft) {
      const lost = h('div', 'killed-lost', undefined, box);
      h('div', 'killed-label', K.lost, lost);
      h('div', 'bubble me lost', draft, lost);
    }
    // Dead: the phone is out of use until the respawn takes this away (renderDead).
    h('div', 'killed-wait', P.backOnRespawn, box);
  }

  /** In the match and dead: nothing on the phone works until the respawn. */
  private isDead(): boolean {
    return !!this.status && !this.status.alive && this.status.desktop;
  }

  /** The dead screen over everything (the killed note serves as it when the phone was out). */
  private renderDead(): void {
    const shown = this.root.querySelector('.killed-wrap');
    if (!this.isDead()) {
      shown?.remove();
      return;
    }
    if (shown) return;
    this.sheet = null;
    this.sotkuItem = null;
    if (this.view === 'chat' || this.view === 'sotku') {
      this.chat = null;
      store('session')?.removeItem(CHAT_KEY);
      this.show('list');
    }
    const wrap = h('div', 'killed-wrap', undefined, this.root);
    const box = h('div', 'killed', undefined, wrap);
    h('div', 'killed-title', P.deadTitle, box);
    h('div', 'killed-text', P.deadText, box);
    h('div', 'killed-wait', P.backOnRespawn, box);
  }

  // ---- views ----

  private show(view: View): void {
    this.closeMenu();
    this.view = view;
    if (this.sending && view !== 'chat') {
      window.clearTimeout(this.sending.timer);
      this.sending = null;
    }
    this.render();
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
    // A re-render (a kill updating the wallet) keeps the list or the shop where it was scrolled.
    const scrolled = s.querySelector('.convs, .sotku')?.scrollTop ?? 0;
    const was = `${this.view}|${this.sotkuPath}`;
    s.innerHTML = '';
    s.className = `screen v-${this.view}`;
    this.msgs = this.field = this.subtitle = this.sheetDisplay = this.chipRow = null;
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
      case 'sotku':
        this.renderSotku(s);
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
    if (`${this.view}|${this.sotkuPath}` === was && scrolled) {
      const list = s.querySelector('.convs, .sotku');
      if (list) list.scrollTop = scrolled;
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
    const right = h('div', 'bar-right', undefined, bar);
    h('div', 'bar-brand', '', right);
    h('div', 'money', '', right);
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
    this.tabs(s);
    if (this.sheet) this.renderSheetView();
  }

  /** Chats | Sotku at the bottom of the list and the shop. */
  private tabs(s: HTMLElement): void {
    const bar = h('div', 'tabs', undefined, s);
    const tab = (view: 'list' | 'sotku', label: string, icon: string) => {
      const t = h('button', `tab${this.view === view ? ' on' : ''}`, undefined, bar);
      t.innerHTML = icon;
      h('span', '', label, t);
      t.onclick = () => {
        if (this.view === view) return;
        this.sotkuPath = null;
        this.sotkuItem = null;
        this.show(view);
      };
      return t;
    };
    tab('list', P.tabChats, ICON_CHATS);
    const sotku = tab('sotku', P.tabSotku, ICON_SOTKU);
    const st = this.store;
    if (st && !st.open) h('span', 'tab-lock', '🔒', sotku);
    else if (st && this.affordable(st)) h('span', 'tab-dot', '', sotku);
  }

  /** Something in the shop that can be bought right now. */
  private affordable(st: StoreState): boolean {
    const bought = new Set<string>([...st.owned, ...st.waiting]);
    return Object.keys(SOTKU.items).some((id) => isShopId(id) && canBuy(id, bought) && (st.voucher || shopItem(id).price <= st.money));
  }

  // ---- the Sotku App ----

  private renderSotku(s: HTMLElement): void {
    const st = this.store;
    const bar = this.bar(s);
    const path = st?.open ? this.sotkuPath : null;
    if (path) {
      const back = h('button', 'back', '‹', bar);
      back.setAttribute('aria-label', S.title);
      back.onclick = () => {
        this.sotkuPath = null;
        this.render();
      };
      h('div', 'bar-title', FI.paths[path] ?? path, bar);
    } else h('div', 'bar-title', S.title, bar);
    h('div', 'money', `${st?.money ?? 0} €`, bar);
    this.banner(s);
    const body = h('div', 'sotku', undefined, s);
    if (!st) h('div', 'center-note', P.connecting, body);
    else if (!st.open) this.renderLocked(body, st);
    else if (path) this.renderPath(body, st, path);
    else this.renderShop(body, st);
    this.tabs(s);
    if (st && this.sotkuItem) this.renderItem(s, st, this.sotkuItem);
  }

  /**
   * P-kausi: the shop is shut until its days are served and its gear is signed for (both shown);
   * the money is already there.
   */
  private renderLocked(body: HTMLElement, st: StoreState): void {
    const box = h('div', 'lockbox', undefined, body);
    h('div', 'lock-icon', '🔒', box);
    h('div', 'lock-title', S.locked, box);
    const prog = h('div', 'prog', undefined, box);
    h('i', '', undefined, prog).style.width = `${Math.round((Math.min(st.days, SERVICE.pkausi) / SERVICE.pkausi) * 100)}%`;
    const left = SERVICE.pkausi - st.days;
    h('div', 'lock-days', left > 0 ? fill(S.lockedDays, { d: st.days, n: SERVICE.pkausi, left }) : fill(S.lockedDaysDone, { d: st.days, n: SERVICE.pkausi }), box);
    const gear = GEAR_IDS.filter((id) => st.owned.includes(id)).length;
    h('div', 'lock-days', fill(S.lockedGear, { n: gear, of: GEAR_IDS.length }), box);
    if (st.paper) h('div', 'lock-note strong', fill(S.waitingOpen, { where: st.paper.where }), box);
    else if (gear < GEAR_IDS.length) h('div', 'lock-note', S.lockedGearHint, box);
    h('div', 'lock-note', fill(S.lockedNote, { eur: payFor(Math.max(1, st.days)) }), box);
    h('div', 'sect', S.paths, body);
    const grid = h('div', 'paths', undefined, body);
    for (const p of PATHS) this.pathCard(grid, st, p, true);
  }

  private renderShop(body: HTMLElement, st: StoreState): void {
    const wallet = h('div', 'wallet', undefined, body);
    h('div', 'wallet-sum', `${st.money} €`, wallet);
    const rate = h('div', 'wallet-rate', undefined, wallet);
    if (st.days >= SERVICE.days) h('div', '', S.done, rate);
    else {
      h('div', '', fill(S.rate, { eur: payFor(st.days + 1) }), rate);
      const next = rises().find((from) => from > st.days + 1);
      h('div', '', next ? fill(S.nextRate, { eur: payFor(next), tj: SERVICE.days - next }) : S.lastRate, rate);
    }
    if (st.voucher) h('div', 'voucher', S.voucher, body);
    h('div', 'sect', S.paths, body);
    const grid = h('div', 'paths', undefined, body);
    for (const p of PATHS) this.pathCard(grid, st, p, false);
    if (st.waiting.length) {
      h('div', 'sect', S.waiting, body);
      for (const id of st.waiting) {
        const row = h('div', 'row2', undefined, body);
        const left = h('div', 'row2-main', undefined, row);
        h('div', 'row2-name', FI.items[id] ?? id, left);
        const open = st.paper?.item === id;
        h('div', `row2-sub${open ? ' strong' : ''}`, open ? fill(S.waitingOpen, { where: st.paper!.where }) : S.waitingQueued, left);
        h('span', 'wait', S.paperwork, row);
      }
    }
    h('div', 'sect', S.cafe, body);
    for (const id of CAFE_IDS) {
      const row = h('button', 'row2', undefined, body);
      const left = h('div', 'row2-main', undefined, row);
      h('div', 'row2-name', FI.items[id] ?? id, left);
      h('div', 'row2-sub', benefit(id), left);
      const right = h('div', 'row2-end', undefined, row);
      h('span', 'price', `${SOTKU.cafe[id]} €`, right);
      if (st.cafe[id] > 0) h('span', 'row2-have', fill(S.have, { n: st.cafe[id] }), right);
      row.onclick = () => this.openItem(id);
    }
  }

  private pathCard(grid: HTMLElement, st: StoreState, path: PathId, locked: boolean): void {
    const items = pathItems(path);
    const card = h('button', `pcard${locked ? ' locked' : ''}`, undefined, grid);
    h('div', 'pmark', PATH_MARK[path], card);
    h('div', 'pname', FI.paths[path] ?? path, card);
    const owned = items.filter((id) => st.owned.includes(id)).length;
    const role = h('div', 'prole', S.roles[path] ?? '', card);
    if (!locked && owned === 0 && !items.some((id) => st.waiting.includes(id))) role.textContent += ` · ${fill(S.from, { eur: shopItem(items[0]!).price })}`;
    const pips = h('div', 'pips', undefined, card);
    for (const id of items) h('i', st.owned.includes(id) ? 'f' : st.waiting.includes(id) ? 'w' : '', undefined, pips);
    if (locked) card.disabled = true;
    else
      card.onclick = () => {
        this.sotkuPath = path;
        this.render();
      };
  }

  /** One path's tree: rows I–IV, a line from each node to what it opens. */
  private renderPath(body: HTMLElement, st: StoreState, path: PathId): void {
    const tree = h('div', 'tree', undefined, body);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tree-lines');
    tree.appendChild(svg);
    const nodes = new Map<ShopId, HTMLElement>();
    const items = pathItems(path);
    const bought = new Set<string>([...st.owned, ...st.waiting]);
    for (const tier of [1, 2, 3, 4]) {
      const row = h('div', 'tree-row', undefined, tree);
      for (const id of items.filter((i) => shopItem(i).tier === tier)) {
        const it = shopItem(id);
        const owned = st.owned.includes(id);
        const waiting = st.waiting.includes(id);
        const open = canBuy(id, bought);
        const cls = owned ? 'own' : waiting ? 'waiting' : !open ? 'lock' : st.voucher || it.price <= st.money ? 'buy' : 'short';
        const node = h('button', `node ${cls}${tier === 4 ? ' cap' : ''}`, undefined, row);
        h('div', 'node-name', FI.items[id] ?? id, node);
        h('div', 'node-sub', owned ? `✓ ${S.owned}` : waiting ? S.paperwork : `${cls === 'lock' ? '🔒 ' : ''}${it.price} €`, node);
        node.onclick = () => this.openItem(id);
        nodes.set(id, node);
      }
    }
    // The lines go in once the nodes are laid out: every position measured first, then all the
    // lines added at once (one layout, not one per line).
    requestAnimationFrame(() => {
      const box = tree.getBoundingClientRect();
      const rects = new Map([...nodes].map(([id, node]) => [id, node.getBoundingClientRect()]));
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      const lines = document.createDocumentFragment();
      for (const id of nodes.keys()) {
        for (const need of shopItem(id).needs ?? []) {
          const a = rects.get(need);
          const b = rects.get(id)!;
          if (!a) continue;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(a.left + a.width / 2 - box.left));
          line.setAttribute('y1', String(a.bottom - box.top));
          line.setAttribute('x2', String(b.left + b.width / 2 - box.left));
          line.setAttribute('y2', String(b.top - box.top));
          if (bought.has(need)) line.classList.add('on');
          lines.appendChild(line);
        }
      }
      svg.appendChild(lines);
    });
  }

  private openItem(id: string): void {
    this.sotkuItem = id;
    this.render();
  }

  /** The buy sheet: what it does, what it needs, how it is handed over, and one button. */
  private renderItem(s: HTMLElement, st: StoreState, id: string): void {
    const wrap = h('div', 'item-wrap', undefined, s);
    wrap.onclick = (e) => {
      if (e.target !== wrap) return;
      this.sotkuItem = null;
      this.render();
    };
    const sheet = h('div', 'item-sheet', undefined, wrap);
    h('div', 'item-name', FI.items[id] ?? id, sheet);
    h('div', 'item-benefit', benefit(id), sheet);
    const meta = h('div', 'item-meta', undefined, sheet);
    let price = 0;
    let needs = '';
    let state: 'buy' | 'owned' | 'waiting' | 'needs' | 'short' = 'buy';
    if (isCafeId(id)) {
      price = SOTKU.cafe[id];
      if (st.cafe[id] > 0) h('div', '', fill(S.have, { n: st.cafe[id] }), meta);
      h('div', '', S.delivery.none!, meta);
      if (price > st.money) state = 'short';
    } else if (isShopId(id)) {
      const it = shopItem(id);
      price = st.voucher ? 0 : it.price;
      const bought = new Set<string>([...st.owned, ...st.waiting]);
      const names = (it.needs ?? []).map((n) => FI.items[n] ?? n);
      needs = names.join(' / ');
      if (names.length) h('div', '', fill(canBuy(id, bought) || bought.has(id) ? S.needs : S.needsMissing, { names: names.join(' / ') }) + (it.needs!.some((n) => bought.has(n)) ? ' ✓' : ''), meta);
      const kind = it.tier === 1 ? 'none' : id === 'tkiv' ? 'serial' : it.tier === 2 ? 'word' : it.tier === 3 ? 'paper' : 'voice';
      h('div', '', S.delivery[kind] ?? '', meta);
      state = st.owned.includes(id) ? 'owned' : st.waiting.includes(id) ? 'waiting' : !canBuy(id, bought) ? 'needs' : price > st.money ? 'short' : 'buy';
    }
    const btn = h('button', 'btn primary big', undefined, sheet);
    if (this.buying === id) {
      btn.textContent = P.sendingScreen;
      btn.disabled = true;
    } else if (state === 'buy') {
      btn.textContent = isShopId(id) && st.voucher ? S.take : fill(S.buy, { eur: price });
      btn.onclick = () => {
        if (this.isDead()) return;
        this.buying = id;
        this.net.buy(`${this.token.slice(0, 8)}-b${Date.now().toString(36)}`, id);
        this.render();
      };
    } else {
      btn.disabled = true;
      btn.textContent = state === 'owned' ? S.owned : state === 'waiting' ? S.paperwork : state === 'short' ? fill(S.short, { eur: price - st.money }) : fill(S.needsMissing, { names: needs });
    }
    if (state === 'buy') h('div', 'item-note', fill(S.left, { eur: st.money - price }), sheet);
    h('div', 'item-note', S.phoneOut, sheet);
    h('button', 'link', S.close, sheet).onclick = () => {
      this.sotkuItem = null;
      this.render();
    };
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
    this.pressMenu(this.sheetDisplay, () => {
      const n = this.clip;
      if (!n) return [{ label: P.nothingCopied }];
      return [
        {
          label: fill(P.pasteNumber, { n: formatNumber(n) }),
          act: () => {
            if (!this.sheet) return;
            this.sheet.number = n;
            this.renderSheet();
          },
        },
      ];
    });
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

  // ---- copy and paste ----

  /** A long press (touch) or a click (mouse) on `el` opens a small menu of `items` at the press. */
  private pressMenu(el: HTMLElement, items: () => { label: string; act?: () => void }[]): void {
    let timer = 0;
    let from: { x: number; y: number } | null = null;
    let mouse = false;
    const cancel = () => {
      window.clearTimeout(timer);
      from = null;
    };
    el.addEventListener('pointerdown', (e) => {
      mouse = e.pointerType === 'mouse';
      if (mouse) return;
      from = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        if (!from) return;
        this.openMenu(items(), from.x, from.y);
        from = null;
      }, 450);
    });
    el.addEventListener('pointermove', (e) => {
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', (e) => {
      if (mouse) this.openMenu(items(), e.clientX, e.clientY);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private openMenu(items: { label: string; act?: () => void }[], x: number, y: number): void {
    this.closeMenu();
    const wrap = h('div', 'ctx-wrap', undefined, this.root);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) this.closeMenu();
    });
    const menu = h('div', 'ctx-menu', undefined, wrap);
    for (const it of items) {
      const b = h('button', 'ctx-item', it.label, menu);
      if (!it.act) b.disabled = true;
      else
        b.onclick = () => {
          this.closeMenu();
          it.act!();
        };
    }
    // At the press, kept on the screen.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2))}px`;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, y - r.height - 12))}px`;
  }

  private closeMenu(): void {
    this.root.querySelector('.ctx-wrap')?.remove();
  }

  private copyNumber(n: string): void {
    this.clip = n;
    store('session')?.setItem(CLIP_KEY, n);
    // The system clipboard too, where the browser allows it (https, or this machine).
    void navigator.clipboard?.writeText(n).catch(() => undefined);
    this.toast(fill(P.copied, { n: formatNumber(n) }));
  }

  private toast(text: string): void {
    this.root.querySelector('.toast')?.remove();
    const t = h('div', 'toast', text, this.root);
    window.setTimeout(() => t.remove(), 1600);
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
    this.chipRow = h('div', 'chips hidden', undefined, s);
    this.renderChips();
    this.kb.setMode('letters');
    s.appendChild(this.kb.root);
    this.renderMessages(true);
    this.renderField();
    this.kb.wantCapital((this.drafts.get(c.id) ?? '').length === 0);
  }

  /**
   * Automaattitäyttö: the code in the chat's last message as a tap-to-fill chip above the
   * keyboard, like a one-time code, and the armoury's two commands in its own chat.
   */
  private renderChips(): void {
    const row = this.chipRow;
    const c = this.chat ? this.convs.get(this.chat) : undefined;
    if (!row || !c) return;
    row.innerHTML = '';
    const chips: { text: string; from?: string }[] = [];
    if (effects(this.store?.owned ?? []).autofill) {
      const last = [...c.messages].reverse().find((m) => m.from === 'them' && m.text);
      const codes = last ? codesIn(last.text!).filter((x) => x !== 'LATAA' && x !== 'KRANAATTI') : [];
      chips.push(...codes.slice(-1).map((text) => ({ text, from: c.name })));
      if (c.id === FI.varusmestari.number) chips.push({ text: 'LATAA' }, { text: 'KRANAATTI' });
    }
    row.classList.toggle('hidden', chips.length === 0);
    for (const chip of chips) {
      const b = h('button', 'chip-btn', chip.text, row);
      if (chip.from) h('small', '', fill(P.autofillFrom, { name: chip.from }), b);
      b.onpointerdown = (e) => {
        e.preventDefault();
        this.net.touch();
        this.setDraft(chip.text);
      };
    }
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

  /** When the last drawn message was sent (a time stamp goes in after five quiet minutes). */
  private drawnAt = 0;

  /** The open chat from scratch: its latest DRAW_MESSAGES messages. */
  private renderMessages(scrollToEnd = false): void {
    const list = this.msgs;
    const c = this.chat ? this.convs.get(this.chat) : undefined;
    if (!list || !c) return;
    const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = '';
    this.drawnAt = 0;
    const lastMine = [...c.messages].reverse().find((m) => m.from === 'me');
    for (const m of c.messages.slice(-DRAW_MESSAGES)) this.messageRow(list, m, m === lastMine);
    if (this.typing.has(c.id)) this.typingBubble(list);
    if (scrollToEnd || nearEnd) list.scrollTop = list.scrollHeight;
  }

  /** One message at the end of the open chat, without drawing the rest again. */
  private appendMessage(m: PhoneMessage): void {
    const list = this.msgs;
    if (!list) return;
    list.querySelector('.typing-row')?.remove();
    // The delivery label goes with the newest message of mine (failed ones keep theirs).
    if (m.from === 'me') for (const st of list.querySelectorAll('.state:not(.failed)')) st.remove();
    this.messageRow(list, m, true);
    if (this.chat && this.typing.has(this.chat)) this.typingBubble(list);
    while (list.childElementCount > DRAW_MESSAGES * 2) list.firstElementChild!.remove();
    list.scrollTop = list.scrollHeight;
  }

  private messageRow(list: HTMLElement, m: PhoneMessage, newestMine: boolean): void {
    if (m.from === 'system') {
      const mark = m.text?.match(/^#(round|match) (\d+)$/);
      h('div', mark ? 'divider' : 'sys', mark ? fill(mark[1] === 'match' ? P.match : P.round, { n: mark[2]! }) : (m.text ?? ''), list);
      this.drawnAt = m.at;
      return;
    }
    if (m.at - this.drawnAt > 5 * 60 * 1000) h('div', 'stamp', clock(m.at), list);
    this.drawnAt = m.at;
    const row = h('div', `row ${m.from}`, undefined, list);
    if (m.voice) this.voiceBubble(row, m);
    else {
      const b = h('div', `bubble ${m.from}`, undefined, row);
      b.textContent = m.text ?? '';
      const numbers = numbersIn(m.text);
      if (numbers.length) this.pressMenu(b, () => numbers.map((n) => ({ label: fill(P.copyNumber, { n: formatNumber(n) }), act: () => this.copyNumber(n) })));
    }
    if (m.from === 'me' && m.state && (newestMine || m.state === 'failed')) {
      const st = h('div', `state ${m.state}`, stateText(m), list);
      st.dataset.id = m.id;
    }
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
