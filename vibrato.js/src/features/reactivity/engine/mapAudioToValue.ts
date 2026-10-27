export type ReactiveMapping = {
  intensity: number;
  minimum: number;
  maximum: number;
};

export function mapAudioToValue(
  audioValue: number,
  mapping: ReactiveMapping
): number {
  // Limita la señal de entrada al rango esperado.
  const safeAudioValue = Math.max(0, Math.min(100, audioValue));

  // La intensidad al 100 % conserva la señal original.
  // Al 200 % la duplica, con un límite de 100.
  const amplifiedValue = Math.min(
    100,
    safeAudioValue * (Math.max(0, mapping.intensity) / 100)
  );

  const normalizedValue = amplifiedValue / 100;

  // Convierte el valor al rango visual elegido.
  return (
    mapping.minimum +
    (mapping.maximum - mapping.minimum) * normalizedValue
  );
}