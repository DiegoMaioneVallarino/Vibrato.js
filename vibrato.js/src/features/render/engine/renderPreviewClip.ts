import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";

import {
  getFrequencyAtTime,
} from "../../audio/analysis/analyzeFrequencyBands";

import type {
  FrequencyAnalysis,
} from "../../audio/analysis/analyzeFrequencyBands";

import {
  mapAudioToValue,
} from "../../reactivity/engine/mapAudioToValue";

import type {
  ReactiveMapping,
} from "../../reactivity/engine/mapAudioToValue";

import {
  renderReactiveFrame,
} from "../../visualizer/shaders/renderReactiveFrame";

export type AudioBand = "low" | "mid" | "high";

type RenderPreviewClipOptions = {
  audioFile: File;
  analysis: FrequencyAnalysis;
  startTime: number;
  duration: number;
  band: AudioBand;
  mapping: ReactiveMapping;
  onProgress?: (progress: number) => void;
};

const FPS = 30;
const WIDTH = 640;
const HEIGHT = 360;

export async function renderPreviewClip({
  audioFile,
  analysis,
  startTime,
  duration,
  band,
  mapping,
  onProgress,
}: RenderPreviewClipOptions): Promise<Blob> {
  const audioContext = new AudioContext();

  let decodedAudio: AudioBuffer;

  try {
    const fileData = await audioFile.arrayBuffer();

    decodedAudio = await audioContext.decodeAudioData(fileData);
  } finally {
    await audioContext.close();
  }

  const availableDuration = Math.min(
    decodedAudio.duration,
    analysis.duration
  );

  const safeStart = Math.max(
    0,
    Math.min(startTime, availableDuration)
  );

  const remainingDuration = availableDuration - safeStart;

  // Redondeamos hacia abajo para que todos los fotogramas tengan
  // la misma duración y el audio no sobrepase el final de la canción.
  const frameCount = Math.floor(
    Math.min(duration, remainingDuration) * FPS
  );

  if (frameCount < 1) {
    throw new Error(
      "No queda suficiente audio en este punto para generar un video."
    );
  }

  const clipDuration = frameCount / FPS;

  const canvas = document.createElement("canvas");

  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const target = new BufferTarget();

  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });

  const videoSource = new CanvasSource(canvas, {
    codec: "vp9",
    quality: new Quality({ bitrate: 2_000_000 }),
  });

  const audioSource = new AudioBufferSource({
    codec: "opus",
    quality: new Quality({ bitrate: 128_000 }),
  });

  output.addVideoTrack(videoSource, {
    frameRate: FPS,
  });

  output.addAudioTrack(audioSource);

  await output.start();

  async function writeVideo() {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const videoTime = frameIndex / FPS;
      const songTime = safeStart + videoTime;

      const point = getFrequencyAtTime(analysis, songTime);

      if (!point) {
        throw new Error(
          "No se encontraron datos de frecuencias para este fotograma."
        );
      }

      const reactivity = mapAudioToValue(point[band], mapping);

      renderReactiveFrame(canvas, {
        time: songTime,
        reactivity,
      });

      // El tiempo del video empieza en cero, aunque el fragmento
      // comience más adelante dentro de la canción.
      await videoSource.add(videoTime, 1 / FPS);

      onProgress?.((frameIndex + 1) / frameCount);
    }

    videoSource.close();
  }

  async function writeAudio() {
    const sampleRate = decodedAudio.sampleRate;

    const startSample = Math.floor(safeStart * sampleRate);

    const totalSamples = Math.min(
      Math.floor(clipDuration * sampleRate),
      decodedAudio.length - startSample
    );

    // Alimentamos el audio en fragmentos de un segundo.
    const chunkSize = sampleRate;

    for (
      let offset = 0;
      offset < totalSamples;
      offset += chunkSize
    ) {
      const length = Math.min(
        chunkSize,
        totalSamples - offset
      );

      const chunk = new AudioBuffer({
        length,
        numberOfChannels: decodedAudio.numberOfChannels,
        sampleRate,
      });

      for (
        let channel = 0;
        channel < decodedAudio.numberOfChannels;
        channel++
      ) {
        const source = decodedAudio.getChannelData(channel);

        const slice = source.subarray(
          startSample + offset,
          startSample + offset + length
        );

        chunk.copyToChannel(slice, channel);
      }

      await audioSource.add(chunk);
    }

    audioSource.close();
  }

  try {
    // Ambas pistas avanzan de forma concurrente para que el
    // codificador pueda intercalarlas mientras escribe el archivo.
    await Promise.all([
      writeVideo(),
      writeAudio(),
    ]);

    await output.finalize();

    if (!target.buffer) {
      throw new Error("No se pudo obtener el video generado.");
    }

    return new Blob([target.buffer], {
      type: "video/webm",
    });
  } catch (error) {
    await output.cancel();
    throw error;
  }
}