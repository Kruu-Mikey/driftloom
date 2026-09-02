// All sound is synthesised at runtime. No samples, no downloads, nothing
// to load. Every voice is built from a handful of oscillators and one
// shared noise buffer, which is what keeps this playable on a cheap phone.

import { midiToFreq } from './theory.js';

const MAX_VOICES = 28;

function tanhCurve(drive = 2.2, n = 1024) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
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

    // Last line of defence. Whatever combination of layers lands on the
    // same sixteenth, nothing leaves here above unity.
    this.ceiling = ctx.createDynamicsCompressor();
    this.ceiling.threshold.value = -3;
    this.ceiling.knee.value = 0;
    this.ceiling.ratio.value = 20;
    this.ceiling.attack.value = 0.001;
    this.ceiling.release.value = 0.08;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 38;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 7200;
    this.tone.Q.value = 0.6;

    this.sat = ctx.createWaveShaper();
    this.sat.curve = tanhCurve(2.0);
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
      bass: { gain: 0.8, verb: 0.05, echo: 0.0 },
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
    this.sat.curve = tanhCurve(1.4 + warmth * 2.2);
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
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
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

  bass(midi, time, dur, vel = 0.7, glide = false) {
    if (!this._budget()) return;
    const ctx = this.ctx;
    const out = this.channels.bass.gain;
    const f = midiToFreq(midi);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    if (glide) {
      osc.frequency.setValueAtTime(f * 0.66, time);
      osc.frequency.exponentialRampToValueAtTime(f, time + 0.08);
    } else {
      osc.frequency.setValueAtTime(f, time);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f, time);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(Math.min(4200, f * 10), time);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), time + Math.min(0.4, dur));

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.2, time + 0.012);
    g.gain.setTargetAtTime(vel * 0.13, time + 0.05, 0.25);
    g.gain.setTargetAtTime(0.0001, time + dur, 0.06);

    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, time);
    subG.gain.exponentialRampToValueAtTime(vel * 0.2, time + 0.015);
    subG.gain.setTargetAtTime(0.0001, time + dur, 0.08);

    osc.connect(lp).connect(g).connect(out);
    sub.connect(subG).connect(out);
    osc.start(time);
    sub.start(time);
    osc.stop(time + dur + 0.4);
    sub.stop(time + dur + 0.4);
    this._release(dur + 0.4);
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

  pad(notes, time, dur, vel) {
    const ctx = this.ctx;
    const out = this.channels.chords.gain;
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
