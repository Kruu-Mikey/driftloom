//! The noise every breath, strike and drum plays, and a source that plays
//! it the way Chromium plays an `AudioBufferSourceNode`.
//!
//! The noise is not the core's to make: synth.js fills a two-second buffer
//! from `Math.random` as each Synth is built (`_makeNoise`), so JavaScript
//! hands its samples over once (`Core::noise`), and every note reads them.
//!
//! The source is Chromium's (`audio_buffer_source_handler.cc`, version 141,
//! the one the measure harness runs), checked against it sample for sample
//! on grains, loops, sub-frame starts and offsets:
//!
//! - It starts on the first frame at or after its start time, and if the
//!   start fell between frames it first skips ahead by the fraction it
//!   missed, at its rate. Its stop is the first frame at or after the stop
//!   time. Both times go through Chromium's `TimeToSampleFrame`, which
//!   rounds the time to 1/1024 of a frame first, so a time a hair past a
//!   frame is that frame.
//! - It reads from a whole frame: the offset, in frames, rounded to the
//!   nearest. (Newer Chromium keeps the fraction.)
//! - It moves by its playback rate, a 32-bit float, each frame, and reads
//!   between two samples by linear interpolation in 64-bit floats. A grain
//!   (`start(when, offset, duration)`) ends when the read position reaches
//!   the offset plus the duration in buffer frames, rounded to the nearest;
//!   a loop wraps around the whole buffer, keeping the fraction.

use crate::QUANTUM;
use crate::osc::{frame_at, frames};

/// The longest noise the core holds: two seconds at 96 kHz. A context
/// faster than that keeps its noise voices in JavaScript.
pub const NOISE_MAX: usize = 192_000;

pub struct Noise {
    samples: [f32; NOISE_MAX],
    len: usize,
}

impl Noise {
    pub const fn new() -> Self {
        Noise {
            samples: [0.0; NOISE_MAX],
            len: 0,
        }
    }

    /// Room for `len` samples, to be written through `space`. False, and
    /// no noise, when it is longer than the core holds.
    pub fn resize(&mut self, len: usize) -> bool {
        if len > NOISE_MAX {
            self.len = 0;
            return false;
        }
        self.len = len;
        true
    }

    pub fn space(&mut self) -> &mut [f32] {
        let len = self.len;
        self.samples.get_mut(..len).unwrap_or(&mut [])
    }

    pub fn samples(&self) -> &[f32] {
        self.samples.get(..self.len).unwrap_or(&[])
    }

    /// Whether there is any: a voice that needs it plays in JavaScript
    /// otherwise.
    pub fn ready(&self) -> bool {
        self.len > 1
    }

    /// The buffer's length in seconds, as `AudioBuffer.duration` gives it.
    pub fn duration(&self, rate: f64) -> f64 {
        self.len as f64 / rate
    }
}

impl Default for Noise {
    fn default() -> Self {
        Self::new()
    }
}

/// A source playing the noise.
#[derive(Clone, Copy)]
pub struct NoiseSource {
    start: u64,
    stop: u64,
    /// Where it reads, in buffer frames.
    index: f64,
    /// Buffer frames a frame.
    step: f64,
    /// Where a grain ends, or the buffer's length for a loop.
    end: f64,
    looped: bool,
    done: bool,
}

impl NoiseSource {
    pub const fn new() -> Self {
        NoiseSource {
            start: 0,
            stop: 0,
            index: 0.0,
            step: 0.0,
            end: 0.0,
            looped: false,
            done: true,
        }
    }

    /// `src.playbackRate.value = playback; src.start(when, offset, duration)`.
    #[allow(clippy::too_many_arguments)]
    pub fn grain(
        &mut self,
        when: f64,
        offset: f64,
        duration: f64,
        playback: f64,
        len: usize,
        rate: f64,
    ) {
        let buffer = len as f64 / rate;
        let offset = offset.max(0.0).min(buffer);
        let end = frames(offset + duration.max(0.0), rate).round();
        self.begin(when, frames(offset, rate).round(), playback, rate);
        self.end = end.min(len as f64);
        self.looped = false;
        self.stop = u64::MAX;
    }

