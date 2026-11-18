// 한 번의 그리기 호출에 모든 관절을 넘긴다. WebGL 1의 최소 버텍스 유니폼 수 안에 든다.
const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 color;
attribute vec2 material;
uniform mat4 bones[12];
uniform vec2 lens;
varying vec3 tint;
varying vec3 direction;
varying vec3 local;
varying vec2 finish;
void main() {
  mat4 bone=bones[int(material.y)];
  vec4 p=bone*vec4(position,1.);
  gl_Position=vec4(p.xy*lens,-p.z*.12,1.);
  direction=mat3(bone)*normal;
  local=position;
  tint=color;
  finish=material;
}`;
const fragmentSource = `
precision mediump float;
varying vec3 tint;
varying vec3 direction;
varying vec3 local;
varying vec2 finish;
void main() {
  vec3 n=normalize(direction);
  if(!gl_FrontFacing) n=-n;
  float lit=max(0.,dot(n,vec3(-.52,.69,.50)));
  float sky=.5+.5*n.y;
  float rim=pow(1.-clamp(abs(n.z),0.,1.),3.);
  float gloss=finish.x;
  float spec=pow(max(0.,dot(n,vec3(-.296,.394,.870))),mix(16.,58.,gloss));
  vec3 light=vec3(.65,.65,.72)+sky*vec3(.12,.11,.10)+lit*vec3(.33,.30,.23);
  vec3 shade=tint*light+rim*vec3(.10,.092,.079)*(.35+gloss)+spec*vec3(.30,.27,.20)*gloss;
  if(finish.y<.5) shade*=mix(.72,1.,smoothstep(.10,.65,length(local.xz)));
  gl_FragColor=vec4(shade,1.);
}`;

export function createHardware(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: true,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const shaders = [],
    buffers = [],
    program = gl.createProgram();
  const clear = () => {
    buffers.forEach((b) => gl.deleteBuffer(b));
    shaders.forEach((s) => gl.deleteShader(s));
    gl.deleteProgram(program);
  };
  try {
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ]) {
      const shader = gl.createShader(kind);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('조명 프로그램 컴파일 실패');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('조명 프로그램 연결 실패');
    gl.useProgram(program);
    const vertices = gl.createBuffer(),
      indices = gl.createBuffer();
    buffers.push(vertices, indices);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    for (const [name, length, offset] of [
      ['position', 3, 0],
      ['normal', 3, 3],
      ['color', 3, 6],
      ['material', 2, 9],
    ]) {
      const loc = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, length, gl.FLOAT, false, 44, offset * 4);
    }
    const bones = gl.getUniformLocation(program, 'bones[0]'),
      lens = gl.getUniformLocation(program, 'lens');
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    let count = 0;
    return {
      setModel(model) {
        gl.bufferData(gl.ARRAY_BUFFER, model.vertices, gl.STATIC_DRAW);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);
        count = model.indices.length;
      },
      draw(frame) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniformMatrix4fv(bones, false, frame.bones);
        gl.uniform2f(lens, frame.sx, frame.sy);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
      },
      dispose() {
        clear();
        if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  } catch {
    clear();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
}
