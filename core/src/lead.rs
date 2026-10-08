//! The wave-table voices: pads, leads and the square beep. Each is a port of
//! its JavaScript twin in `js/synth.js`, call for call, like the voices in
//! `voice`, and each is the same shape -- a few oscillators on one wave,
//! through a lowpass, under an envelope -- so two structs cover seven
//! voices. `Tone` has a steady pitch (the pads, analoglead, the saw pluck
//! and the square beep); `Lead` has a pitch that moves (the moog, and the
//! whistle with its slide) and a vibrato that ramps in.

use crate::QUANTUM;
use crate::filter::{Biquad, Kind};
use crate::osc::{Part, Pitch, TableOsc, frame_at};
use crate::param::Param;
use crate::voice::{A440, Block, UNITY, midi_to_freq, pitch_of, release, starts_in};
use crate::wave::{Wave, Waves};

/// Which table a `Tone` plays.
#[derive(Clone, Copy, PartialEq)]
pub enum Source {
    /// The built-in sawtooth.
    Saw,
    /// The built-in square.
    Square,
    /// `_makeWave(1.5)`, the saw lead's.
    LeadSaw,
    /// `_makeWave(1.7)`, the analoglead's.
    LeadAnalog,
}

fn table(source: Source, waves: &Waves) -> &Wave {
    match source {
        Source::Saw => &waves.saw,
        Source::Square => &waves.square,
        Source::LeadSaw => &waves.lead_saw,
        Source::LeadAnalog => &waves.lead_analog,
    }
}

/// The most oscillators a `Tone` has (the pads' three saws).
const TONES: usize = 3;
/// How long a voice is kept after its oscillators stop, in seconds, so the
/// lowpass can ring out: an oscillator that stops while the note is still
/// sounding (the leads and the beep stop on a schedule, not on silence)
/// leaves a resonant filter ringing, and a node keeps rendering its tail.
/// A cutoff of 200 Hz at a Q of 8 dB rings for about 30 ms; this is well
/// past that.
const FILTER_TAIL: f64 = 0.2;
/// A BiquadFilterNode's frequency, and its Q, before anything is set.
const CUTOFF_DEFAULT: f32 = 350.0;
const Q_DEFAULT: f32 = 1.0;

/// A tone with a steady pitch: `count` oscillators on one table, `detune`
/// cents apart, summed into a lowpass whose cutoff may move, then a gain.
/// With a vibrato, one sine at a fixed rate through a fixed depth drives
/// every oscillator's detune.
pub struct Tone {
    source: Source,
    count: usize,
    oscs: [TableOsc; TONES],
    detune: [f32; TONES],
    pitch: f32,
    vibrato: bool,
    lfo: TableOsc,
    lfo_rate: f32,
    lfo_depth: f32,
    cutoff: Param,
    q: f32,
    filter: Biquad,
    gain: Param,
    end: u64,
}

impl Tone {
    pub const fn new() -> Self {
        Tone {
            source: Source::Saw,
            count: 0,
            oscs: [const { TableOsc::new() }; TONES],
            detune: [0.0; TONES],
            pitch: 0.0,
            vibrato: false,
            lfo: TableOsc::new(),
            lfo_rate: 0.0,
            lfo_depth: 0.0,
            cutoff: Param::new(0.0),
            q: 0.0,
            filter: Biquad::new(),
            gain: Param::new(0.0),
            end: 0,
        }
    }

    // What every recipe shares: the oscillators, started at `time` and
    // stopped at `stop`, and the gain and filter state.
    fn start(
        &mut self,
        source: Source,
        detunes: &[f32],
        midi: f64,
        time: f64,
        stop: f64,
        rate: f64,
    ) {
        self.source = source;
        self.count = detunes.len().min(TONES);
        self.pitch = midi_to_freq(midi) as f32;
        self.vibrato = false;
        self.filter.reset();
        for ((osc, d), &cents) in self
            .oscs
            .iter_mut()
            .zip(self.detune.iter_mut())
            .zip(detunes)
        {
            *d = cents;
            osc.schedule(time, stop, rate);
        }
        self.gain.reset(UNITY);
        self.end = frame_at(stop + FILTER_TAIL, rate);
    }

    /// `softpad`: three saws (-9, 0, +11 cents) under a lowpass that opens
    /// across the first half of the note.
    pub fn soft_pad(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        let stop = time + dur + 1.8;
        self.start(
            Source::Saw,
            &[-9.0, 0.0, 11.0],
            midi,
            time,
            stop + 0.01,
            rate,
        );
        self.q = Q_DEFAULT;
        let c = &mut self.cutoff;
        c.reset(CUTOFF_DEFAULT);
        c.set_value_at_time(700.0, time);
        c.linear_ramp_to_value_at_time(1500.0, time + dur * 0.5, time);
        let g = &mut self.gain;
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time((vel * 0.16) as f32, time + (dur * 0.45).min(1.4), time);
        release(g, time + dur * 0.7, stop, time);
    }

