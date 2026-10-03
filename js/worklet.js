// The Rust core's host in the browser (queue item 21, roadmap 16).
//
// One AudioWorkletProcessor around one instance of js/dlcore.wasm. The
// main thread decides every note, as it always has, and posts each one
// here with its absolute start time on the context's clock; the core
// queues it and starts it on its exact sample within the block. Notes
// starting at the 128-frame block boundary instead were enough to wreck
// the match against Web Audio in the brain's probe (-0.1 dB residual
// against -55.6).
//
// The module arrives as bytes in processorOptions and is compiled here,
// synchronously: it is small, and passing a compiled WebAssembly.Module
// across is less certain on iOS Safari, the target. No SharedArrayBuffer,
// no threads, nothing that needs special headers.
//
// One output per channel the core serves, each connected by the synth into
// that channel's input, so echo, reverb, ducking, mutes, silence() and the
// master chain treat these notes exactly as JavaScript ones.

const QUANTUM = 128;
// Core::note's answers (core/src/lib.rs, Taken).
const LATE = 1;
const FULL = 2;

class DriftloomCore extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.alive = true;
    this.core = null;
    this.views = null;
    this.outputs = options.numberOfOutputs;
    try {
      const module = new WebAssembly.Module(options.processorOptions.bytes);
      this.core = new WebAssembly.Instance(module, {}).exports;
      this.core.dl_init(sampleRate);
    } catch (err) {
      // Too old a browser for the module, most likely (it needs Safari 15
      // or later). The synth hears this and plays everything in JS.
      this.core = null;
      this.port.postMessage({ type: 'failed', message: String(err && err.message || err) });
    }
    this.port.onmessage = (e) => this.receive(e.data);
  }

  receive(m) {
    const core = this.core;
    switch (m.type) {
      case 'note': {
        if (!core) return;
        const taken = core.dl_note(m.voice, m.channel, m.time, m.midi, m.dur, m.vel, m.parts);
        // Rare, so worth a message each: Diagnostics counts them.
        if (taken === LATE || taken === FULL) {
          this.port.postMessage({ type: 'counts', late: core.dl_late(), dropped: core.dl_dropped() });
        }
        return;
      }
      case 'dispose':
        // Clear everything, and let go of the instance so its memory can be
        // reclaimed: a browser
        // holds only so many WebAssembly memories at once (about 128 in
        // Chromium), and a page that builds synth after synth -- the
        // measure harness renders hundreds -- would otherwise run out.
        if (core) core.dl_clear();
        this.alive = false;
        this.core = null;
        this.views = null;
        this.port.onmessage = null;
        return;
      case 'ping':
        // Every message before this one has been taken: the measure
        // harness waits for this before it renders.
        this.port.postMessage({
          type: 'pong',
          id: m.id,
          late: core ? core.dl_late() : 0,
          dropped: core ? core.dl_dropped() : 0,
          busy: core ? core.dl_busy() : 0,
        });
        return;
      default:
    }
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const core = this.core;
    if (!core) return true;
    const at = core.dl_process(currentFrame);
    // Views onto the core's output buffers, made once: the buffers never
    // move, and the memory never grows, since nothing allocates after
    // init. A new view every block would be garbage every block.
    if (!this.views || this.views.at !== at || this.views.buffer !== core.memory.buffer) {
      const buffer = core.memory.buffer;
      this.views = { at, buffer, channels: [] };
      for (let c = 0; c < this.outputs; c++) {
        this.views.channels.push(new Float32Array(buffer, at + c * QUANTUM * 4, QUANTUM));
      }
    }
    for (let c = 0; c < this.outputs; c++) {
      const out = outputs[c] && outputs[c][0];
      if (out && out.length === QUANTUM) out.set(this.views.channels[c]);
    }
    return true;
  }
}

registerProcessor('driftloom-core', DriftloomCore);
