//! The folk voices' bodies, and the accordion and the nylon guitar.
//!
//! A body is an instrument's fixed resonances (`BODIES` in synth.js): one
//! chain of filters per kind and channel, shared by every note that voice
//! plays into the channel, as `_body()` builds them. Notes sum into their
//! body's bus; the body runs on the sum. The fiddle (`voice.rs`) plays
//! through one too.

use crate::QUANTUM;
use crate::filter::{Biquad, Kind};
use crate::osc::{Pitch, TableOsc};
use crate::param::Param;
use crate::voice::{Block, SLUR_ATTACK, UNITY, midi_to_freq, speak};
use crate::wave::Waves;

/// The kinds of body, by number.
pub const FIDDLE: usize = 0;
pub const NYLON: usize = 1;
pub const ACCORDION: usize = 2;
pub const KINDS: usize = 3;

/// The most filters a body has.
const MOST: usize = 3;

/// `BODIES` in synth.js: [type, Hz, Q, dB]. A lowpass's Q is in dB, so -3
/// is the plain, unresonant slope.
const BODIES: [&[(Kind, f32, f32, f32)]; KINDS] = [
    // The violin's wood around 300 Hz, a bridge hill at 2.7 kHz, the fizz
    // above rolled away.
    &[
        (Kind::Peaking, 300.0, 1.2, 5.0),
        (Kind::Peaking, 2700.0, 0.9, 2.0),
        (Kind::Lowpass, 4500.0, -3.0, 0.0),
    ],
    // The guitar's air and top-plate resonances.
    &[
        (Kind::Peaking, 110.0, 1.0, 3.0),
        (Kind::Peaking, 230.0, 1.2, 2.0),
        (Kind::Lowpass, 3500.0, -3.0, 0.0),
    ],
    // The reed's milder formant, under a lowpass near 3 kHz.
    &[
        (Kind::Peaking, 1250.0, 0.9, 3.0),
        (Kind::Lowpass, 2800.0, -3.0, 0.0),
    ],
];

/// One body: its filters, in order.
pub struct Body {
    filters: [Biquad; MOST],
    len: usize,
}

impl Body {
    pub const fn new() -> Self {
        Body {
            filters: [Biquad::new(); MOST],
            len: 0,
        }
    }

    /// At rest, as the kind `kind` at `rate`.
    pub fn set(&mut self, kind: usize, rate: f32) {
        let spec = BODIES.get(kind).copied().unwrap_or(&[]);
        self.len = spec.len().min(MOST);
        for (f, &(k, freq, q, gain)) in self.filters.iter_mut().zip(spec.iter()) {
            f.reset();
            f.set(k, freq, q, gain, rate);
        }
    }

    /// `bus` through the body, added into `out`. A body with nothing in
    /// it and nothing ringing is skipped: zeros through filters at rest are
    /// zeros, so this changes no sample, and a channel's three bodies cost
    /// nothing while their voices are not playing.
    pub fn run(&mut self, bus: &Block, out: &mut Block) {
        let filters = self.filters.get_mut(..self.len).unwrap_or(&mut []);
        if filters.iter().all(|f| f.at_rest()) && bus.iter().all(|&x| x == 0.0) {
            return;
        }
        for (y, &x) in out.iter_mut().zip(bus.iter()) {
            let mut v = x;
            for f in filters.iter_mut() {
                v = f.step(v);
            }
            *y += v;
        }
        for f in filters.iter_mut() {
            f.flush();
        }
    }
}

impl Default for Body {
    fn default() -> Self {
        Self::new()
    }
}

/// The accordion's level, by layer (`ACCORDION_LEVEL`): a chord is several
/// notes at once through the engine's spread, so chords take their own.
const ACCORDION_MELODY: f64 = 0.0892;
const ACCORDION_CHORDS: f64 = 0.0909;
/// The two reeds' detunes, in cents either side (`REED_CENTS`), and the
/// second one's level (`SECOND_REED`).
const REED_CENTS: f32 = 1.25;
const SECOND_REED: f32 = 0.35;

/// Accordion: two soft reeds a couple of cents apart, the second quieter
/// and starting at a random point of its cycle, under one envelope, into
/// the accordion's body (`voice('accordion')`).
pub struct Accordion {
    reeds: [TableOsc; 2],
    pitch: f32,
    envelope: Param,
}

impl Accordion {
    pub const fn new() -> Self {
        Accordion {
            reeds: [TableOsc::new(), TableOsc::new()],
            pitch: 0.0,
            envelope: Param::new(0.0),
        }
    }

