// The Rust core, main-thread side (queue item 21, roadmap 16).
//
// `?engine=rust` turns it on; it is off by default, and with it off nothing
// here runs. With it on, the synth hands every voice to an AudioWorkletNode
// running js/dlcore.wasm, and since queue item 29 the mix as well: the
// channels, sends, duck, echo and reverb. It keeps everything else:
// scheduling, the voice budget, every Math.random draw, and the master
// chain.
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
export const CORE_VOICES = {
  kalimba: 0, fiddle: 1, pad: 2, fm: 3, sine: 4, tubular: 5,
  softpad: 6, analogpad: 7, analoglead: 8, sawpluck: 9, beep: 10, moog: 11, whistle: 12,
  nylon: 13, accordion: 14,
  stab: 15, ocarina: 16, flute: 17, panflute: 18, knock: 19, templebell: 20, hat: 21,
  bass: 22, texture: 23, drum: 24,
  vowel: 25, hum: 26, choir: 27,
};
// A sung note's vowel and where it drifts to, as the core numbers them
// (core/src/sung.rs); 4 is a hum opening.
export const SUNG_VOWELS = { a: 0, e: 1, o: 2, u: 3 };
export const SUNG_OPEN_HUM = 4;
// The longest sung note the core takes (sung::LONGEST): its detune holds
// the jitter's steps for this long. Longer ones play in JavaScript.
export const SUNG_LONGEST = 13.5;
// A bass note's voice in `parts`, and its two flags (core/src/bass.rs); a
// name that is not here is the original, `sub`, as the JavaScript voice has it.
export const BASS_KINDS = { sub: 0, round: 1, fifths: 2, pluckbass: 3, moogbass: 4 };
export const BASS_GLIDE = 8;
export const BASS_CHUG = 16;
// A texture note's, in `parts` (core/src/texture.rs).
export const TEXTURE_KINDS = { swell: 0, drop: 1, wind: 2, waves: 3 };
// A drum's, in `parts` (core/src/drums.rs); the hats are the hat voice, and
// their kinds (core/src/breath.rs) are `parts` of their own.
export const DRUM_KINDS = {
  kick: 0, softkick: 1, snare: 2, clap: 3, rim: 4, frame: 5, tap: 6, jingle: 7, ojingle: 8,
};
export const HAT_KINDS = { hat: 0, ohat: 1, shaker: 2 };
// The longest noise the core holds (NOISE_MAX, core/src/noise.rs): two
// seconds at 96 kHz.
export const CORE_NOISE_MAX = 192000;
export const KALIMBA_STRIKE = 1;
export const KALIMBA_BODY = 2;

// The mix's parameters, by the number the core knows them by
// (core/src/mix.rs): each one AudioParam of the synth's graph (the combs'
// one of each comb, which setTone moves together). `gains` is the first of
// five, one per channel in the core's order.
export const MIX = {
  gains: 0, pump: 5, tails: 6, echo: 7, combFb: 8, combFreq: 9, combSum: 10, reverbOut: 11,
};
// The AudioParam calls a parameter takes.
export const SET = 0;
export const LINEAR = 1;
export const TARGET = 2;
export const CANCEL = 3;

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

// A note carries up to twelve of its voice's own values (EXTRA in
// core/src/lib.rs); what it leaves out reaches the core as NaN.
const NO_EXTRA = [];

// One core node for one synth. `dests` are the synth's five channels in
// the core's order, each a voice's destination: what a voice the core
// takes would have played into, and, for a note it cannot take, where the
// synth plays it instead -- connected by the synth into the node's input
// for that channel. The node's one output is the mix, for the master
// chain; with `taps`, five more carry the channels as they went into it.
// `noise` is the synth's noise samples, handed to the core once.
// `quality` is the synth's: the mix has six combs on 'full', three on
// 'lite'.
export class CoreHost {
  constructor(ctx, core, dests, noise = null, { quality = 'full', taps = false } = {}) {
    this.ctx = ctx;
    this.dests = dests;
    this.taps = taps;
    // Called once if the core turns out not to run (too old a browser).
    this.onfail = null;
    // Whether the core has the noise its noise voices play.
    this.noise = !!noise && noise.length <= CORE_NOISE_MAX;
    this.late = 0;
    this.dropped = 0;
    this.failed = null;
    this._pings = new Map();
    this._ping = 0;
    const outputs = taps ? 1 + dests.length : 1;
    this.node = new AudioWorkletNode(ctx, 'driftloom-core', {
      numberOfInputs: dests.length,
      numberOfOutputs: outputs,
      outputChannelCount: new Array(outputs).fill(1),
      // The graph is mono end to end.
      channelCount: 1,
      channelCountMode: 'explicit',
      // Copied, not moved: the page keeps its copy for the next synth.
      processorOptions: { bytes: core.bytes, noise: this.noise ? noise : null, quality },
    });
    this.node.port.onmessage = (e) => this._receive(e.data);
  }

  // The output carrying channel `channel` as it went into the mix (`taps`).
  tapOf(channel) {
    return this.taps ? 1 + channel : -1;
  }

  // Move one of the mix's parameters (MIX) by an AudioParam call (SET,
  // LINEAR, TARGET, CANCEL), as the synth would move its own node's:
  // `value` at `time`, with time constant `tau` for a target.
  param(id, op, value, time, tau = 0) {
    this.node.port.postMessage({ type: 'param', id, op, value, time, tau });
  }

  // The core's channel number for this destination, or -1.
  channelOf(dest) {
    return this.failed ? -1 : this.dests.indexOf(dest);
  }

  // `extra` is the voice's own numbers (core/src/lib.rs): for the fiddle,
  // the note it is joined to and its vibrato; for the pad, how many notes
  // the chord has; for fm, its five options; for tubular, its five detune
  // draws.
  // `draws` is a sung note's draws, as many as it made (Core::sung_draws).
  note(voice, channel, time, midi, dur, vel, parts, extra = NO_EXTRA, draws = null) {
    this.node.port.postMessage({ type: 'note', voice, channel, time, midi, dur, vel, parts, extra, draws });
  }

  // A new strum into `channel` at `time`: the last strum's nylon strings
  // still held let go (Synth.damp, Core::damp).
  damp(channel, time) {
    this.node.port.postMessage({ type: 'damp', channel, time });
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
    if (m.type === 'failed') {
      this.failed = m.message;
      if (this.onfail) this.onfail();
    }
  }
}
