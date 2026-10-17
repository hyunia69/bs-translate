import { test } from "node:test";
import assert from "node:assert/strict";
import { concatFloat32, trimSilence, resampleLinear, base64Pcm16ToFloat32 } from "../src/audio/pcm.ts";

test("concatFloat32 sums lengths and preserves order", () => {
  const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])]);
  assert.equal(out.length, 3);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
  assert.equal(concatFloat32([]).length, 0);
});

test("trimSilence removes silence and keeps 50 ms padding", () => {
  const rate = 1000; // 50 ms = 50 samples
  const s = new Float32Array(1000);
  s[500] = 0.5;
  s[600] = -0.5;
  const out = trimSilence(s, rate);
  assert.equal(out.length, 600 + 1 + 50 - (500 - 50));
  assert.equal(out[50], 0.5);
  assert.equal(out[out.length - 51], -0.5);
});

test("trimSilence clamps padding at the edges and handles all-silence", () => {
  const rate = 1000;
  const s = new Float32Array(100);
  s[10] = 0.1;
  s[90] = 0.1;
  assert.equal(trimSilence(s, rate).length, 100);
  assert.equal(trimSilence(new Float32Array(100).fill(0.003), rate).length, 0);
});

test("resampleLinear length ratio and interpolation", () => {
  const s = new Float32Array(480).map((_, i) => i / 480);
  assert.equal(resampleLinear(s, 24000, 48000).length, 960);
  assert.equal(resampleLinear(s, 48000, 24000).length, 240);
  assert.equal(resampleLinear(s, 24000, 24000).length, 480);
  const up = resampleLinear(new Float32Array([0, 1]), 1, 2);
  assert.deepEqual(Array.from(up), [0, 0.5, 1, 1]);
});

test("base64Pcm16ToFloat32 decodes little-endian int16", () => {
  const bytes = Buffer.from(new Int16Array([0, 16384, -32768]).buffer);
  const out = base64Pcm16ToFloat32(bytes.toString("base64"));
  assert.deepEqual(Array.from(out), [0, 0.5, -1]);
});
