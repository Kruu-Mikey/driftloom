//! A long-lived `AudioParam`, as Chromium renders one
//! (`audio_param_handler.cc`, Chromium 141), for the mix (`mix`).
//!
//! A voice's parameters live for one note and take a handful of events
//! scheduled with it, and `param::Param` follows the spec's curves closely
//! enough for those to null. The mix's parameters live as long as the synth
//! and take events for as long: a duck on every kick, `setTone` on every
//! loop, a mute, a fade of the tails. Chromium renders those through its
//! timeline, and the details the spec leaves open show in the output:
//!
//! - **32-bit steps.** A target curve is stepped from frame to frame in
//!   32-bit floats, four frames at a time with constants worked out for the
//!   four (the x86 build's loop), and a linear ramp likewise. Over a
//!   transition of thousands of frames that drifts from the closed form by
//!   far more than a float's last bit -- about a hundredth of a frame on the
//!   echo's delay time, which a delay line hears.
//! - **Convergence.** A target curve ends: ten time constants after it
//!   starts, or once it is within a hair of its target, Chromium writes the
//!   target itself, and drops the event once it is in the past.
//! - **Events in the past.** An event added with a time already rendered is
//!   moved to the start of the next block rendered
//!   (`ClampNewEventsToCurrentTime`), and every call's time is first raised
//!   to the host's current time, as the main thread's is.
//! - **Old events go.** Events behind the one in force are dropped as the
//!   timeline passes them, so a parameter keeps only what is still to come.
//!
//! Only the calls the mix makes are here: `setValueAtTime`,
//! `linearRampToValueAtTime`, `setTargetAtTime` and
//! `cancelScheduledValues`. The value of each frame is what Chromium's x86
//! build renders, in its order of operations and its precisions.
//!
//! A timeline holds a fixed number of events and never allocates; one
//! added past that is dropped, and the call returns false.

use crate::QUANTUM;

/// `exp(-10)`: within this of its target, a target curve has arrived
/// (`kSetTargetThreshold`).
const SET_TARGET_THRESHOLD: f32 = 4.539_993e-5;
/// Or once this many time constants have passed (`kTimeConstantsToConverge`).
const TIME_CONSTANTS_TO_CONVERGE: f32 = 10.0;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Set,
    Linear,
    Target,
}

#[derive(Clone, Copy)]
struct Event {
    kind: Kind,
    time: f64,
    value: f32,
    tau: f64,
    /// Added since the last block rendered: moved up to that block's start
    /// if it is earlier.
    new: bool,
}

const EMPTY: Event = Event {
    kind: Kind::Set,
    time: 0.0,
    value: 0.0,
    tau: 0.0,
    new: false,
};

pub struct Timeline<const N: usize> {
    /// The `value` attribute: what the parameter holds with no event in
    /// force, and the last value rendered once there has been one.
    intrinsic: f32,
    min: f32,
    max: f32,
    events: [Event; N],
    len: usize,
}

impl<const N: usize> Timeline<N> {
    /// A parameter holding `value`, kept within `min` and `max`.
    pub const fn new(value: f32, min: f32, max: f32) -> Self {
        Timeline {
            intrinsic: value,
            min,
            max,
            events: [EMPTY; N],
            len: 0,
        }
    }

    /// A fresh parameter in place: holding `value`, kept within `min` and
    /// `max`, nothing scheduled.
    pub fn configure(&mut self, value: f32, min: f32, max: f32) {
        self.min = min;
        self.max = max;
        self.reset(value);
    }

    /// Back to holding `value`, with nothing scheduled: the `value`
    /// setter on a fresh node.
    pub fn reset(&mut self, value: f32) {
        self.intrinsic = within(value, self.min, self.max);
        self.len = 0;
    }

    /// The `value` attribute.
    pub fn value(&self) -> f32 {
        self.intrinsic
    }

    /// Whether anything is scheduled or in force.
    pub fn idle(&self) -> bool {
        self.len == 0
    }

