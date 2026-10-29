export type SpectralOnset = { time: number; strength: number };
export type SpectralComponent = {
  id: number;
  centroid: number;
  onsets: SpectralOnset[];
  preview: Float32Array;
  previewTime: number;
};
export type SpectralResult = {
  sampleRate: number;
  duration: number;
  components: SpectralComponent[];
  reconstructionError: number;
};
const SIZE = 1024;
const HOP = 128;
const BANDS = 64;
const EPS = 1e-10;

function fft(real: Float64Array, imaginary: Float64Array, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    for (let start = 0; start < n; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const cosine = Math.cos(angle * j), sine = Math.sin(angle * j);
        const even = start + j, odd = even + length / 2;
        const r = real[odd] * cosine - imaginary[odd] * sine;
        const im = real[odd] * sine + imaginary[odd] * cosine;
        real[odd] = real[even] - r;
        imaginary[odd] = imaginary[even] - im;
        real[even] += r;
        imaginary[even] += im;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imaginary[i] /= n; }
}

// Positive increases in each component activation are proposals, not confirmed hits.
export function activationOnsets(values: Float32Array, hopSeconds: number, sensitivity: number): SpectralOnset[] {
  let peak = 0;
  for (const value of values) peak = Math.max(peak, value);
  if (peak < EPS) return [];
  const rises = Float32Array.from(values, (v, i) => Math.max(0, v - (values[i - 1] ?? 0)));
  const found: SpectralOnset[] = [];
  const history = Math.max(2, Math.round(0.2 / hopSeconds));
  for (let i = 0; i < rises.length; i++) {
    const rise = rises[i];
    if (rise <= 0 || rise < (rises[i - 1] ?? 0) || rise <= (rises[i + 1] ?? 0)) continue;
    let mean = 0, square = 0;
    const start = Math.max(0, i - history), count = Math.max(1, i - start);
    for (let j = start; j < i; j++) { mean += rises[j]; square += rises[j] ** 2; }
    mean /= count;
    const threshold = (mean + Math.sqrt(Math.max(0, square / count - mean ** 2)) + peak * 0.025) / sensitivity;
    if (rise < threshold || values[i] < peak * 0.08) continue;
    const time = Math.max(0, (i + 1) * hopSeconds);
    if (found.length && time - found[found.length - 1].time < 0.045) continue;
    found.push({ time, strength: Math.max(0.05, Math.min(1, values[i] / peak)) });
  }
  return found;
}

