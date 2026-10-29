export type DrumKind = "kick" | "snare" | "hat";

export type DrumEvent = {
  id: string;
  clusterId?: string | null;
  // `kind` stays non-null for compatibility with existing benchmark code.
  // `classified: false` means the displayed value is only a placeholder.
  kind: DrumKind;
  classified?: boolean;
  time: number;
  strength: number;
};

export type DrumSampleCluster = {
  id: string;
  eventIds: string[];
  count: number;
  representativeTime: number;
  similarity: number | null;
  preview: Blob;
};

export type DrumScan = {
  duration: number;
  events: DrumEvent[];
  clusters: DrumSampleCluster[];
  audio: AudioBuffer;
};

// A correction replaces the label on existing hits; it never adds hits.
export function classifyDrumEvents(
  events: DrumEvent[],
  eventIds: readonly string[],
  kind: DrumKind | null
): DrumEvent[] {
  const selected = new Set(eventIds);
  return events.map((event) => {
    if (!selected.has(event.id)) return event;
    const familyId = (event.clusterId ?? event.id).split("::")[0];
    return {
      ...event,
      kind: kind ?? event.kind,
      classified: kind !== null,
      clusterId: `${familyId}::${kind ?? "unassigned"}`,
    };
  });
}

export function getDrumGroups(events: DrumEvent[]) {
  const groups = new Map<string, DrumEvent[]>();
  for (const event of events) {
    const id = event.clusterId ?? event.id;
    const group = groups.get(id) ?? [];
    group.push(event);
    groups.set(id, group);
  }
  return [...groups].map(([id, hits]) => ({
    id,
    events: [...hits].sort((a, b) => a.time - b.time),
    count: hits.length,
    kind: hits.every((hit) => hit.classified !== false && hit.kind === hits[0].kind)
      ? hits[0].kind : null,
  })).sort((a, b) => b.count - a.count || a.events[0].time - b.events[0].time);
}

export type DrumSamples = Partial<Record<DrumKind, File>>;

export const DRUM_KINDS: DrumKind[] = ["kick", "snare", "hat"];

export const DRUM_LABELS: Record<DrumKind, string> = {
  kick: "Kick",
  snare: "Snare / clap",
  hat: "Hi-hat",
};

const HOP_SECONDS = 0.005;
const WINDOW_SECONDS = 0.01;
const CLIP_SECONDS = 0.8;
const CLUSTER_SIMILARITY_THRESHOLD = 0.91;

async function decodeFile(file: File): Promise<AudioBuffer> {
  if (file.size === 0) {
    throw new Error(`El archivo "${file.name}" está vacío.`);
  }

  const context = new AudioContext();

  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } catch (error) {
    console.error(`Error al decodificar "${file.name}":`, error);
    throw new Error(`No se pudo decodificar "${file.name}".`);
  } finally {
    await context.close();
  }
}

function normalizeSample(audio: AudioBuffer, fileName: string): AudioBuffer {
  let peak = 0;

  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    for (const sample of audio.getChannelData(channel)) {
      peak = Math.max(peak, Math.abs(sample));
    }
  }

  if (peak === 0) {
    throw new Error(`El sample "${fileName}" está en silencio.`);
  }

  const gain = 0.75 / peak;
  const normalized = new AudioBuffer({
    length: audio.length,
    numberOfChannels: audio.numberOfChannels,
    sampleRate: audio.sampleRate,
  });

  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const source = audio.getChannelData(channel);
    const destination = normalized.getChannelData(channel);

    for (let index = 0; index < audio.length; index++) {
      destination[index] = source[index] * gain;
    }
  }

  return normalized;
}

function measureEnergy(audio: AudioBuffer): { values: number[]; hop: number } {
  const hopSamples = Math.max(1, Math.round(audio.sampleRate * HOP_SECONDS));
  const windowSamples = Math.max(1, Math.round(audio.sampleRate * WINDOW_SECONDS));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index)
  );
  const values: number[] = [];

  for (let start = 0; start < audio.length; start += hopSamples) {
    const end = Math.min(start + windowSamples, audio.length);
    let sumOfSquares = 0;

    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) {
        sumOfSquares += channel[sample] ** 2;
      }
    }

    values.push(Math.sqrt(sumOfSquares / ((end - start) * channels.length)));
  }

  return { values, hop: hopSamples / audio.sampleRate };
}

