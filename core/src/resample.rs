//! The 2x up- and downsamplers a `WaveShaperNode` runs around its curve
//! when `oversample` is '2x', as Chromium builds them (`up_sampler.cc`,
//! `down_sampler.cc`, Chromium 141): windowed-sinc half-band filters with
//! a Blackman window, worked out in 64-bit floats and kept as 32-bit ones.
//!
//! - **Up**: every even output sample is an input sample delayed by half
//!   the kernel (64 frames); every odd one is the input convolved with a
//!   128-tap sinc offset by half a sample. Chromium convolves directly, four
//!   outputs at a time, each a running 32-bit sum over the taps in order --
//!   which this does tap for tap, so the sums are the same to the bit.
//! - **Down**: a 256-tap half-band filter, of which only the odd taps and
//!   the centre (0.5) are not zero. The odd taps, 128 of them, are
//!   convolved with the odd input samples; the centre adds half the input
//!   delayed by 128 frames. Chromium does that convolution by FFT
//!   (`SimpleFFTConvolver`: a 256-point transform of the block padded with
//!   zeros, times the kernel's, back, and the second half kept to overlap
//!   the next block), and so does this, in 32-bit floats as Chromium's FFT
//!   runs. Its FFT is another library's (PFFFT), so the last bits differ:
//!   about one part in ten million.
//!
//! The pair delays the signal by 128 frames at the original rate, 64 for
//! each (the node's reported latency); Web Audio does not compensate for
//! it, and neither does this.

use crate::QUANTUM;

/// Taps of the upsampler's kernel, and of the downsampler's before it is
/// halved to its odd terms.
pub const UP_TAPS: usize = 128;
pub const DOWN_TAPS: usize = 256;
const DOWN_ODD: usize = DOWN_TAPS / 2;

// The Blackman window's parameters.
const ALPHA: f64 = 0.16;

fn blackman(x: f64) -> f64 {
    let (a0, a1, a2) = (0.5 * (1.0 - ALPHA), 0.5, 0.5 * ALPHA);
    let two_pi = 2.0 * core::f64::consts::PI;
    a0 - a1 * (two_pi * x).cos() + a2 * (two_pi * 2.0 * x).cos()
}

pub struct Up {
    kernel: [f32; UP_TAPS],
    /// The last block in, then this one: the convolution reaches back.
    input: [f32; 2 * QUANTUM],
}

impl Up {
    pub const fn new() -> Self {
        Up {
            kernel: [0.0; UP_TAPS],
            input: [0.0; 2 * QUANTUM],
        }
    }

    /// `MakeKernel`: a sinc offset by half a sample, windowed.
    pub fn init(&mut self) {
        let n = UP_TAPS as i64;
        let half = n / 2;
        let offset = -0.5;
        for (i, k) in self.kernel.iter_mut().enumerate() {
            let i = i as f64;
            let s = core::f64::consts::PI * (i - half as f64 - offset);
            let sinc = if s == 0.0 { 1.0 } else { s.sin() / s };
            let x = (i - offset) / n as f64;
            *k = (sinc * blackman(x)) as f32;
        }
        self.input = [0.0; 2 * QUANTUM];
    }

    /// One block in, two out, interleaved.
    pub fn process(&mut self, source: &[f32; QUANTUM], dest: &mut [f32; 2 * QUANTUM]) {
        if let Some(new) = self.input.get_mut(QUANTUM..) {
            new.copy_from_slice(source);
        }
        let half = UP_TAPS / 2;
        for i in 0..QUANTUM {
            // The even frames: the input, half a kernel late.
            let even = self.input.get(QUANTUM + i - half).copied().unwrap_or(0.0);
            // The odd ones: sum over the taps, oldest input first, as
            // Chromium's `Conv` runs it.
            let mut sum = 0.0f32;
            for m in 0..UP_TAPS {
                let x = self
                    .input
                    .get(QUANTUM + i + 1 + m - UP_TAPS)
                    .copied()
                    .unwrap_or(0.0);
                let h = self.kernel.get(UP_TAPS - 1 - m).copied().unwrap_or(0.0);
                sum += h * x;
            }
            if let Some(pair) = dest.get_mut(2 * i..2 * i + 2) {
                pair[0] = even;
                pair[1] = sum;
            }
        }
        self.input.copy_within(QUANTUM.., 0);
    }
}

/// Points of the downsampler's transform: a block of the odd samples,
/// padded with as many zeros.
const FFT: usize = 2 * QUANTUM;
const FFT_BITS: u32 = FFT.trailing_zeros();