    /// `analogpad`: three saws (-11, 0, +9) under a lowpass that opens to
    /// six times the note.
    pub fn analog_pad(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        let f = midi_to_freq(midi);
        let stop = time + dur + 1.6;
        self.start(
            Source::Saw,
            &[-11.0, 0.0, 9.0],
            midi,
            time,
            stop + 0.01,
            rate,
        );
        self.q = 1.6;
        let c = &mut self.cutoff;
        c.reset(CUTOFF_DEFAULT);
        c.set_value_at_time((f * 3.0).min(900.0) as f32, time);
        c.linear_ramp_to_value_at_time(
            (f * 6.0).min(2600.0) as f32,
            time + (dur * 0.6).min(2.0),
            time,
        );
        let g = &mut self.gain;
        g.set_value_at_time(0.0001, time);
        g.linear_ramp_to_value_at_time((vel * 0.17) as f32, time + (dur * 0.3).min(0.9), time);
        release(g, time + dur * 0.75, stop, time);
    }

    /// `analoglead`: two soft saws (-7, +6) under a fixed lowpass.
    pub fn analog_lead(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        self.start(
            Source::LeadAnalog,
            &[-7.0, 6.0],
            midi,
            time,
            time + dur + 0.8,
            rate,
        );
        self.q = 0.0;
        self.cutoff.reset(1600.0);
        let let_go = time + dur * 0.7;
        let g = &mut self.gain;
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time((vel * 0.0861) as f32, (time + 0.03).min(let_go), time);
        g.set_target_at_time(0.0001, let_go, 0.18);
    }

    /// `pluck('saw')`: one soft saw under a fixed lowpass with a little edge.
    pub fn saw_pluck(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        self.start(Source::LeadSaw, &[0.0], midi, time, time + dur + 0.6, rate);
        self.q = 4.0;
        self.cutoff.reset(1400.0);
        let g = &mut self.gain;
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time((vel * 0.1055) as f32, time + 0.01, time);
        g.set_target_at_time(0.0001, time + dur * 0.6, 0.15);
    }

    /// `pluck()`'s default, the square beep: a square wave with a constant
    /// 5.4 Hz vibrato of 3.5 cents, under a lowpass at 2.6 kHz.
    pub fn beep(&mut self, midi: f64, time: f64, dur: f64, vel: f64, rate: f64) {
        let stop = time + dur + 0.5;
        self.start(Source::Square, &[0.0], midi, time, stop, rate);
        self.vibrato = true;
        self.lfo_rate = 5.4;
        self.lfo_depth = 3.5;
        self.lfo.schedule(time, stop, rate);
        self.q = Q_DEFAULT;
        self.cutoff.reset(2600.0);
        let g = &mut self.gain;
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time((vel * 0.095) as f32, time + 0.008, time);
        g.set_target_at_time(0.0001, time + dur * 0.55, 0.12);
    }

    pub fn start_frame(&self) -> u64 {
        self.oscs[0].start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        let wave = table(self.source, waves);
        // The vibrato's detune, in cents: its sine through its depth.
        let mut cents = [0.0f32; QUANTUM];
        if self.vibrato {
            let steady = Pitch::Steady {
                freq: self.lfo_rate,
                detune: 0.0,
            };
            let mut sine = [0.0f32; QUANTUM];
            let (lo, hi) = self.lfo.render(block, &waves.sine, &steady, r, &mut sine);
            for (c, w) in cents.iter_mut().zip(sine.iter()).take(hi).skip(lo) {
                *c = *w * self.lfo_depth;
            }
        }
        let mut sum = [0.0f32; QUANTUM];
        let mut one = [0.0f32; QUANTUM];
        for (osc, &detune) in self
            .oscs
            .iter_mut()
            .zip(self.detune.iter())
            .take(self.count)
        {
            if self.vibrato {
                let pitch = Pitch::Moving {
                    freq: Part::Steady(self.pitch),
                    detune: Part::Moving(&cents),
                };
                osc.render(block, wave, &pitch, r, &mut one);
            } else {
                let pitch = Pitch::Steady {
                    freq: self.pitch,
                    detune,
                };
                osc.render(block, wave, &pitch, r, &mut one);
            }
            for (s, w) in sum.iter_mut().zip(one.iter()) {
                *s += *w;
            }
        }
        // The filter runs every frame of the block, as a node does.
        let mut cutoff = [0.0f32; QUANTUM];
        self.cutoff.fill(block, rate, &mut cutoff);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        for (((y, x), c), g) in out
            .iter_mut()
            .zip(sum.iter())
            .zip(cutoff.iter())
            .zip(gain.iter())
        {
            self.filter.set(Kind::Lowpass, *c, self.q, 0.0, r);
            *y += self.filter.step(*x) * *g;
        }
        self.filter.flush();
    }
}

