//! The drums (queue item 27): `kick` and `softkick`, `snare` and `clap`,
//! `rim`, and the hand kit's `frame`, `tap` and `jingle`/`ojingle`, each its
//! JavaScript twin in `Synth.drum`, call for call. (The hats are
//! `breath::Struck`, ported with the noise source.) The budget is asked in
//! JavaScript, and so are the draws: the noise's rate and offset for every
//! voice that has noise, and the jingle's five zils before them.
//!
//! A drum is a few parts played together: a sine or triangle with its pitch
//! and gain, usually a grain of noise through a filter and gain of its own,
//! and for the frame and the jingle a second layer. Only the rim puts its
//! filter after the oscillator.

use crate::QUANTUM;
use crate::breath::noise_grain;
use crate::filter::{Biquad, Kind};
use crate::noise::NoiseSource;
use crate::osc::{Part, Pitch, TableOsc, frame_at};
use crate::param::Param;
use crate::voice::{A440, Block, UNITY, pitch_of, starts_in};
use crate::wave::{Wave, Waves};

/// What a drum note's `parts` say.
pub const KICK: u32 = 0;
pub const SOFTKICK: u32 = 1;
pub const SNARE: u32 = 2;
pub const CLAP: u32 = 3;
pub const RIM: u32 = 4;
pub const FRAME: u32 = 5;
pub const TAP: u32 = 6;
pub const JINGLE: u32 = 7;
pub const OPEN_JINGLE: u32 = 8;

/// Whether a drum plays the noise, so the host must have it: all but the
/// softkick and the rim.
pub fn uses_noise(kind: u32) -> bool {
    kind != SOFTKICK && kind != RIM
}

/// The softkick's level, and the hand kit's (`SOFTKICK_LEVEL`,
/// `HAND_LEVEL`).
const SOFTKICK_LEVEL: f64 = 1.15;
const FRAME_LEVEL: f64 = 1.097;
const TAP_LEVEL: f64 = 0.2918;
const JINGLE_LEVEL: f64 = 0.02227;
const OPEN_JINGLE_LEVEL: f64 = 0.04494;
/// A tambourine's zils (`JINGLE_PARTIALS`), in Hz.
pub const ZILS: usize = 5;
const JINGLE_PARTIALS: [f64; ZILS] = [5300.0, 6650.0, 7900.0, 9400.0, 11200.0];
/// A BiquadFilterNode's Q before anything sets it.
const Q_DEFAULT: f32 = 1.0;
/// How long a voice with a filter is kept past its last stop.
const FILTER_TAIL: f64 = 0.2;

/// Which wave the body plays.
#[derive(Clone, Copy, PartialEq)]
enum Shape {
    Sine,
    Triangle,
}

pub struct Drum {
    kind: u32,
    /// The pitched part: the kick's, the soft kick's, the snare's and
    /// clap's body, the rim, the frame's skin.
    body: TableOsc,
    shape: Shape,
    pitch: Param,
    gain: Param,
    /// The rim's bandpass, which comes after its oscillator.
    tone: Biquad,
    /// The frame's second membrane mode.
    mode: TableOsc,
    mode_freq: f32,
    mode_gain: Param,
    /// The jingle's zils: each a sine at its own frequency, all under one
    /// gain (`noise_gain`).
    zils: [TableOsc; ZILS],
    zil_freq: [f32; ZILS],
    /// The noise, its filter and its gain.
    src: NoiseSource,
    filter: Biquad,
    filter_kind: Kind,
    cutoff: f32,
    q: f32,
    noise_gain: Param,
    start: u64,
    end: u64,
}

