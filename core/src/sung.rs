//! The sung voices: vowel, hum and choir (`voice('vowel' | 'hum' |
//! 'choir')` in synth.js), call for call.
//!
//! A singer is the `glottal` wave (a hum's is the triangle) whose detune is
//! a scoop into the note, then a jitter of many small ramps, with a vibrato
//! summed into it; a choir is three singers into one tract. The tract is
//! three peaking formant filters in series, which slide toward another
//! vowel on a long note, then a lowpass; a breath of looped noise through a
//! bandpass joins the tract under one envelope.
//!
//! What JavaScript decides arrives with the note: the vowel, where it
//! drifts to (both drawn before the voice budget is asked), the note's
//! formant trim (`_formantTrim`, worked out in JavaScript from the vowel
//! and the note and sent, since it draws nothing and the synth already
//! caches it), the composer's standing detune, and every other draw, in
//! the order the JavaScript voice makes them (`Core::sung_draws`).
//!
//! The jitter takes one detune event for every 0.09 to 0.17 s of the note,
//! so a singer's detune holds `DETUNE_EVENTS`, sized from the longest sung
//! note in 30,000 loops (10.2 s) with room to spare; a longer note
//! (`LONGEST`) plays in JavaScript. A sung voice is far bigger than any
//! other, so the sung voices have a pool of their own (`POOL`), sized from
//! the voice budget: a hum, the cheapest, costs 16 of its 260 units.

use crate::QUANTUM;
use crate::filter::{Biquad, Kind};
use crate::noise::NoiseSource;
use crate::osc::{Part, Pitch, TableOsc, frame_at};
use crate::param::Param;
use crate::voice::{Block, UNITY, midi_to_freq, pitch_of, release, starts_in};
use crate::wave::Waves;

/// Which sung voice, by its place after `LAST` in lib.rs.
#[derive(Clone, Copy, PartialEq)]
pub enum Kind3 {
    Vowel,
    Hum,
    Choir,
}

/// Sung voices sounding at once. The budget lets at most sixteen hums be
/// billed together, and a voice lingers 0.1 s past its bill.
pub const POOL: usize = 32;

/// The most steps of jitter a singer takes, and so the longest note the
/// core sings: the jitter's first step is at 0.12 s and they come at least
/// 0.09 s apart (`SUNG_LONGEST` in synth.js, which keeps longer notes).
pub const MAX_STEPS: usize = 150;
pub const LONGEST: f64 = 13.5;
const _: () = assert!(0.12 + MAX_STEPS as f64 * 0.09 > LONGEST);
/// A singer's detune: the scoop's two events and the jitter's.
const DETUNE_EVENTS: usize = MAX_STEPS + 2;
const SINGERS: usize = 3;

/// The most draws a note sends: per singer the choir's spread, the scoop's
/// two, the jitter's count and two a step, the vibrato's three; then the
/// breath's rate.
pub const MAX_DRAWS: usize = SINGERS * (4 + 2 * MAX_STEPS + 3) + 1;

/// [centre Hz, bandwidth Hz, boost dB] for each formant (`VOWELS`): a, e,
/// o, u, as the note's vowel numbers them.
const VOWELS: [[[f64; 3]; 3]; 4] = [
    [[800.0, 80.0, 16.0], [1150.0, 90.0, 13.0], [2900.0, 130.0, 9.0]],
    [[400.0, 60.0, 16.0], [1600.0, 80.0, 13.0], [2700.0, 130.0, 9.0]],
    [[450.0, 70.0, 17.0], [800.0, 80.0, 12.0], [2830.0, 120.0, 7.0]],
    [[325.0, 50.0, 17.0], [700.0, 60.0, 11.0], [2530.0, 170.0, 6.0]],
];
/// A closed mouth.
const HUM: [[f64; 3]; 3] = [[280.0, 60.0, 18.0], [1100.0, 100.0, 8.0], [2200.0, 160.0, 3.0]];
/// Where a long hum opens to (`OPEN_HUM`); target 4.
const OPEN_HUM: [[f64; 3]; 3] = [[330.0, 70.0, 16.5], [1200.0, 110.0, 10.0], [2350.0, 170.0, 5.0]];

