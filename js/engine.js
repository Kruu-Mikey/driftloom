// Scheduling.
//
// setTimeout is far too jittery to place notes on, so it is only used to
// wake up and ask "what needs scheduling in the next fraction of a second?"
// The actual note times are absolute Web Audio clock times, which are
// sample-accurate. Standard two-clock pattern.

import { render, drift, LAYERS, characterOf } from './generator.js';
import { Rng, randomSeed } from './rng.js';
import { Clock } from './clock.js';

// While you are looking at it, a short lookahead keeps mutes and re-rolls
// feeling immediate. Once the page is hidden the timer may be throttled to
// about one tick a second, so the queue has to be deep enough to cover the
// gap between wake-ups or the audio runs dry.
const LOOKAHEAD_VISIBLE = 0.3;
const LOOKAHEAD_HIDDEN = 3.0;
const TICK_VISIBLE = 50;
const TICK_HIDDEN = 250;

export class Engine {
  constructor(ctx, synth) {
    this.ctx = ctx;
    this.synth = synth;
    this.playing = false;
    this.spec = null;
    this.base = null; // the pattern as composed
    this.live = null; // the pattern as currently being played
    this.step = 0;
    // Never resets. Layers with different cycle lengths index off this, so
    // they keep drifting instead of resynchronising every time the pattern
    // wraps -- which is the whole point of the Eno character.
    this.absStep = 0;
    this.nextStepTime = 0;
    this.clock = new Clock(() => this._tick());
    this.driftOn = false;
    this.driftAmount = 1.0;
    this.loopCount = 0;
    this.driftRng = new Rng(randomSeed());
    this.onStep = null;
    this.onLoop = null;
    // Dropout counters. A stutter you cannot measure is a stutter you
    // cannot fix, and this runs on a phone that is not in front of me.
    this.lateTicks = 0;
    this.worstLateMs = 0;
    this.totalTicks = 0;
    this.tailsDucked = false;
    this.visualQueue = [];
    this.visualOffset = 0;   // optional manual trim, normally zero
    this.latency = null;     // measured, smoothed, seconds
  }

