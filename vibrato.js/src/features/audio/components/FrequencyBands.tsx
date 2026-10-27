import type { FrequencyPoint } from "../analysis/analyzeFrequencyBands";

import "./FrequencyBands.css";

type FrequencyBandsProps = {
  point: FrequencyPoint | null;
  isAnalyzing: boolean;
  error: string | null;
};

type BandMeterProps = {
  label: string;
  value: number;
  color: string;
};

function BandMeter({ label, value, color }: BandMeterProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div className="frequency-band">
      <div className="frequency-band-heading">
        <span>{label}</span>
        <strong>{Math.round(safeValue)}%</strong>
      </div>

      <div className="frequency-band-track">
        <div
          className="frequency-band-fill"
          style={{
            width: `${safeValue}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

export function FrequencyBands({
  point,
  isAnalyzing,
  error,
}: FrequencyBandsProps) {
  return (
    <section className="frequency-panel">
      <div className="frequency-panel-heading">
        <div>
          <span className="eyebrow">ANÁLISIS DE AUDIO</span>
          <h3>Bandas de frecuencia</h3>
        </div>

        <span className="frequency-status">
          {isAnalyzing ? "ANALIZANDO" : point ? "LISTO" : "SIN DATOS"}
        </span>
      </div>

      {error ? (
        <p className="frequency-message frequency-error" role="alert">
          {error}
        </p>
      ) : isAnalyzing ? (
        <p className="frequency-message">
          Analizando la canción. Esto puede tardar unos momentos.
        </p>
      ) : point ? (
        <div className="frequency-band-list">
          <BandMeter label="Bajos" value={point.low} color="#a98bff" />
          <BandMeter label="Medios" value={point.mid} color="#67c9d8" />
          <BandMeter label="Agudos" value={point.high} color="#f2a878" />
        </div>
      ) : (
        <p className="frequency-message">
          Carga una canción para analizar sus frecuencias.
        </p>
      )}
    </section>
  );
}