// All sound is synthesised at runtime. No samples, no downloads, nothing
// to load. Every voice is built from a handful of oscillators and one
// shared noise buffer, which is what keeps this playable on a cheap phone.

import { midiToFreq } from './theory.js';

// A voice budget in *cost units*, not a count of voices.
//
// Earlier versions capped a flat count of active voices (28, then 44). That
// treats a hi-hat and a fat three-oscillator analogue pad as costing the
// same "one voice", which measured render time across every voice type
// shows is wrong by a lot: an analogpad note costs roughly 36x what a hat
// does, a choir note 34x, an FM piano note 28x. A flat cap is either far too
// loose for a chord of pads or far too tight for a busy hat pattern -- there
// is no single number that is right for both.
//
// The weights below are ratios from OfflineAudioContext render-time
// measurements taken on a development machine, not a real phone, and that
// distinction is not close enough to ignore: a desktop CPU core is commonly
// five to ten times faster per cycle than the efficiency cores a low-end
// Android phone actually schedules audio work onto. The *relative* costs
// between voices should hold regardless of hardware, since they come from
// node counts and filter complexity, not clock speed -- but the absolute
// BUDGET figures below are a reasoned starting point, not a measurement of
// any real device. If Diagnostics shows dropouts on a specific phone, this
// is the number to revisit first.
const VOICE_COST = {
  hat: 1, ohat: 1, shaker: 1, rim: 1, kick: 1, snare: 1.5, clap: 1.5,
  drop: 1.5, bell: 4, chime: 4, celeste: 4, musicbox: 4,
  sub: 8, round: 8, fifths: 8, pluckbass: 9, rhodesbass: 10, moogbass: 7,
  stab: 4, sine: 4, pluck: 11, saw: 8,
  rhodes: 15, moog: 18, whistle: 14, harp: 20,
  keys: 25, prepared: 25, piano: 26,
  pad: 25, moogpad: 25,
  choir: 34, analogpad: 32, softpad: 25,
  kalimba: 11, marimba: 9, vowel: 22, hum: 16,
  ocarina: 15, flute: 16,
  templebell: 12, tubular: 12,
};
const DEFAULT_COST = 12; // any voice not listed above

