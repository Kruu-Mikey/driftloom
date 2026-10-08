//! The bass voices (queue item 27): `sub`, `round`, `fifths`, `pluckbass`
//! and `moogbass`, each its JavaScript twin in `Synth.bass`, call for call.
//! (`rhodesbass` is an `fm()` call, and the FM voice plays it.)
//!
//! They are one shape with different parts: an oscillator (a sawtooth or a
//! triangle) through a resonant lowpass whose cutoff falls, under an
//! envelope; for `sub` a sine of weight underneath it; for the plucked one
//! a click of bandpassed noise instead; and for `fifths` no filter at all,
//! just two sines. The only draws are the click's two, made in JavaScript
//! and sent with the note.

use crate::QUANTUM;
use crate::breath::noise_grain;
use crate::filter::{Biquad, Kind};
use crate::noise::NoiseSource;
use crate::osc::{Part, TableOsc, frame_at};
use crate::param::Param;
use crate::voice::{A440, Block, UNITY, midi_to_freq, pitch_of, starts_in};
use crate::wave::Waves;

/// What a bass note's `parts` say: the voice in the low three bits, and
/// whether it glides in and whether it is a chug in two flags.
pub const SUB: u32 = 0;
pub const ROUND: u32 = 1;
pub const FIFTHS: u32 = 2;
pub const PLUCKBASS: u32 = 3;
pub const MOOGBASS: u32 = 4;
pub const KIND: u32 = 7;
pub const GLIDE: u32 = 8;
pub const CHUG: u32 = 16;

/// A filter's cutoff, before anything is set.
const CUTOFF_DEFAULT: f32 = 350.0;
/// A BiquadFilterNode's Q, before anything sets it (the click's).
const Q_DEFAULT: f32 = 1.0;
/// How long a filtered voice is kept past its oscillator's stop, for the
/// resonance to ring out.
const FILTER_TAIL: f64 = 0.2;
/// The trims, each voice's measured level (`TRIM` in `bass()`).
fn trim(kind: u32) -> f64 {
    match kind {
        SUB | FIFTHS => 0.55,
        ROUND => 0.75,
        PLUCKBASS => 0.72,
        _ => 1.0,
    }
}

/// A sine, its frequency set once, under its own gain.
struct Sine {
    osc: TableOsc,
    pitch: Param,
    gain: Param,
}

impl Sine {
    const fn new() -> Self {
        Sine {
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            gain: Param::new(0.0),
        }
    }

    fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let mut freq = [0.0f32; QUANTUM];
        let first = starts_in(self.osc.start_frame(), block);
        let pitch = pitch_of(
            &mut self.pitch,
            block,
            rate,
            first,
            &mut freq,
            Part::Steady(0.0),
        );
        let mut tone = [0.0f32; QUANTUM];
        let (lo, hi) = self
            .osc
            .render(block, &waves.sine, &pitch, rate as f32, &mut tone);
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
    }
}

pub struct Bass {
    /// The voice, as `parts` names it.
    kind: u32,
    /// The main oscillator, filter and envelope: every voice but `fifths`.
    main: bool,
    triangle: bool,
    osc: TableOsc,
    pitch: Param,
    cutoff: Param,
    q: f32,
    filter: Biquad,
    gain: Param,
    /// The sine underneath (`sub`, `pluckbass`), or both of `fifths`'.
    sines: [Sine; 2],
    sine_count: usize,
    /// The pluck's click.
    click: bool,
    src: NoiseSource,
    click_filter: Biquad,
    click_gain: Param,
    start: u64,
    end: u64,
}

impl Bass {
    pub const fn new() -> Self {
        Bass {
            kind: SUB,
            main: false,
            triangle: false,
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            cutoff: Param::new(0.0),
            q: 0.0,
            filter: Biquad::new(),
            gain: Param::new(0.0),
            sines: [const { Sine::new() }; 2],
            sine_count: 0,
            click: false,
            src: NoiseSource::new(),
            click_filter: Biquad::new(),
            click_gain: Param::new(0.0),
            start: 0,
            end: 0,
        }
    }

