import type { DrumEvent, DrumKind } from './drumEngine';
import type { SpectralResult } from './spectralDrumsCore';
export type { SpectralResult } from './spectralDrumsCore';
export type SpectralLabels = Record<number, DrumKind | 'ignore' | 'unassigned'>;

export async function analyzeSpectralDrums(
  file: File, count: number, sensitivity: number,
  progress: (value: number) => void, signal: AbortSignal
): Promise<{ audio: AudioBuffer; result: SpectralResult }> {
  const context = new AudioContext();
  let audio: AudioBuffer;
  try { audio = await context.decodeAudioData(await file.arrayBuffer()); }
  finally { await context.close(); }
  if (signal.aborted) throw new Error('Análisis cancelado.');
  let selected = audio.getChannelData(0), largest = -1;
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    let energy = 0;
    for (const value of data) energy += value * value;
    if (energy > largest) { largest = energy; selected = data; }
  }
  const rate = 12000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * rate)), rate);
  const input = offline.createBuffer(1, audio.length, audio.sampleRate);
  input.copyToChannel(selected, 0);
  const source = offline.createBufferSource();
  source.buffer = input;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  if (signal.aborted) throw new Error('Análisis cancelado.');
  const pcm = rendered.getChannelData(0).slice();
  const result = await new Promise<SpectralResult>((resolve, reject) => {
    const worker = new Worker(new URL('./spectralDrums.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('Análisis cancelado.')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('No se pudo ejecutar el análisis espectral.')); };
    worker.onmessage = (message: MessageEvent<
      { type: 'progress'; value: number } | { type: 'result'; result: SpectralResult } | { type: 'error'; message: string }
    >) => {
      if (message.data.type === 'progress') progress(message.data.value);
      else if (message.data.type === 'error') { cleanup(); reject(new Error(message.data.message)); }
      else { cleanup(); resolve(message.data.result); }
    };
    if (signal.aborted) { abort(); return; }
    worker.postMessage({ pcm, rate, count, sensitivity }, [pcm.buffer]);
  });
  return { audio, result };
}

export function spectralEvents(result: SpectralResult, labels: SpectralLabels): DrumEvent[] {
  if (result.components.some((component) => !labels[component.id] || labels[component.id] === 'unassigned')) {
    throw new Error('Etiqueta todos los componentes o márcalos como ignorados.');
  }
  const onsets: { kind: DrumKind; time: number; strength: number }[] = [];
  for (const component of result.components) {
    const kind = labels[component.id];
    if (kind === 'ignore' || kind === 'unassigned') continue;
    for (const onset of component.onsets) onsets.push({ ...onset, kind });
  }
  const unique: typeof onsets = [];
  for (const hit of onsets.sort((a, b) => b.strength - a.strength)) {
    if (!unique.some((other) => other.kind === hit.kind && Math.abs(other.time - hit.time) < 0.035)) unique.push(hit);
  }
  const events: DrumEvent[] = [];
  for (const hit of unique.sort((a, b) => a.time - b.time)) {
    const previous = events[events.length - 1];
    if (previous && hit.time - previous.time < 0.02 && !previous.components?.some((component) => component.kind === hit.kind)) {
      previous.components!.push({ kind: hit.kind, offset: hit.time - previous.time, strength: hit.strength });
    } else {
      events.push({ id: crypto.randomUUID(), kind: hit.kind, time: hit.time, strength: hit.strength, classified: false,
        components: [{ kind: hit.kind, offset: 0, strength: hit.strength }] });
    }
  }
  if (!events.length) throw new Error('No hay ataques utilizables con las etiquetas seleccionadas.');
  return events;
}
