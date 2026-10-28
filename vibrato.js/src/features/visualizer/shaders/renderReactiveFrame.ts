export type ReactiveFrameOptions = {
  time: number;
  reactivity: number;
  shaderCode?: string;
};

export const DEFAULT_SHADER_CODE = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 centered = uv - 0.5;

  centered.x *= iResolution.x / iResolution.y;

  float distanceFromCenter = length(centered);

  // u_reactivity contiene la señal de audio entre 0 y 1.
  float glowSize = 0.12 + u_reactivity * 0.22;
  float glow = glowSize / (distanceFromCenter + 0.16);

  float wave = sin(
    centered.x * 8.0 +
    centered.y * 5.0 +
    iTime * 1.5
  );

  float waveStrength = 0.04 + u_reactivity * 0.16;

  vec3 background = vec3(0.025, 0.015, 0.05);
  vec3 glowColor = vec3(0.45, 0.20, 0.85);

  vec3 color = background + glowColor * glow;
  color += wave * waveStrength * glowColor;

  fragColor = vec4(color, 1.0);
}
`.trim();

const vertexShaderSource = `
  attribute vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

function createFragmentSource(shaderCode: string): string {
  // Se ignoran los comentarios al comprobar las características usadas.
  const codeWithoutComments = shaderCode
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  if (!/\bvoid\s+mainImage\s*\(/.test(codeWithoutComments)) {
    throw new Error(
      "El código debe incluir void mainImage(out vec4 fragColor, in vec2 fragCoord)."
    );
  }

  if (/\bvoid\s+main\s*\(/.test(codeWithoutComments)) {
    throw new Error(
      "Pega el código de Image con mainImage, sin una función main adicional."
    );
  }

  if (/^\s*#version\b/m.test(codeWithoutComments)) {
    throw new Error(
      "Esta primera versión no admite directivas #version. Usa un shader compatible con WebGL 1."
    );
  }

  if (
    /\biChannel[0-3]\b|\biChannelResolution\b|\biChannelTime\b/.test(
      codeWithoutComments
    )
  ) {
    throw new Error(
      "Este shader usa canales externos. Por ahora admite shaders sin iChannel0–3, texturas ni buffers."
    );
  }

  return `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif

    precision mediump int;

    uniform vec3 iResolution;
    uniform float iTime;
    uniform vec4 iMouse;

    uniform float u_reactivity;

    // Los errores del compilador apuntarán al código pegado.
    #line 1
    ${shaderCode}

    void main() {
      vec4 color = vec4(0.0);

      mainImage(color, gl_FragCoord.xy);

      // Reacción automática para shaders que no usan u_reactivity.
      float audioBrightness = 0.6 + u_reactivity * 0.8;

      gl_FragColor = vec4(
        color.rgb * audioBrightness,
        color.a
      );
    }
  `;
}

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

    throw new Error(
      `Error al compilar el shader:\n${message ?? "Error desconocido."}`
    );
  }

  return shader;
}

export function renderReactiveFrame(
  canvas: HTMLCanvasElement,
  options: ReactiveFrameOptions
): void {
  const shaderCode =
    options.shaderCode?.trim() || DEFAULT_SHADER_CODE;

  const fragmentSource = createFragmentSource(shaderCode);

  const gl = canvas.getContext("webgl", {
    preserveDrawingBuffer: true,
    alpha: false,
  });

  if (!gl) {
    throw new Error("Tu navegador no pudo iniciar WebGL.");
  }

  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;

  try {
    vertexShader = compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource
    );

    fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentSource
    );

    program = gl.createProgram();

    if (!program) {
      throw new Error("No se pudo crear el programa del shader.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Error al enlazar el shader:\n${
          gl.getProgramInfoLog(program) ?? "Error desconocido."
        }`
      );
    }

    buffer = gl.createBuffer();

    if (!buffer) {
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
      "iResolution"
    );

    const timeLocation = gl.getUniformLocation(
      program,
      "iTime"
    );

    const mouseLocation = gl.getUniformLocation(
      program,
      "iMouse"
    );

    const reactivityLocation = gl.getUniformLocation(
      program,
      "u_reactivity"
    );

    const reactivity =
      Math.max(0, Math.min(100, options.reactivity)) / 100;

    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.uniform3f(
      resolutionLocation,
      canvas.width,
      canvas.height,
      1
    );

    gl.uniform1f(timeLocation, options.time);

    // Por ahora no hay interacción del mouse con el shader.
    gl.uniform4f(mouseLocation, 0, 0, 0, 0);

    gl.uniform1f(reactivityLocation, reactivity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (gl.isContextLost()) {
      throw new Error(
        "Se perdió el contexto WebGL mientras se generaba el fotograma."
      );
    }
  } finally {
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);

    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}