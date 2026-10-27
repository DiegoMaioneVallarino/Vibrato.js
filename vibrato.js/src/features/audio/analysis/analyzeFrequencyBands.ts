export type FrequencyPoint = {
  time: number;
  low: number;
  mid: number;
  high: number;
};

export type FrequencyAnalysis = {
  duration: number;
  interval: number;
  points: FrequencyPoint[];
};

const ANALYSIS_INTERVAL = 0.05;

type FrequencyBand = {
  name: "low" | "mid" | "high";
  type: BiquadFilterType;
  frequency: number;
};

const FREQUENCY_BANDS: FrequencyBand[] = [
  {
    name: "low",
    type: "lowpass",
    frequency: 150,
  },
  {
    name: "mid",
    type: "bandpass",
    frequency: 550,
  },
  {
    name: "high",
    type: "highpass",
    frequency: 2000,
  },
];

async function decodeAudio(file: File): Promise<AudioBuffer> {
  const audioContext = new AudioContext();

  try {
    const fileBuffer = await file.arrayBuffer();

    return await audioContext.decodeAudioData(fileBuffer);
  } finally {
    await audioContext.close();
  }
}

async function renderBand(
  audioBuffer: AudioBuffer,
  band: FrequencyBand
): Promise<AudioBuffer> {
  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );

  const source = offlineContext.createBufferSource();
  const filter = offlineContext.createBiquadFilter();

  source.buffer = audioBuffer;

  filter.type = band.type;
  filter.frequency.value = band.frequency;

  // En el filtro de medios, Q controla qué tan ancha es la banda.
  if (band.type === "bandpass") {
    filter.Q.value = 0.3;
  }

  source.connect(filter);
  filter.connect(offlineContext.destination);

  source.start(0);

  return offlineContext.startRendering();
}

function calculateRmsValues(
  audioBuffer: AudioBuffer,
  interval: number
): number[] {
  const samplesPerWindow = Math.max(
    1,
    Math.round(audioBuffer.sampleRate * interval)
  );

  const windowCount = Math.ceil(audioBuffer.length / samplesPerWindow);
  const values: number[] = [];

  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channelIndex) => audioBuffer.getChannelData(channelIndex)
  );

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const start = windowIndex * samplesPerWindow;
    const end = Math.min(start + samplesPerWindow, audioBuffer.length);

    let sumOfSquares = 0;
    let sampleCount = 0;

    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
        const sample = channel[sampleIndex];

        sumOfSquares += sample * sample;
        sampleCount++;
      }
    }

    const rms =
      sampleCount > 0 ? Math.sqrt(sumOfSquares / sampleCount) : 0;

    values.push(rms);
  }

  return values;
}

function normalizeValues(values: number[]): number[] {
  let maximum = 0;

  for (const value of values) {
    maximum = Math.max(maximum, value);
  }

  if (maximum === 0) {
    return values.map(() => 0);
  }

  return values.map((value) => (value / maximum) * 100);
}

export async function analyzeFrequencyBands(
  file: File
): Promise<FrequencyAnalysis> {
  const audioBuffer = await decodeAudio(file);

  const bandValues: Record<FrequencyBand["name"], number[]> = {
    low: [],
    mid: [],
    high: [],
  };

  // Se procesan una por una para evitar mantener varias copias filtradas
  // completas en memoria al mismo tiempo.
  for (const band of FREQUENCY_BANDS) {
    const filteredAudio = await renderBand(audioBuffer, band);

    const rmsValues = calculateRmsValues(
      filteredAudio,
      ANALYSIS_INTERVAL
    );

    bandValues[band.name] = normalizeValues(rmsValues);
  }

  const points: FrequencyPoint[] = bandValues.low.map((low, index) => ({
    time: index * ANALYSIS_INTERVAL,
    low,
    mid: bandValues.mid[index] ?? 0,
    high: bandValues.high[index] ?? 0,
  }));

  return {
    duration: audioBuffer.duration,
    interval: ANALYSIS_INTERVAL,
    points,
  };
}

export function getFrequencyAtTime(
  analysis: FrequencyAnalysis,
  time: number
): FrequencyPoint | null {
  if (analysis.points.length === 0) {
    return null;
  }

  const safeTime = Math.max(
    0,
    Math.min(analysis.duration, time)
  );

  const index = Math.min(
    analysis.points.length - 1,
    Math.floor(safeTime / analysis.interval)
  );

  return analysis.points[index] ?? null;
}