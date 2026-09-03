// Scheduling.
//
// setTimeout is far too jittery to place notes on, so it is only used to
// wake up and ask "what needs scheduling in the next fraction of a second?"
// The actual note times are absolute Web Audio clock times, which are
// sample-accurate. Standard two-clock pattern.

import { render, drift } from './generator.js';
import { Rng, randomSeed } from './rng.js';

const LOOKAHEAD = 0.3;  // seconds of audio scheduled in advance
const TICK = 50;        // ms between scheduler wake-ups

export class Engine {
  constructor(ctx, synth) {
    this.ctx = ctx;
    this.synth = synth;
    this.playing = false;
    this.spec = null;
    this.base = null; // the pattern as composed
    this.live = null; // the pattern as currently being played
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = null;
    this.driftOn = false;
    this.driftAmount = 1.0;
    this.loopCount = 0;
    this.driftRng = new Rng(randomSeed());
    this.onStep = null;
    this.onLoop = null;
  }

  load(spec, { keepPosition = false } = {}) {
    this.spec = spec;
    this.base = render(spec);
    this.live = this.driftOn ? drift(this.base, this.driftRng, this.driftAmount) : this.base;
    this.synth.setTone(spec.tone);
    this.synth.setEchoTime((60 / spec.bpm) * 0.75);
    for (const [layer, muted] of Object.entries(spec.mutes || {})) {
      this.synth.setMute(layer, muted);
    }
    if (!keepPosition) this.step = 0;
    else this.step = this.step % this.base.totalSteps;
    return this.base;
  }

  get stepDur() {
    return 60 / this.spec.bpm / 4;
  }

  start() {
    if (this.playing || !this.spec) return;
    this.playing = true;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._tick(), TICK);
    this._tick();
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.step = 0;
    this.loopCount = 0;
    this.synth.setTone(this.spec.tone);
  }

  _tick() {
    if (!this.playing) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 64) {
      this._scheduleStep(this.step, this.nextStepTime);
      this._advance();
    }
  }

  _advance() {
    this.nextStepTime += this.stepDur;
    this.step++;
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
    const swing = step % 2 === 1 ? this.spec.swing * this.stepDur : 0;
    const t = time + swing;
    const sd = this.stepDur;
    const mutes = this.spec.mutes || {};

    if (!mutes.drums) {
      for (const e of p.tracks.drums) {
        if (e.step !== step || !e.vel) continue;
        this.synth.drum(e.inst, t + (Math.random() - 0.5) * 0.008, e.vel);
      }
    }
    if (!mutes.bass) {
      for (const e of p.tracks.bass) {
        if (e.step !== step || !e.vel) continue;
        this.synth.bass(e.midi, t, e.dur * sd, e.vel, e.glide);
      }
    }
    if (!mutes.chords) {
      for (const e of p.tracks.chords) {
        if (e.step !== step || !e.vel) continue;
        if (e.voice === 'pad') {
          this.synth.pad(e.notes, t, e.dur * sd, e.vel);
        } else {
          // Spread the level across the voicing so a five-note chord is
          // not five times louder than a single note.
          const spread = 0.8 / Math.sqrt(e.notes.length);
          e.notes.forEach((n, i) => {
            // Spread the notes of a chord by a few milliseconds so it
            // sounds like fingers rather than a switch closing.
            this.synth.fm(n, t + i * 0.011, e.dur * sd, e.vel * spread, {
              ratio: 2,
              index: 200,
              decay: e.dur * sd * 0.6,
            });
          });
        }
      }
    }
    if (!mutes.melody) {
      for (const e of p.tracks.melody) {
        if (e.step !== step || !e.vel) continue;
        this.synth.pluck(e.midi, t, e.dur * sd, e.vel, e.voice);
      }
    }
    if (!mutes.texture) {
      for (const e of p.tracks.texture) {
        if (e.step !== step || !e.vel) continue;
        this.synth.texture(e.kind, e.notes, t, e.dur * sd, e.vel);
      }
    }

    if (this.onStep) {
      const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
      setTimeout(() => this.onStep(step), delay);
    }
  }
}
