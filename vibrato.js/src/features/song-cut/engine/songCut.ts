export type CutSegment = {
  index: number;
  sourceStart: number;
  sourceEnd: number;
  silence: number;
  duration: number;
  startSample: number;
  endSample: number;
  paddingSamples: number;
};

export function planSongCuts(
  sampleRate: number,
  audioLength: number,
  start: number,
  end: number,
): CutSegment[] {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 ||
      !Number.isInteger(audioLength) || audioLength <= 0 ||
      !Number.isFinite(start) || !Number.isFinite(end) ||
      start < 0 || end <= start || end - start > 120 ||
      end > audioLength / sampleRate) {
    throw new Error('Selecciona un intervalo válido de hasta 120 segundos.');
  }
  const first = Math.round(start * sampleRate);
  const last = Math.min(audioLength, Math.round(end * sampleRate));
  if (last <= first) throw new Error('El intervalo es demasiado corto.');
  const step = sampleRate * 6;
  const segments: CutSegment[] = [];
  for (let position = first; position < last; position += step) {
    const stop = Math.min(last, position + step);
    segments.push({
      index: segments.length,
      sourceStart: position / sampleRate,
      sourceEnd: stop / sampleRate,
      silence: (position - first) / sampleRate,
      duration: (stop - first) / sampleRate,
      startSample: position,
      endSample: stop,
      paddingSamples: position - first,
    });
  }
  return segments;
}

export async function decodeSong(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('No se pudo decodificar el audio. Prueba con otro MP3 o WAV válido.');
  } finally {
    await context.close();
  }
}

// PCM WAV evita añadir un nuevo retardo de codificador MP3 en cada corte.
export function encodeSongCut(audio: AudioBuffer, segment: CutSegment): Blob {
  const channels = audio.numberOfChannels;
  const frames = segment.paddingSamples + segment.endSample - segment.startSample;
  const dataSize = frames * channels * 2;
  if (dataSize > 0xffffffff - 36) throw new Error('El archivo WAV es demasiado grande.');
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, dataSize, true);
  const source = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
  let offset = 44 + segment.paddingSamples * channels * 2;
  for (let frame = segment.startSample; frame < segment.endSample; frame++) {
    for (const channel of source) {
      const value = Math.max(-1, Math.min(1, channel[frame]));
      view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

// ZIP sin compresión: WAV ya se prepara individualmente y no requiere dependencias.
export async function packSongCuts(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const d = new DataView(entry.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true);
    d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
    d.setUint16(14, 33, true); d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(header, file.blob); directory.push(entry);
    offset += header.length + data.length;
    if (offset > 0xffffffff) throw new Error('El ZIP es demasiado grande.');
  }
  const directorySize = directory.reduce((sum, item) => sum + item.length, 0);
  const footer = new Uint8Array(22);
  const f = new DataView(footer.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, files.length, true); f.setUint16(10, files.length, true);
  f.setUint32(12, directorySize, true); f.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, footer], { type: 'application/zip' });
}
