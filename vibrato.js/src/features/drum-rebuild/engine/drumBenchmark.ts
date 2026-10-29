import {
  DRUM_KINDS,
  rebuildDrums,
  scanDrums,
} from "./drumEngine";

import type {
  DrumEvent,
  DrumKind,
  DrumSamples,
} from "./drumEngine";

export type BenchmarkPattern = "isolated" | "straight" | "groove";

export type EventMatch = {
  reference: DrumEvent;
  detected: DrumEvent;
  errorMs: number;
};

export type BenchmarkRow = {
  kind: DrumKind;
  expected: number;
  detected: number;
  correct: number;
  missed: number;
  extra: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export type BenchmarkReport = {
  rows: BenchmarkRow[];
  matches: EventMatch[];
  missedEvents: DrumEvent[];
  extraEvents: DrumEvent[];
  precision: number | null;
  recall: number | null;
  f1: number | null;
  meanErrorMs: number | null;
  maxErrorMs: number | null;
};

export type BenchmarkResult = {
  referenceBlob: Blob;
  reconstructedBlob: Blob | null;
  reconstructionError: string | null;
  referenceEvents: DrumEvent[];
  detectedEvents: DrumEvent[];
  report: BenchmarkReport;
};

export function createBenchmarkPattern(
  pattern: BenchmarkPattern,
  bpm: number
): {
  events: DrumEvent[];
  duration: number;
} {
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 200) {
    throw new Error("El tempo de prueba debe estar entre 60 y 200 BPM.");
  }

  const beatDuration = 60 / bpm;
  const events: DrumEvent[] = [];

  function add(
    kind: DrumKind,
    beat: number,
    strength: number,
    offset = 0
  ) {
    events.push({
      id: `reference-${events.length}`,
      kind,
      time: 0.5 + beat * beatDuration + offset,
      strength,
    });
  }

  let duration: number;

  if (pattern === "isolated") {
    // Golpes separados para comprobar confusiones entre categorías.
    for (let index = 0; index < 9; index++) {
      add(
        DRUM_KINDS[index % DRUM_KINDS.length],
        index * 2,
        index < 3 ? 1 : index < 6 ? 0.7 : 0.4
      );
    }

    duration = 0.5 + 18 * beatDuration;
  } else if (pattern === "straight") {
    // Cuatro compases de 4/4 con golpes simultáneos.
    for (let beat = 0; beat < 16; beat++) {
      add("kick", beat, 0.95);

      if (beat % 4 === 1 || beat % 4 === 3) {
        add("snare", beat, 0.85);
      }
    }

    for (let step = 0; step < 32; step++) {
      add("hat", step / 2, step % 2 === 0 ? 0.65 : 0.4);
    }

    duration = 0.5 + 16 * beatDuration;
  } else {
    // Síncopas, ghost notes y pequeños desplazamientos temporales.
    for (let bar = 0; bar < 4; bar++) {
      const base = bar * 4;

      add("kick", base, 0.95);
      add("kick", base + 1.5, 0.65, -0.006);
      add("kick", base + 2, 0.85);
      add("kick", base + 3.25, 0.55, 0.007);

      add("snare", base + 1, 0.9, 0.012);
      add("snare", base + 3, 0.85, 0.009);
      add("snare", base + 2.75, 0.28, -0.004);

      for (let step = 0; step < 16; step++) {
        add(
          "hat",
          base + step / 4,
          step % 4 === 0 ? 0.65 : step % 2 === 0 ? 0.45 : 0.25,
          step % 2 === 0 ? 0 : 0.018
        );
      }
    }

    duration = 0.5 + 16 * beatDuration;
  }

  return {
    events: events.sort((a, b) => a.time - b.time),
    duration,
  };
}

// Emparejamiento temporal uno a uno.
// Maximiza los aciertos y, ante empate, minimiza el error total.
// Debe recibir eventos de una misma categoría.
function matchEvents(
  reference: DrumEvent[],
  detected: DrumEvent[],
  toleranceSeconds: number
): EventMatch[] {
  const refs = [...reference].sort((a, b) => a.time - b.time);
  const estimates = [...detected].sort((a, b) => a.time - b.time);

  const columns = estimates.length + 1;
  const cells = (refs.length + 1) * columns;

  const counts = new Uint32Array(cells);
  const costs = new Float64Array(cells);
  const steps = new Uint8Array(cells);

  for (let row = 1; row <= refs.length; row++) {
    steps[row * columns] = 1;
  }

  for (let column = 1; column <= estimates.length; column++) {
    steps[column] = 2;
  }

  for (let row = 1; row <= refs.length; row++) {
    for (let column = 1; column <= estimates.length; column++) {
      const cell = row * columns + column;
      const above = cell - columns;
      const left = cell - 1;
      const diagonal = above - 1;

      counts[cell] = counts[above];
      costs[cell] = costs[above];
      steps[cell] = 1;

      function consider(
        count: number,
        cost: number,
        step: number
      ) {
        if (
          count > counts[cell] ||
          (count === counts[cell] && cost < costs[cell])
        ) {
          counts[cell] = count;
          costs[cell] = cost;
          steps[cell] = step;
        }
      }

      consider(counts[left], costs[left], 2);

      const distance = Math.abs(
        refs[row - 1].time - estimates[column - 1].time
      );

      if (distance <= toleranceSeconds + 1e-9) {
        consider(
          counts[diagonal] + 1,
          costs[diagonal] + distance,
          3
        );
      }
    }
  }

  const matches: EventMatch[] = [];

  let row = refs.length;
  let column = estimates.length;

  while (row > 0 || column > 0) {
    const step = steps[row * columns + column];

    if (step === 3) {
      const referenceEvent = refs[row - 1];
      const detectedEvent = estimates[column - 1];

      matches.push({
        reference: referenceEvent,
        detected: detectedEvent,
        errorMs: (detectedEvent.time - referenceEvent.time) * 1000,
      });

      row--;
      column--;
    } else if (step === 1) {
      row--;
    } else if (step === 2) {
      column--;
    } else {
      break;
    }
  }

  return matches.reverse();
}