function detectAttacks(audio: AudioBuffer, sensitivity: number): DrumEvent[] {
  const { values, hop } = measureEnergy(audio);
  const peakEnergy = values.reduce((peak, value) => Math.max(peak, value), 0);

  if (peakEnergy < 0.00001) {
    return [];
  }

  const rises = values.map((value, index) =>
    Math.max(0, value - (values[index - 1] ?? 0))
  );
  const historyLength = Math.max(1, Math.round(0.15 / hop));
  const safeSensitivity = Math.max(0.5, Math.min(2, sensitivity));
  const events: DrumEvent[] = [];
  let lastTime = -Infinity;

  for (let index = 0; index < rises.length; index++) {
    const rise = rises[index];

    if (rise <= 0 || rise < (rises[index - 1] ?? 0) || rise <= (rises[index + 1] ?? 0)) {
      continue;
    }

    const historyStart = Math.max(0, index - historyLength);
    const history = rises.slice(historyStart, index);
    const mean = history.length
      ? history.reduce((sum, value) => sum + value, 0) / history.length
      : 0;
    const variance = history.length
      ? history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length
      : 0;
    const threshold = (mean + Math.sqrt(variance) * 2 + peakEnergy * 0.012) / safeSensitivity;

    if (rise <= threshold || values[index] < peakEnergy * 0.035) {
      continue;
    }

    const time = Math.max(0, index * hop - WINDOW_SECONDS / 2);

    // A single full-band detector avoids duplicate hits from three overlapping filters.
    if (time - lastTime < 0.035) {
      continue;
    }

    const localPeak = Math.max(values[index], values[index + 1] ?? 0, values[index + 2] ?? 0);
    events.push({
      id: crypto.randomUUID(),
      clusterId: null,
      kind: "kick",
      classified: false,
      time,
      strength: Math.max(0.05, Math.min(1, localPeak / peakEnergy)),
    });
    lastTime = time;
  }

  return events;
}

type AudioFingerprint = { spectrum: number[]; envelope: number[] };

function normalizeVector(values: number[]): number[] {
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return length > 0 ? values.map((value) => value / length) : values;
}

function fingerprintAt(audio: AudioBuffer, time: number): AudioFingerprint {
  const spectrumBands = 18;
  const envelopeBins = 16;
  const start = Math.max(0, Math.floor(time * audio.sampleRate));
  const durationSamples = Math.min(Math.floor(audio.sampleRate * 0.18), audio.length - start);
  const stride = Math.max(1, Math.ceil(audio.sampleRate / 11025));
  const effectiveRate = audio.sampleRate / stride;
  const mono: number[] = [];

  for (let offset = 0; offset < durationSamples; offset += stride) {
    let sum = 0;
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      sum += audio.getChannelData(channel)[start + offset];
    }
    mono.push(sum / audio.numberOfChannels);
  }

  const spectrum: number[] = [];
  const minFrequency = 45;
  const maxFrequency = Math.min(9000, effectiveRate * 0.46);

  for (let band = 0; band < spectrumBands; band++) {
    const proportion = (band + 0.5) / spectrumBands;
    const frequency = minFrequency * (maxFrequency / minFrequency) ** proportion;
    const omega = (2 * Math.PI * frequency) / effectiveRate;
    const coefficient = 2 * Math.cos(omega);
    let previous = 0;
    let previousPrevious = 0;

    for (let index = 0; index < mono.length; index++) {
      const window = mono.length > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (mono.length - 1)) : 1;
      const current = mono[index] * window + coefficient * previous - previousPrevious;
      previousPrevious = previous;
      previous = current;
    }

    const power = Math.max(0, previous * previous + previousPrevious * previousPrevious - coefficient * previous * previousPrevious);
    spectrum.push(Math.log1p(Math.sqrt(power)));
  }

  const envelope: number[] = [];
  for (let bin = 0; bin < envelopeBins; bin++) {
    const from = Math.floor((bin / envelopeBins) * mono.length);
    const to = Math.max(from + 1, Math.floor(((bin + 1) / envelopeBins) * mono.length));
    let energy = 0;
    for (let index = from; index < Math.min(to, mono.length); index++) {
      energy += mono[index] ** 2;
    }
    envelope.push(Math.sqrt(energy / Math.max(1, to - from)));
  }

  return {
    spectrum: normalizeVector(spectrum),
    envelope: normalizeVector(envelope),
  };
}

function fingerprintSimilarity(a: AudioFingerprint, b: AudioFingerprint): number {
  const cosine = (left: number[], right: number[]) =>
    left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const spectralSimilarity = Math.max(0, cosine(a.spectrum, b.spectrum));
  const envelopeSimilarity = Math.max(0, cosine(a.envelope, b.envelope));
  return spectralSimilarity * 0.72 + envelopeSimilarity * 0.28;
}

type MutableCluster = {
  id: string;
  events: DrumEvent[];
  fingerprints: AudioFingerprint[];
  similarityTotal: number;
  similarityCount: number;
};

