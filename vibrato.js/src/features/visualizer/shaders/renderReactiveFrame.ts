export type ReactiveFrameOptions = {
  time: number;
  reactivity: number;
};

const vertexShaderSource = `
  attribute vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_bass;

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 centered = uv - 0.5;

    // Corrige la proporción para que el centro conserve su forma.
    centered.x *= u_resolution.x / u_resolution.y;

    float distanceFromCenter = length(centered);

    // El valor reactivo controla el tamaño del resplandor.
    float glowSize = 0.12 + u_bass * 0.22;

    float glow = glowSize / (distanceFromCenter + 0.16);

    // Movimiento calculado a partir del tiempo exacto del fotograma.
    float wave = sin(
      centered.x * 8.0 +
      centered.y * 5.0 +
      u_time * 1.5
    );

    float waveStrength = 0.04 + u_bass * 0.16;

    vec3 background = vec3(0.025, 0.015, 0.05);
    vec3 glowColor = vec3(0.45, 0.20, 0.85);

    vec3 color = background + glowColor * glow;
    color += wave * waveStrength * glowColor;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("No se pudo crear el shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);

    gl.deleteShader(shader);

    throw new Error(`Error al compilar el shader: ${message}`);
  }

  return shader;
}

export function renderReactiveFrame(
  canvas: HTMLCanvasElement,
  options: ReactiveFrameOptions
): void {
  const gl = canvas.getContext("webgl", {
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    throw new Error("Tu navegador no pudo iniciar WebGL.");
  }

  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    vertexShaderSource
  );

  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  );

  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    throw new Error("No se pudo crear el programa del shader.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);

    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    throw new Error(`Error al enlazar el shader: ${message}`);
  }

  const buffer = gl.createBuffer();

  if (!buffer) {
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    throw new Error("No se pudo crear el buffer del shader.");
  }

  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]),
    gl.STATIC_DRAW
  );

  const positionLocation = gl.getAttribLocation(
    program,
    "a_position"
  );

  gl.enableVertexAttribArray(positionLocation);

  gl.vertexAttribPointer(
    positionLocation,
    2,
    gl.FLOAT,
    false,
    0,
    0
  );

  const resolutionLocation = gl.getUniformLocation(
    program,
    "u_resolution"
  );

  const timeLocation = gl.getUniformLocation(
    program,
    "u_time"
  );

  const bassLocation = gl.getUniformLocation(
    program,
    "u_bass"
  );

  const reactivity =
    Math.max(0, Math.min(100, options.reactivity)) / 100;

  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.uniform2f(
    resolutionLocation,
    canvas.width,
    canvas.height
  );

  gl.uniform1f(timeLocation, options.time);

  gl.uniform1f(bassLocation, reactivity);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
}