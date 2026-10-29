import { useEffect, useRef, useState } from "react";

import {
  classifyDrumEvents,
  getDrumGroups,
  DRUM_KINDS,
  DRUM_LABELS,
  rebuildDrums,
  scanDrums,
} from "../engine/drumEngine";

import type {
  DrumEvent,
  DrumKind,
  DrumSamples,
} from "../engine/drumEngine";

import { DrumBenchmarkPanel } from "./DrumBenchmarkPanel";
import "./DrumRebuildPanel.css";

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  return `${minutes}:${remainder.toString().padStart(2, "0")}.${milliseconds
    .toString()
    .padStart(3, "0")}`;
}

export function DrumRebuildPanel() {
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);
  const resultAudioRef = useRef<HTMLAudioElement | null>(null);
  const samplePreviewRef = useRef<HTMLAudioElement | null>(null);
  const samplePreviewUrlRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<DrumEvent[]>([]);
  const stemBufferRef = useRef<AudioBuffer | null>(null);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [correctionKind, setCorrectionKind] = useState<DrumKind>("snare");
  const [duration, setDuration] = useState(0);
  const [samples, setSamples] = useState<DrumSamples>({});
  const [sensitivity, setSensitivity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setOriginalUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  useEffect(() => {
    return () => {
      samplePreviewRef.current?.pause();
      previewSourceRef.current?.stop();
      void previewContextRef.current?.close();
      if (samplePreviewUrlRef.current) {
        URL.revokeObjectURL(samplePreviewUrlRef.current);
      }
    };
  }, []);

  async function listenToHit(event: DrumEvent) {
    const buffer = stemBufferRef.current;
    if (!buffer) return;
    originalAudioRef.current?.pause();
    resultAudioRef.current?.pause();
    samplePreviewRef.current?.pause();
    previewSourceRef.current?.stop();
    previewSourceRef.current = null;
    try {
      const context = previewContextRef.current ?? new AudioContext();
      previewContextRef.current = context;
      await context.resume();
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const next = events.filter((hit) => hit.time > event.time + 0.01)
        .reduce((time, hit) => Math.min(time, hit.time), buffer.duration);
      const start = Math.max(0, Math.min(event.time, buffer.duration));
      const length = Math.min(0.2, next - start, buffer.duration - start);
      if (length <= 0) return;
      previewSourceRef.current = source;
      source.onended = () => {
        source.disconnect();
        if (previewSourceRef.current === source) previewSourceRef.current = null;
      };
      source.start(0, start, length);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "No se pudo escuchar el golpe.");
    }
  }

  function previewSample(sample: File) {
    originalAudioRef.current?.pause();
    resultAudioRef.current?.pause();
    previewSourceRef.current?.stop();
    previewSourceRef.current = null;
    const url = URL.createObjectURL(sample);
    const blobUrlPlayer = new Audio(url);
    samplePreviewRef.current?.pause();
    if (samplePreviewUrlRef.current) URL.revokeObjectURL(samplePreviewUrlRef.current);
    samplePreviewRef.current = blobUrlPlayer;
    samplePreviewUrlRef.current = url;
    blobUrlPlayer.onended = () => {
      URL.revokeObjectURL(url);
      if (samplePreviewUrlRef.current === url) {
        samplePreviewUrlRef.current = null;
        samplePreviewRef.current = null;
      }
    };
    void blobUrlPlayer.play().catch(() => {
      setError(`El navegador no pudo reproducir "${sample.name}".`);
      URL.revokeObjectURL(url);
      samplePreviewUrlRef.current = null;
      samplePreviewRef.current = null;
    });
  }

  function updateEvent(id: string, changes: Partial<DrumEvent>) {
    setResultUrl(null);
    setEvents((current) =>
      current.map((event) => (event.id === id ? { ...event, ...changes } : event))
    );
  }

  function correctHits(ids: readonly string[], kind: DrumKind | null) {
    setEvents((current) => classifyDrumEvents(current, ids, kind));
    setResultUrl(null);
    setError(null);
    setStatus(`${ids.length} golpes corregidos. Se conservaron sus tiempos; vuelve a generar el audio.`);
  }

  function classifyCluster(clusterId: string, kind: DrumKind | null) {
    correctHits(events.filter((event) => (event.clusterId ?? event.id) === clusterId)
      .map((event) => event.id), kind);
  }

  async function handleScan() {
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    setStatus("Detectando golpes y comparando sus huellas de audio...");

    try {
      const result = await scanDrums(file, sensitivity);
      setEvents(result.events);
      stemBufferRef.current = result.audio;
      setSelectedIds([]);
      setResultUrl(null);
      setDuration(result.duration);
      setStatus(
        `${result.events.length} golpes detectados y agrupados en ${result.clusters.length} tipos de sample. Escucha cada grupo y asígnale su instrumento.`
      );
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "No se pudo analizar el audio.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleRebuild() {
    if (busy || events.length === 0) return;

    originalAudioRef.current?.pause();
    setBusy(true);
    setError(null);
    setStatus("Reconstruyendo con tus samples...");

    try {
      const blob = await rebuildDrums(events, samples, duration);
      setResultUrl(URL.createObjectURL(blob));
      setStatus("WAV generado. Compara el resultado con el original.");
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "No se pudo reconstruir la batería.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const groups = getDrumGroups(events);
  const classifiedCount = events.filter((event) => event.classified !== false).length;

  return (
    <section className="drum-rebuild">
      <header className="drum-heading">
        <div>
          <span className="eyebrow">LABORATORIO DE AUDIO</span>
          <h2>Reconstrucción de batería</h2>
        </div>
        <span>Experimental</span>
      </header>

      <p className="drum-description">
        Carga un stem de batería. Vibrato detecta golpes y agrupa repeticiones
        similares; tú escuchas cada grupo y decides qué instrumento es.
      </p>

      <fieldset className="drum-controls" disabled={busy}>
        <label>
          <span>Stem de batería</span>
          <input
            type="file"
            accept="audio/*"
            onChange={(change) => {
              const selected = change.target.files?.[0];
              if (!selected) return;

              originalAudioRef.current?.pause();
              samplePreviewRef.current?.pause();
              setFile(selected);
              setEvents([]);
              stemBufferRef.current = null;
              previewSourceRef.current?.stop();
              previewSourceRef.current = null;
              setSelectedIds([]);
              setDuration(0);
              setResultUrl(null);
              setStatus("");
              setError(null);
              change.target.value = "";
            }}
          />
        </label>

        <label>
          <span>Sensibilidad: {sensitivity.toFixed(1)}</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={sensitivity}
            onChange={(change) => setSensitivity(Number(change.target.value))}
          />
        </label>

        <button type="button" className="button button-primary" disabled={!file} onClick={handleScan}>
          Analizar y agrupar
        </button>
      </fieldset>

      {originalUrl && (
        <div className="drum-player">
          <strong>Stem original: {file?.name}</strong>
          <audio ref={originalAudioRef} src={originalUrl} controls onPlay={() => {
            resultAudioRef.current?.pause();
            samplePreviewRef.current?.pause();
            previewSourceRef.current?.stop();
            previewSourceRef.current = null;
          }} />
        </div>
      )}

      <div className="drum-samples">
        {DRUM_KINDS.map((kind) => (
          <label key={kind} className="drum-sample">
            <strong>{DRUM_LABELS[kind]}</strong>
            <span>{events.filter((event) => event.classified !== false && event.kind === kind).length} golpes asignados</span>
            <input
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(change) => {
                const sample = change.target.files?.[0];
                if (!sample) return;
                setSamples((current) => ({ ...current, [kind]: sample }));
                setError(null);
                previewSample(sample);
                change.target.value = "";
              }}
            />
            <small>{samples[kind]?.name ?? "Sin sample de reemplazo"}</small>
          </label>
        ))}
      </div>

      {duration > 0 && (
        <>
          <section aria-labelledby="sample-groups-heading">
            <div className="drum-event-heading">
              <h3 id="sample-groups-heading">
                Tipos de sample detectados: {groups.length}
              </h3>
              <span>{events.length} golpes · {classifiedCount} clasificados</span>
            </div>

            <div className="drum-event-table">
              <table>
                <thead>
                  <tr>
                    <th>Grupo / repeticiones</th>
                    <th>Ocurrencias</th>
                    <th>Tipo de drum (manual)</th>
                    <th>Revisión</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((cluster, index) => {
                    const groupEvents = cluster.events;
                    const selectedKind = cluster.kind;
                    const visibleTimes = groupEvents.slice(0, 8);

                    return (
                      <tr key={cluster.id}>
                        <td>
                          <strong>Sample {index + 1}</strong>
                          <div>
                            <button type="button" disabled={busy} onClick={() => void listenToHit(groupEvents[0])}>
                              Escuchar primera aparición
                            </button>
                          </div>
                        </td>
                        <td>
                          <strong>{cluster.count} veces</strong>
                          <div className="drum-occurrence-times">
                            {visibleTimes.map((event) => formatTime(event.time)).join(" · ")}
                            {groupEvents.length > visibleTimes.length && ` · +${groupEvents.length - visibleTimes.length} más`}
                          </div>
                        </td>
                        <td>
                          <select
                            aria-label={`Tipo de drum para el sample ${index + 1}`}
                            value={selectedKind ?? "unassigned"}
                            disabled={busy}
                            onChange={(change) =>
                              classifyCluster(
                                cluster.id,
                                change.target.value === "unassigned"
                                  ? null
                                  : (change.target.value as DrumKind)
                              )
                            }
                          >
                            <option value="unassigned">Por clasificar</option>
                            {DRUM_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{DRUM_LABELS[kind]}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button type="button" disabled={busy} onClick={() =>
                            setSelectedIds(groupEvents.map((event) => event.id))
                          }>Seleccionar apariciones</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="drum-event-heading">
            <h3>Golpes: {events.length}</h3>
            <button
              type="button"
              className="button button-outline"
              disabled={busy}
              onClick={() => {
                const time = Math.max(0, Math.min(duration, originalAudioRef.current?.currentTime ?? 0));
                setResultUrl(null);
                setEvents((current) => [
                  ...current,
                  { id: crypto.randomUUID(), clusterId: null, kind: "kick", classified: false, time, strength: 1 },
                ]);
              }}
            >
              + Golpe en el cursor
            </button>
          </div>

          <fieldset className="drum-controls" disabled={busy || selectedIds.length === 0}>
            <legend>Separar y corregir golpes seleccionados ({selectedIds.length})</legend>
            <label>
              Tipo correcto
              <select value={correctionKind} onChange={(change) => setCorrectionKind(change.target.value as DrumKind)}>
                {DRUM_KINDS.map((kind) => <option key={kind} value={kind}>{DRUM_LABELS[kind]}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => {
              correctHits(selectedIds, correctionKind);
              setSelectedIds([]);
            }}>Aplicar solo a los seleccionados</button>
            <button type="button" onClick={() => setSelectedIds([])}>Limpiar selección</button>
          </fieldset>
          <p>Escucha cada golpe y marca los que necesitan corrección. El recorte conserva el audio del stem: no separa instrumentos que suenen simultáneamente.</p>

          <div className="drum-event-table">
            <table>
              <thead>
                <tr><th>Seleccionar</th><th>Tiempo</th><th>Tipo de drum</th><th>Intensidad</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {[...events].sort((a, b) => a.time - b.time).map((event) => (
                  <tr key={event.id}>
                    <td><input type="checkbox" aria-label={`Seleccionar golpe en ${formatTime(event.time)}`}
                      checked={selectedIds.includes(event.id)} disabled={busy}
                      onChange={(change) => setSelectedIds((current) => change.target.checked
                        ? [...current, event.id] : current.filter((id) => id !== event.id))} /></td>
                    <td>
                      <input
                        aria-label="Tiempo del golpe"
                        type="number"
                        min={0}
                        max={duration}
                        step={0.001}
                        value={event.time}
                        disabled={busy}
                        onChange={(change) => updateEvent(event.id, {
                          time: Math.max(0, Math.min(duration, Number(change.target.value))),
                        })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="Categoría del golpe"
                        value={event.classified === false ? "unassigned" : event.kind}
                        disabled={busy}
                        onChange={(change) => {
                          if (change.target.value === "unassigned") {
                            correctHits([event.id], null);
                          } else {
                            correctHits([event.id], change.target.value as DrumKind);
                          }
                        }}
                      >
                        <option value="unassigned">Por clasificar</option>
                        {DRUM_KINDS.map((kind) => <option key={kind} value={kind}>{DRUM_LABELS[kind]}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Intensidad del golpe"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={event.strength}
                        disabled={busy}
                        onChange={(change) => updateEvent(event.id, {
                          strength: Math.max(0, Math.min(1, Number(change.target.value))),
                        })}
                      />
                    </td>
                    <td>
                      <div className="drum-row-actions">
                        <button type="button" disabled={busy} onClick={() => void listenToHit(event)}>Escuchar golpe</button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const audio = originalAudioRef.current;
                            if (audio && audio.readyState >= 1) audio.currentTime = event.time;
                          }}
                        >Ir</button>
                        <button type="button" disabled={busy} onClick={() => {
                          setEvents((current) => current.filter((item) => item.id !== event.id));
                          setSelectedIds((current) => current.filter((id) => id !== event.id));
                          setResultUrl(null);
                        }}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <button
        type="button"
        className="button button-primary"
        onClick={handleRebuild}
        disabled={busy || events.length === 0}
      >
        Reconstruir batería
      </button>

      {status && <p className="drum-status" role="status">{status}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}

      {resultUrl && (
        <div className="drum-player">
          <strong>Última reconstrucción generada</strong>
          <audio ref={resultAudioRef} src={resultUrl} controls onPlay={() => {
            originalAudioRef.current?.pause();
            samplePreviewRef.current?.pause();
            previewSourceRef.current?.stop();
            previewSourceRef.current = null;
          }} />
          <a href={resultUrl} download="vibrato-drums.wav">Descargar WAV</a>
        </div>
      )}

      <DrumBenchmarkPanel
        samples={samples}
        sensitivity={sensitivity}
        disabled={busy}
        onBusyChange={setBusy}
      />
    </section>
  );
}