/// A 256-point complex FFT in 32-bit floats: radix 2, in place, its twiddles
/// worked out once in 64 bits.
struct Fft {
    cos: [f32; FFT / 2],
    sin: [f32; FFT / 2],
}

impl Fft {
    const fn new() -> Self {
        Fft {
            cos: [0.0; FFT / 2],
            sin: [0.0; FFT / 2],
        }
    }

    fn init(&mut self) {
        for (k, (c, s)) in self.cos.iter_mut().zip(self.sin.iter_mut()).enumerate() {
            let a = -2.0 * core::f64::consts::PI * k as f64 / FFT as f64;
            *c = a.cos() as f32;
            *s = a.sin() as f32;
        }
    }

    /// Forward (e^-i) or, with `inverse`, backward (e^+i, unscaled).
    fn run(&self, re: &mut [f32; FFT], im: &mut [f32; FFT], inverse: bool) {
        for i in 0..FFT {
            let j = (i as u32).reverse_bits() >> (32 - FFT_BITS);
            let j = j as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let sign = if inverse { -1.0 } else { 1.0 };
        let mut len = 2;
        while len <= FFT {
            let half = len / 2;
            let stride = FFT / len;
            let mut start = 0;
            while start < FFT {
                for k in 0..half {
                    let (Some(&wr), Some(&wi)) = (self.cos.get(k * stride), self.sin.get(k * stride)) else {
                        continue;
                    };
                    let wi = sign * wi;
                    let (a, b) = (start + k, start + k + half);
                    let (Some(&br), Some(&bi), Some(&ar), Some(&ai)) = (re.get(b), im.get(b), re.get(a), im.get(a)) else {
                        continue;
                    };
                    let tr = br * wr - bi * wi;
                    let ti = br * wi + bi * wr;
                    if let (Some(x), Some(y)) = (re.get_mut(b), im.get_mut(b)) {
                        *x = ar - tr;
                        *y = ai - ti;
                    }
                    if let (Some(x), Some(y)) = (re.get_mut(a), im.get_mut(a)) {
                        *x = ar + tr;
                        *y = ai + ti;
                    }
                }
                start += len;
            }
            len *= 2;
        }
    }
}

pub struct Down {
    /// The kernel's transform: its odd taps (`MakeReducedKernel`), padded
    /// with zeros to the transform's length (`DoPaddedFFT`).
    kernel_re: [f32; FFT],
    kernel_im: [f32; FFT],
    fft: Fft,
    /// The last block in at the high rate, then this one.
    input: [f32; 4 * QUANTUM],
    /// The second half of the last block's convolution, to add to this
    /// one's first.
    overlap: [f32; QUANTUM],
}

impl Down {
    pub const fn new() -> Self {
        Down {
            kernel_re: [0.0; FFT],
            kernel_im: [0.0; FFT],
            fft: Fft::new(),
            input: [0.0; 4 * QUANTUM],
            overlap: [0.0; QUANTUM],
        }
    }

    pub fn init(&mut self) {
        let n = DOWN_TAPS as i64;
        let half = n / 2;
        let scale = 0.5;
        let mut kernel = [0.0f32; DOWN_ODD];
        for i in (1..n).step_by(2) {
            let s = scale * core::f64::consts::PI * (i - half) as f64;
            let mut sinc = if s == 0.0 { 1.0 } else { s.sin() / s };
            sinc *= scale;
            let x = i as f64 / n as f64;
            if let Some(k) = kernel.get_mut(((i - 1) / 2) as usize) {
                *k = (sinc * blackman(x)) as f32;
            }
        }
        self.fft.init();
        self.kernel_re = [0.0; FFT];
        self.kernel_im = [0.0; FFT];
        if let Some(head) = self.kernel_re.get_mut(..DOWN_ODD) {
            head.copy_from_slice(&kernel);
        }
        self.fft.run(&mut self.kernel_re, &mut self.kernel_im, false);
        self.input = [0.0; 4 * QUANTUM];
        self.overlap = [0.0; QUANTUM];
    }

