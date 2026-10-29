import { useEffect, useState } from "react";

import {
  runDrumBenchmark,
} from "../engine/drumBenchmark";

import type {
  BenchmarkPattern,
  BenchmarkResult,
} from "../engine/drumBenchmark";

import {
  DRUM_KINDS,
  DRUM_LABELS,
} from "../engine/drumEngine";

import type {
  DrumSamples,
} from "../engine/drumEngine";

import "./DrumBenchmarkPanel.css";

type DrumBenchmarkPanelProps = {
  samples: DrumSamples;
  sensitivity: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
};

type FinishedTest = {
  result: BenchmarkResult;
  pattern: BenchmarkPattern;
  bpm: number;
  sensitivity: number;
  toleranceMs: number;
  sampleNames: string[];
};

const PATTERN_LABELS: Record<BenchmarkPattern, string> = {
  isolated: "Golpes aislados",
  straight: "Patrón recto",
  groove: "Groove y ghost notes",
};

function percentage(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function DrumBenchmarkPanel({
  samples,
  sensitivity,
  disabled,
  onBusyChange,
}: DrumBenchmarkPanelProps) {
  const [pattern, setPattern] =
    useState<BenchmarkPattern>("isolated");

  const [bpm, setBpm] = useState(120);
  const [toleranceMs, setToleranceMs] = useState(20);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [finished, setFinished] = useState<FinishedTest | null>(null);

  const [audioUrls, setAudioUrls] = useState<{
    reference: string;
    reconstructed: string | null;
  } | null>(null);

  useEffect(() => {
    if (!finished) {
      return;
    }

    const reference = URL.createObjectURL(
      finished.result.referenceBlob
    );

    const reconstructed = finished.result.reconstructedBlob
      ? URL.createObjectURL(finished.result.reconstructedBlob)
      : null;

    setAudioUrls({
      reference,
      reconstructed,
    });

    return () => {
      URL.revokeObjectURL(reference);

      if (reconstructed) {
        URL.revokeObjectURL(reconstructed);
      }
    };
  }, [finished]);

  const hasSamples = DRUM_KINDS.every((kind) => samples[kind]);
  const locked = disabled || running;

  async function handleRun() {
    if (locked || !hasSamples) {
      return;
    }

    const configuration = {
      samples: { ...samples },
      pattern,
      bpm,
      sensitivity,
      toleranceMs,
    };

    setRunning(true);
    onBusyChange(true);
    setError(null);

    try {
      const result = await runDrumBenchmark(configuration);

      setFinished({
        result,
        pattern: configuration.pattern,
        bpm: configuration.bpm,
        sensitivity: configuration.sensitivity,
        toleranceMs: configuration.toleranceMs,
        sampleNames: DRUM_KINDS.map(
          (kind) => configuration.samples[kind]?.name ?? ""
        ),
      });
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "No se pudo ejecutar la prueba."
      );
    } finally {
      setRunning(false);
      onBusyChange(false);
    }
  }

  const report = finished?.result.report;

  return (
    <section className="drum-benchmark">
      <span className="eyebrow">MEDICIÓN DEL DETECTOR</span>
      <h3>Banco de pruebas</h3>

      <p>
        Genera un loop con eventos conocidos y analiza el resultado.
        Usa samples cortos sin silencio inicial.
      </p>

      <fieldset className="benchmark-controls" disabled={locked}>
        <label>
          <span>Patrón</span>

          <select
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value as BenchmarkPattern);
            }}
          >
            <option value="isolated">Golpes aislados</option>
            <option value="straight">Patrón recto</option>
            <option value="groove">Groove y ghost notes</option>
          </select>
        </label>

        <label>
          <span>Tempo de generación</span>

          <input
            type="number"
            min={60}
            max={200}
            step={1}
            value={bpm}
            onChange={(event) => {
              setBpm(Number(event.target.value));
            }}
          />
        </label>

        <label>
          <span>Tolerancia de evaluación</span>

          <select
            value={toleranceMs}
            onChange={(event) => {
              setToleranceMs(Number(event.target.value));
            }}
          >
            <option value={10}>±10 ms</option>
            <option value={20}>±20 ms</option>
            <option value={50}>±50 ms</option>
          </select>
        </label>

        <button
          type="button"
          className="button button-primary"
          onClick={handleRun}
          disabled={!hasSamples}
        >
          {running ? "Ejecutando prueba..." : "Generar y evaluar"}
        </button>
      </fieldset>

      {!hasSamples && (
        <p>Carga un sample de kick, snare y hi-hat arriba.</p>
      )}

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {finished && report && (
        <>
          <p className="benchmark-test-info">
            Última prueba: {PATTERN_LABELS[finished.pattern]}
            {" · "}{finished.bpm} BPM
            {" · "}Sensibilidad {finished.sensitivity.toFixed(1)}
            {" · "}Tolerancia ±{finished.toleranceMs} ms
          </p>

          <p className="benchmark-test-info">
            Samples: {finished.sampleNames.join(" / ")}
          </p>

          <div className="benchmark-summary">
            <div>
              <span>Precisión</span>
              <strong>{percentage(report.precision)}</strong>
            </div>

            <div>
              <span>Recuperación</span>
              <strong>{percentage(report.recall)}</strong>
            </div>

            <div>
              <span>F1 global</span>
              <strong>{percentage(report.f1)}</strong>
            </div>

            <div>
              <span>Error temporal medio*</span>
              <strong>
                {report.meanErrorMs === null
                  ? "—"
                  : `${report.meanErrorMs.toFixed(1)} ms`}
              </strong>
            </div>
          </div>

          <div className="drum-event-table">
            <table>
              <thead>
                <tr>
                  <th>Instrumento</th>
                  <th>Esperados</th>
                  <th>Detectados</th>
                  <th>Aciertos</th>
                  <th>Omitidos</th>
                  <th>Adicionales</th>
                  <th>Precisión</th>
                  <th>Recuperación</th>
                  <th>F1</th>
                </tr>
              </thead>

              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.kind}>
                    <td>{DRUM_LABELS[row.kind]}</td>
                    <td>{row.expected}</td>
                    <td>{row.detected}</td>
                    <td>{row.correct}</td>
                    <td>{row.missed}</td>
                    <td>{row.extra}</td>
                    <td>{percentage(row.precision)}</td>
                    <td>{percentage(row.recall)}</td>
                    <td>{percentage(row.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>
            *El error temporal solo incluye los aciertos dentro de la
            tolerancia. Los demás eventos cuentan como errores de detección.
          </p>

          <details className="benchmark-details">
            <summary>Ver golpes omitidos y adicionales</summary>

            <h4>Omitidos: {report.missedEvents.length}</h4>

            <ul>
              {report.missedEvents.map((event) => (
                <li key={event.id}>
                  {DRUM_LABELS[event.kind]} · {event.time.toFixed(3)} s
                </li>
              ))}
            </ul>

            <h4>Adicionales: {report.extraEvents.length}</h4>

            <ul>
              {report.extraEvents.map((event) => (
                <li key={event.id}>
                  {DRUM_LABELS[event.kind]} · {event.time.toFixed(3)} s
                </li>
              ))}
            </ul>
          </details>

          {finished.result.reconstructionError && (
            <p className="error-message">
              {finished.result.reconstructionError}
            </p>
          )}
        </>
      )}

    
    </section>
  );
}