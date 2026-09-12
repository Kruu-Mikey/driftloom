// All sound is synthesised at runtime. No samples, no downloads, nothing
// to load. Every voice is built from a handful of oscillators and one
// shared noise buffer, which is what keeps this playable on a cheap phone.

import { midiToFreq } from './theory.js';

const MAX_VOICES = 28;

// Tape saturation, not a maximizer.
//
// Dividing by tanh(drive) -- the obvious normalisation, since it maps x=1 to
// y=1 -- gives a small-signal gain of drive/tanh(drive), which reaches 3.2x.
// That hauls up every quiet detail while clamping the peaks, which is a
// distortion pedal, and it is what was audible as "clipping" even though
// nothing ever reached full scale.
//
// Dividing by drive instead makes the slope at zero exactly 1: quiet passages
// pass through untouched and only loud ones round off. Peaks land around
// -3 to -6 dB depending on drive, which is what tape actually does.
function tanhCurve(drive = 1.0, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / drive;
  }
  return curve;
}

export class Synth {
  constructor(ctx, quality = 'full') {
    this.ctx = ctx;
    this.quality = quality;
    this.voices = 0;
    this.noise = this._makeNoise(2.0);
    this._build();
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      // Light pinking. Pure white noise sounds like a hiss; this sounds like air.
      b0 = 0.99765 * b0 + white * 0.099;
      b1 = 0.963 * b1 + white * 0.293;
      b2 = 0.57 * b2 + white * 1.0526;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
    return buf;
  }

  _build() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.userVolume = 0.85;
    this.characterLevel = 1;

    // Last line of defence. Whatever combination of layers lands on the
    // same sixteenth, nothing leaves here above unity.
    this.ceiling = ctx.createDynamicsCompressor();
    this.ceiling.threshold.value = -3;
    this.ceiling.knee.value = 0;
    this.ceiling.ratio.value = 20;
    this.ceiling.attack.value = 0.001;
    this.ceiling.release.value = 0.08;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.25;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 38;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 7200;
    this.tone.Q.value = 0.6;

    this.sat = ctx.createWaveShaper();
    this.sat.curve = tanhCurve(1.0);
    this.sat.oversample = this.quality === 'full' ? '2x' : 'none';

    // Tape wobble: a very short delay whose time is modulated. Slow wow,
    // fast flutter. This one node does most of the "not made this decade" work.
    this.wobble = ctx.createDelay(0.2);
    this.wobble.delayTime.value = 0.014;
    this.wowLfo = ctx.createOscillator();
    this.wowLfo.frequency.value = 0.32;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 0.0016;
    this.flutterLfo = ctx.createOscillator();
    this.flutterLfo.frequency.value = 6.3;
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0.00018;
    this.wowLfo.connect(this.wowDepth).connect(this.wobble.delayTime);
    this.flutterLfo.connect(this.flutterDepth).connect(this.wobble.delayTime);
    this.wowLfo.start();
    this.flutterLfo.start();