  // What the listener is hearing right now, on the audio clock.
  //
  // ctx.currentTime is the time of audio being handed to the output, not of
  // audio arriving at the ear; the gap is the output latency, which on
  // Android can exceed 300ms and varies by device, buffer size, and whether
  // headphones or Bluetooth are connected. Lighting the cursor at
  // currentTime therefore runs ahead of the music by an unknown amount, and
  // asking the user to dial that in by hand is not a fix.
  //
  // getOutputTimestamp exists for exactly this. It returns a correlated
  // pair: the audio-clock time of the sample being played at the output,
  // and the performance-clock time it happened. Interpolating from that pair
  // with performance.now() gives the true playback position, self-correcting
  // as latency changes underneath us -- which it does the moment Bluetooth
  // headphones connect.
  heardTime() {
    const ctx = this.ctx;
    let heard = null;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const since = (performance.now() - ts.performanceTime) / 1000;
        // A stale timestamp would otherwise extrapolate without bound.
        heard = ts.contextTime + Math.max(0, Math.min(0.5, since));
      }
    }
    if (heard === null) {
      // No timestamp: fall back to the declared latency figures.
      const declared = ctx.outputLatency || ctx.baseLatency || 0;
      heard = ctx.currentTime - declared;
    }
    // Smooth the implied latency rather than the position, so the cursor
    // never jumps backwards when a measurement wobbles.
    const raw = Math.max(0, Math.min(0.6, ctx.currentTime - heard));
    this.latency = this.latency === null ? raw : this.latency * 0.92 + raw * 0.08;
    return ctx.currentTime - this.latency;
  }

  // The step that should be lit right now, or null if nothing has changed.
  visualStep() {
    const now = this.heardTime() + this.visualOffset;
    let found = null;
    while (this.visualQueue.length && this.visualQueue[0].time <= now) {
      found = this.visualQueue.shift().step;
    }
    return found;
  }

  load(spec, { keepPosition = false } = {}) {
    this.spec = spec;
    this.base = render(spec);
    this.live = this.driftOn ? drift(this.base, this.driftRng, this.driftAmount) : this.base;
    this.synth.setTone(spec.tone);
    const character = characterOf(spec);
    this.synth.setCharacterLevel(character.level ?? 1);
    this.pumpAmount = character.pump ?? 0;
    this.synth.setEchoTime((60 / spec.bpm) * 0.75);
    for (const [layer, muted] of Object.entries(spec.mutes || {})) {
      this.synth.setMute(layer, muted);
    }
    if (!keepPosition) {
      this.step = 0;
      this.absStep = 0;
    } else {
      this.step = this.step % this.base.totalSteps;
    }
    return this.base;
  }

  get stepDur() {
    return 60 / this.spec.bpm / 4;
  }

  get hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  get lookahead() {
    return this.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD_VISIBLE;
  }

  // Called when the page is shown or hidden, so the tick rate follows.
  retune() {
    if (this.playing) this.clock.start(this.hidden ? TICK_HIDDEN : TICK_VISIBLE);
  }

  start() {
    if (this.playing || !this.spec) return;
    this.playing = true;
    this.synth.unsilence();
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.clock.start(this.hidden ? TICK_HIDDEN : TICK_VISIBLE);
    this._tick();
  }

  stop() {
    this.playing = false;
    this.clock.stop();
    this.visualQueue = [];
    this.synth.silence();
    if (this.tailsDucked) {
      this.synth.restoreTails(this.ctx.currentTime);
      this.tailsDucked = false;
    }
  }

  report() {
    return {
      clock: this.clock.usingWorker ? 'worker' : 'timer',
      hidden: this.hidden,
      lookahead: this.lookahead,
      ticks: this.totalTicks,
      lateTicks: this.lateTicks,
      worstLateMs: this.worstLateMs,
      ctxState: this.ctx.state,
      sampleRate: this.ctx.sampleRate,
      baseLatency: this.ctx.baseLatency ? +this.ctx.baseLatency.toFixed(4) : '-',
      outputLatency: this.ctx.outputLatency ? +this.ctx.outputLatency.toFixed(4) : '-',
      measuredLatencyMs: this.latency === null ? '-' : Math.round(this.latency * 1000),
      timestampApi: typeof this.ctx.getOutputTimestamp === 'function' ? 'yes' : 'no',
    };
  }

  clearMetrics() {
    this.lateTicks = 0;
    this.worstLateMs = 0;
    this.totalTicks = 0;
  }

  reset() {
    this.step = 0;
    this.absStep = 0;
    this.loopCount = 0;
    this.synth.setTone(this.spec.tone);
  }

  _tick() {
    if (!this.playing) return;
    this.totalTicks++;
    // If the next step was already due before we woke up, the queue ran dry
    // and something audible was missed.
    const behind = this.ctx.currentTime - this.nextStepTime;
    if (behind > 0) {
      this.lateTicks++;
      this.worstLateMs = Math.max(this.worstLateMs, Math.round(behind * 1000));
      // Do not try to catch up by cramming the missed steps in at once;
      // that turns a gap into a burst. Skip to now and carry on.
      if (behind > 0.25) this.nextStepTime = this.ctx.currentTime + 0.02;
    }
    const horizon = this.ctx.currentTime + this.lookahead;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 256) {
      this._scheduleStep(this.step, this.nextStepTime);
      this._advance();
    }
  }

  _advance() {
    this.nextStepTime += this.stepDur;
    this.step++;
    this.absStep++;
    if (this.step >= this.live.totalSteps) {
      this.step = 0;
      this.loopCount++;
      // Fresh variation at the top of each pass. The base pattern is never
      // touched, so the piece always returns to the version you saved.
      this.live = this.driftOn ? drift(this.base, this.driftRng, this.driftAmount) : this.base;
      if (this.onLoop) this.onLoop(this.loopCount);
    }
  }

  // True when every layer is scheduled out for the bar containing this step,
  // either by the loop's entry schedule or by a drift rest.
  _isSilentBar(absStep) {
    const p = this.live;
    if (!p) return false;
    const spb = p.stepsPerBar || 16;
    const bar = Math.floor((absStep % p.totalSteps) / spb);
    if (p.driftSilentBars && p.driftSilentBars.indexOf(bar) !== -1) return true;
    if (p.silentBars && p.silentBars.indexOf(bar) !== -1) return true;
    if (!p.form) return false;
    for (const layer of LAYERS) {
      const sched = p.form[layer];
      if (!sched) return false; // a freshly rolled layer plays throughout
      const cycle = (p.cycles && p.cycles[layer]) || p.totalSteps;
      const b = Math.floor((absStep % cycle) / spb) % sched.length;
      if (sched[b]) return false;
    }
    return true;
  }

  _scheduleStep(step, time) {
    const p = this.live;
    const cyc = p.cycles || {};
    const abs = this.absStep;

    // At each bar line, decide whether the tails should still be ringing.
    const spbNow = p.stepsPerBar || 16;
    if (abs % spbNow === 0) {
      const quiet = this._isSilentBar(abs);
      if (quiet && !this.tailsDucked) {
        this.synth.fadeTails(time);
        this.tailsDucked = true;
      } else if (!quiet && this.tailsDucked) {
        // Restore just before the bar starts, so the first note is not dry.
        this.synth.restoreTails(Math.max(this.ctx.currentTime, time - 0.12));
        this.tailsDucked = false;
      }
    }
    // Where each layer is inside its own loop.
    const at = (layer) => {
      const len = cyc[layer] || p.totalSteps;
      return len === p.totalSteps ? step : ((abs % len) + len) % len;
    };
    const swing = step % 2 === 1 ? this.spec.swing * this.stepDur : 0;
    const t = time + swing;
    const sd = this.stepDur;
    const mutes = this.spec.mutes || {};

    if (!mutes.drums) {
      const s = at('drums');
      const pump = this.pumpAmount || 0;
      for (const e of p.tracks.drums) {
        if (e.step !== s || !e.vel) continue;
        // Rolls sit between the steps, so they carry a fractional offset and
        // skip the humanising jitter that would smear them.
        const micro = e.micro ? e.micro * sd : 0;
        const jitter = e.roll ? 0 : (Math.random() - 0.5) * 0.008;
        this.synth.drum(e.inst, t + micro + jitter, e.vel);
        if (pump && e.inst === 'kick') this.synth.duck(t + micro, pump * e.vel);
      }
    }
    if (!mutes.bass) {
      const s = at('bass');
      for (const e of p.tracks.bass) {
        if (e.step !== s || !e.vel) continue;
        this.synth.bass(e.midi, t, e.dur * sd, e.vel, e.glide, e.voice);
      }
    }
    if (!mutes.chords) {
      const s = at('chords');
      for (const e of p.tracks.chords) {
        if (e.step !== s || !e.vel) continue;
        if (e.voice === 'pad') {
          this.synth.pad(e.notes, t, e.dur * sd, e.vel);
        } else {
          // Spread the level across the voicing so a five-note chord is
          // not five times louder than a single note.
          const spread = 0.8 / Math.sqrt(e.notes.length);
          e.notes.forEach((n, i) => {
            // Spread the notes of a chord by a few milliseconds so it
            // sounds like fingers rather than a switch closing.
            this.synth.voice(e.voice, n, t + i * 0.011, e.dur * sd, e.vel * spread,
              this.synth.channels.chords.gain);
          });
        }
      }
    }
    if (!mutes.melody) {
      const s = at('melody');
      for (const e of p.tracks.melody) {
        if (e.step !== s || !e.vel) continue;
        this.synth.voice(e.voice, e.midi, t, e.dur * sd, e.vel,
          this.synth.channels.melody.gain, { glide: e.glide });
      }
    }
    if (!mutes.texture) {
      const s = at('texture');
      for (const e of p.tracks.texture) {
        if (e.step !== s || !e.vel) continue;
        this.synth.texture(e.kind, e.notes, t, e.dur * sd, e.vel, { band: e.band });
      }
    }

    // The cursor used to get a setTimeout per step. Timer callbacks drift,
    // arrive in bursts and are the first thing the main thread drops under
    // load, so the playhead wandered away from the music. Record when each
    // step is due and let a frame loop read it off the audio clock instead.
    this.visualQueue.push({ step, time });
    if (this.visualQueue.length > 512) this.visualQueue.shift();
  }
}
