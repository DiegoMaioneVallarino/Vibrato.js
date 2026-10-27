export async function generateWaveform(
  file: File,
  numberOfBars = 250
): Promise<number[]> {
  const audioContext = new AudioContext();

  try {
    const arrayBuffer = await file.arrayBuffer();

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelCount = audioBuffer.numberOfChannels;
    const sampleCount = audioBuffer.length;

    const barCount = Math.min(numberOfBars, sampleCount);

    if (barCount <= 0) {
      return [];
    }

    const waveform: number[] = [];

    for (let bar = 0; bar < barCount; bar++) {
      const start = Math.floor((bar / barCount) * sampleCount);
      const end = Math.floor(((bar + 1) / barCount) * sampleCount);

      let peak = 0;

      for (let channel = 0; channel < channelCount; channel++) {
        const channelData = audioBuffer.getChannelData(channel);

        for (let sample = start; sample < end; sample++) {
          peak = Math.max(peak, Math.abs(channelData[sample]));
        }
      }

      waveform.push(peak);
    }

    const maximumPeak = Math.max(...waveform);

    if (maximumPeak === 0) {
      return waveform;
    }

    return waveform.map((peak) => peak / maximumPeak);
  } finally {
    await audioContext.close();
  }
}