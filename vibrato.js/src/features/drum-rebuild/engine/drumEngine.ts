export type DrumKind = "kick" | "snare" | "hat";

export type DrumEvent = {
  id: string;
  kind: DrumKind;
  time: number;
  strength: number;
};

export type DrumScan = {
  duration: number;
  events: DrumEvent[];
};

export type DrumSamples = Partial<Record<DrumKind, File>>;

export const DRUM_KINDS: DrumKind[] = [
  "kick",
  "snare",
  "hat",
];

export const DRUM_LABELS: Record<DrumKind, string> = {
  kick: "Kick",
  snare: "Snare / clap",
  hat: "Hi-hat",
};

const HOP_SECONDS = 0.005;
const WINDOW_SECONDS = 0.01;

async function decodeFile(file: File): Promise<AudioBuffer> {
  if (file.size === 0) {
    throw new Error(`El archivo "${file.name}" está vacío.`);
  }

  const context = new AudioContext();

  try {
    const data = await file.arrayBuffer();

    return await context.decodeAudioData(data);
  } catch (error) {
    console.error(`Error al decodificar "${file.name}":`, error);

    throw new Error(
      `No se pudo decodificar "${file.name}". ` +
      "Prueba a exportarlo como WAV PCM de 16 bits y vuelve a cargarlo."
    );
  } finally {
    await context.close();
  }
}

function normalizeSample(
  audio: AudioBuffer,
  fileName: string
): AudioBuffer {
  let peak = 0;

  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const samples = audio.getChannelData(channel);

    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
    }
  }

  if (peak < 0.00001) {
    throw new Error(
      `El sample "${fileName}" está en silencio o tiene un nivel casi nulo.`
    );
  }

  const targetPeak = 0.75;
  const gain = targetPeak / peak;

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

async function filterBand(
  audio: AudioBuffer,
  kind: DrumKind
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    audio.numberOfChannels,
    audio.length,
    audio.sampleRate
  );

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();

  source.buffer = audio;

  if (kind === "kick") {
    filter.type = "lowpass";
    filter.frequency.value = 150;
    filter.Q.value = 0.707;
  } else if (kind === "snare") {
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.8;
  } else {
    filter.type = "highpass";
    filter.frequency.value = 6000;
    filter.Q.value = 0.707;
  }

  source.connect(filter);
  filter.connect(context.destination);
  source.start();

  return context.startRendering();
}

function measureEnergy(audio: AudioBuffer): {
  values: number[];
  hop: number;
} {
  const hop = Math.max(
    1,
    Math.round(audio.sampleRate * HOP_SECONDS)
  );

  const windowSize = Math.max(
    1,
    Math.round(audio.sampleRate * WINDOW_SECONDS)
  );

  const channels = Array.from(
    { length: audio.numberOfChannels },
    (_, index) => audio.getChannelData(index)
  );

  const values: number[] = [];

  for (let start = 0; start < audio.length; start += hop) {
    const end = Math.min(start + windowSize, audio.length);

    let squares = 0;

    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) {
        squares += channel[sample] ** 2;
      }
    }

    values.push(
      Math.sqrt(
        squares / ((end - start) * channels.length)
      )
    );
  }

  return {
    values,
    hop: hop / audio.sampleRate,
  };
}