function clusterEvents(audio: AudioBuffer, events: DrumEvent[]): DrumSampleCluster[] {
  const working: MutableCluster[] = [];

  for (const event of events) {
    const fingerprint = fingerprintAt(audio, event.time);
    let bestCluster: MutableCluster | null = null;
    let bestSimilarity = -1;

    for (const cluster of working) {
      const centroid: AudioFingerprint = {
        spectrum: normalizeVector(cluster.fingerprints[0].spectrum.map((_, index) =>
          cluster.fingerprints.reduce((sum, item) => sum + item.spectrum[index], 0)
        )),
        envelope: normalizeVector(cluster.fingerprints[0].envelope.map((_, index) =>
          cluster.fingerprints.reduce((sum, item) => sum + item.envelope[index], 0)
        )),
      };
      const similarity = fingerprintSimilarity(fingerprint, centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestSimilarity >= CLUSTER_SIMILARITY_THRESHOLD) {
      bestCluster.events.push(event);
      bestCluster.fingerprints.push(fingerprint);
      bestCluster.similarityTotal += bestSimilarity;
      bestCluster.similarityCount += 1;
      event.clusterId = bestCluster.id;
    } else {
      const cluster: MutableCluster = {
        id: crypto.randomUUID(),
        events: [event],
        fingerprints: [fingerprint],
        similarityTotal: 0,
        similarityCount: 0,
      };
      working.push(cluster);
      event.clusterId = cluster.id;
    }
  }

  return working
    .map((cluster) => {
      const representative = cluster.events[0];
      return {
        id: cluster.id,
        eventIds: cluster.events.map((event) => event.id),
        count: cluster.events.length,
        representativeTime: representative.time,
        similarity: cluster.similarityCount > 0
          ? cluster.similarityTotal / cluster.similarityCount
          : null,
        preview: encodeWav(extractClip(audio, representative.time, CLIP_SECONDS)),
      };
    })
    .sort((a, b) => b.count - a.count || a.representativeTime - b.representativeTime);
}

function extractClip(audio: AudioBuffer, time: number, duration: number): AudioBuffer {
  const start = Math.max(0, Math.floor(time * audio.sampleRate));
  const length = Math.max(1, Math.min(Math.floor(duration * audio.sampleRate), audio.length - start));
  const clip = new AudioBuffer({
    length,
    numberOfChannels: audio.numberOfChannels,
    sampleRate: audio.sampleRate,
  });

  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    clip.copyToChannel(audio.getChannelData(channel).subarray(start, start + length), channel);
  }

  return clip;
}

export async function scanDrums(file: File, sensitivity: number): Promise<DrumScan> {
  const audio = await decodeFile(file);
  const events = detectAttacks(audio, sensitivity);
  const clusters = clusterEvents(audio, events);

  return { duration: audio.duration, events, clusters, audio };
}

export async function rebuildDrums(
  events: DrumEvent[],
  samples: DrumSamples,
  originalDuration: number
): Promise<Blob> {
  if (events.length === 0) {
    throw new Error("No hay eventos para reconstruir.");
  }

  const unassignedCount = events.filter((event) => event.classified === false).length;
  if (unassignedCount > 0) {
    throw new Error(`Asigna un tipo de drum a los ${unassignedCount} eventos sin clasificar.`);
  }

  const buffers: Partial<Record<DrumKind, AudioBuffer>> = {};
  const usedKinds = new Set(events.map((event) => event.kind));
  let outputDuration = originalDuration;

  for (const kind of usedKinds) {
    const file = samples[kind];
    if (!file) {
      throw new Error(`Falta cargar un sample para ${DRUM_LABELS[kind]}.`);
    }
    buffers[kind] = normalizeSample(await decodeFile(file), file.name);
  }

  for (const event of events) {
    if (!Number.isFinite(event.time) || event.time < 0 || event.time > originalDuration) {
      throw new Error("Hay un evento fuera de la duración del fragmento.");
    }
    if (!Number.isFinite(event.strength)) {
      throw new Error("Hay un evento con intensidad no válida.");
    }
    const buffer = buffers[event.kind];
    if (buffer) outputDuration = Math.max(outputDuration, event.time + buffer.duration);
  }

  const sampleRate = 48000;
  const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(outputDuration * sampleRate)), sampleRate);

  for (const event of events) {
    const buffer = buffers[event.kind];
    if (!buffer) continue;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, event.strength));
    source.connect(gain);
    gain.connect(context.destination);
    source.start(event.time);
  }

  return encodeWav(await context.startRendering());
}

function encodeWav(audio: AudioBuffer): Blob {
  const channelCount = audio.numberOfChannels;
  const dataSize = audio.length * channelCount * 2;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, index) => audio.getChannelData(index));
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  const scale = peak > 0.98 ? 0.98 / peak : 1;
  let offset = 44;

  for (let frame = 0; frame < audio.length; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] * scale));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }

  return new Blob([bytes], { type: "audio/wav" });
}