    fn line(&mut self) -> Line<'_> {
        Line {
            intrinsic: &mut self.intrinsic,
            min: self.min,
            max: self.max,
            events: &mut self.events,
            len: &mut self.len,
        }
    }

    /// `setValueAtTime`. `now` is the host's current time: a time before
    /// it is raised to it, as the main thread raises it.
    pub fn set_value_at_time(&mut self, value: f32, time: f64, now: f64) -> bool {
        self.line().set_value_at_time(value, time, now)
    }

    /// `linearRampToValueAtTime`. With nothing scheduled, the ramp starts
    /// from the `value` attribute at `now`.
    pub fn linear_ramp_to_value_at_time(&mut self, value: f32, time: f64, now: f64) -> bool {
        self.line().linear_ramp_to_value_at_time(value, time, now)
    }

    /// `setTargetAtTime`. A time constant of zero jumps, as
    /// `setValueAtTime`.
    pub fn set_target_at_time(&mut self, target: f32, time: f64, tau: f64, now: f64) -> bool {
        self.line().set_target_at_time(target, time, tau, now)
    }

    /// `cancelScheduledValues`: every event at or after `time` goes. A ramp
    /// is at the time it ends, so one under way then goes too.
    pub fn cancel_scheduled_values(&mut self, time: f64, now: f64) {
        self.line().cancel_scheduled_values(time, now)
    }

    /// The value at every frame of the block starting at frame `block`
    /// (`CalculateTimelineValues`): the parameter rendered at audio rate.
    pub fn fill(&mut self, block: u64, rate: f64, out: &mut [f32; QUANTUM]) {
        self.line().fill(block, rate, out)
    }
}

// The timeline itself, whatever its capacity: one copy of the code for
// every size of list.
struct Line<'a> {
    intrinsic: &'a mut f32,
    min: f32,
    max: f32,
    events: &'a mut [Event],
    len: &'a mut usize,
}

