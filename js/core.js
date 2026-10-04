// The Rust core, main-thread side (queue item 21, roadmap 16).
//
// `?engine=rust` turns it on; it is off by default, and with it off nothing
// here runs. With it on, the synth hands the voices the core has (kalimba,
// fiddle and pad, so far) to an AudioWorkletNode running js/dlcore.wasm,
// and keeps everything else: scheduling, the voice budget, every
// Math.random draw, every other voice, the effects and the master chain.
// The JavaScript synth stays the reference the core is proven against
// (tools/measure.mjs --null).

export const ENGINE = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search || '').get('engine') === 'rust' ? 'rust' : 'js';
  } catch {
    return 'js';
  }
})();

// The voices the core plays, by the number it knows them by
// (core/src/lib.rs), and the parts of a kalimba note (core/src/voice.rs).
export const CORE_VOICES = { kalimba: 0, fiddle: 1, pad: 2 };
export const KALIMBA_STRIKE = 1;
export const KALIMBA_BODY = 2;

const WASM_URL = new URL('./dlcore.wasm', import.meta.url);
const WORKLET_URL = new URL('./worklet.js', import.meta.url);

// Fetched once per page, however many contexts and synths come and go.
let bytes = null;
export function fetchCore() {
  if (!bytes) {
    bytes = fetch(WASM_URL).then((res) => {
      if (!res.ok) throw new Error(`dlcore.wasm: HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    // A failed fetch can be tried again.
    bytes.catch(() => { bytes = null; });
  }
  return bytes;
}

// The worklet module, added once per context.
const modules = new WeakMap();

// Everything a Synth needs to build its core node on this context: the
// module's bytes, with the worklet already added. Async, so the app calls
// it as soon as it has a context and the synth takes it when it arrives.
export async function loadCore(ctx) {
  if (!ctx.audioWorklet) throw new Error('no AudioWorklet in this browser');
  let added = modules.get(ctx);
  if (!added) {
    added = ctx.audioWorklet.addModule(WORKLET_URL);
    modules.set(ctx, added);
  }
  const [wasm] = await Promise.all([fetchCore(), added]);
  return { bytes: wasm };
}

const NO_EXTRA = [NaN, NaN, NaN, NaN];

// One core node for one synth: an output per channel it serves, each
// connected into that channel's input.
export class CoreHost {
  constructor(ctx, core, dests) {
    this.ctx = ctx;
    this.dests = dests;
    this.late = 0;
    this.dropped = 0;
    this.failed = null;
    this._pings = new Map();
    this._ping = 0;
    this.node = new AudioWorkletNode(ctx, 'driftloom-core', {
      numberOfInputs: 0,
      numberOfOutputs: dests.length,
      outputChannelCount: dests.map(() => 1),
      // Copied, not moved: the page keeps its copy for the next synth.
      processorOptions: { bytes: core.bytes },
    });
    dests.forEach((dest, i) => this.node.connect(dest, i));
    this.node.port.onmessage = (e) => this._receive(e.data);
  }

  // The core's channel number for this destination, or -1.
  channelOf(dest) {
    return this.failed ? -1 : this.dests.indexOf(dest);
  }

  // `extra` is the voice's own four numbers (core/src/lib.rs): for the
  // fiddle, the note it is joined to and its vibrato; for the pad, how many
  // notes the chord has. NaN for none.
  note(voice, channel, time, midi, dur, vel, parts, extra = NO_EXTRA) {
    this.node.port.postMessage({ type: 'note', voice, channel, time, midi, dur, vel, parts, extra });
  }

  // Resolves once the worklet has taken every message sent before it.
  flush() {
    const id = ++this._ping;
    return new Promise((resolve) => {
      this._pings.set(id, resolve);
      this.node.port.postMessage({ type: 'ping', id });
    });
  }

  dispose() {
    this.node.port.postMessage({ type: 'dispose' });
    try { this.node.disconnect(); } catch { /* already detached */ }
    this.node.port.onmessage = null;
  }

  _receive(m) {
    if (m.type === 'counts' || m.type === 'pong') {
      this.late = m.late;
      this.dropped = m.dropped;
    }
    if (m.type === 'pong') {
      const resolve = this._pings.get(m.id);
      this._pings.delete(m.id);
      if (resolve) resolve(m);
    }
    if (m.type === 'failed') this.failed = m.message;
  }
}
