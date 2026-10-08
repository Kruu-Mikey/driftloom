//! Band-limited wavetables, built the way a Web Audio `PeriodicWave` is in
//! Chromium, so a voice with a custom wave (the fiddle's bowed string) or a
//! built-in one other than the sine (the pad's triangle) nulls against the
//! JavaScript synth.
//!
//! A `PeriodicWave` is not one table but a set of them, one per third of an
//! octave of fundamental frequency, each with the partials that would alias
//! at that pitch cut away. An oscillator reads the two tables either side of
//! its pitch and blends them (`osc::TableOsc`). Chromium's rules, from its
//! source (`periodic_wave_handler.cc`) and checked against its output:
//!
//! - At 24 to 88.2 kHz the tables are 4096 samples long: 2048 partials at
//!   most, and the lowest fundamental is the Nyquist frequency over 2048.
//!   (At 24 kHz and under they are 2048 long; above 88.2 kHz, 16384, which
//!   this core does not build -- it keeps 4096 there, still band-limited.)
//! - There are `0.5 + 3 log2(size)` ranges, 36 at 4096. Range `r` keeps the
//!   partials up to `2048 * 2^(-r/3)`, rounded down, and none above the ones
//!   the wave was given.
//! - Each table is the wave's partials summed (an inverse FFT), and every
//!   table is scaled by one number: whatever brings range 0's peak to 1.
//!
//! The tables are built once, when the core starts, in a fixed array: no
//! allocation.

use core::f64::consts::PI;

/// The longest table this core builds.
pub const SIZE: usize = 4096;
/// The most ranges a wave has.
pub const RANGES: usize = 36;

pub struct Wave {
    size: usize,
    ranges: usize,
    /// The fundamental, in Hz, below which range 0 is read.
    lowest: f32,
    /// Table samples per second per Hz: `size / rate`.
    rate_scale: f32,
    /// Below this fundamental, both tables a pitch picks are copies of range
    /// 0's, so `pick` need not work out which (a sine's are, up to 16 kHz).
    same_below: f32,
    tables: [[f32; SIZE]; RANGES],
}

/// The two tables either side of a pitch, and how far between them.
#[derive(Clone, Copy)]
pub struct Pick {
    pub higher: usize,
    pub lower: usize,
    pub blend: f32,
}