impl Line<'_> {
    fn list(&self) -> &[Event] {
        self.events.get(..*self.len).unwrap_or(&[])
    }

    /// `setValueAtTime`. `now` is the host's current time: a time before
    /// it is raised to it, as the main thread raises it.
    fn set_value_at_time(&mut self, value: f32, time: f64, now: f64) -> bool {
        self.insert(Kind::Set, value, time.max(now), 0.0)
    }

    /// `linearRampToValueAtTime`. With nothing scheduled, the ramp starts
    /// from the `value` attribute at `now`.
    fn linear_ramp_to_value_at_time(&mut self, value: f32, time: f64, now: f64) -> bool {
        if *self.len == 0 && !self.insert(Kind::Set, *self.intrinsic, now, 0.0) {
            return false;
        }
        self.insert(Kind::Linear, value, time.max(now), 0.0)
    }

    /// `setTargetAtTime`. A time constant of zero jumps, as
    /// `setValueAtTime`.
    fn set_target_at_time(&mut self, target: f32, time: f64, tau: f64, now: f64) -> bool {
        if !(tau >= 0.0) {
            return false;
        }
        let kind = if tau == 0.0 { Kind::Set } else { Kind::Target };
        self.insert(kind, target, time.max(now), tau)
    }

    /// `cancelScheduledValues`: every event at or after `time` goes. A ramp
    /// is at the time it ends, so one under way then goes too.
    fn cancel_scheduled_values(&mut self, time: f64, now: f64) {
        let time = time.max(now);
        *self.len = self.list().iter().take_while(|e| e.time < time).count();
    }

    fn insert(&mut self, kind: Kind, value: f32, time: f64, tau: f64) -> bool {
        if *self.len >= self.events.len() || !time.is_finite() || !value.is_finite() || !tau.is_finite() {
            return false;
        }
        // After every event at the same time or earlier.
        let at = self.list().iter().take_while(|e| e.time <= time).count();
        let Some(tail) = self.events.get_mut(at..=*self.len) else {
            return false;
        };
        let mut new = Event {
            kind,
            time,
            value,
            tau,
            new: true,
        };
        for e in tail.iter_mut() {
            core::mem::swap(e, &mut new);
        }
        *self.len += 1;
        true
    }

    /// The value at every frame of the block starting at frame `block`
    /// (`CalculateTimelineValues`): the parameter rendered at audio rate.
    fn fill(&mut self, block: u64, rate: f64, out: &mut [f32; QUANTUM]) {
        let start = block;
        let end = block + QUANTUM as u64;
        let last = self.values_for_frame_range(start, end, *self.intrinsic, out, rate, rate);
        let (min, max) = (self.min, self.max);
        for v in out.iter_mut() {
            *v = within(*v, min, max);
        }
        *self.intrinsic = within(last, min, max);
    }

    // `ValuesForFrameRangeImpl`, for the kinds of event above.
    fn values_for_frame_range(
        &mut self,
        start: u64,
        end: u64,
        default: f32,
        values: &mut [f32; QUANTUM],
        rate: f64,
        control: f64,
    ) -> f32 {
        let first_time = match self.list().first() {
            Some(e) => e.time,
            None => {
                values.fill(default);
                return default;
            }
        };
        if end as f64 / rate <= first_time {
            values.fill(default);
            return default;
        }
        self.clamp_new_events(start as f64 / rate);
        let mut default = default;
        if self.all_in_the_past(start as f64 / rate, rate, &mut default) {
            values.fill(default);
            return default;
        }

        // Before the first event: the value it had.
        let mut current = start;
        let mut write = 0usize;
        if let Some(first) = self.list().first()
            && first.time > start as f64 / rate
        {
            let first_frame = (first.time * rate).ceil();
            let fill_end = if end as f64 > first_frame {
                first_frame as u64
            } else {
                end
            };
            let fill = (fill_end.saturating_sub(start) as usize).min(QUANTUM);
            if let Some(span) = values.get_mut(write..fill) {
                span.fill(default);
            }
            write = fill;
            current += fill as u64;
        }

        let mut value = default;
        let mut last_skipped = 0usize;
        let n = *self.len;
        let mut i = 0usize;
        while i < n && write < QUANTUM {
            let Some(&e) = self.events.get(i) else { break };
            let next = if i + 1 < n {
                self.events.get(i + 1).copied()
            } else {
                None
            };
            if !is_current(&e, next.as_ref(), current, rate) {
                last_skipped = i;
                i += 1;
                continue;
            }
            // A target curve followed by a ramp: the ramp starts wherever
            // the curve has got to, so the curve becomes a value there.
            let mut e = e;
            if e.kind == Kind::Target && next.is_some_and(|x| x.kind == Kind::Linear) {
                if (2.0 * rate * e.time - 2.0 * current as f64 + 1.0).abs() <= 1.0 {
                    value = (e.value as f64
                        + (value - e.value) as f64
                            * (-(current as f64 / rate - e.time) / e.tau).exp())
                        as f32;
                } else {
                    let c = discrete_time_constant(e.tau, control) as f32;
                    value += (e.value - value) * c;
                }
                e = Event {
                    kind: Kind::Set,
                    time: current as f64 / rate,
                    value,
                    tau: 0.0,
                    new: false,
                };
                if let Some(slot) = self.events.get_mut(i) {
                    *slot = e;
                }
            }
            let (value1, time1) = (e.value, e.time);
            let (value2, time2, next_kind) = match next {
                Some(x) => (x.value, x.time, Some(x.kind)),
                None => (value1, end as f64 / rate + 1.0, None),
            };
            let fill_end = if end as f64 > time2 * rate {
                (time2 * rate).ceil() as u64
            } else {
                end
            };
            let fill = (fill_end.saturating_sub(start) as usize).min(QUANTUM);
            let fill = fill.max(write);

            if next_kind == Some(Kind::Linear) {
                (current, value, write) = linear_ramp(
                    fill, time1, time2, value1, value2, rate, values, current, value, write,
                );
            } else {
                match e.kind {
                    Kind::Set | Kind::Linear => {
                        current = fill_end;
                        value = e.value;
                        if let Some(span) = values.get_mut(write..fill) {
                            span.fill(value);
                        }
                        write = fill;
                    }
                    Kind::Target => {
                        (current, value, write) = set_target(
                            fill, time1, value1, e.tau, rate, control, fill_end, values,
                            current, value, write,
                        );
                    }
                }
            }
            i += 1;
        }
        if last_skipped > 0 {
            self.remove_old(last_skipped - 1);
        }
        if let Some(span) = values.get_mut(write..) {
            span.fill(value);
        }
        values[QUANTUM - 1]
    }

    // `ClampNewEventsToCurrentTime`: an event added since the last block
    // with a time already rendered moves to the start of this one.
    fn clamp_new_events(&mut self, now: f64) {
        let len = *self.len;
        let mut moved = false;
        for e in self.events.iter_mut().take(len) {
            if e.new && e.time < now {
                e.time = now;
                moved = true;
            }
            e.new = false;
        }
        if moved {
            // A stable insertion sort: the list is short and nearly sorted.
            let events = self.events.get_mut(..len).unwrap_or(&mut []);
            for k in 1..events.len() {
                let mut j = k;
                while let Some(pair) = j.checked_sub(1).and_then(|i| events.get_mut(i..=j)) {
                    let [a, b] = pair else { break };
                    if b.time >= a.time {
                        break;
                    }
                    core::mem::swap(a, b);
                    j -= 1;
                }
            }
        }
    }

    // `HandleAllEventsInThePast`: once the last event is a block and a half
    // behind, and a target curve has converged, the parameter holds and
    // the events go -- all but the last, which Chromium always keeps.
    fn all_in_the_past(&mut self, now: f64, rate: f64, default: &mut f32) -> bool {
        let Some(&last) = self.list().last() else {
            return false;
        };
        if last.time + 1.5 * QUANTUM as f64 / rate < now {
            if last.kind == Kind::Target {
                if converged(*default, last.value, now, last.time, last.tau) {
                    *default = last.value;
                } else {
                    return false;
                }
            }
            self.remove_old(*self.len);
            return true;
        }
        false
    }

    // `RemoveOldEvents`: the first `count`, always leaving one.
    fn remove_old(&mut self, count: usize) {
        if *self.len > 1 {
            let drop = count.min(*self.len - 1);
            if let Some(events) = self.events.get_mut(..*self.len) {
                events.copy_within(drop.., 0);
                *self.len -= drop;
            }
        }
    }
}