/// The note's level before its velocity and trim.
const LEVEL_CHOIR: f64 = 0.112;
const LEVEL_HUM: f64 = 0.085;
const LEVEL_VOWEL: f64 = 0.174;
/// How long the voice is kept past its sources' stop, for its filters.
const FILTER_TAIL: f64 = 0.2;
/// A gain behind the noise holds its first event's value before it (item
/// 26b), as the breath's and the envelope's do.
const QUIET: f32 = 0.0001;

struct Singer {
    osc: TableOsc,
    /// The frequency: the note's, never automated.
    pitch: Param,
    detune: Param<DETUNE_EVENTS>,
    lfo: TableOsc,
    lfo_rate: f32,
    depth: Param,
}

impl Singer {
    const fn new() -> Self {
        Singer {
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            detune: Param::new(0.0),
            lfo: TableOsc::new(),
            lfo_rate: 0.0,
            depth: Param::new(0.0),
        }
    }
}

struct Formant {
    filter: Biquad,
    freq: Param,
    q: Param,
    gain: Param,
}

impl Formant {
    const fn new() -> Self {
        Formant {
            filter: Biquad::new(),
            freq: Param::new(0.0),
            q: Param::new(0.0),
            gain: Param::new(0.0),
        }
    }
}

pub struct Sung {
    /// Taken by a sounding note.
    pub busy: bool,
    singers: [Singer; SINGERS],
    count: usize,
    humming: bool,
    formants: [Formant; 3],
    corner: f32,
    lowpass: Biquad,
    amp: Param,
    breath: NoiseSource,
    breath_hz: f32,
    breath_filter: Biquad,
    breath_gain: Param,
    start: u64,
    end: u64,
}

/// Reads a note's draws in order; NaN once they run out (a note sent short
/// sings without what is missing rather than reading another's).
struct Draws<'a> {
    all: &'a [f64],
    at: usize,
}

impl Draws<'_> {
    fn next(&mut self) -> f64 {
        let x = self.all.get(self.at).copied().unwrap_or(f64::NAN);
        self.at += 1;
        x
    }
}

impl Sung {
    pub const fn new() -> Self {
        Sung {
            busy: false,
            singers: [const { Singer::new() }; SINGERS],
            count: 0,
            humming: false,
            formants: [const { Formant::new() }; 3],
            corner: 0.0,
            lowpass: Biquad::new(),
            amp: Param::new(0.0),
            breath: NoiseSource::idle(),
            breath_hz: 0.0,
            breath_filter: Biquad::new(),
            breath_gain: Param::new(0.0),
            start: 0,
            end: 0,
        }
    }

