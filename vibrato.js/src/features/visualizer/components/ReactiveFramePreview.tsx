import { useEffect, useRef, useState } from "react";

import type {
  FrequencyAnalysis,
  FrequencyPoint,
} from "../../audio/analysis/analyzeFrequencyBands";

import {
  mapAudioToValue,
} from "../../reactivity/engine/mapAudioToValue";

import {
  renderPreviewClip,
} from "../../render/engine/renderPreviewClip";

import type {
  AudioBand,
} from "../../render/engine/renderPreviewClip";

import {
  renderReactiveFrame,
} from "../shaders/renderReactiveFrame";

import "./ReactiveFramePreview.css";

type ReactiveFramePreviewProps = {
  currentTime: number;
  frequencyPoint: FrequencyPoint | null;
  audioFile: File | null;
  frequencyAnalysis: FrequencyAnalysis | null;
};

type RenderedFrameInfo = {
  time: number;
  band: AudioBand;
  sourceValue: number;
  intensity: number;
  minimum: number;
  maximum: number;
  resultValue: number;
};

type VideoInfo = {
  start: number;
  requestedDuration: number;
  fps: number;
  band: AudioBand;
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
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);

  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [videoError, setVideoError] = useState<string | null>(null);

  const [clipDuration, setClipDuration] = useState(5);
  const [clipFps, setClipFps] = useState(30);

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

    // Guarda la configuración usada por esta generación.
    const requestedInfo: VideoInfo = {
      start: currentTime,
      requestedDuration: clipDuration,
      fps: clipFps,
      band: selectedBand,
    };

    setIsRenderingVideo(true);
    setRenderProgress(0);
    setVideoError(null);

    try {
      const videoBlob = await renderPreviewClip({
        audioFile,
        analysis: frequencyAnalysis,
        startTime: requestedInfo.start,
        duration: requestedInfo.requestedDuration,
        fps: requestedInfo.fps,
        band: requestedInfo.band,
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
      setVideoInfo(requestedInfo);
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
              disabled={isRenderingVideo}
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
              disabled={isRenderingVideo}
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
              disabled={isRenderingVideo}
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
              disabled={isRenderingVideo}
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
          el fotograma o el video.
        </p>
      </div>

      <div className="reactive-preview-controls">
        <button
          type="button"
          className="button button-primary"
          onClick={handleRenderFrame}
          disabled={!frequencyPoint || isRenderingVideo}
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

          <span>
            {clipDuration} s · {clipFps} FPS · 640 × 360
          </span>
        </div>

        <p>
          Inicio seleccionado: {currentTime.toFixed(2)} s.
          Si el fragmento llega al final de la canción, se recortará.
        </p>

        <fieldset
          className="clip-settings"
          disabled={isRenderingVideo}
        >
          <legend>Opciones del fragmento</legend>

          <div className="reactive-settings-grid">
            <label className="reactive-control">
              <span>Duración</span>

              <select
                value={clipDuration}
                onChange={(event) => {
                  setClipDuration(Number(event.target.value));
                }}
              >
                <option value={5}>5 segundos</option>
                <option value={10}>10 segundos</option>
                <option value={15}>15 segundos</option>
                <option value={30}>30 segundos</option>
              </select>
            </label>

            <label className="reactive-control">
              <span>Fotogramas por segundo</span>

              <select
                value={clipFps}
                onChange={(event) => {
                  setClipFps(Number(event.target.value));
                }}
              >
                <option value={24}>24 FPS</option>
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
              </select>
            </label>
          </div>
        </fieldset>

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
            ? renderProgress === 100
              ? "Finalizando video..."
              : `Procesando ${renderProgress}%`
            : "Generar video de prueba"}
        </button>

        {isRenderingVideo && (
          <progress
            className="clip-progress"
            max={100}
            value={renderProgress}
            aria-label="Progreso del video"
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
            {videoInfo && (
              <p className="clip-result-info">
                Inicio: {videoInfo.start.toFixed(2)} s · Duración
                solicitada: {videoInfo.requestedDuration} s ·{" "}
                {videoInfo.fps} FPS ·{" "}
                {bandLabels[videoInfo.band]}
              </p>
            )}

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