    this.preBus = ctx.createGain();
    this.preBus.connect(this.wobble);
    this.wobble.connect(this.sat);
    this.sat.connect(this.tone);
    this.tone.connect(this.hp);
    this.hp.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.ceiling);
    // The last node in the chain. Connected straight to the speakers here
    // so the synth works on its own, but MediaBridge re-routes it through
    // a media element so the phone treats us as a music player.
    this.output = this.ceiling;
    this.ceiling.connect(ctx.destination);

    // Reverb: parallel damped comb filters. Far cheaper than a convolver
    // and it can be tuned live, which a fixed impulse response cannot.
    this.reverbIn = ctx.createGain();
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.8;
    // Six combs in parallel, each with feedback near 0.85, multiply the
    // signal by roughly fifty before it reaches the bus. Normalising by
    // (1 - feedback) / count puts the tail back at the level of the send.
    this.combSum = ctx.createGain();
    this.combs = [];
    const times = this.quality === 'full'
      ? [0.0297, 0.0371, 0.0411, 0.0437, 0.0503, 0.0577]
      : [0.0297, 0.0411, 0.0503];
    for (const t of times) {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = t;
      const fb = ctx.createGain();
      fb.gain.value = 0.8;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      this.reverbIn.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);
      d.connect(this.combSum);
      this.combs.push({ d, fb, lp });
    }
    this.combSum.gain.value = 0.2 / this.combs.length;
    this.combSum.connect(this.reverbOut);
    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.02;
    this.reverbOut.connect(preDelay);
    preDelay.connect(this.preBus);

    // Echo, tuned to a dotted eighth by default; set per loop tempo later.
    this.echo = ctx.createDelay(2.0);
    this.echo.delayTime.value = 0.36;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.34;
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 2000;
    this.echoIn = ctx.createGain();
    this.echoIn.connect(this.echo);
    this.echo.connect(this.echoTone);
    this.echoTone.connect(this.echoFb);
    this.echoFb.connect(this.echo);
    this.echoTone.connect(this.preBus);

    // No continuous surface-noise layer: the musical voices and reverb
    // provide the atmosphere without adding an audible hiss.

    // Per-layer channels, each with its own send amounts.
    this.channels = {};
    const cfg = {
      drums: { gain: 0.82, verb: 0.1, echo: 0.05 },
      bass: { gain: 0.62, verb: 0.05, echo: 0.0 },
      chords: { gain: 0.5, verb: 0.35, echo: 0.15 },
      melody: { gain: 0.45, verb: 0.4, echo: 0.35 },
      texture: { gain: 0.5, verb: 0.6, echo: 0.25 },
    };
    for (const [name, c] of Object.entries(cfg)) {
      const g = ctx.createGain();
      g.gain.value = c.gain;
      const verb = ctx.createGain();
      verb.gain.value = c.verb;
      const echo = ctx.createGain();
      echo.gain.value = c.echo;
      g.connect(this.preBus);
      g.connect(verb).connect(this.reverbIn);
      g.connect(echo).connect(this.echoIn);
      this.channels[name] = { gain: g, verb, echo, base: c };
    }
  }

  setTone(tone) {
    const t = this.ctx.currentTime;
    const warmth = tone.warmth ?? 0.6;
    const space = tone.space ?? 0.5;
    const wobble = tone.wobble ?? 0.4;

    this.tone.frequency.setTargetAtTime(2600 + (1 - warmth) * 9000, t, 0.2);
    this.sat.curve = tanhCurve(0.55 + warmth * 1.25);
    this.reverbOut.gain.setTargetAtTime(0.4 + space * 0.9, t, 0.2);
    // Cap room feedback to prevent resonant high-frequency feedback at large room sizes.
    const fb = Math.min(0.74, 0.66 + space * 0.2);
    for (const c of this.combs) {
      c.fb.gain.setTargetAtTime(fb, t, 0.2);
      c.lp.frequency.setTargetAtTime(1400 + space * 2600, t, 0.2);
    }
    this.combSum.gain.setTargetAtTime((1 - fb) / this.combs.length, t, 0.2);
    this.wowDepth.gain.setTargetAtTime(0.0004 + wobble * 0.0038, t, 0.2);
    this.flutterDepth.gain.setTargetAtTime(0.00004 + wobble * 0.0005, t, 0.2);
  }

  setEchoTime(seconds) {
    this.echo.delayTime.setTargetAtTime(Math.min(1.9, seconds), this.ctx.currentTime, 0.05);
  }

  setMute(layer, muted) {
    const ch = this.channels[layer];
    if (!ch) return;
    ch.gain.gain.setTargetAtTime(muted ? 0 : ch.base.gain, this.ctx.currentTime, 0.03);
  }

  setVolume(v) {
    this.userVolume = v;
    this._applyGain();
  }

  // Per-character trim, kept separate from the user's volume so the two do
  // not fight each other.
  setCharacterLevel(level) {
    this.characterLevel = level;
    this._applyGain();
  }

  _applyGain() {
    const v = (this.userVolume ?? 0.85) * (this.characterLevel ?? 1);
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }

  _budget() {
    if (this.voices > MAX_VOICES) return false;
    this.voices++;
    return true;
  }
  _release(dur) {
    setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
    }, dur * 1000 + 120);
  }

  _noiseSource(time, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const offset = Math.random() * (this.noise.duration - dur - 0.05);
    src.start(time, Math.max(0, offset), dur + 0.05);
    return src;
  }

  // ------------------------------------------------------------- drums

  drum(inst, time, vel = 0.8) {
    if (!this._budget()) return;
    const ctx = this.ctx;
    const out = this.channels.drums.gain;
    const v = Math.max(0, Math.min(1, vel));

    if (inst === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(128, time);
      osc.frequency.exponentialRampToValueAtTime(44, time + 0.09);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * 1.1, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);
      osc.connect(g).connect(out);
      osc.start(time);
      osc.stop(time + 0.42);

      const click = this._noiseSource(time, 0.03);
      const cf = ctx.createBiquadFilter();
      cf.type = 'lowpass';
      cf.frequency.value = 1400;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(v * 0.28, time);
      cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      click.connect(cf).connect(cg).connect(out);
      this._release(0.45);
      return;
    }

    if (inst === 'snare' || inst === 'clap') {
      const dur = inst === 'clap' ? 0.2 : 0.16;
      const src = this._noiseSource(time, dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = inst === 'clap' ? 1500 : 1900;
      bp.Q.value = inst === 'clap' ? 1.4 : 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * 0.7, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(bp).connect(g).connect(out);

      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(inst === 'clap' ? 320 : 190, time);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(v * 0.3, time);
      bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
      body.connect(bg).connect(out);
      body.start(time);
      body.stop(time + 0.12);
      this._release(dur);
      return;
    }

    if (inst === 'hat' || inst === 'ohat' || inst === 'shaker') {
      const dur = inst === 'ohat' ? 0.26 : inst === 'shaker' ? 0.07 : 0.045;
      const src = this._noiseSource(time, dur);
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = inst === 'shaker' ? 5200 : 7400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * (inst === 'shaker' ? 0.3 : 0.42), time + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(hpf).connect(g).connect(out);
      this._release(dur);
      return;
    }

    if (inst === 'rim') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, time);
      osc.frequency.exponentialRampToValueAtTime(280, time + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(v * 0.5, time + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 2.4;
      osc.connect(bp).connect(g).connect(out);
      osc.start(time);
      osc.stop(time + 0.09);
      this._release(0.1);
      return;
    }
    this._release(0.05);
  }

  // -------------------------------------------------------------- bass

  // One sawtooth-plus-sub recipe for every loop was both the muddiest option
  // and the most monotonous. Each of these keeps the low end clear a
  // different way: less sub, a steeper filter, or no sawtooth at all.
  bass(midi, time, dur, vel = 0.7, glide = false, voice = 'sub') {
    if (!this._budget()) return;
    const ctx = this.ctx;
    const out = this.channels.bass.gain;
    const f = midiToFreq(midi);
    const stop = time + dur + 0.4;
    // Measured trims. Sustained low voices build up far more energy than
    // short ones, so a single channel fader either leaves the sustained
    // ones booming or buries the plucked ones.
    const TRIM = { sub: 0.55, fifths: 0.55, round: 0.75, pluckbass: 0.72, rhodesbass: 0.8, moogbass: 1 };
    vel *= TRIM[voice] ?? 1;

    const env = (peak, sustain, release) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), time + 0.014);
      if (sustain != null) g.gain.setTargetAtTime(sustain, time + 0.05, 0.25);
      g.gain.setTargetAtTime(0.0001, time + dur, release);
      return g;
    };

    const setF = (osc) => {
      if (glide) {
        osc.frequency.setValueAtTime(f * 0.66, time);
        osc.frequency.exponentialRampToValueAtTime(f, time + 0.08);
      } else {
        osc.frequency.setValueAtTime(f, time);
      }
    };

    if (voice === 'round') {
      // Triangle through a gentle filter. No sawtooth buzz, no sub piled on
      // top: the cleanest option and the right one under a quiet pad.
      const o = ctx.createOscillator();
      o.type = 'triangle';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(Math.min(2200, f * 6), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(140, f * 2.4), time + Math.min(0.5, dur));
      const g = env(vel * 0.34, vel * 0.22, 0.08);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);
    } else if (voice === 'fifths') {
      // Root and fifth, sine only. Open and weightless -- it states a bass
      // note without asserting a chord, which is what the ambient
      // characters want underneath a floating harmony.
      for (const [mult, lvl] of [[1, 0.3], [1.5, 0.14]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * mult, time);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * lvl, time + Math.min(0.4, dur * 0.3));
        g.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.2);
        o.connect(g).connect(out);
        o.start(time); o.stop(stop + 0.4);
      }
    } else if (voice === 'rhodesbass') {
      this.fm(midi, time, dur, vel * 0.85, { out, ratio: 1, index: 130, decay: 0.4, attack: 0.006 });
    } else if (voice === 'pluckbass') {
      // Short and woody, with a little noise for the finger. Leaves space
      // between notes instead of filling the whole bar with low end.
      const o = ctx.createOscillator();
      o.type = 'triangle';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(Math.min(2600, f * 9), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(130, f * 2), time + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vel * 0.42, time + 0.006);
      g.gain.setTargetAtTime(0.0001, time + Math.min(dur, 0.3), 0.1);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);
      const click = this._noiseSource(time, 0.02);
      const cf = ctx.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 900;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(vel * 0.1, time);
      cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
      click.connect(cf).connect(cg).connect(out);
    } else if (voice === 'moogbass') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 9;
      lp.frequency.setValueAtTime(Math.min(3600, f * 11), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(150, f * 2.2), time + Math.min(0.35, dur));
      const g = env(vel * 0.26, vel * 0.15, 0.07);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);
    } else {
      // The original: sawtooth over a sine sub. Kept, but with the sub
      // pulled well down -- at the old level the two fundamentals stacked
      // and turned into mud.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      setF(o);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(Math.min(4200, f * 10), time);
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), time + Math.min(0.4, dur));
      const g = env(vel * 0.17, vel * 0.11, 0.06);
      o.connect(lp).connect(g).connect(out);
      o.start(time); o.stop(stop);

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(f, time);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, time);
      sg.gain.exponentialRampToValueAtTime(vel * 0.13, time + 0.015);
      sg.gain.setTargetAtTime(0.0001, time + dur, 0.08);
      sub.connect(sg).connect(out);
      sub.start(time); sub.stop(stop);
    }
    this._release(dur + 0.8);
  }

  // ------------------------------------------------------------- tuned

  // Two-operator FM. Ratio and index do all the work: 2:1 with a short
  // index envelope is an electric piano, 3.5:1 is a bell, 1:1 is a soft
  // reed. One tiny voice covering most of a mid-80s digital keyboard.
  fm(midi, time, dur, vel, opts = {}) {
    if (!this._budget()) return;
    const ctx = this.ctx;
    const out = opts.out || this.channels.chords.gain;
    const f = midiToFreq(midi);
    const ratio = opts.ratio ?? 2;
    const index = opts.index ?? 220;
    const attack = opts.attack ?? 0.006;
    const decay = opts.decay ?? dur;
    const detune = opts.detune ?? 0;

    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = f;
    car.detune.value = detune;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = f * ratio;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(index * vel, time);
    modGain.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.06), time + Math.min(0.9, decay));
    mod.connect(modGain).connect(car.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vel * 0.26), time + attack);
    g.gain.setTargetAtTime(0.0001, time + Math.max(0.05, dur * 0.7), Math.max(0.06, dur * 0.35));

    car.connect(g).connect(out);
    car.start(time);
    mod.start(time);
    const stop = time + dur + 1.2;
    car.stop(stop);
    mod.stop(stop);
    this._release(dur + 1.2);
  }

  pad(notes, time, dur, vel, dest) {
    const ctx = this.ctx;
    const out = dest || this.channels.chords.gain;
    for (const midi of notes) {
      if (!this._budget()) return;
      const f = midiToFreq(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime((vel * 0.22) / Math.sqrt(notes.length), time + Math.min(0.9, dur * 0.4));
      g.gain.setTargetAtTime(0.0001, time + dur * 0.8, dur * 0.35 + 0.2);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, time);
      lp.frequency.linearRampToValueAtTime(1900, time + dur * 0.5);
      lp.Q.value = 0.8;
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(time);
        o.stop(time + dur + 1.6);
      }
      lp.connect(g).connect(out);
      this._release(dur + 1.6);
    }
  }

  pluck(midi, time, dur, vel, voice = 'pluck') {
    const out = this.channels.melody.gain;
    if (voice === 'bell') {
      this.fm(midi, time, dur * 0.9, vel, { out, ratio: 3.51, index: 420, decay: 0.5 });
    } else if (voice === 'keys') {
      this.fm(midi, time, dur, vel, { out, ratio: 2, index: 260, decay: 0.4 });
    } else if (voice === 'saw') {
      if (!this._budget()) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToFreq(midi);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, time);
      lp.frequency.exponentialRampToValueAtTime(700, time + dur);
      lp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vel * 0.28, time + 0.01);
      g.gain.setTargetAtTime(0.0001, time + dur * 0.6, 0.15);
      o.connect(lp).connect(g).connect(out);
      o.start(time);
      o.stop(time + dur + 0.6);
      this._release(dur + 0.6);
    } else {
      // Square-wave beep with a touch of vibrato. The Adventure Time voice.
      if (!this._budget()) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = midiToFreq(midi);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.4;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 3.5;
      vib.connect(vibGain).connect(o.detune);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vel * 0.16, time + 0.008);
      g.gain.setTargetAtTime(0.0001, time + dur * 0.55, 0.12);
      o.connect(lp).connect(g).connect(out);
      o.start(time);
      vib.start(time);
      o.stop(time + dur + 0.5);
      vib.stop(time + dur + 0.5);
      this._release(dur + 0.5);
    }
  }


  // ------------------------------------------------------- voice router

  // One entry point for every tuned sound. Characters name a voice and this
  // decides what that means in oscillators.
  voice(name, midi, time, dur, vel, out, opts = {}) {
    const ctx = this.ctx;
    const dest = out || this.channels.melody.gain;
    const f = midiToFreq(midi);

    switch (name) {
      // Zelda's harp: bright, short, two-operator, with a second voice a
      // hair out of tune so it rings rather than beeps.
      case 'harp':
        this.fm(midi, time, dur * 0.8, vel, { out: dest, ratio: 3, index: 200, decay: 0.35 });
        this.fm(midi, time + 0.006, dur * 0.6, vel * 0.4, { out: dest, ratio: 3, index: 140, decay: 0.3, detune: 7 });
        return;

      // Ocarina and flute are the same idea at different mixes: a nearly pure
      // tone plus breath noise, with vibrato that arrives late the way a
      // player's does.
      case 'ocarina':
      case 'flute': {
        if (!this._budget()) return;
        const breathy = name === 'flute';
        const o = ctx.createOscillator();
        o.type = breathy ? 'triangle' : 'sine';
        o.frequency.value = f;
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vibAmt = ctx.createGain();
        vibAmt.gain.setValueAtTime(0, time);
        vibAmt.gain.linearRampToValueAtTime(breathy ? 9 : 6, time + Math.min(0.5, dur));
        vib.connect(vibAmt).connect(o.detune);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.3, time + 0.05);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.09);
        o.connect(g).connect(dest);
        const air = this._noiseSource(time, dur + 0.1);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 2;
        bp.Q.value = 1.2;
        const ag = ctx.createGain();
        ag.gain.setValueAtTime(0.0001, time);
        ag.gain.linearRampToValueAtTime(vel * (breathy ? 0.1 : 0.045), time + 0.06);
        ag.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.09);
        air.connect(bp).connect(ag).connect(dest);
        o.start(time); vib.start(time);
        o.stop(time + dur + 0.4); vib.stop(time + dur + 0.4);
        this._release(dur + 0.4);
        return;
      }

      // Piano, the BOTW voice. Two operators at a 1:1 ratio with a fast index
      // decay give the struck-string bite; a detuned second partial and a
      // long tail do the rest. Not a Steinway, but it reads as a piano.
      case 'piano': {
        this.fm(midi, time, dur, vel * 0.9, { out: dest, ratio: 1, index: 340, decay: 0.16, attack: 0.002 });
        this.fm(midi + 12, time, dur * 0.5, vel * 0.16, { out: dest, ratio: 1, index: 120, decay: 0.1, detune: 4 });
        return;
      }

      case 'musicbox':
        this.fm(midi, time, dur * 0.9, vel, { out: dest, ratio: 5.1, index: 420, decay: 0.45 });
        return;

      // Fender Rhodes: the classic 2:1 bell-ish FM electric piano.
      case 'rhodes':
        this.fm(midi, time, dur, vel, { out: dest, ratio: 2, index: 190, decay: 0.5, attack: 0.004 });
        return;

      // Garson's Moog: one oscillator, portamento, and a resonant filter
      // sweep. Monophonic by nature, which is why it is a lead and not a pad.
      case 'moog':
      case 'whistle': {
        if (!this._budget()) return;
        const whistle = name === 'whistle';
        const o = ctx.createOscillator();
        o.type = whistle ? 'triangle' : 'sawtooth';
        if (opts.glide) {
          o.frequency.setValueAtTime(f * 0.75, time);
          o.frequency.exponentialRampToValueAtTime(f, time + 0.09);
        } else {
          o.frequency.setValueAtTime(f, time);
        }
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.6;
        const vibAmt = ctx.createGain();
        vibAmt.gain.setValueAtTime(0, time);
        vibAmt.gain.linearRampToValueAtTime(whistle ? 12 : 5, time + Math.min(0.6, dur));
        vib.connect(vibAmt).connect(o.detune);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = whistle ? 8 : 11;
        lp.frequency.setValueAtTime(Math.min(9000, f * 7), time);
        lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 1.6), time + Math.max(0.12, dur * 0.8));
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * (whistle ? 0.22 : 0.2), time + 0.014);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.75, 0.1);
        o.connect(lp).connect(g).connect(dest);
        o.start(time); vib.start(time);
        o.stop(time + dur + 0.5); vib.stop(time + dur + 0.5);
        this._release(dur + 0.5);
        return;
      }

      // Eno's voices: three detuned saws, heavily filtered, arriving slowly.
      case 'choir': {
        if (!this._budget()) return;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(700, time);
        lp.frequency.linearRampToValueAtTime(1500, time + dur * 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.16, time + Math.min(1.4, dur * 0.45));
        g.gain.setTargetAtTime(0.0001, time + dur * 0.7, dur * 0.3 + 0.3);
        for (const cents of [-9, 0, 11]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          o.stop(time + dur + 1.8);
        }
        lp.connect(g).connect(dest);
        this._release(dur + 1.8);
        return;
      }

      case 'sine': {
        if (!this._budget()) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.24, time + Math.min(0.5, dur * 0.3));
        g.gain.setTargetAtTime(0.0001, time + dur * 0.7, 0.25);
        o.connect(g).connect(dest);
        o.start(time);
        o.stop(time + dur + 1);
        this._release(dur + 1);
        return;
      }

      case 'moogpad':
        this.pad([midi], time, dur, vel, dest);
        return;

      default:
        this.pluck(midi, time, dur, vel, name);
    }
  }

  // ------------------------------------------------------------ texture

  texture(kind, notes, time, dur, vel) {
    const ctx = this.ctx;
    const out = this.channels.texture.gain;
    if (kind === 'swell') {
      for (const midi of notes) {
        if (!this._budget()) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = midiToFreq(midi);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.3, time + dur * 0.45);
        g.gain.linearRampToValueAtTime(0.0001, time + dur);
        o.connect(g).connect(out);
        o.start(time);
        o.stop(time + dur + 0.2);
        this._release(dur + 0.2);
      }
    } else if (kind === 'bell') {
      this.fm(notes[0], time, dur, vel, { out, ratio: 5.1, index: 300, decay: 1.1 });
    } else if (kind === 'drop') {
      if (!this._budget()) return;
      const src = this._noiseSource(time, 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400 + Math.random() * 3000, time);
      bp.Q.value = 9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vel * 0.3, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
      src.connect(bp).connect(g).connect(out);
      this._release(0.15);
    } else if (kind === 'wind') {
      if (!this._budget()) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.6;
      src.start(time);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 620;
      bp.Q.value = 1.1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 280;
      lfo.connect(lfoG).connect(bp.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(vel * 0.5, time + 1.5);
      g.gain.setTargetAtTime(0.0001, time + dur - 1, 0.5);
      src.connect(bp).connect(g).connect(out);
      lfo.start(time);
      lfo.stop(time + dur + 1);
      src.stop(time + dur + 1);
      this._release(dur + 1);
    }
  }
}
