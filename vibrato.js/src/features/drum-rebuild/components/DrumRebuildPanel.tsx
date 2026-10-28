import { useEffect, useRef, useState } from "react";

import {
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

import "./DrumRebuildPanel.css";

export function DrumRebuildPanel() {
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const [events, setEvents] = useState<DrumEvent[]>([]);
  const [duration, setDuration] = useState(0);
  const [samples, setSamples] = useState<DrumSamples>({});

  const [sensitivity, setSensitivity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);

    setOriginalUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [resultUrl]);

  function updateEvent(
    id: string,
    changes: Partial<DrumEvent>
  ) {
    setEvents((current) =>
      current.map((event) =>
        event.id === id
          ? { ...event, ...changes }
          : event
      )
    );
  }

  async function handleScan() {
    if (!file || busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Analizando ataques por bandas...");

    try {
      const result = await scanDrums(file, sensitivity);

      setEvents(result.events);
      setDuration(result.duration);

      setStatus(
        `${result.events.length} candidatos detectados. Revisa sus categorías y tiempos.`
      );
    } catch (scanError) {
      setError(
        scanError instanceof Error
          ? scanError.message
          : "No se pudo analizar el audio."
      );

      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function handleRebuild() {
    if (busy || events.length === 0) {
      return;
    }

    originalAudioRef.current?.pause();

    setBusy(true);
    setError(null);
    setStatus("Reconstruyendo con tus samples...");

    try {
      const blob = await rebuildDrums(
        events,
        samples,
        duration
      );

      setResultUrl(URL.createObjectURL(blob));
      setStatus("WAV generado. Compara el resultado con el original.");
    } catch (renderError) {
      setError(
        renderError instanceof Error
          ? renderError.message
          : "No se pudo reconstruir la batería."
      );

      setStatus("");
    } finally {
      setBusy(false);
    }
  }

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
        Carga un stem de batería de hasta 60 segundos.
        Los golpes detectados son candidatos editables.
      </p>

      <fieldset className="drum-controls" disabled={busy}>
        <label>
          <span>Audio original</span>

          <input
            type="file"
            accept="audio/*"
            onChange={(event) => {
              const selected = event.target.files?.[0];

              if (!selected) {
                return;
              }

              originalAudioRef.current?.pause();

              setFile(selected);
              setEvents([]);
              setDuration(0);
              setResultUrl(null);
              setStatus("");
              setError(null);

              event.target.value = "";
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
            onChange={(event) => {
              setSensitivity(Number(event.target.value));
            }}
          />
        </label>

        <button
          type="button"
          className="button button-primary"
          disabled={!file}
          onClick={handleScan}
        >
          Analizar batería
        </button>
      </fieldset>

      {originalUrl && (
        <div className="drum-player">
          <strong>Original: {file?.name}</strong>

          <audio
            ref={originalAudioRef}
            src={originalUrl}
            controls
            onPlay={() => {
              setError(null);
            }}
          />
        </div>
      )}

      <div className="drum-samples">
        {DRUM_KINDS.map((kind) => (
          <label key={kind} className="drum-sample">
            <strong>{DRUM_LABELS[kind]}</strong>

            <span>
              {events.filter((event) => event.kind === kind).length}
              {" "}eventos
            </span>

            <input
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(event) => {
                const sample = event.target.files?.[0];

                if (!sample) {
                  return;
                }

                setSamples((current) => ({
                  ...current,
                  [kind]: sample,
                }));

                event.target.value = "";
              }}
            />

            <small>{samples[kind]?.name ?? "Sin sample"}</small>
          </label>
        ))}
      </div>

      {duration > 0 && (
        <>
          <div className="drum-event-heading">
            <h3>Eventos: {events.length}</h3>

            <button
              type="button"
              className="button button-outline"
              disabled={busy}
              onClick={() => {
                const time = Math.max(
                  0,
                  Math.min(
                    duration,
                    originalAudioRef.current?.currentTime ?? 0
                  )
                );

                setEvents((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    kind: "kick",
                    time,
                    strength: 1,
                  },
                ]);
              }}
            >
              + Evento en el cursor del audio
            </button>
          </div>

          <div className="drum-event-table">
            <table>
              <thead>
                <tr>
                  <th>Tiempo (s)</th>
                  <th>Categoría</th>
                  <th>Intensidad</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {[...events]
                  .sort((a, b) => a.time - b.time)
                  .map((event) => (
                    <tr key={event.id}>
                      <td>
                        <input
                          aria-label="Tiempo del evento"
                          type="number"
                          min={0}
                          max={duration}
                          step={0.001}
                          value={event.time}
                          disabled={busy}
                          onChange={(change) => {
                            updateEvent(event.id, {
                              time: Math.max(
                                0,
                                Math.min(
                                  duration,
                                  Number(change.target.value)
                                )
                              ),
                            });
                          }}
                        />
                      </td>

                      <td>
                        <select
                          aria-label="Categoría del evento"
                          value={event.kind}
                          disabled={busy}
                          onChange={(change) => {
                            updateEvent(event.id, {
                              kind: change.target.value as DrumKind,
                            });
                          }}
                        >
                          {DRUM_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {DRUM_LABELS[kind]}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td>
                        <input
                          aria-label="Intensidad del evento"
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={event.strength}
                          disabled={busy}
                          onChange={(change) => {
                            updateEvent(event.id, {
                              strength: Math.max(
                                0,
                                Math.min(
                                  1,
                                  Number(change.target.value)
                                )
                              ),
                            });
                          }}
                        />
                      </td>

                      <td>
                        <div className="drum-row-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const audio = originalAudioRef.current;

                              if (audio && audio.readyState >= 1) {
                                audio.currentTime = event.time;
                              }
                            }}
                          >
                            Ir
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEvents((current) =>
                                current.filter(
                                  (item) => item.id !== event.id
                                )
                              );
                            }}
                          >
                            Borrar
                          </button>
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

      {status && (
        <p className="drum-status" role="status">
          {status}
        </p>
      )}

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {resultUrl && (
        <div className="drum-player">
          <strong>Última reconstrucción generada</strong>

          <audio src={resultUrl} controls />

          <a href={resultUrl} download="vibrato-drums.wav">
            Descargar WAV
          </a>
        </div>
      )}
    </section>
  );
}