impl Wave {
    /// All zeros, so a static of these costs nothing in the `.wasm`, and
    /// silent until `build`.
    pub const fn new() -> Self {
        Wave {
            size: 0,
            ranges: 0,
            lowest: 0.0,
            rate_scale: 0.0,
            same_below: 0.0,
            tables: [[0.0; SIZE]; RANGES],
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn rate_scale(&self) -> f32 {
        self.rate_scale
    }

    /// Build the tables from the wave's partials: `real[n]` is the cosine
    /// and `imag[n]` the sine of partial `n`, as `createPeriodicWave` takes
    /// them (index 0, DC, is ignored). Normalized, as Web Audio does unless
    /// told not to. `scratch` is a buffer for the FFT.
    pub fn build(&mut self, rate: f32, real: &[f32], imag: &[f32], scratch: &mut Fft) {
        let size = if rate <= 24000.0 { SIZE / 2 } else { SIZE };
        self.size = size;
        // Chromium's own float arithmetic, step for step.
        self.ranges = (0.5 + 3.0 * (size as f32).log2()) as usize;
        self.ranges = self.ranges.min(RANGES);
        let half = size / 2;
        self.lowest = (0.5 * rate) / half as f32;
        self.rate_scale = size as f32 / rate;
        let components = real.len().min(imag.len()).min(half);

        let mut scale = 1.0f32;
        let mut last = usize::MAX;
        self.same_below = f32::INFINITY;
        for r in 0..self.ranges {
            let keep = components.min(partials_for_range(r, half) + 1);
            if r > 0 && keep != last && self.same_below.is_infinite() {
                // The first range that differs from range 0. A pitch picks
                // ranges up to 2 above 1 + 3 log2(f / lowest); keep half a
                // range clear of the edge.
                self.same_below = self.lowest * 2f32.powf((r as f32 - 2.5) / 3.0);
            }
            // The same partials as the range before: the same table. A wave
            // with few partials has many of these (the fiddle's first 16).
            if keep == last {
                if let Some([before, this]) = self.tables.get_mut(r.wrapping_sub(1)..=r) {
                    *this = *before;
                }
                continue;
            }
            last = keep;
            scratch.clear(size);
            for n in 1..keep {
                let (re, im) = (
                    real.get(n).copied().unwrap_or(0.0) as f64,
                    imag.get(n).copied().unwrap_or(0.0) as f64,
                );
                scratch.set(n, re, -im);
            }
            scratch.inverse(size);
            let Some(table) = self.tables.get_mut(r) else {
                break;
            };
            for (t, &x) in table.iter_mut().zip(scratch.real(size)) {
                *t = x as f32;
            }
            if r == 0 {
                let peak = table.iter().take(size).fold(0.0f32, |m, &x| m.max(x.abs()));
                if peak > 0.0 {
                    scale = 1.0 / peak;
                }
            }
            for t in table.iter_mut().take(size) {
                *t *= scale;
            }
        }
    }

    /// Which tables to read for a fundamental of `f` Hz.
    pub fn pick(&self, f: f32) -> Pick {
        let f = f.abs();
        if f < self.same_below {
            // Either table, or any blend of them, is range 0 to the bit.
            return Pick {
                higher: 0,
                lower: 0,
                blend: 0.0,
            };
        }
        let ratio = if f > 0.0 { f / self.lowest } else { 0.5 };
        let cents = ratio.log2() * 1200.0;
        let top = self.ranges.saturating_sub(1);
        let range = (1.0 + cents / (1200.0 / 3.0)).max(0.0).min(top as f32);
        let higher = range as usize;
        let lower = (higher + 1).min(top);
        Pick {
            higher,
            lower,
            blend: range - higher as f32,
        }
    }

    /// The wave at table position `index`, linearly read from each of the
    /// two tables and blended, as Chromium reads one when the step between
    /// samples is a third of a table sample or more (every pitch over about
    /// 3 Hz).
    pub fn read(&self, index: f64, pick: Pick) -> f32 {
        let mask = self.size.wrapping_sub(1);
        let i0 = (index as usize) & mask;
        let i1 = (i0 + 1) & mask;
        let t = index as f32 - i0 as f32;
        let (Some(h), Some(l)) = (self.tables.get(pick.higher), self.tables.get(pick.lower)) else {
            return 0.0;
        };
        let (h0, h1) = (
            h.get(i0).copied().unwrap_or(0.0),
            h.get(i1).copied().unwrap_or(0.0),
        );
        let (l0, l1) = (
            l.get(i0).copied().unwrap_or(0.0),
            l.get(i1).copied().unwrap_or(0.0),
        );
        let high = h0 + t * (h1 - h0);
        let low = l0 + t * (l1 - l0);
        high + pick.blend * (low - high)
    }
}

impl Default for Wave {
    fn default() -> Self {
        Self::new()
    }
}

/// The waves the voices play: Web Audio's sine (a `PeriodicWave` of one
/// partial, read like any other), the folk voices' own waves and the
/// built-in triangle, sawtooth and square.
pub struct Waves {
    pub sine: Wave,
    pub bowed: Wave,
    pub triangle: Wave,
    /// The built-in sawtooth and square.
    pub saw: Wave,
    pub square: Wave,
    /// The leads' own waves (`LEAD_SLOPE` in synth.js): partial n at
    /// 1/n^slope, 64 of them, like `bowed`.
    pub lead_saw: Wave,
    pub lead_moog: Wave,
    pub lead_analog: Wave,
    /// The accordion's `reed` and the nylon guitar's two plucks.
    pub reed: Wave,
    /// The pan flute's `pipe`.
    pub pipe: Wave,
    pub nylon_mellow: Wave,
    pub nylon_bright: Wave,
    /// The sung voices' `glottal` source.
    pub glottal: Wave,
}

/// The lead waves' slopes, and how many partials they have.
const LEAD_SAW_SLOPE: f64 = 1.5;
const LEAD_MOOG_SLOPE: f64 = 1.8;
const LEAD_ANALOG_SLOPE: f64 = 1.7;
const LEAD_PARTIALS: usize = 64;

/// The fiddle's `bowed` wave: partial n at 1/n^2.2, 64 of them
/// (`_makeWave(BOWED_SLOPE)` in synth.js).
const BOWED_SLOPE: f64 = 2.2;
const BOWED_PARTIALS: usize = 64;

/// The accordion's `reed` wave (`_makeWave(REED_SLOPE, REED_EVEN)`): partial
/// n at 1/n^2, the even ones at 0.6 of that, 64 of them.
const REED_SLOPE: f64 = 2.0;
const REED_EVEN: f64 = 0.6;

/// The pan flute's `pipe` wave (`_makeWave(PIPE_SLOPE, 0)`): the odd
/// partials at 1/n^2.5, no even ones, 64 of them.
const PIPE_SLOPE: f64 = 2.5;

/// The nylon guitar's two waves (`_makePluck`): partial n at 1/n^slope times
/// sin(n pi at), the comb of a string plucked a fifth of the way along; 64
/// of them. `NYLON_MELLOW.slope`, `NYLON_BRIGHT.slope`, `NYLON_PLUCK_AT`.
const NYLON_MELLOW_SLOPE: f64 = 2.4;
const NYLON_BRIGHT_SLOPE: f64 = 1.4;
const NYLON_PLUCK_AT: f64 = 0.2;
const FOLK_PARTIALS: usize = 64;

/// The sung voices' `glottal` wave (`_makeGlottal`): every partial at
/// 1/n^2.5, 64 of them.
const GLOTTAL_SLOPE: f64 = 2.5;
const GLOTTAL_PARTIALS: usize = 64;

impl Waves {
    pub const fn new() -> Self {
        Waves {
            sine: Wave::new(),
            bowed: Wave::new(),
            triangle: Wave::new(),
            saw: Wave::new(),
            square: Wave::new(),
            lead_saw: Wave::new(),
            lead_moog: Wave::new(),
            lead_analog: Wave::new(),
            reed: Wave::new(),
            pipe: Wave::new(),
            nylon_mellow: Wave::new(),
            nylon_bright: Wave::new(),
            glottal: Wave::new(),
        }
    }

    pub fn build(&mut self, rate: f32, fft: &mut Fft) {
        // As createPeriodicWave is given them: 32-bit floats.
        let mut real = [0.0f32; SIZE / 2];
        let mut imag = [0.0f32; SIZE / 2];
        imag[1] = 1.0;
        self.sine.build(rate, &real[..2], &imag[..2], fft);
        for (n, im) in imag.iter_mut().enumerate().take(BOWED_PARTIALS + 1).skip(1) {
            *im = (1.0 / (n as f64).powf(BOWED_SLOPE)) as f32;
        }
        self.bowed.build(
            rate,
            &real[..=BOWED_PARTIALS],
            &imag[..=BOWED_PARTIALS],
            fft,
        );
        // The built-in triangle is given every partial a table holds.
        for (n, im) in imag.iter_mut().enumerate() {
            *im = triangle(n);
        }
        real[0] = 0.0;
        self.triangle.build(rate, &real, &imag, fft);
        // And the sawtooth and the square, likewise.
        for (n, im) in imag.iter_mut().enumerate() {
            *im = sawtooth(n);
        }
        self.saw.build(rate, &real, &imag, fft);
        for (n, im) in imag.iter_mut().enumerate() {
            *im = square(n);
        }
        self.square.build(rate, &real, &imag, fft);
        // The leads' waves, as `_makeWave(slope)` gives them.
        for (wave, slope) in [
            (&mut self.lead_saw, LEAD_SAW_SLOPE),
            (&mut self.lead_moog, LEAD_MOOG_SLOPE),
            (&mut self.lead_analog, LEAD_ANALOG_SLOPE),
        ] {
            imag.fill(0.0);
            for (n, im) in imag.iter_mut().enumerate().take(LEAD_PARTIALS + 1).skip(1) {
                *im = (1.0 / (n as f64).powf(slope)) as f32;
            }
            wave.build(rate, &real[..=LEAD_PARTIALS], &imag[..=LEAD_PARTIALS], fft);
        }
        imag.fill(0.0);
        for (n, im) in imag.iter_mut().enumerate().take(FOLK_PARTIALS + 1).skip(1) {
            let even = if n.is_multiple_of(2) { REED_EVEN } else { 1.0 };
            *im = (even / (n as f64).powf(REED_SLOPE)) as f32;
        }
        self.reed
            .build(rate, &real[..=FOLK_PARTIALS], &imag[..=FOLK_PARTIALS], fft);
        for (n, im) in imag.iter_mut().enumerate().take(FOLK_PARTIALS + 1).skip(1) {
            let odd = if n.is_multiple_of(2) { 0.0 } else { 1.0 };
            *im = (odd / (n as f64).powf(PIPE_SLOPE)) as f32;
        }
        self.pipe
            .build(rate, &real[..=FOLK_PARTIALS], &imag[..=FOLK_PARTIALS], fft);
        // `Math.sin(n * Math.PI * at)`, multiplied in that order.
        for (wave, slope) in [
            (&mut self.nylon_mellow, NYLON_MELLOW_SLOPE),
            (&mut self.nylon_bright, NYLON_BRIGHT_SLOPE),
        ] {
            for (n, im) in imag.iter_mut().enumerate().take(FOLK_PARTIALS + 1).skip(1) {
                let k = n as f64;
                *im = ((k * PI * NYLON_PLUCK_AT).sin() / k.powf(slope)) as f32;
            }
            wave.build(rate, &real[..=FOLK_PARTIALS], &imag[..=FOLK_PARTIALS], fft);
        }
        for (n, im) in imag.iter_mut().enumerate().take(GLOTTAL_PARTIALS + 1).skip(1) {
            *im = (1.0 / (n as f64).powf(GLOTTAL_SLOPE)) as f32;
        }
        self.glottal.build(
            rate,
            &real[..=GLOTTAL_PARTIALS],
            &imag[..=GLOTTAL_PARTIALS],
            fft,
        );
    }
}

impl Default for Waves {
    fn default() -> Self {
        Self::new()
    }
}

/// The partials range `r` keeps, out of `half`.
fn partials_for_range(r: usize, half: usize) -> usize {
    let cents = r as f32 * (1200.0 / 3.0);
    let keep = 2f64.powf(-(cents as f64) / 1200.0) as f32;
    (keep * half as f32) as usize
}

/// The partials of Web Audio's built-in triangle, as Chromium writes them:
/// `8 / (pi n)^2`, alternating in sign, odd partials only.
pub fn triangle(n: usize) -> f32 {
    if n.is_multiple_of(2) {
        return 0.0;
    }
    let pi = core::f32::consts::PI;
    let factor = 2.0 / (n as f32 * pi);
    let b = 2.0 * (factor * factor);
    if ((n - 1) >> 1) & 1 == 1 { -b } else { b }
}

/// The partials of Web Audio's built-in sawtooth, as Chromium writes them:
/// `2 / (pi n)`, alternating in sign, so the wave ramps upward.
pub fn sawtooth(n: usize) -> f32 {
    if n == 0 {
        return 0.0;
    }
    let factor = 2.0 / (n as f32 * core::f32::consts::PI);
    if n.is_multiple_of(2) { -factor } else { factor }
}

/// The partials of Web Audio's built-in square: `4 / (pi n)`, odd ones only.
pub fn square(n: usize) -> f32 {
    if n.is_multiple_of(2) {
        return 0.0;
    }
    let factor = 2.0 / (n as f32 * core::f32::consts::PI);
    2.0 * factor
}

/// A complex FFT of up to `SIZE` points, in place, for building tables.
pub struct Fft {
    re: [f64; SIZE],
    im: [f64; SIZE],
    /// e^(2 pi i k / SIZE), for k up to SIZE / 2, once worked out.
    twiddle: [(f64, f64); SIZE / 2],
    ready: bool,
}

impl Fft {
    pub const fn new() -> Self {
        Fft {
            re: [0.0; SIZE],
            im: [0.0; SIZE],
            twiddle: [(0.0, 0.0); SIZE / 2],
            ready: false,
        }
    }

    fn clear(&mut self, n: usize) {
        for (r, i) in self.re.iter_mut().zip(self.im.iter_mut()).take(n) {
            *r = 0.0;
            *i = 0.0;
        }
    }

    fn set(&mut self, k: usize, re: f64, im: f64) {
        if let (Some(r), Some(i)) = (self.re.get_mut(k), self.im.get_mut(k)) {
            *r = re;
            *i = im;
        }
    }

    fn real(&self, n: usize) -> &[f64] {
        self.re.get(..n).unwrap_or(&[])
    }

    /// x[k] = sum over j of X[j] e^(+2 pi i jk / n), for n a power of two
    /// up to `SIZE`.
    fn inverse(&mut self, n: usize) {
        if !self.ready {
            for (k, w) in self.twiddle.iter_mut().enumerate() {
                let a = 2.0 * PI * k as f64 / SIZE as f64;
                *w = (a.cos(), a.sin());
            }
            self.ready = true;
        }
        let n = n.min(SIZE);
        let (Some(re), Some(im)) = (self.re.get_mut(..n), self.im.get_mut(..n)) else {
            return;
        };
        // Bit reversal.
        let mut j = 0;
        for i in 1..n {
            let mut bit = n >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if i < j && j < n {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let half = len / 2;
            let stride = SIZE / len;
            for (rc, ic) in re.chunks_exact_mut(len).zip(im.chunks_exact_mut(len)) {
                let (r0, r1) = rc.split_at_mut(half);
                let (i0, i1) = ic.split_at_mut(half);
                let ups = r0.iter_mut().zip(i0.iter_mut());
                let downs = r1.iter_mut().zip(i1.iter_mut());
                let turns = self.twiddle.iter().step_by(stride);
                for (((ur, ui), (ar, ai)), &(wr, wi)) in ups.zip(downs).zip(turns) {
                    let (vr, vi) = (*ar * wr - *ai * wi, *ar * wi + *ai * wr);
                    let (xr, xi) = (*ur, *ui);
                    *ur = xr + vr;
                    *ui = xi + vi;
                    *ar = xr - vr;
                    *ai = xi - vi;
                }
            }
            len <<= 1;
        }
    }
}

impl Default for Fft {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(real: &[f32], imag: &[f32]) -> Box<Wave> {
        let mut w = Box::new(Wave::new());
        let mut fft = Box::new(Fft::new());
        w.build(44100.0, real, imag, &mut fft);
        w
    }

    #[test]
    fn a_sine_wave_is_a_sine() {
        let w = build(&[0.0, 0.0], &[0.0, 1.0]);
        assert_eq!(w.ranges, 36);
        for k in [0usize, 100, 1024, 3000] {
            let want = (2.0 * PI * k as f64 / 4096.0).sin() as f32;
            assert!((w.tables[0][k] - want).abs() < 1e-6, "k {k}");
            assert!((w.tables[20][k] - want).abs() < 1e-6, "k {k}");
        }
    }

    #[test]
    fn ranges_lose_partials_as_the_pitch_rises() {
        assert_eq!(partials_for_range(0, 2048), 2048);
        assert_eq!(partials_for_range(3, 2048), 1024);
        assert_eq!(partials_for_range(15, 2048), 64);
        assert_eq!(partials_for_range(35, 2048), 0);
    }

    #[test]
    fn a_wave_is_normalized_to_its_fullest_table() {
        let imag: Vec<f32> = (0..65)
            .map(|n| {
                if n == 0 {
                    0.0
                } else {
                    1.0 / (n as f32).powf(2.2)
                }
            })
            .collect();
        let real = vec![0.0; 65];
        let w = build(&real, &imag);
        let peak = w.tables[0].iter().fold(0.0f32, |m, &x| m.max(x.abs()));
        assert!((peak - 1.0).abs() < 1e-6);
        // Range 30 keeps 2 partials, on the same scale as range 0.
        let partial = |r: usize, n: usize| -> f64 {
            let t = &w.tables[r];
            t.iter()
                .enumerate()
                .map(|(k, &x)| x as f64 * (2.0 * PI * (n * k) as f64 / 4096.0).sin())
                .sum::<f64>()
                / 2048.0
        };
        for n in 1..=2 {
            assert!((partial(30, n) - partial(0, n)).abs() < 1e-5, "partial {n}");
        }
        assert!(partial(30, 3).abs() < 1e-6);
        assert!(partial(0, 3) > 0.01);
    }

    #[test]
    fn a_pick_below_the_first_change_reads_the_same_as_any_other() {
        let w = build(&[0.0, 0.0], &[0.0, 1.0]);
        assert!(
            w.same_below > 15000.0 && w.same_below < 22050.0,
            "{}",
            w.same_below
        );
        let mut every = Box::new(Wave::new());
        every.lowest = w.lowest;
        every.ranges = w.ranges;
        for f in [30.0f32, 440.0, 5000.0, 12000.0] {
            for index in [0.0, 17.25, 2047.9, 4095.5] {
                assert_eq!(
                    w.read(index, w.pick(f)),
                    w.read(index, every.pick(f)),
                    "{f} {index}"
                );
            }
        }
    }

    #[test]
    fn picks_the_tables_either_side_of_a_pitch() {
        let mut w = build(&[0.0, 0.0], &[0.0, 1.0]);
        w.same_below = 0.0;
        let p = w.pick(220.0);
        assert_eq!((p.higher, p.lower), (14, 15));
        assert!((p.blend - 0.0586).abs() < 1e-3);
    }
}
