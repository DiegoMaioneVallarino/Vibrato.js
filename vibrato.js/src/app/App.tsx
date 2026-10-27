import { useEffect, useRef, useState } from "react";

import "./App.css";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Crea una URL temporal para el archivo y la libera al reemplazarlo.
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      return;
    }

    const url = URL.createObjectURL(audioFile);

    setAudioUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  function handleAudioSelect(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    audioRef.current?.pause();

    setAudioFile(file);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setAudioError(null);

    // Permite volver a seleccionar el mismo archivo.
    event.target.value = "";
  }

  async function togglePlayback() {
    const audio = audioRef.current;

    if (!audio || !audioUrl) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
      return;
    }

    try {
      setAudioError(null);
      await audio.play();
    } catch {
      setAudioError(
        "No se pudo reproducir el archivo. Prueba con otro formato de audio."
      );
    }
  }

  function handleSeek(event: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const time = Number(event.target.value);

    audio.currentTime = time;
    setCurrentTime(time);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">V</span>

          <div>
            <strong>VIBRATO<span>.JS</span></strong>
            <p>Audio reactive video studio</p>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="project-label">Proyecto sin título</span>

          <button
            className="button button-primary"
            type="button"
            disabled
            title="La exportación estará disponible más adelante"
          >
            Exportar video
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="panel sidebar">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROYECTO</span>
              <h2>Audio y capas</h2>
            </div>
          </div>

          <section className="sidebar-section">
            <div className="section-title">
              <h3>Audio</h3>
              <span>01</span>
            </div>

            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept="audio/*"
              onChange={handleAudioSelect}
            />

            <button
              className="upload-area"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="upload-icon">↑</span>

              <strong>
                {audioFile ? "Cambiar canción" : "Cargar canción"}
              </strong>

              <span>Selecciona un archivo de audio</span>
            </button>

            {audioFile && (
              <div className="audio-file">
                <span className="audio-file-icon">♪</span>

                <div className="audio-file-info">
                  <strong title={audioFile.name}>{audioFile.name}</strong>
                  <span>Duración: {formatTime(duration)}</span>
                </div>
              </div>
            )}

            {audioError && (
              <p className="error-message" role="alert">
                {audioError}
              </p>
            )}
          </section>

          <section className="sidebar-section">
            <div className="section-title">
              <h3>Capas visuales</h3>
              <span>00</span>
            </div>

            <div className="empty-panel">
              <span>✦</span>
              <p>Todavía no hay capas visuales.</p>
              <small>Aquí añadiremos shaders y animaciones.</small>
            </div>

            <button className="button button-outline full-width" disabled>
              + Añadir capa
            </button>
          </section>
        </aside>

        <section className="editor">
          <div className="editor-heading">
            <div>
              <span className="eyebrow">ESPACIO DE TRABAJO</span>
              <h1>Vista previa</h1>
            </div>

            <span className="preview-badge">SIN PROCESAR</span>
          </div>

          <div className="preview-container">
            <div className="preview-screen">
              <div className="preview-empty">
                <div className="preview-symbol">✳</div>
                <h2>Tu visual comienza aquí</h2>
                <p>
                  Carga una canción para empezar a crear tu proyecto.
                </p>
              </div>
            </div>

            <div className="preview-footer">
              <span>Vista previa procesada</span>
              <span>1920 × 1080 · 30 FPS</span>
            </div>
          </div>
        </section>

        <aside className="panel properties">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">INSPECTOR</span>
              <h2>Propiedades</h2>
            </div>
          </div>

          <div className="properties-empty">
            <span className="properties-icon">◇</span>
            <strong>Selecciona una capa</strong>
            <p>
              Sus ajustes y conexiones reactivas aparecerán aquí.
            </p>
          </div>
        </aside>
      </main>

      <footer className="timeline">
        <div className="timeline-top">
          <div>
            <span className="eyebrow">AUDIO</span>
            <h2>Línea de tiempo</h2>
          </div>

          <span className="timeline-filename">
            {audioFile?.name ?? "Sin canción"}
          </span>
        </div>

        <div className="transport">
          <button
            className="play-button"
            type="button"
            onClick={togglePlayback}
            disabled={!audioUrl}
            aria-label={isPlaying ? "Pausar audio" : "Reproducir audio"}
          >
            {isPlaying ? "Ⅱ" : "▶"}
          </button>

          <span className="time-label">{formatTime(currentTime)}</span>

          <input
            className="timeline-range"
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(currentTime, duration || 0)}
            onChange={handleSeek}
            disabled={!audioUrl || duration <= 0}
            aria-label="Posición de reproducción"
          />

          <span className="time-label">{formatTime(duration)}</span>
        </div>
      </footer>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const audioDuration = event.currentTarget.duration;

            setDuration(
              Number.isFinite(audioDuration) ? audioDuration : 0
            );
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => {
            setIsPlaying(false);
            setAudioError("No se pudo cargar este archivo de audio.");
          }}
        />
      )}
    </div>
  );
}

export default App;