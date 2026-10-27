import { useRef, useState } from "react";

import type { FrequencyPoint } from "../../audio/analysis/analyzeFrequencyBands";
import { renderReactiveFrame } from "../shaders/renderReactiveFrame";

import "./ReactiveFramePreview.css";

type ReactiveFramePreviewProps = {
  currentTime: number;
  frequencyPoint: FrequencyPoint | null;
};

type RenderedFrameInfo = {
  time: number;
  bass: number;
};

export function ReactiveFramePreview({
  currentTime,
  frequencyPoint,
}: ReactiveFramePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [renderedFrame, setRenderedFrame] =
    useState<RenderedFrameInfo | null>(null);

  const [error, setError] = useState<string | null>(null);

  function handleRenderFrame() {
    const canvas = canvasRef.current;

    if (!canvas || !frequencyPoint) {
      return;
    }

    try {
      setError(null);

      renderReactiveFrame(canvas, {
        time: currentTime,
        bass: frequencyPoint.low,
      });

      setRenderedFrame({
        time: currentTime,
        bass: frequencyPoint.low,
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
            Fotograma: {renderedFrame.time.toFixed(2)} s · Bajos:{" "}
            {Math.round(renderedFrame.bass)}%
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