    /// `src.loop = true; src.playbackRate.value = playback; src.start(when);
    /// src.stop(stop)`.
    pub fn looped(&mut self, when: f64, stop: f64, playback: f64, len: usize, rate: f64) {
        self.looped_at(when, 0.0, stop, playback, len, rate);
    }

    /// The same, from `offset` seconds in: `src.start(when, offset)`.
    #[allow(clippy::too_many_arguments)]
    pub fn looped_at(
        &mut self,
        when: f64,
        offset: f64,
        stop: f64,
        playback: f64,
        len: usize,
        rate: f64,
    ) {
        let buffer = len as f64 / rate;
        let offset = offset.max(0.0).min(buffer);
        self.begin(when, frames(offset, rate).round(), playback, rate);
        self.end = len as f64;
        self.looped = true;
        self.stop = frame_at(stop, rate);
    }

    fn begin(&mut self, when: f64, index: f64, playback: f64, rate: f64) {
        self.start = frame_at(when, rate);
        // A k-rate AudioParam: a 32-bit float.
        self.step = playback as f32 as f64;
        self.index = index;
        // The fraction of a frame the start fell before its first frame.
        let missed = when * rate - self.start as f64;
        if missed < 0.0 {
            self.index += (missed * self.step).abs();
        }
        self.done = false;
    }

    /// The same as `new`, but all zeros, for a pool that must cost nothing
    /// in the `.wasm`: with no stop it plays nothing until `grain` or
    /// `looped`.
    pub const fn idle() -> Self {
        NoiseSource {
            done: false,
            ..NoiseSource::new()
        }
    }

    pub fn start_frame(&self) -> u64 {
        self.start
    }

    /// The frame it has certainly finished by: its stop, or for a grain
    /// the frame its read position reaches the grain's end.
    pub fn end_frame(&self) -> u64 {
        if self.looped {
            return self.stop;
        }
        let left = (self.end - self.index).max(0.0);
        let frames = if self.step > 0.0 {
            (left / self.step).ceil() as u64
        } else {
            0
        };
        self.start + frames + 1
    }

    /// Render the block from frame `block` into `out`, every sample
    /// written, zero where it does not play. Returns the range it played
    /// in.
    pub fn render(
        &mut self,
        block: u64,
        noise: &[f32],
        out: &mut [f32; QUANTUM],
    ) -> (usize, usize) {
        out.fill(0.0);
        let end = block + QUANTUM as u64;
        let lo = self.start.max(block);
        let hi = self.stop.min(end);
        if self.done || lo >= hi {
            return (0, 0);
        }
        let len = noise.len();
        let size = len as f64;
        if len < 2 || self.step <= 0.0 {
            self.done = true;
            return (0, 0);
        }
        let (lo, hi) = ((lo - block) as usize, (hi - block) as usize);
        let mut last = lo;
        for y in out.iter_mut().take(hi).skip(lo) {
            if !self.looped && self.index >= self.end {
                self.done = true;
                break;
            }
            let at = self.index.floor();
            let fraction = self.index - at;
            let i = (at as usize).min(len - 1);
            let mut j = i + 1;
            if j >= len {
                j = if self.looped {
                    ((self.index + 1.0 - size).floor().max(0.0) as usize).min(len - 1)
                } else {
                    i
                };
            }
            let (a, b) = (
                noise.get(i).copied().unwrap_or(0.0) as f64,
                noise.get(j).copied().unwrap_or(0.0) as f64,
            );
            let sample = if i == j && i >= 1 {
                // The end of the buffer: on from the last two samples.
                let before = noise.get(i - 1).copied().unwrap_or(0.0) as f64;
                a + (a - before) * fraction
            } else {
                (1.0 - fraction) * a + fraction * b
            };
            *y = sample as f32;
            last += 1;
            self.index += self.step;
            if self.index >= self.end {
                if self.looped {
                    self.index -= size;
                } else {
                    self.done = true;
                    break;
                }
            }
        }
        (lo, last)
    }
}

impl Default for NoiseSource {
    fn default() -> Self {
        Self::new()
    }
}