    /// `vowel` is 0-3 (a, e, o, u); `target`, where it drifts to (the same
    /// numbers, 4 for an opening hum, anything else for none); `trim`, the
    /// note's formant trim; `lean`, the composer's standing detune in cents
    /// (`opts.detune`); `draws`, the rest (`Core::sung_draws`).
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        kind: Kind3,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        vowel: f64,
        target: f64,
        trim: f64,
        lean: f64,
        draws: &[f64],
        noise: usize,
        rate: f64,
    ) {
        let humming = kind == Kind3::Hum;
        let choral = kind == Kind3::Choir;
        self.humming = humming;
        let f = midi_to_freq(midi);
        let mut d = Draws { all: draws, at: 0 };

        let formants = if humming {
            HUM
        } else {
            let v = if vowel >= 0.0 && vowel < 4.0 { vowel as usize } else { 0 };
            VOWELS.get(v).copied().unwrap_or(VOWELS[0])
        };
        let to = match target {
            t if t == 4.0 => Some(OPEN_HUM),
            t if (0.0..4.0).contains(&t) => VOWELS.get(t as usize).copied(),
            _ => None,
        };
        let held = ((dur - 0.5) / 1.5).max(0.0).min(1.0);
        let depth = 0.34 + held * 0.66;

        let stop_at = time + dur + 0.9;
        let level = if choral {
            LEVEL_CHOIR
        } else if humming {
            LEVEL_HUM
        } else {
            LEVEL_VOWEL
        };
        let a = &mut self.amp;
        a.reset_at(QUIET, rate);
        a.set_value_at_time(0.0001, time);
        a.linear_ramp_to_value_at_time(
            (vel * trim * level) as f32,
            time + (dur * 0.25).min(0.3),
            time,
        );
        release(a, time + dur * 0.72, stop_at, time);

        let leave_at = time + dur * 0.35;
        let land_at = time + dur * 0.85;
        let part = |from: f64, to: f64| from + (to - from) * depth;
        for (i, (fm, &[hz, bw, gain_db])) in self.formants.iter_mut().zip(formants.iter()).enumerate() {
            fm.filter.reset();
            fm.freq.reset_at(hz as f32, rate);
            fm.q.reset_at((hz / bw) as f32, rate);
            fm.gain.reset_at(gain_db as f32, rate);
            if let Some([thz, tbw, tgain]) = to.and_then(|t| t.get(i).copied()) {
                fm.freq.set_value_at_time(hz as f32, leave_at);
                fm.freq
                    .linear_ramp_to_value_at_time(part(hz, thz) as f32, land_at, time);
                fm.q.set_value_at_time((hz / bw) as f32, leave_at);
                fm.q.linear_ramp_to_value_at_time(
                    (part(hz, thz) / part(bw, tbw)) as f32,
                    land_at,
                    time,
                );
                fm.gain.set_value_at_time(gain_db as f32, leave_at);
                fm.gain
                    .linear_ramp_to_value_at_time(part(gain_db, tgain) as f32, land_at, time);
            }
        }
        self.corner = if humming { 1700.0 } else { 2600.0 };
        self.lowpass.reset();

        self.count = if choral { SINGERS } else { 1 };
        let stop = stop_at + 0.01;
        for (i, s) in self.singers.iter_mut().take(self.count).enumerate() {
            s.pitch.reset(f as f32);
            let spread = lean
                + if choral {
                    (i as f64 - 1.0) * (7.0 + d.next() * 6.0)
                } else {
                    0.0
                };
            let det = &mut s.detune;
            det.reset_at(0.0, rate);
            det.set_value_at_time((spread - 22.0 - d.next() * 14.0) as f32, time);
            det.linear_ramp_to_value_at_time(spread as f32, time + 0.06 + d.next() * 0.05, time);
            let steps = d.next();
            let steps = if steps >= 0.0 { steps as usize } else { 0 };
            let mut t = time + 0.12;
            for _ in 0..steps.min(MAX_STEPS) {
                let v = d.next();
                det.linear_ramp_to_value_at_time((spread + (v - 0.5) * 11.0) as f32, t, time);
                t += 0.09 + d.next() * 0.08;
            }
            // Past what the core holds: read on, so what follows is
            // still the vibrato's.
            for _ in MAX_STEPS..steps {
                d.next();
                d.next();
            }
            s.lfo_rate = (4.3 + d.next() * 1.8) as f32;
            let peak = (if humming { 5.0 } else { 9.0 }) + d.next() * 4.0;
            let dp = &mut s.depth;
            dp.reset_at(UNITY, rate);
            dp.set_value_at_time(0.0, time);
            dp.linear_ramp_to_value_at_time(
                peak as f32,
                time + (dur * 0.55).min(0.9) + d.next() * 0.2,
                time,
            );
            s.osc.schedule(time, stop, rate);
            s.lfo.schedule(time, stop, rate);
        }

        let breath_rate = 0.8 + d.next() * 0.4;
        self.breath.looped(time, stop_at, breath_rate, noise, rate);
        self.breath_hz = if humming { 900.0 } else { 2200.0 };
        self.breath_filter.reset();
        let b = &mut self.breath_gain;
        b.reset_at(QUIET, rate);
        b.set_value_at_time(0.0001, time);
        b.linear_ramp_to_value_at_time(
            (vel * if humming { 0.05 } else { 0.1 }) as f32,
            time + 0.04,
            time,
        );
        b.exponential_ramp_to_value_at_time((vel * 0.02).max(0.0005) as f32, time + 0.3, time);
        b.set_target_at_time(0.0001, time + dur * 0.8, 0.15);

        self.start = frame_at(time, rate);
        self.end = frame_at(stop + FILTER_TAIL, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.start
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, noise: &[f32], out: &mut Block) {
        let r = rate as f32;
        let wave = if self.humming {
            &waves.triangle
        } else {
            &waves.glottal
        };
        // The singers, summed into the tract.
        let mut voices = [0.0f32; QUANTUM];
        for s in self.singers.iter_mut().take(self.count) {
            // The detune: its own events, plus the vibrato through its depth.
            // Both are first rendered when the singer starts: clamped then.
            let first = starts_in(s.osc.start_frame(), block);
            if first {
                s.detune.clamp_before(block, rate);
                s.depth.clamp_before(block, rate);
            }
            let mut cents = [0.0f32; QUANTUM];
            s.detune.fill(block, rate, &mut cents);
            let steady = Pitch::Steady {
                freq: s.lfo_rate,
                detune: 0.0,
            };
            let mut sine = [0.0f32; QUANTUM];
            let (lo, hi) = s.lfo.render(block, &waves.sine, &steady, r, &mut sine);
            let mut depth = [0.0f32; QUANTUM];
            s.depth.fill(block, rate, &mut depth);
            for ((c, w), g) in cents
                .iter_mut()
                .zip(sine.iter())
                .zip(depth.iter())
                .take(hi)
                .skip(lo)
            {
                *c += *w * *g;
            }
            let mut freq = [0.0f32; QUANTUM];
            let pitch = pitch_of(&mut s.pitch, block, rate, first, &mut freq, Part::Moving(&cents));
            let mut tone = [0.0f32; QUANTUM];
            let (lo, hi) = s.osc.render(block, wave, &pitch, r, &mut tone);
            for (v, x) in voices.iter_mut().zip(tone.iter()).take(hi).skip(lo) {
                *v += *x;
            }
        }
        // The tract's parameters, frame by frame: the filters work their
        // coefficients out again only when these move.
        let mut params = [[[0.0f32; QUANTUM]; 3]; 3];
        for (fm, p) in self.formants.iter().zip(params.iter_mut()) {
            let [hz, q, gain] = p;
            fm.freq.fill(block, rate, hz);
            fm.q.fill(block, rate, q);
            fm.gain.fill(block, rate, gain);
        }
        let mut amp = [0.0f32; QUANTUM];
        self.amp.fill(block, rate, &mut amp);
        let mut air = [0.0f32; QUANTUM];
        self.breath.render(block, noise, &mut air);
        let mut breath_gain = [0.0f32; QUANTUM];
        self.breath_gain.fill(block, rate, &mut breath_gain);
        self.lowpass.set(Kind::Lowpass, self.corner, 0.7, 0.0, r);
        self.breath_filter
            .set(Kind::Bandpass, self.breath_hz, 0.8, 0.0, r);
        for (i, y) in out.iter_mut().enumerate() {
            let mut x = voices.get(i).copied().unwrap_or(0.0);
            for (fm, p) in self.formants.iter_mut().zip(params.iter()) {
                let at = |k: usize| p.get(k).and_then(|a| a.get(i)).copied().unwrap_or(0.0);
                fm.filter.set(Kind::Peaking, at(0), at(1), at(2), r);
                x = fm.filter.step(x);
            }
            let tract = self.lowpass.step(x);
            let b = self.breath_filter.step(air.get(i).copied().unwrap_or(0.0))
                * breath_gain.get(i).copied().unwrap_or(0.0);
            *y += (tract + b) * amp.get(i).copied().unwrap_or(0.0);
        }
        for fm in self.formants.iter_mut() {
            fm.filter.flush();
        }
        self.lowpass.flush();
        self.breath_filter.flush();
    }
}

impl Default for Sung {
    fn default() -> Self {
        Self::new()
    }
}
