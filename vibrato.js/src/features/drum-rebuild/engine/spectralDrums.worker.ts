import { analyzeSpectralPCM } from './spectralDrumsCore';
self.onmessage = (event: MessageEvent<{ pcm: Float32Array; rate: number; count: number; sensitivity: number }>) => {
  try {
    const { pcm, rate, count, sensitivity } = event.data;
    const result = analyzeSpectralPCM(pcm, rate, count, sensitivity, (value) => self.postMessage({ type: 'progress', value }));
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Error en el análisis espectral.' });
  }
};
