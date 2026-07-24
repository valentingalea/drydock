import { HOST_PROTOCOL_VERSION, connectHost } from "../host-bridge.js";

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec3 a_color;
  uniform float u_rotation;
  uniform float u_aspect;
  varying vec3 v_color;

  void main() {
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    vec2 rotated = vec2(
      a_position.x * c - a_position.y * s,
      a_position.x * s + a_position.y * c
    );

    rotated.x = rotated.x / max(u_aspect, 0.0001);
    gl_Position = vec4(rotated, 0.0, 1.0);
    v_color = a_color;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec3 v_color;

  void main() {
    gl_FragColor = vec4(v_color, 1.0);
  }
`;

const canvas = document.querySelector("#stage");
const status = document.querySelector("#status");
const gl = canvas.getContext("webgl", {
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true
});

if (!gl) {
  status.textContent = "WebGL unavailable";
  throw new Error("WebGL unavailable");
}

const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
const positionLocation = gl.getAttribLocation(program, "a_position");
const colorLocation = gl.getAttribLocation(program, "a_color");
const rotationLocation = gl.getUniformLocation(program, "u_rotation");
const aspectLocation = gl.getUniformLocation(program, "u_aspect");

const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    0.0, 0.62, 0.1, 0.85, 0.74,
    -0.58, -0.42, 0.94, 0.58, 0.28,
    0.58, -0.42, 0.42, 0.66, 1.0
  ]),
  gl.STATIC_DRAW
);

await initializeHostStatus();
requestAnimationFrame(render);

async function initializeHostStatus() {
  const host = await connectHost();
  const capabilities = await host.capabilities();
  const storageResult = await host.storage.save("web-iterate-smoke", {
    at: new Date().toISOString(),
    protocolVersion: HOST_PROTOCOL_VERSION
  });

  const storageText = storageResult.ok ? capabilities.storage : storageResult.code;
  status.textContent = `Host v${HOST_PROTOCOL_VERSION}; storage: ${storageText}; achievements: ${capabilities.achievements}`;
}

function render(now) {
  resizeCanvas();

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.05, 0.06, 0.06, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 20, 8);

  gl.uniform1f(rotationLocation, now * 0.001);
  gl.uniform1f(aspectLocation, canvas.width / canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  requestAnimationFrame(render);
}

function resizeCanvas() {
  const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
  const height = Math.max(1, Math.floor(canvas.clientHeight * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function createProgram(context, vertexSource, fragmentSource) {
  const vertexShader = createShader(context, context.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(context, context.FRAGMENT_SHADER, fragmentSource);
  const linkedProgram = context.createProgram();

  context.attachShader(linkedProgram, vertexShader);
  context.attachShader(linkedProgram, fragmentShader);
  context.linkProgram(linkedProgram);

  if (!context.getProgramParameter(linkedProgram, context.LINK_STATUS)) {
    const message = context.getProgramInfoLog(linkedProgram);
    context.deleteProgram(linkedProgram);
    throw new Error(`WebGL program link failed: ${message}`);
  }

  return linkedProgram;
}

function createShader(context, type, source) {
  const shader = context.createShader(type);

  context.shaderSource(shader, source);
  context.compileShader(shader);

  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const message = context.getShaderInfoLog(shader);
    context.deleteShader(shader);
    throw new Error(`WebGL shader compile failed: ${message}`);
  }

  return shader;
}