function calculateScores(
  correct: number,
  expected: number,
  detected: number
) {
  return {
    precision: detected > 0 ? correct / detected : null,
    recall: expected > 0 ? correct / expected : null,
    f1:
      expected + detected > 0
        ? (2 * correct) / (expected + detected)
        : null,
  };
}

export function evaluateDrumEvents(
  reference: DrumEvent[],
  detected: DrumEvent[],
  toleranceMs: number
): BenchmarkReport {
  if (!Number.isFinite(toleranceMs) || toleranceMs <= 0) {
    throw new Error("La tolerancia temporal no es válida.");
  }

  const matches: EventMatch[] = [];

  const rows = DRUM_KINDS.map((kind): BenchmarkRow => {
    const refs = reference.filter((event) => event.kind === kind);
    const estimates = detected.filter((event) => event.kind === kind);

    const categoryMatches = matchEvents(
      refs,
      estimates,
      toleranceMs / 1000
    );

    matches.push(...categoryMatches);

    const correct = categoryMatches.length;

    return {
      kind,
      expected: refs.length,
      detected: estimates.length,
      correct,
      missed: refs.length - correct,
      extra: estimates.length - correct,
      ...calculateScores(correct, refs.length, estimates.length),
    };
  });

  const matchedReferenceIds = new Set(
    matches.map((match) => match.reference.id)
  );

  const matchedDetectedIds = new Set(
    matches.map((match) => match.detected.id)
  );

  const absoluteErrors = matches.map((match) =>
    Math.abs(match.errorMs)
  );

  return {
    rows,
    matches,
    missedEvents: reference.filter(
      (event) => !matchedReferenceIds.has(event.id)
    ),
    extraEvents: detected.filter(
      (event) => !matchedDetectedIds.has(event.id)
    ),
    ...calculateScores(
      matches.length,
      reference.length,
      detected.length
    ),
    meanErrorMs:
      absoluteErrors.length > 0
        ? absoluteErrors.reduce((sum, value) => sum + value, 0)
          / absoluteErrors.length
        : null,
    maxErrorMs:
      absoluteErrors.length > 0
        ? Math.max(...absoluteErrors)
        : null,
  };
}

export async function runDrumBenchmark(options: {
  samples: DrumSamples;
  pattern: BenchmarkPattern;
  bpm: number;
  sensitivity: number;
  toleranceMs: number;
}): Promise<BenchmarkResult> {
  const {
    samples,
    pattern,
    bpm,
    sensitivity,
    toleranceMs,
  } = options;

  for (const kind of DRUM_KINDS) {
    if (!samples[kind]) {
      throw new Error("Carga los tres samples antes de ejecutar la prueba.");
    }
  }

  const reference = createBenchmarkPattern(pattern, bpm);

  const referenceBlob = await rebuildDrums(
    reference.events,
    samples,
    reference.duration
  );

  const referenceFile = new File(
    [referenceBlob],
    "benchmark-reference.wav",
    { type: "audio/wav" }
  );

  const scan = await scanDrums(referenceFile, sensitivity);

  const report = evaluateDrumEvents(
    reference.events,
    scan.events,
    toleranceMs
  );

  let reconstructedBlob: Blob | null = null;
  let reconstructionError: string | null = null;

  // Conservamos el informe aunque no se detecte ningún evento
  // o falle la reconstrucción.
  if (scan.events.length > 0) {
    try {
      reconstructedBlob = await rebuildDrums(
        scan.events,
        samples,
        scan.duration
      );
    } catch (error) {
      reconstructionError =
        error instanceof Error
          ? error.message
          : "No se pudo reconstruir la detección.";
    }
  }

  return {
    referenceBlob,
    reconstructedBlob,
    reconstructionError,
    referenceEvents: reference.events,
    detectedEvents: scan.events,
    report,
  };
}