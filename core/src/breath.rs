//! The voices built on the noise and the bandpass: the stab, the ocarina
//! and the flute, the pan flute, the prepared piano's knock, the temple
//! bell, and the hat's graph (the noise source's first proof, and item 27's
//! drums). Each is its JavaScript twin in synth.js, call for call; the
//! `Math.random` draws are made in JavaScript and arrive with the note.
//!
//! Their parameters start their target curves where Chromium does
//! (`Param::reset_at`), and each keeps its voice a moment past its last
//! stop, as the leads do, for its filter to ring out.

use crate::QUANTUM;
use crate::filter::{Biquad, Kind};
use crate::noise::NoiseSource;
use crate::osc::{Part, Pitch, TableOsc, frame_at};
use crate::param::Param;
use crate::voice::{A440, Block, UNITY, midi_to_freq, pitch_of, release, starts_in};
use crate::wave::Waves;

/// How long a voice with a filter is kept past its last stop: the filter
/// rings on after its input stops.
const FILTER_TAIL: f64 = 0.2;
/// A BiquadFilterNode's Q, before anything sets it.
const Q_DEFAULT: f32 = 1.0;
/// Where a gain behind the noise holds before its note: its first event's
/// value (item 26b). A source can begin a frame ahead of that event, and
/// the frame it plays then goes through this, not through unity.
const QUIET: f32 = 0.0001;

/// A source's playback rate from its draw: `0.9 + Math.random() * 0.25`.
fn breath_rate(draw: f64) -> f64 {
    0.9 + draw * 0.25
}

/// `_noiseSource(time, dur)`: a grain of the noise at a drawn rate, from a
/// drawn place, `dur + 0.05` long; `rate_draw` and `offset_draw` are its two
/// draws, in that order.
#[allow(clippy::too_many_arguments)]
fn noise_grain(
    src: &mut NoiseSource,
    time: f64,
    dur: f64,
    rate_draw: f64,
    offset_draw: f64,
    len: usize,
    rate: f64,
) {
    let duration = len as f64 / rate;
    let offset = offset_draw * (duration - dur - 0.05);
    src.grain(
        time,
        offset.max(0.0),
        dur + 0.05,
        breath_rate(rate_draw),
        len,
        rate,
    );
}

/// `x` through `filter` and `gain`, added into `out`. The filter runs on
/// every frame of the block: it rings on past its source.
fn through(x: &Block, filter: &mut Biquad, gain: &Block, out: &mut Block) {
    for ((y, &v), &g) in out.iter_mut().zip(x.iter()).zip(gain.iter()) {
        *y += filter.step(v) * g;
    }
    filter.flush();
}

/// Stab: two detuned sawtooths through a bandpass, under a short
/// exponential envelope (`voice('stab')`).
pub struct Stab {
    saws: [TableOsc; 2],
    pitch: f32,
    filter: Biquad,
    gain: Param,
    end: u64,
}

const STAB_CENTS: [f32; 2] = [-6.0, 7.0];

impl Stab {
    pub const fn new() -> Self {
        Stab {
            saws: [TableOsc::new(), TableOsc::new()],
            pitch: 0.0,
            filter: Biquad::new(),
            gain: Param::new(0.0),
            end: 0,
        }
    }

