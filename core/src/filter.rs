//! A biquad filter that filters the way a Web Audio `BiquadFilterNode` does
//! in Chromium (`biquad.cc`): the Audio EQ Cookbook's coefficients worked
//! out in 64-bit floats from the node's 32-bit parameters, run in 64-bit
//! floats, with each output rounded to a 32-bit float before it is fed
//! back. A lowpass's and a highpass's Q is in dB, as Web Audio has them; a
//! bandpass's is linear.
//!
//! When a parameter moves, Chromium works the coefficients out again for
//! every sample; `set` caches the last ones, so a filter whose parameters
//! hold still costs a comparison a sample.

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Lowpass,
    Highpass,
    Bandpass,
    Peaking,
}

#[derive(Clone, Copy)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
    /// The parameters the coefficients were last worked out for, once
    /// there are any (`set` has been called).
    last: (f32, f32, f32),
    ready: bool,
}

impl Biquad {
    pub const fn new() -> Self {
        Biquad {
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            last: (0.0, 0.0, 0.0),
            ready: false,
        }
    }

    /// Silence, and no coefficients yet. All zeros, like `new`, so a pool
    /// of filters costs nothing in the `.wasm`.
    pub fn reset(&mut self) {
        *self = Biquad::new();
    }

    /// Work out the coefficients for `kind` at `freq` Hz, `q` and `gain` dB,
    /// unless they are what they were.
    pub fn set(&mut self, kind: Kind, freq: f32, q: f32, gain: f32, rate: f32) {
        if self.ready && self.last == (freq, q, gain) {
            return;
        }
        self.last = (freq, q, gain);
        self.ready = true;
        let nyquist = rate as f64 / 2.0;
        let w = (freq as f64 / nyquist).clamp(0.0, 1.0);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            Kind::Lowpass => {
                if w >= 1.0 {
                    (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                } else if w > 0.0 {
                    let resonance = 10f64.powf(q as f64 / 20.0);
                    let theta = core::f64::consts::PI * w;
                    let alpha = theta.sin() / (2.0 * resonance);
                    let cosw = theta.cos();
                    let beta = (1.0 - cosw) / 2.0;
                    (
                        beta,
                        2.0 * beta,
                        beta,
                        1.0 + alpha,
                        -2.0 * cosw,
                        1.0 - alpha,
                    )
                } else {
                    (0.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                }
            }
            Kind::Highpass => {
                if w >= 1.0 {
                    // The z-transform is 0.
                    (0.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                } else if w > 0.0 {
                    let resonance = 10f64.powf(q as f64 / 20.0);
                    let theta = core::f64::consts::PI * w;
                    let alpha = theta.sin() / (2.0 * resonance);
                    let cosw = theta.cos();
                    let beta = (1.0 + cosw) / 2.0;
                    (
                        beta,
                        -2.0 * beta,
                        beta,
                        1.0 + alpha,
                        -2.0 * cosw,
                        1.0 - alpha,
                    )
                } else {
                    // At zero the poles and zeros meet: the z-transform is 1.
                    (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                }
            }
            Kind::Bandpass => {
                let q = (q as f64).max(0.0);
                if w > 0.0 && w < 1.0 {
                    if q > 0.0 {
                        let w0 = core::f64::consts::PI * w;
                        let alpha = w0.sin() / (2.0 * q);
                        let k = w0.cos();
                        (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * k, 1.0 - alpha)
                    } else {
                        // The limit as Q goes to 0 is 1.
                        (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                    }
                } else {
                    // At 0 and at the Nyquist frequency it passes nothing.
                    (0.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                }
            }
            Kind::Peaking => {
                let q = (q as f64).max(0.0);
                let a = 10f64.powf(gain as f64 / 40.0);
                if w > 0.0 && w < 1.0 {
                    if q > 0.0 {
                        let w0 = core::f64::consts::PI * w;
                        let alpha = w0.sin() / (2.0 * q);
                        let k = w0.cos();
                        (
                            1.0 + alpha * a,
                            -2.0 * k,
                            1.0 - alpha * a,
                            1.0 + alpha / a,
                            -2.0 * k,
                            1.0 - alpha / a,
                        )
                    } else {
                        (a * a, 0.0, 0.0, 1.0, 0.0, 0.0)
                    }
                } else {
                    (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                }
            }
        };
        let inv = 1.0 / a0;
        self.b0 = b0 * inv;
        self.b1 = b1 * inv;
        self.b2 = b2 * inv;
        self.a1 = a1 * inv;
        self.a2 = a2 * inv;
    }

    pub fn step(&mut self, x: f32) -> f32 {
        let x = x as f64;
        let y = (self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2) as f32;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y as f64;
        y
    }

    /// Whether the filter is still: nothing in its memory, so zeros in give
    /// zeros out.
    pub fn at_rest(&self) -> bool {
        self.x1 == 0.0 && self.x2 == 0.0 && self.y1 == 0.0 && self.y2 == 0.0
    }

    /// At the end of every block, as Chromium does: state too small for a
    /// 32-bit float goes to zero.
    pub fn flush(&mut self) {
        for v in [&mut self.x1, &mut self.x2, &mut self.y1, &mut self.y2] {
            if v.abs() < f32::MIN_POSITIVE as f64 {
                *v = 0.0;
            }
        }
    }
}

impl Default for Biquad {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lowpass_passes_dc_and_stops_the_top() {
        let mut f = Biquad::new();
        f.set(Kind::Lowpass, 1000.0, -3.0, 0.0, 44100.0);
        let mut y = 0.0;
        for _ in 0..10000 {
            y = f.step(1.0);
        }
        assert!((y - 1.0).abs() < 1e-4);
        let mut g = Biquad::new();
        g.set(Kind::Lowpass, 1000.0, -3.0, 0.0, 44100.0);
        let mut peak = 0.0f32;
        for k in 0..10000 {
            let y = g.step(if k % 2 == 0 { 1.0 } else { -1.0 });
            if k > 1000 {
                peak = peak.max(y.abs());
            }
        }
        assert!(peak < 1e-3);
    }

    #[test]
    fn a_peaking_filter_lifts_its_band_by_its_gain() {
        let rate = 44100.0f32;
        let mut f = Biquad::new();
        f.set(Kind::Peaking, 1000.0, 1.0, 6.0, rate);
        let mut peak = 0.0f32;
        for k in 0..44100 {
            let x = (2.0 * core::f64::consts::PI * 1000.0 * k as f64 / rate as f64).sin() as f32;
            let y = f.step(x);
            if k > 22050 {
                peak = peak.max(y.abs());
            }
        }
        assert!((20.0 * peak.log10() - 6.0).abs() < 0.05, "{peak}");
    }
}
