import { bakeAllHands } from './handBake';

/** Bakes all first-person hands off the main thread. */
self.onmessage = async (ev: MessageEvent<{ url: string }>) => {
  const post = (self as unknown as Worker).postMessage.bind(self);
  try {
    const buf = await fetch(ev.data.url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${ev.data.url}`);
      return r.arrayBuffer();
    });
    const baked = bakeAllHands(buf);
    if (!baked.fromCache) console.warn('hands: handPoses.json is out of date, poses were solved at load time (run npm run gen:hands)');
    for (const h of baked.hands) {
      const g = h.glove;
      const s = h.sleeve;
      post({ key: h.key, glove: g, sleeve: s }, [g.pos.buffer, g.nrm.buffer, g.uv.buffer, g.col.buffer, g.idx.buffer, s.pos.buffer, s.nrm.buffer, s.uv.buffer, s.col.buffer, s.idx.buffer]);
    }
    post({ done: true });
  } catch (err) {
    post({ error: String(err) });
  }
};