    /// `chords` is whether it plays into the chords channel; `joined`,
    /// whether it follows on from the note before (`opts.prev`); `draw`, the
    /// `Math.random` draw that sets how late the second reed comes in, under
    /// one period of the note.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        chords: bool,
        joined: bool,
        draw: f64,
        rate: f64,
    ) {
        let f = midi_to_freq(midi);
        self.pitch = f as f32;
        let level = vel
            * if chords {
                ACCORDION_CHORDS
            } else {
                ACCORDION_MELODY
            };
        let attack = if joined { SLUR_ATTACK } else { speak(dur) };
        let g = &mut self.envelope;
        g.reset_at(UNITY, rate);
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time(level as f32, time + attack, time);
        g.set_target_at_time(0.0001, time + dur * 0.92, 0.06);
        let stop = time + dur + 0.35;
        let [first, second] = &mut self.reeds;
        first.schedule(time, stop, rate);
        second.schedule(time + draw / f, stop, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.reeds[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.reeds[0].stop_frame()
    }

    /// Add this block into `out`, the accordion's bus for its channel.
    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let [first, second] = &mut self.reeds;
        let mut low = [0.0f32; QUANTUM];
        let mut high = [0.0f32; QUANTUM];
        let (lo, hi) = first.render(
            block,
            &waves.reed,
            &Pitch::Steady {
                freq: self.pitch,
                detune: -REED_CENTS,
            },
            r,
            &mut low,
        );
        second.render(
            block,
            &waves.reed,
            &Pitch::Steady {
                freq: self.pitch,
                detune: REED_CENTS,
            },
            r,
            &mut high,
        );
        let mut envelope = [0.0f32; QUANTUM];
        self.envelope.fill(block, rate, &mut envelope);
        // The second reed through its own gain, then both into the
        // envelope's gain. The second starts no earlier than the first, so
        // the first's range covers both.
        for (((y, a), b), g) in out
            .iter_mut()
            .zip(low.iter())
            .zip(high.iter())
            .zip(envelope.iter())
            .take(hi)
            .skip(lo)
        {
            *y += (*a + *b * SECOND_REED) * *g;
        }
    }
}

impl Default for Accordion {
    fn default() -> Self {
        Self::new()
    }
}

/// The nylon guitar's level (`NYLON_LEVEL`), the bright layer's share of
/// it and how fast each layer dies away (`NYLON_BRIGHT`, `NYLON_MELLOW`),
/// and the release a strummed string is damped on (`NYLON_DAMP`).
const NYLON_LEVEL: f64 = 0.1029;
const NYLON_BRIGHT_SHARE: f64 = 0.6;
const NYLON_BRIGHT_TAU: f64 = 0.08;
const NYLON_MELLOW_TAU: f64 = 0.55;
pub const NYLON_DAMP: f64 = 0.08;

/// Nylon guitar: a plucked string, two layers -- a mellow one that rings
/// on, lower strings longer, and a bright one that dies in a tenth of a
/// second -- each with its own envelope, into the guitar's body
/// (`voice('nylon')`). A strummed string can be damped by the next strum
/// (`damp`).
pub struct Nylon {
    /// Mellow, then bright, in the order JavaScript builds them.
    oscs: [TableOsc; 2],
    gains: [Param; 2],
    pitch: f32,
}

impl Nylon {
    pub const fn new() -> Self {
        Nylon {
            oscs: [TableOsc::new(), TableOsc::new()],
            gains: [Param::new(0.0), Param::new(0.0)],
            pitch: 0.0,
        }
    }

    pub fn play(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        let f = midi_to_freq(midi);
        self.pitch = f as f32;
        let level = vel * NYLON_LEVEL;
        let ring = NYLON_MELLOW_TAU * (261.6 / f).powf(0.35);
        let stop = time + dur + 0.4;
        for ((osc, g), (peak, tau)) in self.oscs.iter_mut().zip(self.gains.iter_mut()).zip([
            (level, ring),
            (level * NYLON_BRIGHT_SHARE, NYLON_BRIGHT_TAU),
        ]) {
            g.reset_at(UNITY, rate);
            g.set_value_at_time(0.0001, time);
            g.exponential_ramp_to_value_at_time(peak as f32, time + 0.004, time);
            g.set_target_at_time(0.0001, time + 0.004, tau);
            g.set_target_at_time(0.0001, time + dur, 0.08);
            osc.schedule(time, stop, rate);
        }
    }

    /// Let the string go at `time`, on the note's own release
    /// (`damp()` in synth.js).
    pub fn damp(&mut self, time: f64) {
        for g in self.gains.iter_mut() {
            g.set_target_at_time(0.0001, time, NYLON_DAMP);
        }
    }

    pub fn start_frame(&self) -> u64 {
        self.oscs[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.oscs[0].stop_frame()
    }

    /// Add this block into `out`, the nylon's bus for its channel.
    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let pitch = Pitch::Steady {
            freq: self.pitch,
            detune: 0.0,
        };
        for ((osc, g), wave) in self
            .oscs
            .iter_mut()
            .zip(self.gains.iter())
            .zip([&waves.nylon_mellow, &waves.nylon_bright])
        {
            let mut w = [0.0f32; QUANTUM];
            let (lo, hi) = osc.render(block, wave, &pitch, r, &mut w);
            let mut gain = [0.0f32; QUANTUM];
            g.fill(block, rate, &mut gain);
            for ((y, x), k) in out
                .iter_mut()
                .zip(w.iter())
                .zip(gain.iter())
                .take(hi)
                .skip(lo)
            {
                *y += *x * *k;
            }
        }
    }
}

impl Default for Nylon {
    fn default() -> Self {
        Self::new()
    }
}
