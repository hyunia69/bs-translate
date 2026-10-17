// Pure PCM helpers. No DOM APIs: usable from the player, engines and Node tests.

export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Drops leading/trailing samples whose absolute value stays below `threshold`,
 * keeping `padMs` of audio around the first/last loud sample.
 * Returns an empty array when every sample is below the threshold.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.004,
  padMs = 50,
): Float32Array {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return new Float32Array(0);
  const pad = Math.round((padMs / 1000) * sampleRate);
  const start = Math.max(0, first - pad);
  const end = Math.min(samples.length, last + 1 + pad);
  return samples.slice(start, end);
}

/** Linear-interpolation resampler. Output length = round(n * toRate / fromRate). */
export function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice();
  const outLen = Math.round((samples.length * toRate) / fromRate);
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  const lastIdx = samples.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.min(Math.floor(pos), lastIdx);
    const i1 = Math.min(i0 + 1, lastIdx);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** Decodes base64 little-endian int16 PCM into floats (int16 / 32768). */
export function base64Pcm16ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(2 * i);
    const hi = bin.charCodeAt(2 * i + 1);
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}
