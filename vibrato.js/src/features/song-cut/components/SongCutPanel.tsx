import { useEffect, useRef, useState } from 'react';
import { decodeSong, encodeSongCut, packSongCuts, planSongCuts } from '../engine/songCut';
import './SongCutPanel.css';

type Result = { name: string; url: string; blob: Blob };

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}

export function SongCutPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const urls = useRef<string[]>([]);
  const generation = useRef(0);

  useEffect(() => () => {
    generation.current++;
    for (const url of urls.current) URL.revokeObjectURL(url);
  }, []);

  function clearResults() {
    setResults([]); setZipUrl(null); setProgress(0);
    // Keep the original player URL alive.
    urls.current = urls.current.filter((url) => {
      if (url === sourceUrl) return true;
      URL.revokeObjectURL(url); return false;
    });
  }

  async function loadFile(next: File) {
    const token = ++generation.current;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setResults([]); setZipUrl(null); setSourceUrl(null); setAudio(null);
    setFile(next); setError(''); setBusy(true); setProgress(0);
    try {
      const decoded = await decodeSong(next);
      if (token !== generation.current) return;
      const url = URL.createObjectURL(next); urls.current.push(url);
      setSourceUrl(url); setAudio(decoded); setStart(0);
      setEnd(Math.min(120, decoded.duration));
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'Error al cargar.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  let selectionError = '';
  let plan: ReturnType<typeof planSongCuts> = [];
  if (audio) {
    try { plan = planSongCuts(audio.sampleRate, audio.length, start, end); }
    catch (cause) { selectionError = cause instanceof Error ? cause.message : 'Intervalo inválido.'; }
  }

  async function generate() {
    if (!audio || busy || !plan.length) return;
    const token = ++generation.current;
    const created: string[] = [];
    clearResults(); setBusy(true); setError('');
    const base = (file?.name.replace(/\.[^.]+$/, '') || 'song').replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const next: Result[] = [];
      for (const segment of plan) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (token !== generation.current) return;
        const blob = encodeSongCut(audio, segment);
        const name = `${base}_${String(segment.index + 1).padStart(2, '0')}.wav`;
        const url = URL.createObjectURL(blob); created.push(url);
        next.push({ name, blob, url });
        setProgress(Math.round((segment.index + 1) / plan.length * 90));
      }
      const manifest = new Blob([JSON.stringify({
        source: file?.name, start, end, sampleRate: audio.sampleRate,
        instruction: 'Coloca todos los WAV en pistas separadas desde el segundo 0. El silencio inicial conserva la posición relativa a la selección.',
        segments: plan.map((segment, i) => ({ ...segment, file: next[i].name })),
      }, null, 2)], { type: 'application/json' });
      const zip = await packSongCuts([...next, { name: 'manifest.json', blob: manifest }]);
      if (token !== generation.current) return;
      const archiveUrl = URL.createObjectURL(zip); created.push(archiveUrl);
      urls.current.push(...created); created.length = 0;
      setResults(next); setZipUrl(archiveUrl); setProgress(100);
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : 'No se pudieron generar los cortes.');
    } finally {
      for (const url of created) URL.revokeObjectURL(url);
      if (token === generation.current) setBusy(false);
    }
  }

  return (
    <section className="song-cut">
      <header><h2>Vibrato Song Cut</h2><p>Cortes de 6 segundos con silencio inicial acumulado.</p></header>
      <label className="song-cut-upload">Cargar canción
        <input type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" disabled={busy}
          onChange={(event) => { const next = event.target.files?.[0]; if (next) void loadFile(next); event.target.value = ''; }} />
      </label>
      {sourceUrl && <audio ref={player} controls src={sourceUrl} onTimeUpdate={() => {
        if (player.current && player.current.currentTime >= end) player.current.pause();
      }} />}
      {audio && <>
        <p>{file?.name} · {formatTime(audio.duration)}</p>
        <div className="song-cut-fields">
          <label>Inicio (segundos)<input type="number" min={0} max={audio.duration} step="0.01" value={start} disabled={busy}
            onChange={(e) => { clearResults(); setStart(Number(e.target.value)); }} /></label>
          <label>Final (segundos)<input type="number" min={0} max={audio.duration} step="0.01" value={end} disabled={busy}
            onChange={(e) => { clearResults(); setEnd(Number(e.target.value)); }} /></label>
        </div>
        <div className="song-cut-actions">
          <button disabled={busy} onClick={() => { clearResults(); setStart(player.current?.currentTime ?? 0); }}>Usar posición como inicio</button>
          <button disabled={busy} onClick={() => { clearResults(); setEnd(player.current?.currentTime ?? 0); }}>Usar posición como final</button>
          <button disabled={busy || !plan.length} onClick={() => {
            if (player.current) { player.current.currentTime = start; void player.current.play().catch(() => setError('No se pudo iniciar la reproducción.')); }
          }}>Escuchar selección</button>
        </div>
        {selectionError ? <p role="alert">{selectionError}</p> : <p>{formatTime(start)} → {formatTime(end)} · {(end - start).toFixed(2)} s · {plan.length} archivos</p>}
        <button className="song-cut-primary" disabled={busy || !plan.length} onClick={() => void generate()}>
          {busy ? `Procesando ${progress}%` : 'Generar cortes y ZIP'}
        </button>
        {busy && <progress max={100} value={progress} aria-label="Progreso de exportación" />}
        <p>Importa todos los archivos desde cero en pistas separadas. El último corte conserva el audio restante aunque dure menos de 6 segundos. Salida WAV PCM de 16 bits.</p>
        {zipUrl && <a className="song-cut-download" href={zipUrl} download="vibrato-song-cut.zip">Descargar todos (.zip)</a>}
        <div className="song-cut-table"><table>
          <thead><tr><th>Archivo</th><th>Origen</th><th>Silencio inicial</th><th>Duración total</th><th>Descarga</th></tr></thead>
          <tbody>{plan.map((segment, i) => <tr key={segment.index}>
            <td>{i + 1}</td><td>{formatTime(segment.sourceStart)} – {formatTime(segment.sourceEnd)}</td>
            <td>{segment.silence.toFixed(2)} s</td><td>{segment.duration.toFixed(2)} s</td>
            <td>{results[i] ? <a href={results[i].url} download={results[i].name}>WAV</a> : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
