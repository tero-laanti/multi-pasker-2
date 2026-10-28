# MULTI-PASKER 2 — stack decision record

Date: 2026-10-26. Status: decided.

## Constraints that matter most

- Desktop browsers over plain HTTP on a LAN: no secure context, so no `SharedArrayBuffer`, cross-origin isolation, Wake Lock, async Clipboard, Keyboard Lock or `pointerrawupdate` on guest machines.
- One server process on one port for the desktop client, the phone page and WebSockets, easy to start on a macOS or Windows host.
- The server validates shots against the same collision world as the client, headlessly.
- Up to 16 players on mixed laptops, some with integrated graphics, over Wi-Fi.
- Everything built from code and the command line. Gunfeel systems are custom code whatever the engine.

## Client engine

| Criterion | Three.js r186 | Babylon.js 9 | PlayCanvas 2 (engine only) | Godot 4 web export |
|---|---|---|---|---|
| Input latency, pointer lock, `unadjustedMovement` | Plain DOM, full control | Plain DOM, wrapped by engine input | Plain DOM | Engine-owned input loop, extra frame in some browsers |
| Weak GPUs | Lean renderer; we control draw calls, lights and shader variants | Good, but heavier default pipeline | Very good | WebGL2 compatibility renderer only; heavy runtime |
| Headless collision on server | Not an engine concern: shared TS collision or Rapier | NullEngine in Node (heavy) | Not a first-class path | Headless Godot binary (must ship per host OS) |
| Character controller / physics | Bring your own (custom anyway) | Havok WASM + character controller | ammo.js (old) | Built-in, good |
| Spatial audio | Web Audio directly (HRTF `PannerNode`) | Built-in wrapper | Built-in wrapper | Engine mixer; web audio path has limitations |
| Download size over LAN | ~0.7 MB min (~0.17 MB gzip) | Several MB | ~1.5 MB | ~35 MB wasm + pck |
| glTF pipeline | `GLTFLoader`, mature | Mature | Mature | Import needs the editor |
| TypeScript | `@types/three`, idiomatic | Native TS | Bundled types | GDScript (no C# on web) |
| Maturity and docs | Largest community, many FPS examples | Strong docs | Docs lean on the editor | Strong, editor-centric |
| Code-only workflow | Natural | Natural | Possible, examples assume editor | Scenes are editor-centric; export step per change |
| Threads without secure context | Not needed | Not needed | Not needed | Threaded build needs `SharedArrayBuffer`; single-threaded build has audio caveats |

**Decision: Three.js r186 (`WebGLRenderer`, WebGL2), TypeScript, bundled by Vite.**

Collision: **custom shared TypeScript, not Rapier.** The map is data made of convex brushes (boxes, yaw-rotated boxes, ramps, prisms). Collision uses the Quake III-style box trace through brushes, with axial bevel planes, which is exact for these shapes. Movement is a fixed-step `pmove` built on that trace (slide move, step-up, ground snap). The id Tech 3 lineage behind Call of Duty movement is a deliberate fit for the gunfeel goal. One source file runs in the browser, on the server and in unit tests. That gives bit-identical results, synchronous start-up, no WASM, and trivial headless testing. The only dynamic physics is grenades, which bounce off the same traces.

Rapier (`@dimforge/rapier3d-compat` 0.21) was the main alternative. It would add trimesh collision and rigid bodies we don't need, a ~2 MB WASM payload and async initialisation. It stays the fallback if the map ever needs arbitrary meshes; collision sits behind a small `CollisionWorld` interface.

Electron wrapping is a possible later fallback if browser frame-rate caps or input latency hurt. It is noted, not built.

## Server runtime

| Criterion | Node.js 22/24 + TS (tsx) | Bun 1.3 | Deno 2 | Rust | Go | Headless engine |
|---|---|---|---|---|---|---|
| Code shared with client (protocol, map, collision, chat script, validation) | All of it | All of it | All of it | Little (WASM bridge or duplicate) | None | Only with Godot client |
| Install and start on macOS / Windows host | Official installers; most people already have it | One-line install; less common on Windows | Single binary; permission flags | Toolchain or per-OS binaries | Per-OS binaries | Ship engine binary |
| 30–60 Hz tick timing | Drift-compensated timers, fine | Fine | Fine | Excellent | Excellent | Fine |
| Testability | Vitest, same code as client | Built-in test runner | Built-in | cargo test | go test | Awkward |
| Iteration speed | Fast | Fastest | Fast | Slow | Medium | Slow |

Colyseus 0.18 was considered as a framework. Its schema state sync doesn't fit snapshot interpolation with rewind history and a custom binary protocol. We would still write all the important parts, so plain `ws` is simpler.

**Decision: Node.js (≥ 22.12; 24 LTS recommended) running TypeScript through `tsx`, `ws` for WebSockets** (`perMessageDeflate: false`, no fallback transports), Vite 8 as middleware in the same process and port during development, and static files from the build in normal use. Vitest runs unit tests and Playwright drives Chrome for browser tests. Dependency versions are pinned exactly in `package.json` with a committed lockfile.

## Risks and mitigations

- **Custom collision bugs** (snagging, tunnelling, falling through seams): use the proven Quake III algorithm, plus unit and fuzz tests on traces and movement. The collision API is kept narrow so Rapier can replace it.
- **Browser input latency and frame caps**: raw mouse deltas are applied to the view immediately on each event, the simulation steps at a fixed rate, the canvas uses a low-latency hint, and render-scale and quality presets exist. Electron is the fallback.
- **`unadjustedMovement` unsupported** in some browsers or OSes: feature-detect and fall back to plain pointer lock without smoothing.
- **Integrated GPUs**: fixed light pool (no shader recompiles), merged static geometry, capped and pooled effects, and Low/Medium/High presets controlling shadow-map size, MSAA, render scale and light count.
- **Wi-Fi jitter**: adaptive interpolation buffer sized from measured jitter, rewind capped at ~200 ms, and a dev network conditioner to exercise both.
- **Windows host friction** (firewall on "Public" networks, Node install): documented in docs/HOSTING.md; the server prints the address it chose and accepts an override.
- **Three.js API churn**: pinned to an exact version.
