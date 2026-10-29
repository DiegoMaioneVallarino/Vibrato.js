import { useEffect, useRef, useState } from "react";

import {
  decomposeDrumEvents,
  expandDrumComponents,
  getDrumFragmentBounds,
  getDrumGroups,
  DRUM_KINDS,
  DRUM_LABELS,
  rebuildDrums,
  scanDrums,
} from "../engine/drumEngine";

import type {
  DrumCatalog,
  DrumComponent,
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
  const [catalog, setCatalog] = useState<DrumCatalog>({});
  const [events, setEvents] = useState<DrumEvent[]>([]);
  const stemBufferRef = useRef<AudioBuffer | null>(null);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
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
      const { start, end } = getDrumFragmentBounds(event, events, buffer.duration);
      const length = end - start;
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

  async function handleScan() {
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    setStatus("Detectando golpes y comparando sus huellas de audio...");

    try {
      const result = await scanDrums(file, sensitivity);
      setCatalog({});
      setEvents(result.events);
      stemBufferRef.current = result.audio;
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

  function updateCatalog(id: string, entry: DrumCatalog[string]) {
    setCatalog((current) => ({ ...current, [id]: entry }));
    setEvents((current) => current.map((event) => ({ ...event, components: undefined, fitError: undefined, classified: false })));
    setResultUrl(null);
  }

  function updateComponents(id: string, components: DrumComponent[]) {
    updateEvent(id, { components, classified: false, fitError: undefined });
  }

  async function handleDecompose() {
    const audio = stemBufferRef.current;
    if (!audio || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Comparando cada aparición con las referencias primarias...");
    try {
      const proposed = await decomposeDrumEvents(audio, events, catalog);
      setEvents(proposed);
      setResultUrl(null);
      setStatus("Propuestas listas. Revisa los componentes y confirma cada aparición antes de reconstruir.");
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "No se pudo analizar la composición.");
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
  const confirmedComponents = expandDrumComponents(events.filter((event) => event.classified !== false));
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
              setCatalog({});
              setEvents([]);
              stemBufferRef.current = null;
              previewSourceRef.current?.stop();
              previewSourceRef.current = null;
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
            <span>{confirmedComponents.filter((event) => event.kind === kind).length} golpes asignados</span>
            <input
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(change) => {
                const sample = change.target.files?.[0];
                if (!sample) return;
                setSamples((current) => ({ ...current, [kind]: sample }));
                setResultUrl(null);
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
          <fieldset className="drum-controls" disabled={busy}>
            <legend>2. Analizar composición</legend>
            <button type="button" onClick={handleDecompose}>Analizar apariciones con los primarios</button>
            <p>Primero marca todos los grupos. Solo los primarios confirmados se usan como referencias. Cambiar el catálogo invalida las propuestas anteriores; volver a analizar reemplaza las correcciones de componentes.</p>
          </fieldset>
          <section aria-labelledby="sample-groups-heading">
            <div className="drum-event-heading">
              <h3 id="sample-groups-heading">
                1. Catálogo de grupos: {groups.length}
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
                    const entry = catalog[cluster.id] ?? { mode: "pending" as const, kind: "kick" as const, referenceId: groupEvents[0].id };
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
                          <select aria-label={`Rol del grupo ${index + 1}`} value={entry.mode} disabled={busy}
                            onChange={(change) => updateCatalog(cluster.id, { ...entry, mode: change.target.value as "pending" | "primary" | "compound" })}>
                            <option value="pending">Por revisar</option>
                            <option value="primary">Primario limpio</option>
                            <option value="compound">Compuesto / interpuesto</option>
                          </select>
                          {entry.mode === "primary" && <>
                            <select aria-label="Instrumento primario" value={entry.kind} disabled={busy}
                              onChange={(change) => updateCatalog(cluster.id, { ...entry, kind: change.target.value as DrumKind })}>
                              {DRUM_KINDS.map((kind) => <option key={kind} value={kind}>{DRUM_LABELS[kind]}</option>)}
                            </select>
                            <select aria-label="Aparición limpia de referencia" value={entry.referenceId} disabled={busy}
                              onChange={(change) => updateCatalog(cluster.id, { ...entry, referenceId: change.target.value })}>
                              {groupEvents.map((event) => <option key={event.id} value={event.id}>{formatTime(event.time)}</option>)}
                            </select>
                            <button type="button" disabled={busy} onClick={() => {
                              const reference = groupEvents.find((event) => event.id === entry.referenceId);
                              if (reference) void listenToHit(reference);
                            }}>Escuchar referencia</button>
                          </>}
                        </td>
                        <td>
                          {entry.mode === "primary" ? "Referencia para el análisis" : entry.mode === "compound" ? "Se analizará con los primarios" : "Pendiente"}
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

          <p>2. Revisa cada aparición: activa sus componentes, ajusta sus tiempos relativos e intensidades y confirma. Un grupo compuesto no es un instrumento nuevo.</p>
          <div className="drum-event-table">
            <table>
              <thead>
                <tr><th>Tiempo</th><th>Tipo de drum</th><th>Intensidad</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {[...events].sort((a, b) => a.time - b.time).map((event) => (
                  <tr key={event.id}>

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
                          time: Math.max(0, Math.min(duration, Number(change.target.value))), classified: false, fitError: undefined,
                        })}
                      />
                    </td>
                    <td>
                      {DRUM_KINDS.map((kind) => {
                        const component = event.components?.find((item) => item.kind === kind);
                        const components = event.components ?? [];
                        return <div key={kind}>
                          <label><input type="checkbox" disabled={busy} checked={Boolean(component)}
                            onChange={(change) => updateComponents(event.id, change.target.checked
                              ? [...components, { kind, offset: 0, strength: event.strength }]
                              : components.filter((item) => item.kind !== kind))} />{DRUM_LABELS[kind]}</label>
                          {component && <>
                            <label>Desplazamiento (s)<input type="number" step={0.001} min={-event.time} max={duration - event.time}
                              disabled={busy} value={component.offset} onChange={(change) => {
                                const offset = Number(change.target.value);
                                if (Number.isFinite(offset)) updateComponents(event.id, components.map((item) => item.kind === kind ? { ...item, offset } : item));
                              }} /></label>
                            <label>Intensidad<input type="number" min={0} max={1} step={0.05} disabled={busy} value={component.strength}
                              onChange={(change) => updateComponents(event.id, components.map((item) => item.kind === kind
                                ? { ...item, strength: Math.max(0, Math.min(1, Number(change.target.value))) } : item))} /></label>
                          </>}
                        </div>;
                      })}
                      {event.fitError !== undefined && <small>Error residual: {Math.round(event.fitError * 100)}% (no es probabilidad). Revisa la propuesta.</small>}
                      <button type="button" disabled={busy || !event.components?.length || event.classified === true}
                        onClick={() => updateEvent(event.id, { classified: true })}>
                        {event.classified === true ? "Confirmado" : "Confirmar componentes"}
                      </button>
                    </td>
                    <td>
                      <input
                        aria-label="Intensidad del golpe"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={event.strength}
                        disabled={busy || event.components !== undefined}
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