impl Default for Tone {
    fn default() -> Self {
        Self::new()
    }
}

/// The vibrato of the moog and the whistle, in Hz.
const LEAD_VIBRATO: f32 = 5.6;

/// Which of the two a `Lead` is.
#[derive(Clone, Copy, PartialEq)]
pub enum LeadKind {
    Moog,
    Whistle,
}

/// `voice('moog')` and `voice('whistle')`: one oscillator (the moog's own
/// wave, or the built-in triangle) whose pitch is automated, with a
/// vibrato on its detune that ramps in, through a resonant lowpass whose
/// cutoff moves, under a gain. The whistle may scoop or slide into the
/// note (`_slide`); JavaScript draws that and sends where from and how
/// long it takes.
pub struct Lead {
    kind: LeadKind,
    osc: TableOsc,
    pitch: Param,
    lfo: TableOsc,
    depth: Param,
    cutoff: Param,
    q: f32,
    filter: Biquad,
    gain: Param,
    end: u64,
}

impl Lead {
    pub const fn new() -> Self {
        Lead {
            kind: LeadKind::Moog,
            osc: TableOsc::new(),
            pitch: Param::new(0.0),
            lfo: TableOsc::new(),
            depth: Param::new(0.0),
            cutoff: Param::new(0.0),
            q: 0.0,
            filter: Biquad::new(),
            gain: Param::new(0.0),
            end: 0,
        }
    }

    /// `slide` is where the pitch comes from in Hz and how long it takes to
    /// arrive, in seconds, if the whistle slides into this note.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        kind: LeadKind,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        slide: Option<(f64, f64)>,
        rate: f64,
    ) {
        let whistle = kind == LeadKind::Whistle;
        let f = midi_to_freq(midi);
        self.kind = kind;
        let stop = time + dur + 0.5;
        let p = &mut self.pitch;
        p.reset(A440);
        match slide.filter(|_| whistle) {
            Some((from, reach)) => {
                p.set_value_at_time(from as f32, time);
                p.exponential_ramp_to_value_at_time(f as f32, time + reach, time);
            }
            None => {
                p.set_value_at_time(f as f32, time);
            }
        }
        let d = &mut self.depth;
        d.reset(UNITY);
        d.set_value_at_time(0.0, time);
        d.linear_ramp_to_value_at_time(if whistle { 12.0 } else { 5.0 }, time + dur.min(0.6), time);
        let c = &mut self.cutoff;
        c.reset(CUTOFF_DEFAULT);
        if whistle {
            self.q = 8.0;
            c.set_value_at_time((f * 7.0).min(9000.0) as f32, time);
            c.exponential_ramp_to_value_at_time(
                (f * 1.6).max(220.0) as f32,
                time + (dur * 0.8).max(0.12),
                time,
            );
        } else {
            self.q = 5.0;
            c.set_value_at_time(1600.0, time);
            c.exponential_ramp_to_value_at_time(1100.0, time + (dur * 0.8).max(0.12), time);
        }
        let g = &mut self.gain;
        g.reset(UNITY);
        g.set_value_at_time(0.0001, time);
        g.exponential_ramp_to_value_at_time(
            (vel * if whistle { 0.1121 } else { 0.0947 }) as f32,
            time + 0.014,
            time,
        );
        g.set_target_at_time(0.0001, time + dur * 0.75, 0.1);
        self.filter.reset();
        self.osc.schedule(time, stop, rate);
        self.lfo.schedule(time, stop, rate);
        self.end = frame_at(stop + FILTER_TAIL, rate);
    }

    pub fn start_frame(&self) -> u64 {
        self.osc.start_frame()
    }

    pub fn end_frame(&self) -> u64 {
        self.end
    }

    pub fn render(&mut self, block: u64, rate: f64, waves: &Waves, out: &mut Block) {
        let r = rate as f32;
        // The detune, in cents: the vibrato's sine through its depth. It
        // moves for the whole note, even before the depth has risen.
        let steady = Pitch::Steady {
            freq: LEAD_VIBRATO,
            detune: 0.0,
        };
        let mut sine = [0.0f32; QUANTUM];
        let (lo, hi) = self.lfo.render(block, &waves.sine, &steady, r, &mut sine);
        // Feeding only the detune, the depth is first rendered when the
        // note starts: its events are clamped to that block.
        if starts_in(self.lfo.start_frame(), block) {
            self.depth.clamp_before(block, rate);
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
        let wave = match self.kind {
            LeadKind::Moog => &waves.lead_moog,
            LeadKind::Whistle => &waves.triangle,
        };
        let mut tone = [0.0f32; QUANTUM];
        self.osc.render(block, wave, &pitch, r, &mut tone);
        let mut cutoff = [0.0f32; QUANTUM];
        self.cutoff.fill(block, rate, &mut cutoff);
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
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
}

impl Default for Lead {
    fn default() -> Self {
        Self::new()
    }
}