impl Drum {
    pub const fn new() -> Self {
        Drum {
            kind: KICK,
            body: TableOsc::new(),
            shape: Shape::Sine,
            pitch: Param::new(0.0),
            gain: Param::new(0.0),
            tone: Biquad::new(),
            mode: TableOsc::new(),
            mode_freq: 0.0,
            mode_gain: Param::new(0.0),
            zils: [const { TableOsc::new() }; ZILS],
            zil_freq: [0.0; ZILS],
            src: NoiseSource::new(),
            filter: Biquad::new(),
            filter_kind: Kind::Lowpass,
            cutoff: 0.0,
            q: 0.0,
            noise_gain: Param::new(0.0),
            start: 0,
            end: 0,
        }
    }

    // The noise grain: `_noiseSource(time, dur)`'s two draws, a filter, and
    // a gain that starts at its first value (item 26b).
    #[allow(clippy::too_many_arguments)]
    fn grain(
        &mut self,
        time: f64,
        dur: f64,
        draws: (f64, f64),
        filter: (Kind, f32, f32),
        first: f64,
        noise: usize,
        rate: f64,
    ) {
        noise_grain(&mut self.src, time, dur, draws.0, draws.1, noise, rate);
        self.filter.reset();
        self.filter_kind = filter.0;
        self.cutoff = filter.1;
        self.q = filter.2;
        self.noise_gain.reset_at(first as f32, rate);
    }

