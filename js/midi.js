// Standard MIDI File writer, format 1.
//
// This is the escape hatch: whatever the browser synth sounds like, the
// notes themselves can go into a DAW, a Volca, an MPC, anything with a
// MIDI in. Written by hand because the whole spec we need is about
// eighty bytes of structure.

const PPQ = 480;

function varLen(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function str(s) {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function u32(n) {
  return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function u16(n) {
  return [(n >> 8) & 255, n & 255];
}

function chunk(id, data) {
  return [...str(id), ...u32(data.length), ...data];
}

// General MIDI percussion map, so the drum track lands on the right pads
// in more or less any sampler.
const GM_DRUMS = {
  kick: 36,
  snare: 38,
  rim: 37,
  clap: 39,
  hat: 42,
  ohat: 46,
  shaker: 70,
};

function buildTrack(name, notes, channel, extraHeadEvents = []) {
  // notes: [{tick, dur, midi, vel}]
  const evts = [...extraHeadEvents];
  evts.push({ tick: 0, bytes: [0xff, 0x03, name.length, ...str(name)] });
  for (const n of notes) {
    const vel = Math.max(1, Math.min(127, Math.round(n.vel * 127)));
    evts.push({ tick: n.tick, bytes: [0x90 | channel, n.midi & 127, vel], order: 1 });
    evts.push({ tick: n.tick + Math.max(10, n.dur), bytes: [0x80 | channel, n.midi & 127, 0], order: 0 });
  }
  evts.sort((a, b) => a.tick - b.tick || (a.order ?? 2) - (b.order ?? 2));

  const data = [];
  let last = 0;
  for (const e of evts) {
    data.push(...varLen(Math.max(0, e.tick - last)), ...e.bytes);
    last = e.tick;
  }
  data.push(0x00, 0xff, 0x2f, 0x00);
  return chunk('MTrk', data);
}

// numerator, denominator as a power of two, clocks per click, 32nds per beat
function timeSignature(stepsPerBar) {
  if (stepsPerBar === 12) return [6, 3, 24, 8];   // 6/8
  if (stepsPerBar === 20) return [5, 2, 24, 8];   // 5/4
  if (stepsPerBar === 14) return [7, 3, 24, 8];   // 7/8
  return [4, 2, 24, 8];                            // 4/4
}

export function patternToMidi(pattern, { repeats = 1 } = {}) {
  const spec = pattern.spec;
  const ticksPerStep = PPQ / 4;
  const loopTicks = pattern.totalSteps * ticksPerStep;
  const swingTicks = Math.round(spec.swing * ticksPerStep);
  const at = (step) => step * ticksPerStep + (step % 2 === 1 ? swingTicks : 0);

  const tempoUs = Math.round(60000000 / spec.bpm);
  const tempoTrack = chunk('MTrk', [
    ...varLen(0), 0xff, 0x51, 0x03, (tempoUs >> 16) & 255, (tempoUs >> 8) & 255, tempoUs & 255,
    ...varLen(0), 0xff, 0x58, 0x04, ...timeSignature(spec.stepsPerBar || 16),
    ...varLen(0), 0xff, 0x03, spec.name.length, ...str(spec.name),
    ...varLen(loopTicks * repeats), 0xff, 0x2f, 0x00,
  ]);

  const collect = (fn) => {
    const out = [];
    for (let r = 0; r < repeats; r++) fn(out, r * loopTicks);
    return out;
  };

  const drums = collect((out, off) => {
    for (const e of pattern.tracks.drums) {
      if (!e.vel) continue;
      const midi = GM_DRUMS[e.inst];
      if (!midi) continue;
      out.push({ tick: off + at(e.step), dur: 30, midi, vel: e.vel });
    }
  });
  const bass = collect((out, off) => {
    for (const e of pattern.tracks.bass) {
      if (!e.vel) continue;
      out.push({ tick: off + at(e.step), dur: e.dur * ticksPerStep, midi: e.midi, vel: e.vel });
    }
  });
  const chords = collect((out, off) => {
    for (const e of pattern.tracks.chords) {
      if (!e.vel) continue;
      for (const n of e.notes) {
        out.push({ tick: off + at(e.step), dur: e.dur * ticksPerStep, midi: n, vel: e.vel });
      }
    }
  });
  const melody = collect((out, off) => {
    for (const e of pattern.tracks.melody) {
      if (!e.vel) continue;
      out.push({ tick: off + at(e.step), dur: e.dur * ticksPerStep, midi: e.midi, vel: e.vel });
    }
  });
  const texture = collect((out, off) => {
    for (const e of pattern.tracks.texture) {
      if (!e.vel || !e.notes || !e.notes.length) continue;
      for (const n of e.notes) {
        out.push({ tick: off + at(e.step), dur: e.dur * ticksPerStep, midi: n, vel: e.vel });
      }
    }
  });

  const tracks = [
    tempoTrack,
    buildTrack('Drums', drums, 9),
    buildTrack('Bass', bass, 0, [{ tick: 0, bytes: [0xc0, 38] }]),
    buildTrack('Keys', chords, 1, [{ tick: 0, bytes: [0xc1, 4] }]),
    buildTrack('Melody', melody, 2, [{ tick: 0, bytes: [0xc2, 80] }]),
    buildTrack('Air', texture, 3, [{ tick: 0, bytes: [0xc3, 89] }]),
  ];

  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  const bytes = new Uint8Array([...header, ...tracks.flat()]);
  return new Blob([bytes], { type: 'audio/midi' });
}
