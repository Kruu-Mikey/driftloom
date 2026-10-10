// Tests for the core's worklet (js/worklet.js) that need no browser: the real
// worklet module and the real js/dlcore.wasm, with the few globals an
// AudioWorkletGlobalScope gives it stubbed.
// Run with:  node test/worklet.test.mjs
//
// What they pin down is which block the worklet asks the core to render
// (queue item 31b): the frame count that rides out Chromium's stale
// `currentFrame`, and finds the clock again if it ever runs ahead of it.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const QUANTUM = 128;
const RATE = 44100;
const wasm = fs.readFileSync(fileURLToPath(new URL('../js/dlcore.wasm', import.meta.url)));

let processors = [];
globalThis.sampleRate = RATE;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.sent = [];
    this.port = { postMessage: (m) => this.sent.push(m), onmessage: null };
  }
};
globalThis.registerProcessor = (name, cls) => { processors.push([name, cls]); };
await import('../js/worklet.js');
const [, DriftloomCore] = processors[0];

let failures = 0;
function check(label, condition, detail = '') {
  console.log(condition ? `  pass  ${label}` : `  FAIL  ${label} ${detail}`);
  if (!condition) failures++;
}

// A worklet around a core that records the blocks it is asked for.
function make() {
  const processor = new DriftloomCore({
    numberOfOutputs: 1,
    processorOptions: { bytes: wasm, noise: null, quality: 'full' },
  });
  const blocks = [];
  const real = processor.core;
  processor.core = { ...real, dl_process: (block) => { blocks.push(block); return real.dl_process(block); } };
  return { processor, blocks };
}

// One process() call at the clock `frame`.
function call(processor, frame) {
  globalThis.currentFrame = frame;
  const inputs = Array.from({ length: 5 }, () => []);
  const outputs = [[new Float32Array(QUANTUM)]];
  return processor.process(inputs, outputs);
}

console.log('\nWhich block the worklet renders');

{
  const { processor, blocks } = make();
  for (let b = 0; b < 6; b++) call(processor, b * QUANTUM);
  check('a clock that keeps time renders each block as it says',
    blocks.join() === [0, 128, 256, 384, 512, 640].join(), blocks.join());
}

{
  // Seen in offline renders: 9088 again where 9216 was due, then 9344.
  const { processor, blocks } = make();
  for (const frame of [8960, 9088, 9088, 9344, 9472]) call(processor, frame);
  check('a stale frame renders the block that was due, not the last one again',
    blocks.join() === [8960, 9088, 9216, 9344, 9472].join(), blocks.join());
}

{
  const { processor, blocks } = make();
  for (const frame of [0, 128, 128, 128, 384]) call(processor, frame);
  check('a frame stale twice still renders each block once, in order',
    blocks.join() === [0, 128, 256, 384, 512].join(), blocks.join());
}

{
  const { processor, blocks } = make();
  for (const frame of [0, 128, 256, 5120, 5248]) call(processor, frame);
  check('a gap moves the core on to the clock',
    blocks.join() === [0, 128, 256, 5120, 5248].join(), blocks.join());
}

{
  // A host that called process() twice for each block of real time would
  // run the count ahead of the clock for good, were it never to look at the
  // clock again.
  const { processor, blocks } = make();
  let worst = 0;
  for (let b = 0; b < 400; b++) {
    for (let k = 0; k < 2; k++) {
      call(processor, b * QUANTUM);
      worst = Math.max(worst, processor.next - b * QUANTUM);
    }
  }
  check('a count running ahead of the clock finds it again', worst <= 3 * QUANTUM, `${worst / QUANTUM} blocks ahead`);
  check('and no block is ever rendered twice in a row',
    blocks.every((x, i) => i === 0 || x !== blocks[i - 1]));
}

{
  // The count is where the clock says again, so a late-starting core is not
  // left behind a clock that is far ahead.
  const { processor, blocks } = make();
  call(processor, 100 * QUANTUM);
  call(processor, 100 * QUANTUM);
  call(processor, 100 * QUANTUM);
  call(processor, 100 * QUANTUM);
  check('the clock is trusted once the count is more than two blocks ahead',
    blocks.join() === [100, 101, 102, 100].map((b) => b * QUANTUM).join(), blocks.join());
}

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failing.\n`);
process.exit(failures === 0 ? 0 : 1);
