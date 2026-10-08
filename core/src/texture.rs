//! The textures that are not `fm()` calls (queue item 27): `swell`, `drop`,
//! `wind` and `waves`, each its JavaScript twin in `Synth.texture`, call
//! for call. (`bell` and `chime` are `fm()` calls, and the FM voice plays
//! them.) The budget is asked in JavaScript, note by note, and so are the
//! draws: the drop's three, the wind's one and the waves' two arrive with
//! the note.

use crate::QUANTUM;
use crate::breath::noise_grain;
use crate::filter::{Biquad, Kind};
use crate::noise::NoiseSource;
use crate::osc::{Pitch, TableOsc, frame_at};
use crate::param::Param;
use crate::voice::{Block, UNITY, midi_to_freq};
use crate::wave::Waves;

/// What a texture note's `parts` say.
pub const SWELL: u32 = 0;
pub const DROP: u32 = 1;
pub const WIND: u32 = 2;
pub const WAVES: u32 = 3;

/// Whether a texture plays the noise.
pub fn uses_noise(kind: u32) -> bool {
    kind != SWELL
}

/// A BiquadFilterNode's frequency before anything sets it.
const CUTOFF_DEFAULT: f32 = 350.0;
/// Where the wind's band sits unless the loop names one.
const WIND_BAND: f32 = 620.0;
/// How far the wind's slow sine moves its band, in Hz.
const WIND_SWING: f32 = 280.0;
const WIND_BREATH: f64 = 0.6;
/// The waves' cutoff, and their level (`WAVES_CUTOFF`, `WAVES_LEVEL`).
const WAVES_CUTOFF: f64 = 650.0;
const WAVES_LEVEL: f64 = 0.67;
/// The waves' two lowpass filters' Q, in dB.
const WAVES_Q: f32 = -3.0;
/// The drop's bandpass Q, and the wind's.
const DROP_Q: f32 = 9.0;
const WIND_Q: f32 = 1.1;
/// How long a filtered voice is kept past its source, for the filter to ring.
const FILTER_TAIL: f64 = 0.2;

pub struct Texture {
    kind: u32,
    /// The swell's sine, or the wind's slow one.
    osc: TableOsc,
    freq: f32,
    src: NoiseSource,
    filter: Biquad,
    /// The waves' second lowpass.
    second: Biquad,
    cutoff: Param,
    band: f32,
    gain: Param,
    start: u64,
    end: u64,
}

impl Texture {
    pub const fn new() -> Self {
        Texture {
            kind: SWELL,
            osc: TableOsc::new(),
            freq: 0.0,
            src: NoiseSource::new(),
            filter: Biquad::new(),
            second: Biquad::new(),
            cutoff: Param::new(0.0),
            band: 0.0,
            gain: Param::new(0.0),
            start: 0,
            end: 0,
        }
    }