// `IsEventCurrent`: an event is behind once the next one has started --
// unless it is a value set within the last frame, which must still be
// applied.
fn is_current(e: &Event, next: Option<&Event>, current: u64, rate: f64) -> bool {
    if let Some(next) = next
        && next.time < current as f64 / rate
    {
        let frame = e.time * rate;
        let c = current as f64;
        if !(e.kind == Kind::Set && frame <= c && c < frame + 1.0) {
            return false;
        }
    }
    true
}

// `ClampTo`, without the panic `f32::clamp` has for a bad range.
fn within(v: f32, min: f32, max: f32) -> f32 {
    if v < min {
        min
    } else if v > max {
        max
    } else {
        v
    }
}

// `DiscreteTimeConstantForSampleRate`.
fn discrete_time_constant(tau: f64, rate: f64) -> f64 {
    1.0 - (-1.0 / (rate * tau)).exp()
}

// `HasSetTargetConverged`.
fn converged(value: f32, target: f32, now: f64, start: f64, tau: f64) -> bool {
    if now > start + TIME_CONSTANTS_TO_CONVERGE as f64 * tau {
        return true;
    }
    if target == 0.0 && value.abs() < SET_TARGET_THRESHOLD {
        return true;
    }
    target != 0.0 && (target - value).abs() < SET_TARGET_THRESHOLD * value.abs()
}

