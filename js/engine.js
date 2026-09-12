// Scheduling.
//
// setTimeout is far too jittery to place notes on, so it is only used to
// wake up and ask "what needs scheduling in the next fraction of a second?"
// The actual note times are absolute Web Audio clock times, which are
// sample-accurate. Standard two-clock pattern.

import { render, drift } from './generator.js';
import { Rng, randomSeed } from './rng.js';
import { Clock } from './clock.js';
import { CHARACTERS } from './characters.js';

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
  }

  load(spec, { keepPosition = false } = {}) {
    this.spec = spec;
    this.base = render(spec);
    this.live = this.driftOn ? drift(this.base, this.driftRng, this.driftAmount) : this.base;
    this.synth.setTone(spec.tone);
    const character = CHARACTERS[spec.character];
    this.synth.setCharacterLevel(character ? (character.level ?? 1) : 1);
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
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.clock.start(this.hidden ? TICK_HIDDEN : TICK_VISIBLE);
    this._tick();
  }

  stop() {
    this.playing = false;
    this.clock.stop();
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

  _scheduleStep(step, time) {
    const p = this.live;
    const cyc = p.cycles || {};
    const abs = this.absStep;
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
      for (const e of p.tracks.drums) {
        if (e.step !== s || !e.vel) continue;
        this.synth.drum(e.inst, t + (Math.random() - 0.5) * 0.008, e.vel);
      }
    }
    if (!mutes.bass) {
      const s = at('bass');
      for (const e of p.tracks.bass) {
        if (e.step !== s || !e.vel) continue;
        this.synth.bass(e.midi, t, e.dur * sd, e.vel, e.glide);
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
        this.synth.texture(e.kind, e.notes, t, e.dur * sd, e.vel);
      }
    }

    if (this.onStep) {
      const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
      setTimeout(() => this.onStep(step), delay);
    }
  }
}
