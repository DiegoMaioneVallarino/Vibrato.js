import { useRef, useState } from "react";

import type { FrequencyPoint } from "../../audio/analysis/analyzeFrequencyBands";
import { mapAudioToValue } from "../../reactivity/engine/mapAudioToValue";
import { renderReactiveFrame } from "../shaders/renderReactiveFrame";

import "./ReactiveFramePreview.css";

type ReactiveFramePreviewProps = {
  currentTime: number;
  frequencyPoint: FrequencyPoint | null;
};

type AudioBand = "low" | "mid" | "high";

type RenderedFrameInfo = {
  time: number;
  band: AudioBand;
  sourceValue: number;
  intensity: number;
  minimum: number;
  maximum: number;
  resultValue: number;
};

const bandLabels: Record<AudioBand, string> = {
  low: "Bajos",
  mid: "Medios",
  high: "Agudos",
};

export function ReactiveFramePreview({
  currentTime,
  frequencyPoint,
}: ReactiveFramePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [selectedBand, setSelectedBand] =
    useState<AudioBand>("low");

  const [intensity, setIntensity] = useState(100);
  const [minimum, setMinimum] = useState(0);
  const [maximum, setMaximum] = useState(100);

  const [renderedFrame, setRenderedFrame] =
    useState<RenderedFrameInfo | null>(null);

  const [error, setError] = useState<string | null>(null);

  function handleRenderFrame() {
    const canvas = canvasRef.current;

    if (!canvas || !frequencyPoint) {
      return;
    }

    const sourceValue = frequencyPoint[selectedBand];

    const resultValue = mapAudioToValue(sourceValue, {
      intensity,
      minimum,
      maximum,
    });

    try {
      setError(null);

      renderReactiveFrame(canvas, {
        time: currentTime,
        reactivity: resultValue,
      });

      setRenderedFrame({
        time: currentTime,
        band: selectedBand,
        sourceValue,
        intensity,
        minimum,
        maximum,
        resultValue,
      });
    } catch (renderError) {
      console.error("Error al generar el fotograma:", renderError);

      setError(
        renderError instanceof Error
          ? renderError.message
          : "No se pudo generar el fotograma."
      );
    }
  }

  return (
    <div className="reactive-preview">
      <div className="reactive-preview-screen">
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          className="reactive-preview-canvas"
          aria-label="Fotograma generado del shader reactivo"
        />

        {!renderedFrame && (
          <div className="reactive-preview-placeholder">
            <span>✳</span>

            <strong>Primer shader reactivo</strong>

            <p>
              Carga una canción y genera un fotograma de prueba.
            </p>
          </div>
        )}
      </div>

      <div className="reactive-settings">
        <div className="reactive-settings-heading">
          <div>
            <span className="eyebrow">CONEXIÓN REACTIVA</span>
            <h3>Resplandor del shader</h3>
          </div>

          <span className="reactive-settings-badge">
            AUDIO → VISUAL
          </span>
        </div>

        <div className="reactive-settings-grid">
          <label className="reactive-control">
            <span>Fuente de audio</span>

            <select
              value={selectedBand}
              onChange={(event) => {
                setSelectedBand(event.target.value as AudioBand);
              }}
            >
              <option value="low">Bajos</option>
              <option value="mid">Medios</option>
              <option value="high">Agudos</option>
            </select>
          </label>

          <label className="reactive-control">
            <span className="reactive-control-heading">
              <span>Intensidad</span>
              <strong>{intensity}%</strong>
            </span>

            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={intensity}
              onChange={(event) => {
                setIntensity(Number(event.target.value));
              }}
            />
          </label>

          <label className="reactive-control">
            <span className="reactive-control-heading">
              <span>Mínimo visual</span>
              <strong>{minimum}%</strong>
            </span>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={minimum}
              onChange={(event) => {
                const nextMinimum = Number(event.target.value);

                setMinimum(nextMinimum);

                if (nextMinimum > maximum) {
                  setMaximum(nextMinimum);
                }
              }}
            />
          </label>

          <label className="reactive-control">
            <span className="reactive-control-heading">
              <span>Máximo visual</span>
              <strong>{maximum}%</strong>
            </span>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={maximum}
              onChange={(event) => {
                const nextMaximum = Number(event.target.value);

                setMaximum(nextMaximum);

                if (nextMaximum < minimum) {
                  setMinimum(nextMaximum);
                }
              }}
            />
          </label>
        </div>

        <p className="reactive-settings-hint">
          La banda seleccionada controla el resplandor al generar
          el fotograma.
        </p>
      </div>

      <div className="reactive-preview-controls">
        <button
          type="button"
          className="button button-primary"
          onClick={handleRenderFrame}
          disabled={!frequencyPoint}
        >
          Generar fotograma
        </button>

        {renderedFrame ? (
          <span>
            {renderedFrame.time.toFixed(2)} s ·{" "}
            {bandLabels[renderedFrame.band]}:{" "}
            {Math.round(renderedFrame.sourceValue)}% · Intensidad:{" "}
            {renderedFrame.intensity}% · Rango:{" "}
            {renderedFrame.minimum}–{renderedFrame.maximum}% · Resultado:{" "}
            {Math.round(renderedFrame.resultValue)}%
          </span>
        ) : (
          <span>Esperando un fotograma</span>
        )}
      </div>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}