    /// One drum. `draws` are what the voice draws, in order: the noise's
    /// rate and offset, and for the jingle the five zils first (so seven).
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        kind: u32,
        time: f64,
        vel: f64,
        draws: &[f64; 7],
        noise: usize,
        rate: f64,
    ) {
        self.kind = kind;
        let v = vel.clamp(0.0, 1.0);
        let r = rate as f32;
        let (n0, n1) = (draws[0], draws[1]);
        // What each part ends by, to find the voice's end.
        let mut stops = 0u64;
        let mut starts = u64::MAX;
        self.src = NoiseSource::new();
        match kind {
            KICK => {
                self.shape = Shape::Sine;
                self.body_events(time, rate, 128.0, Some((44.0, 0.09)));
                let g = &mut self.gain;
                g.reset(UNITY);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time((v * 1.1) as f32, time + 0.004, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.38, time);
                self.body.schedule(time, time + 0.42, rate);
                // The click: a lowpassed grain.
                self.grain(time, 0.03, (n0, n1), (Kind::Lowpass, 1400.0, Q_DEFAULT), v * 0.28, noise, rate);
                let g = &mut self.noise_gain;
                g.set_value_at_time((v * 0.28) as f32, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.03, time);
                stops = stops.max(self.body.stop_frame());
                starts = starts.min(self.body.start_frame());
            }
            SOFTKICK => {
                self.shape = Shape::Sine;
                self.body_events(time, rate, 96.0, Some((46.0, 0.14)));
                let g = &mut self.gain;
                g.reset(UNITY);
                g.set_value_at_time(0.0, time);
                g.linear_ramp_to_value_at_time((v * SOFTKICK_LEVEL) as f32, time + 0.009, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.34, time);
                self.body.schedule(time, time + 0.36, rate);
                stops = stops.max(self.body.stop_frame());
                starts = starts.min(self.body.start_frame());
            }
            SNARE | CLAP => {
                let clap = kind == CLAP;
                let dur = if clap { 0.2 } else { 0.16 };
                self.grain(
                    time,
                    dur,
                    (n0, n1),
                    (Kind::Bandpass, if clap { 1500.0 } else { 1900.0 }, if clap { 1.4 } else { 0.8 }),
                    0.0001,
                    noise,
                    rate,
                );
                let g = &mut self.noise_gain;
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time((v * 0.7) as f32, time + 0.004, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + dur, time);
                // The body: a triangle that does not fall.
                self.shape = Shape::Triangle;
                self.body_events(time, rate, if clap { 320.0 } else { 190.0 }, None);
                let g = &mut self.gain;
                g.reset(UNITY);
                g.set_value_at_time((v * 0.3) as f32, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.09, time);
                self.body.schedule(time, time + 0.12, rate);
                stops = stops.max(self.body.stop_frame());
                starts = starts.min(self.body.start_frame());
            }
            RIM => {
                self.shape = Shape::Triangle;
                self.body_events(time, rate, 420.0, Some((280.0, 0.03)));
                self.tone.reset();
                self.tone.set(Kind::Bandpass, 1700.0, 2.4, 0.0, r);
                let g = &mut self.gain;
                g.reset(UNITY);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time((v * 0.5) as f32, time + 0.002, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.07, time);
                self.body.schedule(time, time + 0.09, rate);
                stops = stops.max(self.body.stop_frame() + frame_at(FILTER_TAIL, rate));
                starts = starts.min(self.body.start_frame());
            }
            FRAME | TAP => {
                let low = kind == FRAME;
                let level = v * if low { FRAME_LEVEL } else { TAP_LEVEL };
                let pitch = if low { 92.0 } else { 210.0 };
                let ring = if low { 0.32 } else { 0.12 };
                // The skin: round, a little higher as it is struck.
                self.shape = Shape::Sine;
                self.body_events(time, rate, pitch * 1.18, Some((pitch, 0.05)));
                let g = &mut self.gain;
                g.reset(UNITY);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time(level as f32, time + 0.004, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + ring, time);
                self.body.schedule(time, time + ring + 0.02, rate);
                // A second mode above it, dying faster.
                self.mode_freq = (pitch * 1.59) as f32;
                let g = &mut self.mode_gain;
                g.reset(UNITY);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time((level * 0.35) as f32, time + 0.003, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + ring * 0.45, time);
                self.mode.schedule(time, time + ring + 0.02, rate);
                // The tipper's slap on the skin.
                self.grain(
                    time,
                    0.04,
                    (n0, n1),
                    (Kind::Bandpass, if low { 520.0 } else { 900.0 }, 1.1),
                    0.0001,
                    noise,
                    rate,
                );
                let g = &mut self.noise_gain;
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time(
                    (level * if low { 0.3 } else { 0.45 }) as f32,
                    time + 0.002,
                    time,
                );
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.04, time);
                stops = stops.max(self.body.stop_frame());
                starts = starts.min(self.body.start_frame());
            }
            _ => {
                // A tambourine's zils: five sines a hair off from where
                // they were last time, and a whisper of noise above 7 kHz,
                // all under one gain.
                let long = kind == OPEN_JINGLE;
                let ring = if long { 0.24 } else { 0.09 };
                let level = v * if long { OPEN_JINGLE_LEVEL } else { JINGLE_LEVEL };
                let g = &mut self.noise_gain;
                g.reset_at(0.0001, rate);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time(level as f32, time + 0.002, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + ring, time);
                for ((osc, freq), (&hz, &draw)) in self
                    .zils
                    .iter_mut()
                    .zip(self.zil_freq.iter_mut())
                    .zip(JINGLE_PARTIALS.iter().zip(draws.iter()))
                {
                    *freq = (hz * (0.99 + draw * 0.02)) as f32;
                    osc.schedule(time, time + ring + 0.02, rate);
                    stops = stops.max(osc.stop_frame());
                    starts = starts.min(osc.start_frame());
                }
                noise_grain(&mut self.src, time, ring, draws[5], draws[6], noise, rate);
                self.filter.reset();
                self.filter_kind = Kind::Highpass;
                self.cutoff = 7000.0;
                self.q = Q_DEFAULT;
            }
        }
        if uses_noise(kind) {
            starts = starts.min(self.src.start_frame());
            stops = stops.max(self.src.end_frame() + frame_at(FILTER_TAIL, rate));
        }
        self.start = starts;
        self.end = stops;
    }

    // The body's frequency: set at the start, and for most falling to a
    // second value by a time.
    fn body_events(&mut self, time: f64, _rate: f64, from: f64, to: Option<(f64, f64)>) {
        let p = &mut self.pitch;
        p.reset(A440);
        p.set_value_at_time(from as f32, time);
        if let Some((hz, within)) = to {
            p.exponential_ramp_to_value_at_time(hz as f32, time + within, time);
        }
    }

    pub fn start_frame(&self) -> u64 {
        self.start
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, noise: &[f32], out: &mut Block) {
        let r = rate as f32;
        match self.kind {
            KICK | SOFTKICK | SNARE | CLAP | FRAME | TAP => {
                self.render_body(block, rate, waves, out);
            }
            RIM => {
                let mut x = [0.0f32; QUANTUM];
                self.render_body_into(block, rate, waves, &mut x);
                let mut gain = [0.0f32; QUANTUM];
                self.gain.fill(block, rate, &mut gain);
                // The filter runs every frame of the block; it rings on.
                for ((y, v), g) in out.iter_mut().zip(x.iter()).zip(gain.iter()) {
                    *y += self.tone.step(*v) * *g;
                }
                self.tone.flush();
            }
            _ => {}
        }
        if self.kind == FRAME || self.kind == TAP {
            let steady = Pitch::Steady {
                freq: self.mode_freq,
                detune: 0.0,
            };
            let mut tone = [0.0f32; QUANTUM];
            let (lo, hi) = self.mode.render(block, &waves.sine, &steady, r, &mut tone);
            let mut gain = [0.0f32; QUANTUM];
            self.mode_gain.fill(block, rate, &mut gain);
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
        if self.kind == JINGLE || self.kind == OPEN_JINGLE {
            // The zils and the hiss, summed, then the gain they share.
            let mut sum = [0.0f32; QUANTUM];
            let mut one = [0.0f32; QUANTUM];
            for (osc, &freq) in self.zils.iter_mut().zip(self.zil_freq.iter()) {
                let steady = Pitch::Steady { freq, detune: 0.0 };
                osc.render(block, &waves.sine, &steady, r, &mut one);
                for (s, w) in sum.iter_mut().zip(one.iter()) {
                    *s += *w;
                }
            }
            let mut x = [0.0f32; QUANTUM];
            self.src.render(block, noise, &mut x);
            let mut gain = [0.0f32; QUANTUM];
            self.noise_gain.fill(block, rate, &mut gain);
            for (((y, s), v), g) in out
                .iter_mut()
                .zip(sum.iter())
                .zip(x.iter())
                .zip(gain.iter())
            {
                self.filter.set(self.filter_kind, self.cutoff, self.q, 0.0, r);
                let hiss = self.filter.step(*v) * 0.6;
                *y += (*s + hiss) * *g;
            }
            self.filter.flush();
        } else if uses_noise(self.kind) {
            let mut x = [0.0f32; QUANTUM];
            self.src.render(block, noise, &mut x);
            let mut gain = [0.0f32; QUANTUM];
            self.noise_gain.fill(block, rate, &mut gain);
            for ((y, v), g) in out.iter_mut().zip(x.iter()).zip(gain.iter()) {
                self.filter.set(self.filter_kind, self.cutoff, self.q, 0.0, r);
                *y += self.filter.step(*v) * *g;
            }
            self.filter.flush();
        }
    }

    // The body through its gain, added into `out`.
    fn render_body(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let mut tone = [0.0f32; QUANTUM];
        let (lo, hi) = self.render_body_into(block, rate, waves, &mut tone);
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

    // The body oscillator alone.
    fn render_body_into(
        &mut self,
        block: u64,
        rate: f64,
        waves: &Waves,
        tone: &mut Block,
    ) -> (usize, usize) {
        let mut freq = [0.0f32; QUANTUM];
        let first = starts_in(self.body.start_frame(), block);
        let pitch = pitch_of(
            &mut self.pitch,
            block,
            rate,
            first,
            &mut freq,
            Part::Steady(0.0),
        );
        let wave: &Wave = match self.shape {
            Shape::Sine => &waves.sine,
            Shape::Triangle => &waves.triangle,
        };
        self.body.render(block, wave, &pitch, rate as f32, tone)
    }
}

impl Default for Drum {
    fn default() -> Self {
        Self::new()
    }
}