    /// Two blocks in, interleaved, one out.
    pub fn process(&mut self, source: &[f32; 2 * QUANTUM], dest: &mut [f32; QUANTUM]) {
        // The input buffer holds the last block (2 * QUANTUM at the high
        // rate) and this one after it.
        let at = 2 * QUANTUM;
        if let Some(new) = self.input.get_mut(at..) {
            new.copy_from_slice(source);
        }
        // This block's odd samples, each a sample late (the one before each
        // even frame), then as many zeros.
        let mut re = [0.0f32; FFT];
        let mut im = [0.0f32; FFT];
        for (i, x) in re.iter_mut().take(QUANTUM).enumerate() {
            *x = self.input.get(at + 2 * i - 1).copied().unwrap_or(0.0);
        }
        self.fft.run(&mut re, &mut im, false);
        for k in 0..FFT {
            let (Some(&hr), Some(&hi)) = (self.kernel_re.get(k), self.kernel_im.get(k)) else {
                continue;
            };
            if let (Some(xr), Some(xi)) = (re.get_mut(k), im.get_mut(k)) {
                let (a, b) = (*xr, *xi);
                *xr = a * hr - b * hi;
                *xi = a * hi + b * hr;
            }
        }
        self.fft.run(&mut re, &mut im, true);
        let scale = 1.0 / FFT as f32;
        let half = DOWN_TAPS / 2;
        for (i, y) in dest.iter_mut().enumerate() {
            let conv = re.get(i).copied().unwrap_or(0.0) * scale;
            let sum = conv + self.overlap.get(i).copied().unwrap_or(0.0);
            let centre = self.input.get(at + 2 * i - half).copied().unwrap_or(0.0);
            // Chromium adds the centre in 64 bits to its 32-bit sum.
            *y = (sum as f64 + 0.5 * centre as f64) as f32;
        }
        for (i, o) in self.overlap.iter_mut().enumerate() {
            *o = re.get(QUANTUM + i).copied().unwrap_or(0.0) * scale;
        }
        self.input.copy_within(at.., 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn up_then_down_passes_a_low_sine_through_a_hundred_and_twenty_eight_frames_late() {
        let mut up = Up::new();
        let mut down = Down::new();
        up.init();
        down.init();
        let f = 440.0 / 44100.0;
        let x = |n: usize| (2.0 * core::f64::consts::PI * f * n as f64).sin() as f32;
        let mut worst = 0.0f32;
        for b in 0..20 {
            let source: [f32; QUANTUM] = core::array::from_fn(|i| x(b * QUANTUM + i));
            let mut high = [0.0f32; 2 * QUANTUM];
            let mut out = [0.0f32; QUANTUM];
            up.process(&source, &mut high);
            down.process(&high, &mut out);
            if b > 4 {
                for (i, &y) in out.iter().enumerate() {
                    worst = worst.max((y - x(b * QUANTUM + i - 128)).abs());
                }
            }
        }
        assert!(worst < 1e-3, "{worst}");
    }
}

#[cfg(test)]
mod against_direct {
    use super::*;

    #[test]
    fn the_transform_convolves_as_a_direct_sum_does() {
        let mut down = Down::new();
        down.init();
        // The kernel, as `init` makes it, and the odd samples' history.
        let n = DOWN_TAPS as i64;
        let kernel: Vec<f64> = (1..n)
            .step_by(2)
            .map(|i| {
                let s = 0.5 * core::f64::consts::PI * (i - n / 2) as f64;
                let sinc = if s == 0.0 { 1.0 } else { s.sin() / s } * 0.5;
                (sinc * blackman(i as f64 / n as f64)) as f32 as f64
            })
            .collect();
        let mut seed = 7u64;
        let mut high = vec![0.0f32; 2 * QUANTUM];
        let mut odd = Vec::new();
        let mut prev_last = 0.0f32;
        let mut worst = 0.0f64;
        let mut all_in = Vec::new();
        for _ in 0..30 {
            for x in high.iter_mut() {
                seed = seed * 6364136223846793005 + 1442695040888963407;
                *x = ((seed >> 40) as f32 / (1u64 << 24) as f32) - 0.5;
            }
            all_in.extend_from_slice(&high);
            let mut out = [0.0f32; QUANTUM];
            let block: [f32; 2 * QUANTUM] = core::array::from_fn(|i| high[i]);
            down.process(&block, &mut out);
            for i in 0..QUANTUM {
                odd.push(if i == 0 { prev_last } else { high[2 * i - 1] });
            }
            prev_last = high[2 * QUANTUM - 1];
            let base = odd.len() - QUANTUM;
            for i in 0..QUANTUM {
                let mut sum = 0.0f64;
                for (k, &h) in kernel.iter().enumerate() {
                    if base + i >= k {
                        sum += h * odd[base + i - k] as f64;
                    }
                }
                let at = all_in.len() - 2 * QUANTUM + 2 * i;
                let centre = if at >= 128 { all_in[at - 128] as f64 } else { 0.0 };
                worst = worst.max((sum + 0.5 * centre - out[i] as f64).abs());
            }
        }
        assert!(worst < 2e-6, "{worst}");
    }
}
