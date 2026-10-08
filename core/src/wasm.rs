//! The WebAssembly face of the core, for `js/worklet.js`. One core per
//! instance: the worklet compiles one instance per AudioWorkletNode.
//!
//! Plain numbers in and out, nothing else -- no imports, no strings, no
//! allocator. A block's samples are read straight out of linear memory at
//! the address `dl_process` returns: `CHANNELS` runs of `QUANTUM` floats,
//! one channel after the other.

use core::cell::UnsafeCell;

use crate::{Core, Taken};

struct Global(UnsafeCell<Core>);

// WebAssembly here runs on one thread: the audio thread that owns the
// worklet. Nothing else can reach the core.
unsafe impl Sync for Global {}

static CORE: Global = Global(UnsafeCell::new(Core::new()));

fn core() -> &'static mut Core {
    // SAFETY: single-threaded (above), and no export holds the reference
    // past its own return.
    unsafe { &mut *CORE.0.get() }
}

/// Set the sample rate and clear everything.
#[unsafe(no_mangle)]
pub extern "C" fn dl_init(rate: f64) {
    core().init(rate);
}

/// A note; see `Core::note`. `a` to `l` are its `EXTRA` values. Returns a
/// `Taken`, as a number.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn dl_note(
    voice: u32,
    channel: u32,
    time: f64,
    midi: f64,
    dur: f64,
    vel: f64,
    parts: u32,
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
    g: f64,
    h: f64,
    i: f64,
    j: f64,
    k: f64,
    l: f64,
) -> u32 {
    core().note(
        voice,
        channel,
        time,
        midi,
        dur,
        vel,
        parts,
        [a, b, c, d, e, f, g, h, i, j, k, l],
    ) as u32
}

/// Room for the draws of the sung note that comes next; see
/// `Core::sung_draws`. Returns where to write them, or 0 if a note cannot
/// have that many.
#[unsafe(no_mangle)]
pub extern "C" fn dl_sung_draws(len: u32) -> *mut f64 {
    let space = core().sung_draws(len as usize);
    if space.is_empty() {
        core::ptr::null_mut()
    } else {
        space.as_mut_ptr()
    }
}

/// A new strum into `channel` at `time`; see `Core::damp`.
#[unsafe(no_mangle)]
pub extern "C" fn dl_damp(channel: u32, time: f64) {
    core().damp(channel, time);
}

/// Room for `len` samples of the host's noise; see `Core::noise`. Returns
/// where to write them, or 0 if the core cannot hold that many.
#[unsafe(no_mangle)]
pub extern "C" fn dl_noise(len: u32) -> *mut f32 {
    let space = core().noise(len as usize);
    if space.is_empty() {
        core::ptr::null_mut()
    } else {
        space.as_mut_ptr()
    }
}

/// Render the block that starts at frame `block` and return where its
/// samples are.
#[unsafe(no_mangle)]
pub extern "C" fn dl_process(block: f64) -> *const f32 {
    let frame = if block > 0.0 { block as u64 } else { 0 };
    core().process(frame).as_ptr().cast()
}

/// Let every voice go.
#[unsafe(no_mangle)]
pub extern "C" fn dl_clear() {
    core().clear();
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_late() -> u32 {
    core().late()
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_dropped() -> u32 {
    core().dropped()
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_busy() -> u32 {
    core().busy() as u32
}

// Kept in step with `Taken`; the worklet reads these numbers.
const _: () = assert!(Taken::Late as u32 == 1 && Taken::Full as u32 == 2);
