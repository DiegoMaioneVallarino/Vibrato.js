import {
  createDefaultBinding,
  detectShaderParameters,
} from "../engine/shaderBindings";

import type {
  ShaderAudioSource,
  ShaderBinding,
  ShaderBindings,
} from "../engine/shaderBindings";

import "./ShaderParameters.css";

type ShaderParametersProps = {
  shaderCode: string;
  bindings: ShaderBindings;
  onChange: (bindings: ShaderBindings) => void;
  disabled: boolean;
};

export function ShaderParameters({
  shaderCode,
  bindings,
  onChange,
  disabled,
}: ShaderParametersProps) {
  const parameters = detectShaderParameters(shaderCode);

  function updateBinding(
    name: string,
    changes: Partial<ShaderBinding>
  ) {
    const current = bindings[name] ?? createDefaultBinding();

    onChange({
      ...bindings,
      [name]: {
        ...current,
        ...changes,
      },
    });
  }

  return (
    <section className="shader-parameters">
      <div className="shader-parameters-heading">
        <div>
          <span className="eyebrow">AUDIO → VARIABLES</span>
          <h3>Parámetros del shader</h3>
        </div>

        <span>{parameters.length} detectados</span>
      </div>

      {parameters.length === 0 ? (
        <p className="shader-parameters-empty">
          Añade una declaración como{" "}
          <code>uniform float rectangleScale;</code>{" "}
          para configurar su valor o conectarla al audio.
        </p>
      ) : (
        <div className="shader-parameter-list">
          {parameters.map((name) => {
            const binding =
              bindings[name] ?? createDefaultBinding();

            return (
              <fieldset
                key={name}
                className="shader-parameter"
                disabled={disabled}
              >
                <legend>{name}</legend>

                <div className="shader-parameter-grid">
                  <label className="reactive-control">
                    <span>Fuente</span>

                    <select
                      value={binding.source}
                      onChange={(event) => {
                        updateBinding(name, {
                          source: event.target.value as ShaderAudioSource,
                        });
                      }}
                    >
                      <option value="fixed">Valor fijo</option>
                      <option value="low">Bajos</option>
                      <option value="mid">Medios</option>
                      <option value="high">Agudos</option>
                    </select>
                  </label>

                  {binding.source === "fixed" ? (
                    <label className="reactive-control">
                      <span>Valor</span>

                      <input
                        type="number"
                        step="any"
                        value={binding.fixedValue}
                        onChange={(event) => {
                          updateBinding(name, {
                            fixedValue: Number(event.target.value),
                          });
                        }}
                      />
                    </label>
                  ) : (
                    <>
                      <label className="reactive-control">
                        <span>Intensidad (%)</span>

                        <input
                          type="number"
                          min={0}
                          max={200}
                          step={5}
                          value={binding.intensity}
                          onChange={(event) => {
                            updateBinding(name, {
                              intensity: Math.max(
                                0,
                                Math.min(
                                  200,
                                  Number(event.target.value)
                                )
                              ),
                            });
                          }}
                        />
                      </label>

                      <label className="reactive-control">
                        <span>Salida con señal 0</span>

                        <input
                          type="number"
                          step="any"
                          value={binding.minimum}
                          onChange={(event) => {
                            updateBinding(name, {
                              minimum: Number(event.target.value),
                            });
                          }}
                        />
                      </label>

                      <label className="reactive-control">
                        <span>Salida con señal 100</span>

                        <input
                          type="number"
                          step="any"
                          value={binding.maximum}
                          onChange={(event) => {
                            updateBinding(name, {
                              maximum: Number(event.target.value),
                            });
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>
      )}
    </section>
  );
}