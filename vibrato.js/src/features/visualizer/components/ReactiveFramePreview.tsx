import { useEffect, useRef, useState } from "react";

import type { FrequencyPoint } from "../../audio/analysis/analyzeFrequencyBands";
import { mapAudioToValue } from "../../reactivity/engine/mapAudioToValue";
import { renderReactiveFrame } from "../shaders/renderReactiveFrame";

import "./ReactiveFramePreview.css";

import { renderPreviewClip } from "../../render/engine/renderPreviewClip";

import type {
  FrequencyAnalysis,
} from "../../audio/analysis/analyzeFrequencyBands";

type ReactiveFramePreviewProps = {
  currentTime: number;
  frequencyPoint: FrequencyPoint | null;
  audioFile: File | null;
  frequencyAnalysis: FrequencyAnalysis | null;
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
  audioFile,
  frequencyAnalysis,
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
const [videoUrl, setVideoUrl] = useState<string | null>(null);
const [isRenderingVideo, setIsRenderingVideo] = useState(false);
const [renderProgress, setRenderProgress] = useState(0);
const [videoError, setVideoError] = useState<string | null>(null);


useEffect(() => {
  return () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
  };
}, [videoUrl]);


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
async function handleRenderVideo() {
  if (!audioFile || !frequencyAnalysis || isRenderingVideo) {
    return;
  }

  setIsRenderingVideo(true);
  setRenderProgress(0);
  setVideoError(null);

  try {
    const videoBlob = await renderPreviewClip({
      audioFile,
      analysis: frequencyAnalysis,
      startTime: currentTime,
      duration: 5,
      band: selectedBand,
      mapping: {
        intensity,
        minimum,
        maximum,
      },
      onProgress: (progress) => {
        setRenderProgress(Math.round(progress * 100));
      },
    });

    const newVideoUrl = URL.createObjectURL(videoBlob);

    setVideoUrl(newVideoUrl);
  } catch (renderError) {
    console.error("Error al generar el video:", renderError);

    setVideoError(
      renderError instanceof Error
        ? renderError.message
        : "No se pudo generar el video."
    );
  } finally {
    setIsRenderingVideo(false);
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

      <div className="clip-preview">
  <div className="clip-preview-heading">
    <div>
      <span className="eyebrow">VIDEO PROCESADO</span>
      <h3>Fragmento de prueba</h3>
    </div>

    <span>5 s · 30 FPS · 640 × 360</span>
  </div>

  <p>
    El fragmento comienza en la posición actual de la canción.
  </p>

  <button
    type="button"
    className="button button-primary"
    onClick={handleRenderVideo}
    disabled={
      !audioFile ||
      !frequencyAnalysis ||
      isRenderingVideo
    }
  >
    {isRenderingVideo
      ? `Procesando ${renderProgress}%`
      : "Generar video de prueba"}
  </button>

  {isRenderingVideo && (
    <progress
      className="clip-progress"
      max={100}
      value={renderProgress}
    >
      {renderProgress}%
    </progress>
  )}

  {videoError && (
    <p className="error-message" role="alert">
      {videoError}
    </p>
  )}

  {videoUrl && (
    <div className="clip-result">
      <video
        src={videoUrl}
        controls
        playsInline
        className="clip-video"
      />

      <a
        href={videoUrl}
        download="vibrato-preview.webm"
        className="clip-download"
      >
        Descargar video de prueba
      </a>
    </div>
  )}
</div>
    </div>
  );
}