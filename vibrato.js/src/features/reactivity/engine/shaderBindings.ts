import type {
  FrequencyPoint,
} from "../../audio/analysis/analyzeFrequencyBands";

import { mapAudioToValue } from "./mapAudioToValue";

export type ShaderAudioSource = "fixed" | "low" | "mid" | "high";

export type ShaderBinding = {
  source: ShaderAudioSource;
  fixedValue: number;
  intensity: number;
  minimum: number;
  maximum: number;
};

export type ShaderBindings = Record<string, ShaderBinding>;

const RESERVED_NAMES = new Set([
  "iTime",
  "iResolution",
  "iMouse",
  "u_reactivity",
]);

export function createDefaultBinding(): ShaderBinding {
  return {
    source: "fixed",
    fixedValue: 1,
    intensity: 100,
    minimum: 0,
    maximum: 1,
  };
}

export function detectShaderParameters(shaderCode: string): string[] {
  const code = shaderCode
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // Primera versión: una variable float por declaración.
  // Ejemplo: uniform float rectangleScale;
  const expression =
    /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?float\s+([A-Za-z_]\w*)\s*;/g;

  const names = new Set<string>();

  for (const match of code.matchAll(expression)) {
    const name = match[1];

    if (name && !RESERVED_NAMES.has(name)) {
      names.add(name);
    }
  }

  return [...names];
}

export function resolveShaderParameters(
  shaderCode: string,
  bindings: ShaderBindings,
  point: FrequencyPoint | null
): Record<string, number> {
  const values: Record<string, number> = {};

  for (const name of detectShaderParameters(shaderCode)) {
    const binding = bindings[name] ?? createDefaultBinding();

    let value: number;

    if (binding.source === "fixed") {
      value = binding.fixedValue;
    } else {
      const audioValue = point?.[binding.source] ?? 0;

      value = mapAudioToValue(audioValue, {
        intensity: binding.intensity,
        minimum: binding.minimum,
        maximum: binding.maximum,
      });
    }

    if (!Number.isFinite(value)) {
      throw new Error(`El parámetro "${name}" tiene un valor no válido.`);
    }

    values[name] = value;
  }

  return values;
}