function detectAttacks(
  audio: AudioBuffer,
  kind: DrumKind,
  sensitivity: number
): DrumEvent[] {
  const { values, hop } = measureEnergy(audio);

  let peakEnergy = 0;

  for (const value of values) {
    peakEnergy = Math.max(peakEnergy, value);
  }

  if (peakEnergy < 0.00001) {
    return [];
  }

  const rises = values.map((value, index) => {
    const previous = index > 0 ? values[index - 1] : 0;

    return Math.max(0, value - previous);
  });

  const minimumGap = {
    kick: 0.09,
    snare: 0.08,
    hat: 0.035,
  }[kind];

  const historyLength = Math.max(1, Math.round(0.15 / hop));

  const safeSensitivity = Math.max(
    0.5,
    Math.min(2, sensitivity)
  );

  const events: DrumEvent[] = [];
  let lastTime = -Infinity;

  for (let index = 0; index < rises.length; index++) {
    const rise = rises[index];

    const previousRise = rises[index - 1] ?? 0;
    const nextRise = rises[index + 1] ?? 0;

    if (rise <= 0 || rise < previousRise || rise <= nextRise) {
      continue;
    }

    const historyStart = Math.max(0, index - historyLength);

    let mean = 0;
    let variance = 0;

    const historyCount = index - historyStart;

    if (historyCount > 0) {
      for (let past = historyStart; past < index; past++) {
        mean += rises[past];
      }

      mean /= historyCount;

      for (let past = historyStart; past < index; past++) {
        variance += (rises[past] - mean) ** 2;
      }

      variance /= historyCount;
    }

    const threshold =
      (mean + Math.sqrt(variance) * 2 + peakEnergy * 0.012)
      / safeSensitivity;

    if (
      rise <= threshold ||
      values[index] < peakEnergy * 0.05
    ) {
      continue;
    }

    // Aproximación al comienzo del ataque.
    // No representa una alineación exacta a nivel de muestra.
    const time = Math.max(0, index * hop - WINDOW_SECONDS / 2);

    if (time - lastTime < minimumGap) {
      continue;
    }

    const localPeak = Math.max(
      values[index],
      values[index + 1] ?? 0,
      values[index + 2] ?? 0
    );

    events.push({
      id: crypto.randomUUID(),
      kind,
      time,
      strength: Math.max(
        0.05,
        Math.min(1, localPeak / peakEnergy)
      ),
    });

    lastTime = time;
  }

  return events;
}

export async function scanDrums(
  file: File,
  sensitivity: number
): Promise<DrumScan> {
  const audio = await decodeFile(file);


  const events: DrumEvent[] = [];

  for (const kind of DRUM_KINDS) {
    const filtered = await filterBand(audio, kind);

    events.push(
      ...detectAttacks(filtered, kind, sensitivity)
    );
  }

  return {
    duration: audio.duration,
    events: events.sort((a, b) => a.time - b.time),
  };
}

export async function rebuildDrums(
  events: DrumEvent[],
  samples: DrumSamples,
  originalDuration: number
): Promise<Blob> {
  if (events.length === 0) {
    throw new Error("No hay eventos para reconstruir.");
  }

  const buffers: Partial<Record<DrumKind, AudioBuffer>> = {};

  const usedKinds = new Set(events.map((event) => event.kind));

  for (const kind of usedKinds) {
    const file = samples[kind];

    if (!file) {
      throw new Error(
        `Falta cargar un sample para ${DRUM_LABELS[kind]}.`
      );
    }

const decodedSample = await decodeFile(file);
buffers[kind] = normalizeSample(decodedSample, file.name);  }

  let outputDuration = originalDuration;

  for (const event of events) {
    if (
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      event.time > originalDuration
    ) {
      throw new Error("Hay un evento fuera de la duración del fragmento.");
    }

    if (!Number.isFinite(event.strength)) {
      throw new Error("Hay un evento con intensidad no válida.");
    }

    const buffer = buffers[event.kind];

    if (buffer) {
      outputDuration = Math.max(
        outputDuration,
        event.time + buffer.duration
      );
    }
  }

  const sampleRate = 48000;

  const context = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(outputDuration * sampleRate)),
    sampleRate
  );

  for (const event of events) {
    const buffer = buffers[event.kind];

    if (!buffer) {
      continue;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();

    source.buffer = buffer;
    gain.gain.value = Math.max(
      0,
      Math.min(1, event.strength)
    );

    source.connect(gain);
    gain.connect(context.destination);

    source.start(event.time);
  }

  const rendered = await context.startRendering();

  return encodeWav(rendered);
}

function encodeWav(audio: AudioBuffer): Blob {
  const channelCount = audio.numberOfChannels;
  const dataSize = audio.length * channelCount * 2;

  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);

  function writeText(offset: number, value: string) {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

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

  const channels = Array.from(
    { length: channelCount },
    (_, index) => audio.getChannelData(index)
  );

  let peak = 0;

  for (const channel of channels) {
    for (const sample of channel) {
      peak = Math.max(peak, Math.abs(sample));
    }
  }

  // Atenúa solo cuando hace falta para evitar clipping al exportar.
  const scale = peak > 0.98 ? 0.98 / peak : 1;

  let offset = 44;

  for (let frame = 0; frame < audio.length; frame++) {
    for (const channel of channels) {
      const sample = Math.max(
        -1,
        Math.min(1, channel[frame] * scale)
      );

      view.setInt16(
        offset,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true
      );

      offset += 2;
    }
  }

  return new Blob([bytes], {
    type: "audio/wav",
  });
}