// Total budget, in the same units. Calibrated so a genuinely dense passage
// (a four-note analogpad chord plus a busy kit plus a melody note: roughly
// 4*32 + 6*1 + 15 = 149) fits comfortably, while a wall of the heaviest
// voice alone still hits a ceiling well before it could bog down a weak
// device. The "soft" budget is what pads and textures see, so when
// something has to give it is the sustained background yielding, not drums
// or the tune.
const MAX_BUDGET = 260;
const SOFT_BUDGET = 170;
const LITE_BUDGET = 140;

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
    this._releases = [];
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
    // Everything already scheduled keeps playing after Stop: notes are
    // queued up to a lookahead ahead (three seconds when hidden) and a pad
    // triggered just before Stop rings for its full length. A transport has
    // to actually stop, so the whole output passes through here and gets
    // faded out in 60ms.
    this.kill = ctx.createGain();
    this.kill.gain.value = 1;

    this.master.connect(this.kill);
    this.kill.connect(this.ceiling);
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
    // Both tails run through one gain so a scheduled rest can be made into
    // real silence. Without this a four second hole is two seconds of hole
    // and two seconds of reverb wash, which is not what silence sounds like.
    this.tails = ctx.createGain();
    this.tails.gain.value = 1;
    this.tails.connect(this.preBus);

    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.02;
    this.reverbOut.connect(preDelay);
    preDelay.connect(this.tails);

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
    this.echoTone.connect(this.tails);

    // No continuous surface-noise layer: the musical voices and reverb
    // provide the atmosphere without adding an audible hiss.

    // Everything except the drums passes through here, so the kick can
    // press the rest of the mix down and let it breathe back. Without that
    // movement a steady four-to-the-floor is just a thud on top of a pad.
    this.pumpBus = ctx.createGain();
    this.pumpBus.gain.value = 1;
    this.pumpBus.connect(this.preBus);

    // Per-layer channels, each with its own send amounts.
    //
    // The melody used to be the quietest channel in the mix and the wettest
    // -- 0.45 of gain against 0.5 for both keys and air, with more echo on
    // it than anything else carries. That is the recipe for an accompaniment,
    // not a tune: send and level both push a part backwards, and the melody
    // had the worst of each. It now sits above keys and air, with the echo
    // cut to a third of what it was and the reverb pulled back with it, so
    // the line arrives dry and in front instead of washing in from behind.
    // Keys give up a little to make the room.
    this.channels = {};
    const cfg = {
      drums: { gain: 0.82, verb: 0.1, echo: 0.05 },
      bass: { gain: 0.62, verb: 0.05, echo: 0.0 },
      chords: { gain: 0.44, verb: 0.35, echo: 0.15 },
      melody: { gain: 0.58, verb: 0.28, echo: 0.12 },
      texture: { gain: 0.5, verb: 0.6, echo: 0.25 },
    };
    for (const [name, c] of Object.entries(cfg)) {
      const g = ctx.createGain();
      g.gain.value = c.gain;
      const verb = ctx.createGain();
      verb.gain.value = c.verb;
      const echo = ctx.createGain();
      echo.gain.value = c.echo;
      g.connect(name === 'drums' ? this.preBus : this.pumpBus);
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

  // Let the tail ring naturally for a moment, then take it down to nothing.
  fadeTails(time, hold = 0.7, fall = 1.1) {
    this.tails.gain.cancelScheduledValues(time);
    this.tails.gain.setTargetAtTime(0.0001, time + hold, fall / 3);
  }

  restoreTails(time) {
    this.tails.gain.cancelScheduledValues(time);
    this.tails.gain.setTargetAtTime(1, time, 0.08);
  }

  // Called on each kick when the profile asks for it.
  duck(time, amount = 0.5, recover = 0.24) {
    if (!amount) return;
    const g = this.pumpBus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(Math.max(0.1, 1 - amount), time);
    g.linearRampToValueAtTime(1, time + recover);
  }

  setEchoTime(seconds) {
    this.echo.delayTime.setTargetAtTime(Math.min(1.9, seconds), this.ctx.currentTime, 0.05);
  }

  setMute(layer, muted) {
    const ch = this.channels[layer];
    if (!ch) return;
    ch.gain.gain.setTargetAtTime(muted ? 0 : ch.base.gain, this.ctx.currentTime, 0.03);
  }

  // Silence everything already in flight. Not a mute: the transport stopped.
  silence(when = this.ctx.currentTime) {
    const g = this.kill.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(g.value, when);
    g.linearRampToValueAtTime(0, when + 0.06);
  }

  unsilence(when = this.ctx.currentTime) {
    const g = this.kill.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(g.value, when);
    g.linearRampToValueAtTime(1, when + 0.02);
  }

  // Rebuilding the graph (the quality toggle does) used to abandon the old
  // one still wired to the speakers, with its LFOs running and its combs
  // ringing. Tear it down properly instead.
  dispose() {
    for (const osc of [this.wowLfo, this.flutterLfo]) {
      try { osc.stop(); } catch { /* already stopped */ }
      try { osc.disconnect(); } catch { /* already detached */ }
    }
    for (const c of this.combs) {
      try { c.fb.disconnect(); } catch { /* already detached */ }
      try { c.d.disconnect(); } catch { /* already detached */ }
      try { c.lp.disconnect(); } catch { /* already detached */ }
    }
    try { this.echoFb.disconnect(); } catch { /* already detached */ }
    try { this.ceiling.disconnect(); } catch { /* already detached */ }
    try { this.master.disconnect(); } catch { /* already detached */ }
    this._releases = [];
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

  // Voice budgeting used to count down with setTimeout. That is wrong twice
  // over. Backgrounded pages have their timers clamped to about 1Hz, so
  // releases arrive late, the counter stays high and notes get dropped --
  // a real cause of dropouts with the screen off. And in an offline render
  // the callbacks never fire at all, so the budget saturates after 28 notes
  // and silently discards the rest of the piece.
  //
  // Releases are now tracked on the audio clock and pruned against the time
  // the note is scheduled for, which is correct in both cases.
  // Guarantee an envelope is actually at zero when its oscillators stop.
  //
  // setTargetAtTime approaches the target exponentially and never arrives,
  // so stopping a node a fixed time later severs whatever is left. On a six
  // second chord that was a quarter of peak amplitude -- a step
  // discontinuity, which is a click, on every sustained note. Hold the
  // envelope where it has got to, then ramp it properly to zero.
  // Schedule a release that genuinely arrives at zero, then stop.
  //
  // setTargetAtTime approaches its target exponentially and never reaches
  // it, so stopping a node a fixed time later severs whatever is left --
  // on a six second chord that was a quarter of peak amplitude, a step
  // discontinuity, which is a click, on every sustained note.
  // exponentialRampToValueAtTime has a defined endpoint, so a short linear
  // ramp can take the last inaudible bit to true zero from a known value.
  _release2(param, from, to, floor = 0.0006) {
    param.exponentialRampToValueAtTime(floor, Math.max(from + 0.01, to - 0.025));
    param.linearRampToValueAtTime(0, to);
  }

  _stopClean(gainNode, sources, stopAt) {
    for (const s of sources) {
      try { s.stop(stopAt + 0.01); } catch { /* already stopped */ }
    }
  }

  _budget(time = this.ctx.currentTime, soft = false, cost = DEFAULT_COST) {
    while (this._releases.length && this._releases[0].at <= time) this._releases.shift();
    const spent = this._releases.reduce((sum, r) => sum + r.cost, 0);
    const ceiling = this.quality === 'lite' ? LITE_BUDGET : MAX_BUDGET;
    const cap = soft ? Math.min(SOFT_BUDGET, ceiling) : ceiling;
    if (spent + cost > cap) return false;
    return true;
  }

  _release(time, dur, cost = DEFAULT_COST) {
    const at = (typeof dur === 'number' ? time + dur : this.ctx.currentTime + time) + 0.12;
    let i = this._releases.length;
    while (i > 0 && this._releases[i - 1].at > at) i--;
    this._releases.splice(i, 0, { at, cost });
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
    const cost = VOICE_COST[inst] ?? 1.5;
    if (!this._budget(time, false, cost)) return;
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
      this._release(time, 0.45, cost);
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
      this._release(time, dur, cost);
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
      this._release(time, dur, cost);
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
      this._release(time, 0.1, cost);
      return;
    }
    this._release(time, 0.05, cost);
  }

  // -------------------------------------------------------------- bass

  // One sawtooth-plus-sub recipe for every loop was both the muddiest option
  // and the most monotonous. Each of these keeps the low end clear a
  // different way: less sub, a steeper filter, or no sawtooth at all.
  bass(midi, time, dur, vel = 0.7, glide = false, voice = 'sub') {
    const cost = VOICE_COST[voice] ?? 8;
    if (!this._budget(time, false, cost)) return;
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
      this.fm(midi, time, dur, vel * 0.85, {
        out, ratio: 1, index: 130, decay: 0.4, attack: 0.006, skipBudget: true,
      });
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
    this._release(time, dur + 0.8, cost);
  }

  // ------------------------------------------------------------- tuned

  // Two-operator FM. Ratio and index do all the work: 2:1 with a short
  // index envelope is an electric piano, 3.5:1 is a bell, 1:1 is a soft
  // reed. One tiny voice covering most of a mid-80s digital keyboard.
  fm(midi, time, dur, vel, opts = {}) {
    // rhodesbass calls this from inside bass(), which has already checked
    // and will release its own budget for the whole note; checking again
    // here would charge the same sound twice.
    const cost = opts.cost ?? DEFAULT_COST;
    if (!opts.skipBudget && !this._budget(time, !!opts.soft, cost)) return;
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

    const peak = Math.max(0.001, vel * 0.26);
    const stop = time + dur + 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + attack);
    // Decay across the note, then a defined release to silence.
    g.gain.exponentialRampToValueAtTime(Math.max(0.0008, peak * 0.3), time + Math.max(0.08, dur * 0.7));
    this._release2(g.gain, time + Math.max(0.08, dur * 0.7), stop);

    car.connect(g).connect(out);
    car.start(time);
    mod.start(time);
    this._stopClean(g, [car, mod], stop);
    if (!opts.skipBudget) this._release(time, dur + 1.2, cost);
  }

  pad(notes, time, dur, vel, dest) {
    const ctx = this.ctx;
    const out = dest || this.channels.chords.gain;
    // Two detuned triangles per note, so this is the same weight class as
    // the fat analogue voices, not the plain plucks.
    const cost = VOICE_COST.pad;
    for (const midi of notes) {
      if (!this._budget(time, true, cost)) return;
      const f = midiToFreq(midi);
      const g = ctx.createGain();
      const stopAt = time + dur + 1.6;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime((vel * 0.22) / Math.sqrt(notes.length), time + Math.min(0.9, dur * 0.4));
      this._release2(g.gain, time + dur * 0.8, stopAt);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, time);
      lp.frequency.linearRampToValueAtTime(1900, time + dur * 0.5);
      lp.Q.value = 0.8;
      const oscs = [];
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(time);
        oscs.push(o);
      }
      lp.connect(g).connect(out);
      this._stopClean(g, oscs, time + dur + 1.6);
      this._release(time, dur + 1.6, cost);
    }
  }

  pluck(midi, time, dur, vel, voice = 'pluck') {
    const out = this.channels.melody.gain;
    if (voice === 'bell') {
      this.fm(midi, time, dur * 0.9, vel, { out, ratio: 3.51, index: 420, decay: 0.5, cost: VOICE_COST.bell });
    } else if (voice === 'keys') {
      this.fm(midi, time, dur, vel, { out, ratio: 2, index: 260, decay: 0.4, cost: VOICE_COST.keys });
    } else if (voice === 'saw') {
      if (!this._budget(time, false, VOICE_COST.saw)) return;
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
      this._release(time, dur + 0.6, VOICE_COST.saw);
    } else {
      // Square-wave beep with a touch of vibrato. The Adventure Time voice.
      if (!this._budget(time, false, VOICE_COST.pluck)) return;
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
      this._release(time, dur + 0.5, VOICE_COST.pluck);
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
        // Two fm() calls, no outer gate; measured harp end-to-end is ~20x a
        // hat, split across the two layered strikes.
        this.fm(midi, time, dur * 0.8, vel, { out: dest, ratio: 3, index: 200, decay: 0.35, cost: 13 });
        this.fm(midi, time + 0.006, dur * 0.6, vel * 0.4, { out: dest, ratio: 3, index: 140, decay: 0.3, detune: 7, cost: 7 });
        return;

      // Ocarina and flute are the same idea at different mixes: a nearly pure
      // tone plus breath noise, with vibrato that arrives late the way a
      // player's does.
      case 'ocarina':
      case 'flute': {
        const breathy = name === 'flute';
        if (!this._budget(time, false, VOICE_COST[name])) return;
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
        // The shared noise buffer is two seconds long; a held note can be
        // longer than that, and the breath used to stop partway through it.
        const air = ctx.createBufferSource();
        air.buffer = this.noise;
        air.loop = true;
        air.playbackRate.value = 0.9 + Math.random() * 0.25;
        air.start(time);
        air.stop(time + dur + 0.5);
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
        this._release(time, dur + 0.4, VOICE_COST[name]);
        return;
      }

      // Piano, the BOTW voice. Two operators at a 1:1 ratio with a fast index
      // decay give the struck-string bite; a detuned second partial and a
      // long tail do the rest. Not a Steinway, but it reads as a piano.
      case 'piano': {
        // Measured piano end-to-end is ~26x a hat, split across the two
        // struck-string partials.
        this.fm(midi, time, dur, vel * 0.9, { out: dest, ratio: 1, index: 340, decay: 0.16, attack: 0.002, cost: 19 });
        this.fm(midi + 12, time, dur * 0.5, vel * 0.16, { out: dest, ratio: 1, index: 120, decay: 0.1, detune: 4, cost: 7 });
        return;
      }


      // Fat detuned analogue pad. Three sawtooths a few cents apart beat
      // against each other; that slow phasing is the whole sound, and it is
      // why one oscillator never sounds like this however it is filtered.
      case 'analogpad': {
        if (!this._budget(time, true, VOICE_COST.analogpad)) return;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 1.6;
        lp.frequency.setValueAtTime(Math.min(900, f * 3), time);
        lp.frequency.linearRampToValueAtTime(Math.min(2600, f * 6), time + Math.min(2, dur * 0.6));
        const g = ctx.createGain();
        const stopAt = time + dur + 1.6;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.17, time + Math.min(0.9, dur * 0.3));
        this._release2(g.gain, time + dur * 0.75, stopAt);
        const oscs = [];
        for (const cents of [-11, 0, 9]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          oscs.push(o);
        }
        lp.connect(g).connect(dest);
        this._stopClean(g, oscs, time + dur + 1.6);
        this._release(time, dur + 1.6, VOICE_COST.analogpad);
        return;
      }

      case 'analoglead': {
        // Two detuned saws through one resonant filter, no pad-scale energy
        // building up: closer in weight to the moog lead than to analogpad.
        if (!this._budget(time, false, VOICE_COST.moog)) return;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 5;
        lp.frequency.setValueAtTime(Math.min(5000, f * 8), time);
        lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2.4), time + Math.max(0.2, dur * 0.7));
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.16, time + 0.03);
        g.gain.setTargetAtTime(0.0001, time + dur * 0.7, 0.18);
        for (const cents of [-7, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          o.stop(time + dur + 0.8);
        }
        lp.connect(g).connect(dest);
        this._release(time, dur + 0.8, VOICE_COST.moog);
        return;
      }

      // Prepared piano: felt between the hammers and the strings. The tone
      // loses its upper partials and shortens, and you hear the mechanism --
      // a wooden knock alongside the note rather than underneath it.
      case 'prepared': {
        // Measured ~25x a hat, split across the strike, the knock, and the
        // detuned second strike.
        this.fm(midi, time, dur * 0.7, vel * 0.85, {
          out: dest, ratio: 1, index: 200, decay: 0.1, attack: 0.002, cost: 15,
        });
        if (!this._budget(time, false, 3)) return;
        const knock = this._noiseSource(time, 0.05);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 220 + Math.random() * 180;
        bp.Q.value = 3.5;
        const kg = ctx.createGain();
        kg.gain.setValueAtTime(vel * 0.13, time);
        kg.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        knock.connect(bp).connect(kg).connect(dest);
        // A touch of detuning: nothing prepared stays in tune.
        this.fm(midi, time + 0.004, dur * 0.45, vel * 0.2, {
          out: dest, ratio: 1, index: 90, decay: 0.08, detune: 9, cost: 7,
        });
        this._release(time, dur + 0.4, 3);
        return;
      }

      case 'celeste':
        this.fm(midi, time, dur, vel * 0.9, { out: dest, ratio: 4, index: 200, decay: 0.5, cost: VOICE_COST.celeste });
        return;

      // Short filtered chord stab. The repeating fragment that hypnotic
      // house is built from: too brief to be a chord, too pitched to be a
      // drum, and it survives being heard a thousand times.
      case 'stab': {
        if (!this._budget(time)) return;
        const len = Math.min(dur, 0.22);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(Math.min(3400, f * 3.2), time);
        bp.Q.value = 2.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.3, time + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, time + len);
        for (const cents of [-6, 7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(bp);
          o.start(time);
          o.stop(time + len + 0.1);
        }
        bp.connect(g).connect(dest);
        this._release(time, len + 0.2);
        return;
      }

      // Kalimba: a plucked metal tine. Bright inharmonic attack that dies
      // away almost at once, over a soft wooden thump from the box. The
      // shortness is the character -- a tine has almost no sustain.
      case 'kalimba': {
        this.fm(midi, time, Math.min(dur, 1.1), vel, {
          out: dest, ratio: 3.7, index: 260, decay: 0.09, attack: 0.002, cost: 8,
        });
        if (!this._budget(time, false, 3)) return;
        const body = ctx.createOscillator();
        body.type = 'sine';
        body.frequency.setValueAtTime(midiToFreq(midi - 12), time);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, time);
        bg.gain.exponentialRampToValueAtTime(vel * 0.12, time + 0.004);
        bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        body.connect(bg).connect(dest);
        body.start(time);
        body.stop(time + 0.2);
        this._release(time, 0.25, 3);
        return;
      }

      // Marimba: wood rather than metal. The bar's fourth partial is what
      // makes it read as wooden, and it decays slower and darker than a tine.
      case 'marimba': {
        this.fm(midi, time, Math.min(dur, 1.6), vel, {
          out: dest, ratio: 4, index: 190, decay: 0.16, attack: 0.003, cost: 9,
        });
        return;
      }

      // A synthetic human vowel.
      //
      // The first version ran a sawtooth through three parallel bandpass
      // filters. That is the obvious way to build formants and it is why it
      // sounded like a synth: bandpasses keep only the formant bands and
      // throw away everything between them, leaving a thin, hollow buzz. A
      // vocal tract does the opposite -- it resonates a full glottal
      // spectrum, lifting some regions and leaving the rest present. So the
      // filters are now *peaking* filters in series, and the whole harmonic
      // series survives.
      //
      // The other half of sounding human is instability. A perfectly steady
      // pitch is the single most synthetic thing a voice can do, so every
      // note gets jitter (small random pitch drift), a scoop into the note,
      // vibrato whose rate and depth differ per note, and a breath at the
      // onset.
      case 'vowel':
      case 'hum':
      case 'choir': {
        const humming = name === 'hum';
        const choral = name === 'choir';
        const cost = choral ? 34 : humming ? 16 : 22;
        if (!this._budget(time, choral, cost)) return;

        // [centre Hz, bandwidth Hz, boost dB]. Bandwidth matters as much as
        // centre: too wide and the vowel blurs into a filter sweep.
        const VOWELS = {
          a: [[800, 80, 16], [1150, 90, 13], [2900, 130, 9]],
          e: [[400, 60, 16], [1600, 80, 13], [2700, 130, 9]],
          o: [[450, 70, 17], [800, 80, 12], [2830, 120, 7]],
          u: [[325, 50, 17], [700, 60, 11], [2530, 170, 6]],
        };
        // The composer supplies the vowel. The fallback is fixed rather
        // than pitch-derived: deriving it from the note number changed the
        // vowel on every note and made every loop in a given register sing
        // the same sequence.
        const vowelKey = opts.vowel || 'a';
        // A closed mouth: one low nasal resonance, nothing up top.
        const formants = humming
          ? [[280, 60, 18], [1100, 100, 8], [2200, 160, 3]]
          : VOWELS[vowelKey] || VOWELS.a;

        const amp = ctx.createGain();
        const stopAt = time + dur + 0.9;
        amp.gain.setValueAtTime(0.0001, time);
        // Levels measured, not guessed. The humming tract puts an 18dB boost
        // at 280Hz, which lands directly on a triangle wave's fundamental
        // and made it four times louder than every other voice.
        amp.gain.linearRampToValueAtTime(vel * (choral ? 0.16 : humming ? 0.085 : 0.26),
          time + Math.min(0.3, dur * 0.25));
        this._release2(amp.gain, time + dur * 0.72, stopAt);
        amp.connect(dest);

        // Series peaking filters, then a lowpass standing in for the steeper
        // rolloff of a glottal pulse: a raw sawtooth is far too bright and
        // reads as buzz rather than voice.
        let head = null;
        let tail = null;
        for (const [hz, bw, gainDb] of formants) {
          const bq = ctx.createBiquadFilter();
          bq.type = 'peaking';
          bq.frequency.value = hz;
          bq.Q.value = hz / bw;
          bq.gain.value = gainDb;
          if (!head) head = bq; else tail.connect(bq);
          tail = bq;
        }
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 0.7;
        lp.frequency.value = humming ? 1700 : 3400;
        tail.connect(lp).connect(amp);

        // A choir is several of these sharing one tract: the filters are the
        // expensive part, so extra singers cost little. Each gets its own
        // detune and its own vibrato rate, which is what makes a group read
        // as a group rather than as one voice through a chorus pedal.
        const singers = choral ? 3 : 1;
        const sources = [];
        for (let i = 0; i < singers; i++) {
          const src = ctx.createOscillator();
          src.type = humming ? 'triangle' : 'sawtooth';
          src.frequency.value = f;

          const spread = choral ? (i - 1) * (7 + Math.random() * 6) : 0;
          // Scoop into the note. Singers arrive at a pitch, they do not
          // start on it.
          src.detune.setValueAtTime(spread - 22 - Math.random() * 14, time);
          src.detune.linearRampToValueAtTime(spread, time + 0.06 + Math.random() * 0.05);
          // Jitter: small random drift for the rest of the note, scheduled
          // straight onto the param so it costs no extra nodes.
          let t = time + 0.12;
          while (t < time + dur) {
            src.detune.linearRampToValueAtTime(spread + (Math.random() - 0.5) * 11, t);
            t += 0.09 + Math.random() * 0.08;
          }

          const vib = ctx.createOscillator();
          vib.frequency.value = 4.3 + Math.random() * 1.8;
          const vibAmt = ctx.createGain();
          vibAmt.gain.setValueAtTime(0, time);
          vibAmt.gain.linearRampToValueAtTime(
            (humming ? 5 : 9) + Math.random() * 4,
            time + Math.min(0.9, dur * 0.55) + Math.random() * 0.2
          );
          vib.connect(vibAmt).connect(src.detune);

          src.connect(head);
          src.start(time);
          vib.start(time);
          sources.push(src, vib);
        }

        // Aspiration. Strongest at the onset, then settling back -- this is
        // most of what separates a sung note from an organ note.
        const breath = ctx.createBufferSource();
        breath.buffer = this.noise;
        breath.loop = true;
        breath.playbackRate.value = 0.8 + Math.random() * 0.4;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = humming ? 900 : 2200;
        bp.Q.value = 0.8;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, time);
        bg.gain.linearRampToValueAtTime(vel * (humming ? 0.05 : 0.1), time + 0.04);
        bg.gain.exponentialRampToValueAtTime(Math.max(0.0005, vel * 0.02), time + 0.3);
        bg.gain.setTargetAtTime(0.0001, time + dur * 0.8, 0.15);
        breath.connect(bp).connect(bg).connect(amp);
        breath.start(time);
        breath.stop(stopAt);

        this._stopClean(amp, sources, stopAt);
        this._release(time, dur + 0.9, cost);
        return;
      }

      // A struck bowl or temple bell. The defining feature is not brightness
      // but *beating*: two partials a few cents apart drifting in and out of
      // phase, which is the slow shimmer you hear standing next to a real
      // bowl. A single FM voice cannot do that however inharmonic it is,
      // which is why the existing bell voices all sound like the same object.
      case 'templebell': {
        if (!this._budget(time, false, VOICE_COST.templebell)) return;
        const hold = Math.max(dur, 6.5);
        const stopAt = time + hold + 1.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.3, time + 0.006);
        this._release2(g.gain, time + 0.02, stopAt);
        g.connect(dest);

        // Struck metal is inharmonic: these ratios are roughly a bowl's.
        const partials = [[1, 1], [2.02, 0.5], [2.76, 0.32], [5.4, 0.14]];
        const oscs = [];
        for (const [ratio, amp] of partials) {
          // Each partial is a close pair, and the pair is what beats.
          for (const cents of [-4, 4]) {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = f * ratio;
            o.detune.value = cents + (Math.random() - 0.5) * 3;
            const pg = ctx.createGain();
            pg.gain.setValueAtTime(vel * amp * 0.5, time);
            // Higher partials die first, as they do on real metal.
            pg.gain.exponentialRampToValueAtTime(0.0001, time + hold / (0.55 + ratio * 0.3));
            o.connect(pg).connect(g);
            o.start(time);
            oscs.push(o);
          }
        }
        const strike = this._noiseSource(time, 0.03);
        const sf = ctx.createBiquadFilter();
        sf.type = 'bandpass';
        sf.frequency.value = f * 6;
        sf.Q.value = 1.2;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(vel * 0.18, time);
        sg.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
        strike.connect(sf).connect(sg).connect(g);

        this._stopClean(g, oscs, stopAt);
        this._release(time, hold + 1.4, VOICE_COST.templebell);
        return;
      }

      // Church or orchestral tubular bell. Brighter and more pitched than a
      // bowl, with the strong minor-third partial that gives chimes their
      // particular sourness, and a long even decay.
      case 'tubular': {
        if (!this._budget(time, false, VOICE_COST.tubular)) return;
        const hold = Math.max(dur, 5);
        const stopAt = time + hold + 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vel * 0.26, time + 0.004);
        this._release2(g.gain, time + 0.02, stopAt);
        g.connect(dest);

        const partials = [[1, 0.8], [1.19, 0.6], [1.56, 0.4], [2, 0.5], [2.71, 0.22]];
        const oscs = [];
        for (const [ratio, amp] of partials) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f * ratio;
          o.detune.value = (Math.random() - 0.5) * 6;
          const pg = ctx.createGain();
          pg.gain.setValueAtTime(vel * amp * 0.62, time);
          pg.gain.exponentialRampToValueAtTime(0.0001, time + hold / (0.5 + ratio * 0.28));
          o.connect(pg).connect(g);
          o.start(time);
          oscs.push(o);
        }
        this._stopClean(g, oscs, stopAt);
        this._release(time, hold + 1.2, VOICE_COST.tubular);
        return;
      }

      case 'musicbox':
        this.fm(midi, time, dur * 0.9, vel, { out: dest, ratio: 5.1, index: 420, decay: 0.45, cost: VOICE_COST.musicbox });
        return;

      // Fender Rhodes: the classic 2:1 bell-ish FM electric piano.
      case 'rhodes':
        this.fm(midi, time, dur, vel, { out: dest, ratio: 2, index: 190, decay: 0.5, attack: 0.004, cost: VOICE_COST.rhodes });
        return;

      // Garson's Moog: one oscillator, portamento, and a resonant filter
      // sweep. Monophonic by nature, which is why it is a lead and not a pad.
      case 'moog':
      case 'whistle': {
        const whistle = name === 'whistle';
        if (!this._budget(time, false, VOICE_COST[name])) return;
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
        this._release(time, dur + 0.5, VOICE_COST[name]);
        return;
      }

      // The old 'choir' lived here: three detuned saws through a lowpass,
      // with no formants at all. That is a string pad, which is exactly what
      // it sounded like. It is now handled with the vowel voices above,
      // where it gets a vocal tract and three independently wavering
      // singers. Renamed rather than deleted so the pad remains available
      // to the profiles that actually wanted a pad.
      case 'softpad': {
        if (!this._budget(time, true, VOICE_COST.pad)) return;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(700, time);
        lp.frequency.linearRampToValueAtTime(1500, time + dur * 0.5);
        const g = ctx.createGain();
        const stopAt = time + dur + 1.8;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.16, time + Math.min(1.4, dur * 0.45));
        this._release2(g.gain, time + dur * 0.7, stopAt);
        const oscs = [];
        for (const cents of [-9, 0, 11]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(time);
          oscs.push(o);
        }
        lp.connect(g).connect(dest);
        this._stopClean(g, oscs, stopAt);
        this._release(time, dur + 1.8, VOICE_COST.pad);
        return;
      }

      case 'sine': {
        if (!this._budget(time)) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        const stopAt = time + dur + 1;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vel * 0.24, time + Math.min(0.5, dur * 0.3));
        this._release2(g.gain, time + dur * 0.7, stopAt);
        o.connect(g).connect(dest);
        o.start(time);
        this._stopClean(g, [o], time + dur + 1);
        this._release(time, dur + 1);
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

  texture(kind, notes, time, dur, vel, opts = {}) {
    const ctx = this.ctx;
    const out = this.channels.texture.gain;
    const soft = true; // background: first to yield when the graph is full
    if (kind === 'swell') {
      for (const midi of notes) {
        if (!this._budget(time, soft)) return;
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
        this._release(time, dur + 0.2);
      }
    } else if (kind === 'bell') {
      this.fm(notes[0], time, dur, vel, { out, ratio: 5.1, index: 300, decay: 1.1, cost: VOICE_COST.bell });
    } else if (kind === 'chime') {
      this.fm(notes[0], time, dur, vel, { out, ratio: 2.76, index: 230, decay: 1.6, attack: 0.004, cost: VOICE_COST.chime });
    } else if (kind === 'drop') {
      if (!this._budget(time)) return;
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
      this._release(time, 0.15);
    } else if (kind === 'wind') {
      if (!this._budget(time)) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.6;
      src.start(time);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      // Band varies per segment, so successive gusts are not the same gust.
      bp.frequency.value = opts.band || 620;
      bp.Q.value = 1.1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.06;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 280;
      lfo.connect(lfoG).connect(bp.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      // Swell in and back out inside the segment rather than sitting flat.
      g.gain.linearRampToValueAtTime(vel * 0.32, time + Math.max(0.8, dur * 0.4));
      g.gain.setTargetAtTime(0.0001, time + dur * 0.75, Math.max(0.4, dur * 0.2));
      src.connect(bp).connect(g).connect(out);
      lfo.start(time);
      lfo.stop(time + dur + 1);
      src.stop(time + dur + 1);
      this._release(time, dur + 1);
    }
  }
}