    pub fn play(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        let f = midi_to_freq(midi);
        self.pitch = f as f32;
        let len = dur.min(0.22);
        self.filter.reset();
        self.filter.set(
            Kind::Bandpass,
            (f * 3.2).min(3400.0) as f32,
            2.2,
            0.0,
            rate as f32,
        );
        let g = &mut self.gain;
        g.reset_at(UNITY, rate);
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time((vel * 0.3) as f32, time + 0.006, time);
        g.exponential_ramp_to_value_at_time(0.0001, time + len, time);
        let stop = time + len + 0.1;
        for saw in self.saws.iter_mut() {
            saw.schedule(time, stop, rate);
        }
        self.end = frame_at(stop + FILTER_TAIL, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.saws[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let mut sum = [0.0f32; QUANTUM];
        let mut wave = [0.0f32; QUANTUM];
        for (saw, &detune) in self.saws.iter_mut().zip(STAB_CENTS.iter()) {
            let pitch = Pitch::Steady {
                freq: self.pitch,
                detune,
            };
            let (lo, hi) = saw.render(block, &waves.saw, &pitch, r, &mut wave);
            for (s, w) in sum.iter_mut().zip(wave.iter()).take(hi).skip(lo) {
                *s += *w;
            }
        }
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        through(&sum, &mut self.filter, &gain, out);
    }
}

impl Default for Stab {
    fn default() -> Self {
        Self::new()
    }
}

/// The ocarina's and the flute's levels (tone and breath scale together).
const OCARINA_LEVEL: f64 = 0.1115;
const FLUTE_LEVEL: f64 = 0.1357;
/// Their vibrato's rate, in Hz.
const WIND_VIBRATO: f32 = 5.2;

/// Ocarina and flute: a nearly pure tone (a sine, or the flute's triangle)
/// that may slide into the note, a vibrato on the detune that arrives late,
/// and a looped breath through a bandpass (`voice('ocarina' | 'flute')`).
pub struct Wind {
    flute: bool,
    osc: TableOsc,
    pitch: Param,
    lfo: TableOsc,
    depth: Param,
    gain: Param,
    air: NoiseSource,
    filter: Biquad,
    air_gain: Param,
    end: u64,
}

impl Wind {
    pub const fn new() -> Self {
        Wind {
            flute: false,
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            lfo: TableOsc::new(),
            depth: Param::new(0.0),
            gain: Param::new(0.0),
            air: NoiseSource::new(),
            filter: Biquad::new(),
            air_gain: Param::new(0.0),
            end: 0,
        }
    }

    /// `slide` is where the pitch comes from in Hz and how long it takes to
    /// arrive, if the note slides (`_slideOf`); `breath` is the breath's
    /// rate draw.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        flute: bool,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        slide: Option<(f64, f64)>,
        breath: f64,
        noise: usize,
        rate: f64,
    ) {
        self.flute = flute;
        let f = midi_to_freq(midi);
        let level = if flute { FLUTE_LEVEL } else { OCARINA_LEVEL };
        let p = &mut self.pitch;
        match slide {
            Some((from, reach)) => {
                p.reset_at(A440, rate);
                p.set_value_at_time(from as f32, time);
                p.exponential_ramp_to_value_at_time(f as f32, time + reach, time);
            }
            None => p.reset_at(f as f32, rate),
        }
        let d = &mut self.depth;
        d.reset_at(UNITY, rate);
        d.set_value_at_time(0.0, time);
        d.linear_ramp_to_value_at_time(if flute { 9.0 } else { 6.0 }, time + dur.min(0.5), time);
        let let_go = time + dur * 0.8;
        let g = &mut self.gain;
        g.reset_at(UNITY, rate);
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time((vel * level) as f32, (time + 0.05).min(let_go), time);
        g.set_target_at_time(0.0001, let_go, 0.09);
        let air_stop = time + dur + 0.5;
        self.air
            .looped(time, air_stop, breath_rate(breath), noise, rate);
        self.filter.reset();
        self.filter
            .set(Kind::Bandpass, (f * 2.0) as f32, 1.2, 0.0, rate as f32);
        let a = &mut self.air_gain;
        a.reset_at(QUIET, rate);
        a.set_value_at_time(0.0001, time);
        let share = if flute { 1.0 / 3.0 } else { 0.15 };
        a.linear_ramp_to_value_at_time(
            (vel * level * share) as f32,
            (time + 0.06).min(let_go),
            time,
        );
        a.set_target_at_time(0.0001, let_go, 0.09);
        let stop = time + dur + 0.4;
        self.osc.schedule(time, stop, rate);
        self.lfo.schedule(time, stop, rate);
        self.end = frame_at(air_stop + FILTER_TAIL, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.osc.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, noise: &[f32], out: &mut Block) {
        let r = rate as f32;
        let steady = Pitch::Steady {
            freq: WIND_VIBRATO,
            detune: 0.0,
        };
        let mut sine = [0.0f32; QUANTUM];
        let (lo, hi) = self.lfo.render(block, &waves.sine, &steady, r, &mut sine);
        // Feeding only the detune, the depth is first rendered when the
        // note starts.
        if starts_in(self.lfo.start_frame(), block) {
            self.depth.clamp_before(block as f64 / rate);
        }
        let mut depth = [0.0f32; QUANTUM];
        self.depth.fill(block, rate, &mut depth);
        let mut cents = [0.0f32; QUANTUM];
        for ((c, w), d) in cents
            .iter_mut()
            .zip(sine.iter())
            .zip(depth.iter())
            .take(hi)
            .skip(lo)
        {
            *c = *w * *d;
        }
        let mut freq = [0.0f32; QUANTUM];
        let first = starts_in(self.osc.start_frame(), block);
        let pitch = pitch_of(
            &mut self.pitch,
            block,
            rate,
            first,
            &mut freq,
            Part::Moving(&cents),
        );
        let wave = if self.flute {
            &waves.triangle
        } else {
            &waves.sine
        };
        let mut tone = [0.0f32; QUANTUM];
        let (lo, hi) = self.osc.render(block, wave, &pitch, r, &mut tone);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        for ((y, x), g) in out
            .iter_mut()
            .zip(tone.iter())
            .zip(gain.iter())
            .take(hi)
            .skip(lo)
        {
            *y += *x * *g;
        }
        let mut air = [0.0f32; QUANTUM];
        self.air.render(block, noise, &mut air);
        let mut air_gain = [0.0f32; QUANTUM];
        self.air_gain.fill(block, rate, &mut air_gain);
        through(&air, &mut self.filter, &air_gain, out);
    }
}

impl Default for Wind {
    fn default() -> Self {
        Self::new()
    }
}

/// `PANFLUTE_LEVEL`, the breath and the chiff as shares of it, and the dip
/// in cents the pipe speaks from.
const PANFLUTE_LEVEL: f64 = 0.1011;
const PANFLUTE_BREATH: f64 = 0.5;
const PANFLUTE_CHIFF: f64 = 0.8;
const PANFLUTE_DIP: f64 = 30.0;
/// Notes this long and longer get a vibrato (`VIBRATO_MIN_DUR`).
pub const VIBRATO_MIN_DUR: f64 = 0.5;

/// Pan flute: the `pipe` wave, a little flat and rising onto the note, a
/// vibrato on long notes, and a looped breath through a bandpass that spikes
/// as the pipe catches -- the chiff -- and settles (`voice('panflute')`).
pub struct Panflute {
    osc: TableOsc,
    pitch: Param,
    vibrato: bool,
    lfo: TableOsc,
    lfo_rate: f32,
    depth: Param,
    gain: Param,
    air: NoiseSource,
    filter: Biquad,
    air_gain: Param,
    end: u64,
}

impl Panflute {
    pub const fn new() -> Self {
        Panflute {
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            vibrato: false,
            lfo: TableOsc::new(),
            lfo_rate: 0.0,
            depth: Param::new(0.0),
            gain: Param::new(0.0),
            air: NoiseSource::new(),
            filter: Biquad::new(),
            air_gain: Param::new(0.0),
            end: 0,
        }
    }

    /// `vibrato` is the vibrato's rate draw, for a note long enough to have
    /// one; `breath`, the breath's rate draw.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        vibrato: Option<f64>,
        breath: f64,
        noise: usize,
        rate: f64,
    ) {
        let f = midi_to_freq(midi);
        let level = vel * PANFLUTE_LEVEL;
        let p = &mut self.pitch;
        p.reset_at(A440, rate);
        p.set_value_at_time((f * 2f64.powf(-PANFLUTE_DIP / 1200.0)) as f32, time);
        p.exponential_ramp_to_value_at_time(f as f32, time + 0.05, time);
        let stop = time + dur + 0.4;
        self.vibrato = vibrato.is_some();
        if let Some(draw) = vibrato {
            self.lfo_rate = (4.8 + draw * 0.8) as f32;
            let onset = (dur * 0.3).min(0.3);
            let d = &mut self.depth;
            d.reset_at(UNITY, rate);
            d.set_value_at_time(0.0, time);
            d.set_value_at_time(0.0, time + onset);
            d.linear_ramp_to_value_at_time(8.0, time + onset + 0.3, time);
            self.lfo.schedule(time, stop, rate);
        }
        let let_go = time + dur * 0.85;
        let g = &mut self.gain;
        g.reset_at(UNITY, rate);
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time(level as f32, (time + 0.03).min(let_go), time);
        g.set_target_at_time(0.0001, let_go, 0.08);
        self.air
            .looped(time, stop, breath_rate(breath), noise, rate);
        self.filter.reset();
        self.filter
            .set(Kind::Bandpass, (f * 1.5) as f32, 0.9, 0.0, rate as f32);
        let a = &mut self.air_gain;
        a.reset_at(QUIET, rate);
        a.set_value_at_time(0.0001, time);
        a.exponential_ramp_to_value_at_time(
            (level * PANFLUTE_CHIFF) as f32,
            (time + 0.004).min(let_go),
            time,
        );
        a.exponential_ramp_to_value_at_time(
            (level * PANFLUTE_BREATH) as f32,
            (time + 0.03).min(let_go),
            time,
        );
        a.set_target_at_time(0.0001, let_go, 0.08);
        self.osc.schedule(time, stop, rate);
        self.end = frame_at(stop + FILTER_TAIL, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.osc.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, noise: &[f32], out: &mut Block) {
        let r = rate as f32;
        let mut cents = [0.0f32; QUANTUM];
        if self.vibrato {
            let steady = Pitch::Steady {
                freq: self.lfo_rate,
                detune: 0.0,
            };
            let mut sine = [0.0f32; QUANTUM];
            let (lo, hi) = self.lfo.render(block, &waves.sine, &steady, r, &mut sine);
            if starts_in(self.lfo.start_frame(), block) {
                self.depth.clamp_before(block as f64 / rate);
            }
            let mut depth = [0.0f32; QUANTUM];
            self.depth.fill(block, rate, &mut depth);
            for ((c, w), d) in cents
                .iter_mut()
                .zip(sine.iter())
                .zip(depth.iter())
                .take(hi)
                .skip(lo)
            {
                *c = *w * *d;
            }
        }
        let detune = if self.vibrato {
            Part::Moving(&cents)
        } else {
            Part::Steady(0.0)
        };
        let mut freq = [0.0f32; QUANTUM];
        let first = starts_in(self.osc.start_frame(), block);
        let pitch = pitch_of(&mut self.pitch, block, rate, first, &mut freq, detune);
        let mut tone = [0.0f32; QUANTUM];
        let (lo, hi) = self.osc.render(block, &waves.pipe, &pitch, r, &mut tone);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        for ((y, x), g) in out
            .iter_mut()
            .zip(tone.iter())
            .zip(gain.iter())
            .take(hi)
            .skip(lo)
        {
            *y += *x * *g;
        }
        let mut air = [0.0f32; QUANTUM];
        self.air.render(block, noise, &mut air);
        let mut air_gain = [0.0f32; QUANTUM];
        self.air_gain.fill(block, rate, &mut air_gain);
        through(&air, &mut self.filter, &air_gain, out);
    }
}

impl Default for Panflute {
    fn default() -> Self {
        Self::new()
    }
}

/// A grain of noise through a filter under a gain: the prepared piano's
/// knock and the hat's graph.
pub struct Struck {
    src: NoiseSource,
    filter: Biquad,
    gain: Param,
    end: u64,
}

/// The hat's kinds, by `parts`: hat, open hat, shaker.
pub const HAT: u32 = 0;
pub const OPEN_HAT: u32 = 1;
pub const SHAKER: u32 = 2;

impl Struck {
    pub const fn new() -> Self {
        Struck {
            src: NoiseSource::new(),
            filter: Biquad::new(),
            gain: Param::new(0.0),
            end: 0,
        }
    }

    /// The prepared piano's knock: `_noiseSource(time, 0.05)` (`rate_draw`,
    /// `offset_draw`) through a bandpass at a drawn frequency
    /// (`freq_draw`), struck at `vel * 0.13` and gone in 50 ms.
    #[allow(clippy::too_many_arguments)]
    pub fn knock(
        &mut self,
        time: f64,
        vel: f64,
        rate_draw: f64,
        offset_draw: f64,
        freq_draw: f64,
        noise: usize,
        rate: f64,
    ) {
        noise_grain(
            &mut self.src,
            time,
            0.05,
            rate_draw,
            offset_draw,
            noise,
            rate,
        );
        self.filter.reset();
        self.filter.set(
            Kind::Bandpass,
            (220.0 + freq_draw * 180.0) as f32,
            3.5,
            0.0,
            rate as f32,
        );
        let g = &mut self.gain;
        g.reset_at((vel * 0.13) as f32, rate);
        g.set_value_at_time((vel * 0.13) as f32, time);
        g.exponential_ramp_to_value_at_time(0.0001, time + 0.05, time);
        self.end = self.src.end_frame() + frame_at(FILTER_TAIL, rate);
    }

    /// The hat (`drum('hat' | 'ohat' | 'shaker')`): a grain of noise
    /// through a highpass, a fast strike and an exponential fall.
    #[allow(clippy::too_many_arguments)]
    pub fn hat(
        &mut self,
        kind: u32,
        time: f64,
        vel: f64,
        rate_draw: f64,
        offset_draw: f64,
        noise: usize,
        rate: f64,
    ) {
        let v = vel.clamp(0.0, 1.0);
        let dur = match kind {
            OPEN_HAT => 0.26,
            SHAKER => 0.07,
            _ => 0.045,
        };
        noise_grain(
            &mut self.src,
            time,
            dur,
            rate_draw,
            offset_draw,
            noise,
            rate,
        );
        self.filter.reset();
        let cutoff = if kind == SHAKER { 5200.0 } else { 7400.0 };
        self.filter
            .set(Kind::Highpass, cutoff, Q_DEFAULT, 0.0, rate as f32);
        let g = &mut self.gain;
        g.reset_at(QUIET, rate);
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time(
            (v * if kind == SHAKER { 0.3 } else { 0.42 }) as f32,
            time + 0.003,
            time,
        );
        g.exponential_ramp_to_value_at_time(0.0001, time + dur, time);
        self.end = self.src.end_frame() + frame_at(FILTER_TAIL, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.src.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, noise: &[f32], out: &mut Block) {
        let mut x = [0.0f32; QUANTUM];
        self.src.render(block, noise, &mut x);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        through(&x, &mut self.filter, &gain, out);
    }
}

impl Default for Struck {
    fn default() -> Self {
        Self::new()
    }
}

/// `BELL_PARTIAL_VEL`, and the temple bell's lift as a chord voice.
const BELL_PARTIAL_VEL: f64 = 0.8;
fn chord_lift() -> f64 {
    10f64.powf(1.9 / 20.0)
}
/// A bowl's partials: ratio to the note and relative level. Each is a pair
/// of sines 4 cents either side, which is what beats.
const TEMPLE_PARTIALS: [(f64, f64); 4] = [(1.0, 1.0), (2.02, 0.5), (2.76, 0.32), (5.4, 0.14)];
const TEMPLE_PAIR: [f64; 2] = [-4.0, 4.0];
pub const TEMPLE_SINES: usize = 8;

/// Temple bell: four pairs of sines a few cents apart, each dying at its own
/// rate, and a bandpassed strike of noise, under one envelope that lets go
/// after at least six and a half seconds (`voice('templebell')`).
pub struct TempleBell {
    oscs: [TableOsc; TEMPLE_SINES],
    pitch: [f32; TEMPLE_SINES],
    detune: [f32; TEMPLE_SINES],
    gains: [Param; TEMPLE_SINES],
    envelope: Param,
    strike: NoiseSource,
    filter: Biquad,
    strike_gain: Param,
    end: u64,
}

impl TempleBell {
    pub const fn new() -> Self {
        TempleBell {
            oscs: [const { TableOsc::new() }; TEMPLE_SINES],
            pitch: [0.0; TEMPLE_SINES],
            detune: [0.0; TEMPLE_SINES],
            gains: [const { Param::new(0.0) }; TEMPLE_SINES],
            envelope: Param::new(0.0),
            strike: NoiseSource::new(),
            filter: Biquad::new(),
            strike_gain: Param::new(0.0),
            end: 0,
        }
    }

    /// `draws` are the eight detune draws, partial by partial, the lower of
    /// each pair first; then the strike's rate and offset draws. `chords`
    /// is whether it plays into the chords channel.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        chords: bool,
        draws: &[f64; TEMPLE_SINES],
        strike: (f64, f64),
        noise: usize,
        rate: f64,
    ) {
        let f = midi_to_freq(midi);
        let hold = dur.max(6.5);
        let stop = time + hold + 1.4;
        let g = &mut self.envelope;
        g.reset_at(QUIET, rate);
        g.set_value_at_time(0.0001, time);
        let lift = if chords { chord_lift() } else { 1.0 };
        g.exponential_ramp_to_value_at_time((vel * 0.3 * lift) as f32, time + 0.006, time);
        release(g, time + 0.02, stop, time);
        let mut n = 0;
        for &(ratio, amp) in TEMPLE_PARTIALS.iter() {
            for &cents in TEMPLE_PAIR.iter() {
                if let (Some(p), Some(d), Some(pg), Some(osc), Some(&draw)) = (
                    self.pitch.get_mut(n),
                    self.detune.get_mut(n),
                    self.gains.get_mut(n),
                    self.oscs.get_mut(n),
                    draws.get(n),
                ) {
                    *p = (f * ratio) as f32;
                    *d = (cents + (draw - 0.5) * 3.0) as f32;
                    pg.reset_at(UNITY, rate);
                    pg.set_value_at_time((BELL_PARTIAL_VEL * amp * 0.5) as f32, time);
                    pg.exponential_ramp_to_value_at_time(
                        0.0001,
                        time + hold / (0.55 + ratio * 0.3),
                        time,
                    );
                    osc.schedule(time, stop + 0.01, rate);
                }
                n += 1;
            }
        }
        noise_grain(
            &mut self.strike,
            time,
            0.03,
            strike.0,
            strike.1,
            noise,
            rate,
        );
        self.filter.reset();
        self.filter
            .set(Kind::Bandpass, (f * 6.0) as f32, 1.2, 0.0, rate as f32);
        let s = &mut self.strike_gain;
        s.reset_at((BELL_PARTIAL_VEL * 0.18) as f32, rate);
        s.set_value_at_time((BELL_PARTIAL_VEL * 0.18) as f32, time);
        s.exponential_ramp_to_value_at_time(0.0001, time + 0.04, time);
        self.end = frame_at(stop + 0.01, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.oscs[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, noise: &[f32], out: &mut Block) {
        let r = rate as f32;
        let mut sum = [0.0f32; QUANTUM];
        let mut wave = [0.0f32; QUANTUM];
        let mut gain = [0.0f32; QUANTUM];
        for ((osc, pg), (&freq, &detune)) in self
            .oscs
            .iter_mut()
            .zip(self.gains.iter())
            .zip(self.pitch.iter().zip(self.detune.iter()))
        {
            let pitch = Pitch::Steady { freq, detune };
            let (lo, hi) = osc.render(block, &waves.sine, &pitch, r, &mut wave);
            pg.fill(block, rate, &mut gain);
            for ((s, w), g) in sum
                .iter_mut()
                .zip(wave.iter())
                .zip(gain.iter())
                .take(hi)
                .skip(lo)
            {
                *s += *w * *g;
            }
        }
        let mut x = [0.0f32; QUANTUM];
        self.strike.render(block, noise, &mut x);
        self.strike_gain.fill(block, rate, &mut gain);
        through(&x, &mut self.filter, &gain, &mut sum);
        let mut envelope = [0.0f32; QUANTUM];
        self.envelope.fill(block, rate, &mut envelope);
        for ((y, x), g) in out.iter_mut().zip(sum.iter()).zip(envelope.iter()) {
            *y += *x * *g;
        }
    }
}

impl Default for TempleBell {
    fn default() -> Self {
        Self::new()
    }
}