    /// `draws` are the click's `_noiseSource` rate and offset (pluckbass
    /// only); `noise` is the length of the host's noise.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        parts: u32,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        draws: (f64, f64),
        noise: usize,
        rate: f64,
    ) {
        let kind = parts & KIND;
        let glide = parts & GLIDE != 0;
        let chug = parts & CHUG != 0;
        self.kind = kind;
        let f = midi_to_freq(midi);
        let vel = vel * trim(kind);
        let stop = time + dur + 0.4;
        // A chug note lets go in under half the time.
        let let_go = |release: f64| if chug { release * 0.45 } else { release };

        self.main = kind != FIFTHS;
        self.click = kind == PLUCKBASS;
        self.sine_count = 0;
        let mut ends = 0;
        let mut starts = u64::MAX;

        if self.main {
            self.triangle = kind == ROUND || kind == PLUCKBASS;
            // The pitch, gliding in from two thirds if asked.
            let p = &mut self.pitch;
            p.reset(A440);
            if glide {
                p.set_value_at_time((f * 0.66) as f32, time);
                p.exponential_ramp_to_value_at_time(f as f32, time + 0.08, time);
            } else {
                p.set_value_at_time(f as f32, time);
            }
            // The filter, and the envelope's peak, sustain and release.
            let c = &mut self.cutoff;
            c.reset(CUTOFF_DEFAULT);
            let (peak, sustain, release) = match kind {
                PLUCKBASS => {
                    self.q = 2.0;
                    c.set_value_at_time((f * 9.0).min(2600.0) as f32, time);
                    c.exponential_ramp_to_value_at_time(
                        (f * 2.0).max(130.0) as f32,
                        time + 0.22,
                        time,
                    );
                    (vel * 0.42, None, let_go(0.1))
                }
                ROUND => {
                    self.q = 0.9;
                    c.set_value_at_time((f * 6.0).min(2200.0) as f32, time);
                    c.exponential_ramp_to_value_at_time(
                        (f * 2.4).max(140.0) as f32,
                        time + dur.min(0.5),
                        time,
                    );
                    (vel * 0.34, Some(vel * 0.22), let_go(0.08))
                }
                MOOGBASS => {
                    self.q = 9.0;
                    c.set_value_at_time((f * 11.0).min(3600.0) as f32, time);
                    c.exponential_ramp_to_value_at_time(
                        (f * 2.2).max(150.0) as f32,
                        time + dur.min(0.35),
                        time,
                    );
                    (vel * 0.26, Some(vel * 0.15), let_go(0.07))
                }
                _ => {
                    self.q = 3.0;
                    c.set_value_at_time((f * 10.0).min(4200.0) as f32, time);
                    c.exponential_ramp_to_value_at_time(
                        (f * 2.2).max(120.0) as f32,
                        time + dur.min(0.4),
                        time,
                    );
                    (vel * 0.17, Some(vel * 0.11), let_go(0.06))
                }
            };
            // `env()`: strike, settle to the sustain, let go at the end. The
            // pluck has its own: a faster strike, and it lets go early.
            let g = &mut self.gain;
            g.reset_at(UNITY, rate);
            g.set_value_at_time(0.0001, time);
            if kind == PLUCKBASS {
                g.exponential_ramp_to_value_at_time(peak as f32, time + 0.006, time);
                g.set_target_at_time(0.0001, time + dur.min(0.3), release);
            } else {
                g.exponential_ramp_to_value_at_time(peak.max(0.001) as f32, time + 0.014, time);
                if let Some(level) = sustain {
                    g.set_target_at_time(level as f32, time + 0.05, 0.25);
                }
                g.set_target_at_time(0.0001, time + dur, release);
            }
            self.filter.reset();
            self.osc.schedule(time, stop, rate);
            starts = starts.min(self.osc.start_frame());
            ends = ends.max(self.osc.stop_frame() + frame_at(FILTER_TAIL, rate));

            // The sine under it: the weight of the note.
            if kind == SUB {
                let s = &mut self.sines[0];
                s.pitch.reset(A440);
                s.pitch.set_value_at_time(f as f32, time);
                let g = &mut s.gain;
                g.reset_at(UNITY, rate);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time((vel * 0.13) as f32, time + 0.015, time);
                g.set_target_at_time(0.0001, time + dur, let_go(0.08));
                s.osc.schedule(time, stop, rate);
                self.sine_count = 1;
                ends = ends.max(s.osc.stop_frame());
            }
        } else {
            // Root and fifth, sines only.
            for (s, (mult, level)) in self.sines.iter_mut().zip([(1.0, 0.3), (1.5, 0.14)]) {
                s.pitch.reset(A440);
                s.pitch.set_value_at_time((f * mult) as f32, time);
                let g = &mut s.gain;
                g.reset_at(UNITY, rate);
                g.set_value_at_time(0.0001, time);
                g.linear_ramp_to_value_at_time((vel * level) as f32, time + (dur * 0.3).min(0.4), time);
                g.set_target_at_time(0.0001, time + dur * 0.8, 0.2);
                s.osc.schedule(time, stop + 0.4, rate);
                starts = starts.min(s.osc.start_frame());
                ends = ends.max(s.osc.stop_frame());
            }
            self.sine_count = 2;
        }

        if self.click {
            // A little noise for the finger: a grain through a bandpass.
            noise_grain(&mut self.src, time, 0.02, draws.0, draws.1, noise, rate);
            self.click_filter.reset();
            self.click_filter
                .set(Kind::Bandpass, 900.0, Q_DEFAULT, 0.0, rate as f32);
            // Its gain is already at its first value when the noise begins:
            // a source can start a frame ahead of the event (item 26b).
            let g = &mut self.click_gain;
            g.reset_at((vel * 0.1) as f32, rate);
            g.set_value_at_time((vel * 0.1) as f32, time);
            g.exponential_ramp_to_value_at_time(0.0001, time + 0.025, time);
            starts = starts.min(self.src.start_frame());
            ends = ends.max(self.src.end_frame() + frame_at(FILTER_TAIL, rate));
        }
        self.start = starts;
        self.end = ends;
    }

    pub fn start_frame(&self) -> u64 {
        self.start
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, noise: &[f32], out: &mut Block) {
        let r = rate as f32;
        if self.main {
            let mut freq = [0.0f32; QUANTUM];
            let first = starts_in(self.osc.start_frame(), block);
            let pitch = pitch_of(
                &mut self.pitch,
                block,
                rate,
                first,
                &mut freq,
                Part::Steady(0.0),
            );
            let wave = if self.triangle {
                &waves.triangle
            } else {
                &waves.saw
            };
            let mut tone = [0.0f32; QUANTUM];
            self.osc.render(block, wave, &pitch, r, &mut tone);
            let mut cutoff = [0.0f32; QUANTUM];
            self.cutoff.fill(block, rate, &mut cutoff);
            let mut gain = [0.0f32; QUANTUM];
            self.gain.fill(block, rate, &mut gain);
            // The filter runs every frame of the block, as a node does.
            for (((y, x), c), g) in out
                .iter_mut()
                .zip(tone.iter())
                .zip(cutoff.iter())
                .zip(gain.iter())
            {
                self.filter.set(Kind::Lowpass, *c, self.q, 0.0, r);
                *y += self.filter.step(*x) * *g;
            }
            self.filter.flush();
        }
        for s in self.sines.iter_mut().take(self.sine_count) {
            s.render(block, rate, waves, out);
        }
        if self.click {
            let mut x = [0.0f32; QUANTUM];
            self.src.render(block, noise, &mut x);
            let mut gain = [0.0f32; QUANTUM];
            self.click_gain.fill(block, rate, &mut gain);
            for ((y, v), g) in out.iter_mut().zip(x.iter()).zip(gain.iter()) {
                *y += self.click_filter.step(*v) * *g;
            }
            self.click_filter.flush();
        }
    }
}

impl Default for Bass {
    fn default() -> Self {
        Self::new()
    }
}