// `ProcessLinearRamp`, the x86 build: four frames at a time from a
// starting vector and an increment, both 32-bit, then the rest one by one.
#[allow(clippy::too_many_arguments)]
fn linear_ramp(
    fill: usize,
    time1: f64,
    time2: f64,
    value1: f32,
    value2: f32,
    rate: f64,
    values: &mut [f32; QUANTUM],
    mut current: u64,
    mut value: f32,
    mut write: usize,
) -> (u64, f32, usize) {
    let dt = time2 - time1;
    let k: f32 = if dt <= f32::MIN_POSITIVE as f64 {
        0.0
    } else {
        (1.0 / dt) as f32
    };
    let delta = value2 - value1;
    if fill > write {
        let step = (1.0 / rate) as f32;
        let offset = (current as f64 / rate - time1) as f32;
        let scale = k * delta;
        let mut v = [0.0f32; 4];
        for (lane, x) in v.iter_mut().enumerate() {
            *x = (step * lane as f32 + offset) * scale + value1;
        }
        let inc = (4.0 / rate * k as f64 * delta as f64) as f32;
        let trunc = write + ((fill - write) / 4) * 4;
        current += (trunc - write) as u64;
        while write < trunc {
            if let Some(span) = values.get_mut(write..write + 4) {
                span.copy_from_slice(&v);
            }
            for x in v.iter_mut() {
                *x += inc;
            }
            write += 4;
        }
    }
    if let Some(&v) = write.checked_sub(1).and_then(|w| values.get(w)) {
        value = v;
    }
    while write < fill {
        let x = ((current as f64 / rate - time1) * k as f64) as f32;
        value = value1 + x * delta;
        if let Some(y) = values.get_mut(write) {
            *y = value;
        }
        current += 1;
        write += 1;
    }
    (current, value, fill)
}