export function analyzeSpectralPCM(
  pcm: Float32Array, rate: number, count: number, sensitivity = 1,
  progress: (value: number) => void = () => {}
): SpectralResult {
  if (!Number.isInteger(count) || count < 3 || count > 8) throw new Error('Selecciona entre 3 y 8 componentes.');
  if (pcm.length === 0 || !Number.isFinite(rate) || rate < 8000) throw new Error('Audio no válido.');
  const frames = Math.ceil(pcm.length / HOP);
  const window = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE));
  const binBand = Int32Array.from({ length: SIZE / 2 + 1 }, (_, bin) => Math.min(BANDS - 1,
    Math.floor(BANDS * Math.log1p(bin * rate / SIZE / 80) / Math.log1p(rate / 2 / 80))));
  const v = new Float32Array(BANDS * frames);
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  const transform = (frame: number) => {
    const start = frame * HOP - SIZE / 2;
    for (let i = 0; i < SIZE; i++) { re[i] = (pcm[start + i] ?? 0) * window[i]; im[i] = 0; }
    fft(re, im);
  };
  let total = 0;
  for (let t = 0; t < frames; t++) {
    transform(t);
    for (let bin = 0; bin <= SIZE / 2; bin++) {
      const magnitude = Math.hypot(re[bin], im[bin]);
      v[binBand[bin] * frames + t] += magnitude;
      total += magnitude;
    }
  }
  if (total < EPS) throw new Error('El stem está en silencio.');
  progress(0.1);
  // Rescale the observation to stabilize multiplicative updates.
  const scale = total / v.length;
  for (let i = 0; i < v.length; i++) v[i] /= scale;
  let seed = 931;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const w = Float32Array.from({ length: BANDS * count }, (_, i) => {
    const band = Math.floor(i / count), k = i % count;
    return 0.1 + random() * 0.3 + Math.exp(-(((band / BANDS - (k + 0.5) / count) * count) ** 2));
  });
  const h = Float32Array.from({ length: count * frames }, () => 0.2 + random());
  const ratio = new Float32Array(v.length);
  const computeRatio = () => {
    for (let b = 0; b < BANDS; b++) for (let t = 0; t < frames; t++) {
      let approximation = EPS;
      for (let k = 0; k < count; k++) approximation += w[b * count + k] * h[k * frames + t];
      ratio[b * frames + t] = v[b * frames + t] / approximation;
    }
  };
  for (let iteration = 0; iteration < 48; iteration++) {
    computeRatio();
    for (let k = 0; k < count; k++) {
      let denominator = EPS;
      for (let b = 0; b < BANDS; b++) denominator += w[b * count + k];
      for (let t = 0; t < frames; t++) {
        let numerator = 0;
        for (let b = 0; b < BANDS; b++) numerator += w[b * count + k] * ratio[b * frames + t];
        h[k * frames + t] *= numerator / denominator;
      }
    }
    computeRatio();
    for (let k = 0; k < count; k++) {
      let denominator = EPS;
      for (let t = 0; t < frames; t++) denominator += h[k * frames + t];
      for (let b = 0; b < BANDS; b++) {
        let numerator = 0;
        for (let t = 0; t < frames; t++) numerator += ratio[b * frames + t] * h[k * frames + t];
        w[b * count + k] *= numerator / denominator;
      }
      let norm = EPS;
      for (let b = 0; b < BANDS; b++) norm += w[b * count + k];
      for (let b = 0; b < BANDS; b++) w[b * count + k] /= norm;
      for (let t = 0; t < frames; t++) h[k * frames + t] *= norm;
    }
    if (iteration % 4 === 0) progress(0.1 + 0.8 * (iteration + 1) / 48);
  }
  let squaredError = 0, energy = 0;
  for (let b = 0; b < BANDS; b++) for (let t = 0; t < frames; t++) {
    let approximation = 0;
    for (let k = 0; k < count; k++) approximation += w[b * count + k] * h[k * frames + t];
    squaredError += (v[b * frames + t] - approximation) ** 2;
    energy += v[b * frames + t] ** 2;
  }
  const components: SpectralComponent[] = [];
  for (let k = 0; k < count; k++) {
    const activation = h.slice(k * frames, (k + 1) * frames);
    const onsets = activationOnsets(activation, HOP / rate, Math.max(0.5, Math.min(2, sensitivity)))
      .filter((onset) => onset.time < pcm.length / rate);
    let strongest = 0;
    for (let t = 1; t < frames; t++) if (activation[t] > activation[strongest]) strongest = t;
    const start = Math.max(0, strongest * HOP - Math.round(rate * 0.08));
    const end = Math.min(pcm.length, start + Math.round(rate * 0.45));
    const preview = new Float32Array(end - start), weights = new Float32Array(end - start);
    for (let t = Math.max(0, Math.floor((start - SIZE / 2) / HOP)); t < Math.min(frames, Math.ceil((end + SIZE / 2) / HOP)); t++) {
      transform(t);
      for (let bin = 0; bin <= SIZE / 2; bin++) {
        const b = binBand[bin];
        let denominator = EPS;
        for (let j = 0; j < count; j++) denominator += w[b * count + j] * h[j * frames + t];
        const mask = w[b * count + k] * h[k * frames + t] / denominator;
        re[bin] *= mask; im[bin] *= mask;
        if (bin > 0 && bin < SIZE / 2) { re[SIZE - bin] *= mask; im[SIZE - bin] *= mask; }
      }
      fft(re, im, true);
      for (let i = 0; i < SIZE; i++) {
        const at = t * HOP - SIZE / 2 + i - start;
        if (at >= 0 && at < preview.length) { preview[at] += re[i] * window[i]; weights[at] += window[i] ** 2; }
      }
    }
    let peak = 0;
    for (let i = 0; i < preview.length; i++) { preview[i] /= Math.max(EPS, weights[i]); peak = Math.max(peak, Math.abs(preview[i])); }
    if (peak > EPS) for (let i = 0; i < preview.length; i++) preview[i] *= 0.75 / peak;
    let centroid = 0;
    for (let b = 0; b < BANDS; b++) centroid += w[b * count + k] * 80 * Math.expm1((b + 0.5) / BANDS * Math.log1p(rate / 2 / 80));
    components.push({ id: k, centroid, onsets, preview, previewTime: start / rate });
  }
  progress(1);
  return { sampleRate: rate, duration: pcm.length / rate, components, reconstructionError: Math.sqrt(squaredError / Math.max(EPS, energy)) };
}