    /// `draws` are the voice's: the drop's rate, offset and band; the
    /// wind's slow sine's rate (and the loop's band in Hz, NaN if it names
    /// none); the waves' rate and offset.
    #[allow(clippy::too_many_arguments)]
    pub fn play(
        &mut self,
        kind: u32,
        midi: f64,
        time: f64,
        dur: f64,
        vel: f64,
        draws: [f64; 3],
        noise: usize,
        rate: f64,
    ) {
        self.kind = kind;
        self.filter.reset();
        self.second.reset();
        let g = &mut self.gain;
        match kind {
            SWELL => {
                // One sine, up and down in a line.
                self.freq = midi_to_freq(midi) as f32;
                g.reset(UNITY);
                g.set_value_at_time(0.0001, time);
                g.linear_ramp_to_value_at_time((vel * 0.3) as f32, time + dur * 0.45, time);
                g.linear_ramp_to_value_at_time(0.0001, time + dur, time);
                self.osc.schedule(time, time + dur + 0.2, rate);
                self.start = self.osc.start_frame();
                self.end = self.osc.stop_frame();
            }
            DROP => {
                noise_grain(&mut self.src, time, 0.12, draws[0], draws[1], noise, rate);
                let c = &mut self.cutoff;
                c.reset(CUTOFF_DEFAULT);
                c.set_value_at_time((2400.0 + draws[2] * 3000.0) as f32, time);
                // Its gain holds its first value ahead of the event (item 26b).
                g.reset_at(0.0001, rate);
                g.set_value_at_time(0.0001, time);
                g.exponential_ramp_to_value_at_time((vel * 0.3) as f32, time + 0.004, time);
                g.exponential_ramp_to_value_at_time(0.0001, time + 0.12, time);
                self.start = self.src.start_frame();
                self.end = self.src.end_frame() + frame_at(FILTER_TAIL, rate);
            }
            WIND => {
                let stop = time + dur + 1.0;
                self.src
                    .looped(time, stop, WIND_BREATH, noise, rate);
                self.band = if draws[1].is_finite() {
                    draws[1] as f32
                } else {
                    WIND_BAND
                };
                self.freq = (0.07 + draws[0] * 0.06) as f32;
                self.osc.schedule(time, stop, rate);
                g.reset_at(0.0001, rate);
                g.set_value_at_time(0.0001, time);
                g.linear_ramp_to_value_at_time(
                    (vel * 0.32) as f32,
                    time + (dur * 0.4).max(0.8),
                    time,
                );
                g.set_target_at_time(0.0001, time + dur * 0.75, (dur * 0.2).max(0.4));
                self.start = self.src.start_frame().min(self.osc.start_frame());
                self.end = self.src.end_frame() + frame_at(FILTER_TAIL, rate);
            }
            _ => {
                self.src.looped_at(
                    time,
                    draws[1] * 1.5,
                    time + dur + 0.1,
                    0.5 + draws[0] * 0.1,
                    noise,
                    rate,
                );
                let crest = time + dur * 0.4;
                let c = &mut self.cutoff;
                c.reset(CUTOFF_DEFAULT);
                c.set_value_at_time((WAVES_CUTOFF * 0.7) as f32, time);
                c.linear_ramp_to_value_at_time(WAVES_CUTOFF as f32, crest, time);
                c.linear_ramp_to_value_at_time((WAVES_CUTOFF * 0.7) as f32, time + dur, time);
                g.reset_at(0.0001, rate);
                g.set_value_at_time(0.0001, time);
                g.linear_ramp_to_value_at_time((vel * WAVES_LEVEL) as f32, crest, time);
                g.linear_ramp_to_value_at_time(0.0001, time + dur, time);
                self.start = self.src.start_frame();
                self.end = self.src.end_frame() + frame_at(FILTER_TAIL, rate);
            }
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
        let mut gain = [0.0f32; QUANTUM];
        self.gain.fill(block, rate, &mut gain);
        match self.kind {
            SWELL => {
                let steady = Pitch::Steady {
                    freq: self.freq,
                    detune: 0.0,
                };
                let mut tone = [0.0f32; QUANTUM];
                let (lo, hi) = self.osc.render(block, &waves.sine, &steady, r, &mut tone);
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
            DROP => {
                let mut x = [0.0f32; QUANTUM];
                self.src.render(block, noise, &mut x);
                let mut cutoff = [0.0f32; QUANTUM];
                self.cutoff.fill(block, rate, &mut cutoff);
                for (((y, v), c), g) in out
                    .iter_mut()
                    .zip(x.iter())
                    .zip(cutoff.iter())
                    .zip(gain.iter())
                {
                    self.filter.set(Kind::Bandpass, *c, DROP_Q, 0.0, r);
                    *y += self.filter.step(*v) * *g;
                }
                self.filter.flush();
            }
            WIND => {
                let mut x = [0.0f32; QUANTUM];
                self.src.render(block, noise, &mut x);
                // The band's own value and the slow sine through its gain,
                // summed at every frame as an AudioParam sums its input.
                let steady = Pitch::Steady {
                    freq: self.freq,
                    detune: 0.0,
                };
                let mut slow = [0.0f32; QUANTUM];
                self.osc.render(block, &waves.sine, &steady, r, &mut slow);
                for (((y, v), s), g) in out
                    .iter_mut()
                    .zip(x.iter())
                    .zip(slow.iter())
                    .zip(gain.iter())
                {
                    let band = self.band + *s * WIND_SWING;
                    self.filter.set(Kind::Bandpass, band, WIND_Q, 0.0, r);
                    *y += self.filter.step(*v) * *g;
                }
                self.filter.flush();
            }
            _ => {
                let mut x = [0.0f32; QUANTUM];
                self.src.render(block, noise, &mut x);
                let mut cutoff = [0.0f32; QUANTUM];
                self.cutoff.fill(block, rate, &mut cutoff);
                for (((y, v), c), g) in out
                    .iter_mut()
                    .zip(x.iter())
                    .zip(cutoff.iter())
                    .zip(gain.iter())
                {
                    self.filter.set(Kind::Lowpass, *c, WAVES_Q, 0.0, r);
                    self.second.set(Kind::Lowpass, *c, WAVES_Q, 0.0, r);
                    let once = self.filter.step(*v);
                    *y += self.second.step(once) * *g;
                }
                self.filter.flush();
                self.second.flush();
            }
        }
    }
}

impl Default for Texture {
    fn default() -> Self {
        Self::new()
    }
}