// `ProcessSetTarget`, the x86 build: four frames at a time, each lane a
// constant times the distance to go, then the rest one by one.
#[allow(clippy::too_many_arguments)]
fn set_target(
    fill: usize,
    time1: f64,
    target: f32,
    tau: f64,
    rate: f64,
    control: f64,
    fill_end: u64,
    values: &mut [f32; QUANTUM],
    mut current: u64,
    mut value: f32,
    mut write: usize,
) -> (u64, f32, usize) {
    let tau32 = tau as f32;
    let c0 = discrete_time_constant(tau32 as f64, control) as f32;
    let start = time1 * rate;
    let c = current as f64;
    if start <= c && c < start + 1.0 {
        value = (target as f64
            + (value - target) as f64 * (-(c / rate - time1) / tau32 as f64).exp())
            as f32;
    } else {
        value += (target - value) * c0;
    }
    if converged(value, target, c / rate, time1, tau32 as f64) {
        current += (fill - write) as u64;
        if let Some(span) = values.get_mut(write..fill) {
            span.fill(target);
        }
        return (current, value, fill);
    }
    if fill > write {
        let c1 = c0 * (2.0 - c0);
        let c2 = c0 * ((c0 - 3.0) * c0 + 3.0);
        let c3 = c0 * (c0 * ((4.0 - c0) * c0 - 6.0) + 4.0);
        let lanes = [0.0f32, c0, c1, c2];
        let trunc = write + ((fill - write) / 4) * 4;
        while write < trunc {
            let delta = target - value;
            if let Some(span) = values.get_mut(write..write + 4) {
                for (y, &k) in span.iter_mut().zip(lanes.iter()) {
                    *y = value + delta * k;
                }
            }
            value += delta * c3;
            write += 4;
        }
    }
    while write < fill {
        if let Some(y) = values.get_mut(write) {
            *y = value;
        }
        value += (target - value) * c0;
        write += 1;
    }
    if let Some(&v) = write.checked_sub(1).and_then(|w| values.get(w)) {
        value = v;
    }
    (fill_end, value, write)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 44100.0;

    fn block<const N: usize>(t: &mut Timeline<N>, b: u64) -> [f32; QUANTUM] {
        let mut out = [0.0; QUANTUM];
        t.fill(b * QUANTUM as u64, RATE, &mut out);
        out
    }

    #[test]
    fn holds_its_value_with_nothing_scheduled() {
        let mut t: Timeline<8> = Timeline::new(0.58, f32::MIN, f32::MAX);
        assert!(block(&mut t, 0).iter().all(|&v| v == 0.58));
    }

    #[test]
    fn a_set_value_lands_on_the_first_frame_at_or_after_its_time() {
        let mut t: Timeline<8> = Timeline::new(1.0, f32::MIN, f32::MAX);
        t.set_value_at_time(0.5, 100.5 / RATE, 0.0);
        let out = block(&mut t, 0);
        assert_eq!(out[100], 1.0);
        assert_eq!(out[101], 0.5);
    }

    #[test]
    fn a_linear_ramp_runs_from_the_event_before_it() {
        let mut t: Timeline<8> = Timeline::new(1.0, f32::MIN, f32::MAX);
        t.set_value_at_time(0.5, 0.0, 0.0);
        t.linear_ramp_to_value_at_time(1.0, 256.0 / RATE, 0.0);
        let a = block(&mut t, 0);
        let b = block(&mut t, 1);
        assert_eq!(a[0], 0.5);
        assert!((a[64] - 0.625).abs() < 1e-5);
        assert!((b[0] - 0.75).abs() < 1e-5);
        assert_eq!(block(&mut t, 2)[0], 1.0);
    }

    #[test]
    fn a_target_curve_converges_and_its_events_go() {
        let mut t: Timeline<8> = Timeline::new(1.0, f32::MIN, f32::MAX);
        t.set_target_at_time(0.0, 0.0, 0.01, 0.0);
        let first = block(&mut t, 0);
        assert_eq!(first[0], 1.0);
        let want = (-(1.0f64) / (0.01 * RATE)).exp();
        assert!((first[1] as f64 - want).abs() < 1e-6);
        // Ten time constants is 0.1 s, about 35 blocks.
        for b in 1..40 {
            block(&mut t, b);
        }
        assert_eq!(block(&mut t, 40)[0], 0.0);
        assert_eq!(t.len, 1);
    }

    #[test]
    fn an_event_added_in_the_past_moves_to_the_next_block() {
        let mut t: Timeline<8> = Timeline::new(1.0, f32::MIN, f32::MAX);
        block(&mut t, 0);
        block(&mut t, 1);
        // Added at 0.001 s (frame 44), behind the clock: it lands on frame 256.
        t.set_value_at_time(0.25, 0.001, 0.0);
        let out = block(&mut t, 2);
        assert!(out.iter().all(|&v| v == 0.25));
    }

    #[test]
    fn cancel_drops_the_events_from_its_time() {
        let mut t: Timeline<8> = Timeline::new(1.0, f32::MIN, f32::MAX);
        t.set_value_at_time(0.5, 0.0, 0.0);
        t.linear_ramp_to_value_at_time(1.0, 1.0, 0.0);
        t.cancel_scheduled_values(0.5, 0.0);
        assert_eq!(t.len, 1);
        assert!(block(&mut t, 10).iter().all(|&v| v == 0.5));
    }

    #[test]
    fn a_duck_on_every_kick_keeps_the_list_short() {
        let mut t: Timeline<16> = Timeline::new(1.0, f32::MIN, f32::MAX);
        let mut b = 0;
        for kick in 0..200 {
            let at = 0.01 + kick as f64 * 0.25;
            let now = (b * QUANTUM) as f64 / RATE;
            t.cancel_scheduled_values(at, now);
            assert!(t.set_value_at_time(0.5, at, now));
            assert!(t.linear_ramp_to_value_at_time(1.0, at + 0.24, now));
            while ((b * QUANTUM) as f64 / RATE) < at + 0.25 {
                block(&mut t, b as u64);
                b += 1;
            }
        }
        assert!(t.len <= 3);
    }

    #[test]
    fn a_full_timeline_refuses_more() {
        let mut t: Timeline<2> = Timeline::new(0.0, f32::MIN, f32::MAX);
        assert!(t.set_value_at_time(1.0, 1.0, 0.0));
        assert!(t.set_value_at_time(2.0, 2.0, 0.0));
        assert!(!t.set_value_at_time(3.0, 3.0, 0.0));
    }

    #[test]
    fn values_stay_in_range() {
        let mut t: Timeline<8> = Timeline::new(0.1, 0.0, 0.5);
        t.set_value_at_time(2.0, 0.0, 0.0);
        assert!(block(&mut t, 0).iter().all(|&v| v == 0.5));
        assert_eq!(t.value(), 0.5);
    }
}
