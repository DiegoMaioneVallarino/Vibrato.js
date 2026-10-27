import type { MouseEvent } from "react";

import "./Waveform.css";

type WaveformProps = {
  peaks: number[];
  currentTime: number;
  duration: number;
  isAnalyzing: boolean;
  onSeek: (time: number) => void;
};

export function Waveform({
  peaks,
  currentTime,
  duration,
  isAnalyzing,
  onSeek,
}: WaveformProps) {
  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;

  function handleWaveformClick(event: MouseEvent<HTMLDivElement>) {
    if (duration <= 0 || peaks.length === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width <= 0) {
      return;
    }

    const position = (event.clientX - bounds.left) / bounds.width;
    const clampedPosition = Math.max(0, Math.min(1, position));

    onSeek(clampedPosition * duration);
  }

  return (
    <div className="waveform-container">
      {isAnalyzing ? (
        <div className="waveform-placeholder">
          Analizando forma de onda...
        </div>
      ) : peaks.length === 0 ? (
        <div className="waveform-placeholder">
          La forma de onda aparecerá aquí al cargar una canción.
        </div>
      ) : (
        <div
          className="waveform"
          onClick={handleWaveformClick}
          aria-hidden="true"
        >
          {peaks.map((peak, index) => {
            const barPosition = (index / peaks.length) * 100;
            const isPlayed = barPosition <= progress;

            return (
              <span
                key={index}
                className={`waveform-bar ${
                  isPlayed ? "waveform-bar-played" : ""
                }`}
                style={{
                  height: `${Math.max(4, peak * 100)}%`,
                }}
              />
            );
          })}

          <span
            className="waveform-playhead"
            style={{ left: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}