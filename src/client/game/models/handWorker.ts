import { HAND_SPECS, type HandKey } from './handSpecs';
import { handGeometry, toArrays } from './hands';

/** Meshes all first-person hands off the main thread. */
self.onmessage = () => {
  for (const key of Object.keys(HAND_SPECS) as HandKey[]) {
    const h = HAND_SPECS[key];
    const geo = handGeometry(h.grip, h.spec);
    const glove = toArrays(geo.glove);
    const sleeve = toArrays(geo.sleeve);
    (self as unknown as Worker).postMessage({ key, glove, sleeve }, [glove.pos.buffer, glove.nrm.buffer, glove.uv.buffer, glove.idx.buffer, sleeve.pos.buffer, sleeve.nrm.buffer, sleeve.uv.buffer, sleeve.idx.buffer]);
  }
  (self as unknown as Worker).postMessage({ done: true });
};
