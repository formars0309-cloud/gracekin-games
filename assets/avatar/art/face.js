import { cross, sub, unit } from './sculpt.js';
import * as source from './face-data.js';

const clamp = (n) => Math.max(0, Math.min(1, n));
const blend = (a, b, t) => a + (b - a) * t;
const smooth = (n) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const falloff = (x, y) => Math.exp(-(x * x + y * y));

function bytes(data) {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

function words(data, signed) {
  const raw = bytes(data);
  const view = new DataView(raw.buffer);
  return (signed ? Int16Array : Uint16Array).from({ length: raw.length / 2 }, (_, i) =>
    signed ? view.getInt16(i * 2, true) : view.getUint16(i * 2, true),
  );
}

let original;
function faceData() {
  if (!original)
    original = {
      positions: [words(source.youthPositions, true), words(source.maidenPositions, true)],
      colors: [bytes(source.youthColors), bytes(source.maidenColors)],
      ears: [bytes(source.youthEar), bytes(source.maidenEar)],
      faces: words(source.triangles, false),
    };
  return original;
}

// 원화의 얼굴 타원에서 관자·두정부·아래턱을 거쳐 뒤통수까지 닫는다.
function closeSkull(points, triangles) {
  const rim = source.rimCount;
  const frontNormals = normalsOf(points, triangles);
  const outward = [];
  for (let i = 0; i < rim; i++) {
    const n = [0, 0, 0];
    for (let j = -3; j <= 3; j++) {
      const k = ((i + j + rim) % rim) * 3;
      const dir = unit(frontNormals.subarray(k, k + 3));
      for (let c = 0; c < 3; c++) n[c] += dir[c];
    }
    const tangent = sub(points[(i + 1) % rim], points[(i + rim - 1) % rim]);
    outward.push(unit(cross(n, tangent)));
  }
  const first = points.length;
  const belts = 24;
  for (let row = 1; row < belts; row++) {
    for (let i = 0; i < rim; i++) {
      const [x, y, z] = points[i];
      const theta = Math.atan2((y + 0.046) / 0.405, x / 0.37);
      const sn = Math.sin(theta),
        cs = Math.cos(theta);
      // 아래턱각을 귓불 아래까지 이어 목으로 돌아가는 턱밑 면을 만든다.
      const lower = Math.max(0, -sn);
      const jaw = smooth((-y - 0.015) / 0.21);
      const mx = blend(0.401 * cs, x * (1 + 0.23 * lower), jaw);
      const my = blend(0.084 + 0.422 * sn, y + 0.135 * lower ** 2, jaw);
      const mz = -0.048;
      const mid = 10;
      let point;
      if (row <= mid) {
        const t = row / mid;
        const d = Math.min(0.084, 0.34 * Math.hypot(mx - x, my - y, mz - z));
        const end = [mx, my, mz];
        // 앞얼굴의 접선으로 출발하고 뒤통수 단면에서는 -Z와 접한다.
        point = points[i].map((v, c) => {
          const firstControl = v + outward[i][c] * d;
          const lastControl = end[c] + (c === 2 ? (z - mz) * 0.32 : 0);
          return (
            (1 - t) ** 3 * v +
            3 * (1 - t) ** 2 * t * firstControl +
            3 * (1 - t) * t ** 2 * lastControl +
            t ** 3 * end[c]
          );
        });
      } else {
        const t = (((row - mid) / (belts - mid)) * Math.PI) / 2;
        const radius = Math.cos(t);
        const depth = 0.337 - 0.135 * lower ** 2 * radius;
        point = [mx * radius, 0.094 + (my - 0.094) * radius, mz - depth * Math.sin(t)];
      }
      points.push(point);
      const j = (i + 1) % rim;
      const prev = row === 1 ? 0 : first + (row - 2) * rim;
      const next = first + (row - 1) * rim;
      triangles.push(prev + i, prev + j, next + j, prev + i, next + j, next + i);
    }
  }
  const pole = points.length,
    last = pole - rim;
  points.push([0, 0.094, -0.385]);
  for (let i = 0; i < rim; i++) triangles.push(last + i, last + ((i + 1) % rim), pole);
}

function normalsOf(points, indices) {
  const normals = new Float32Array(points.length * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i],
      b = indices[i + 1],
      c = indices[i + 2];
    const [ax, ay, az] = points[a],
      [bx, by, bz] = points[b],
      [cx, cy, cz] = points[c];
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az,
      vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const id of [a, b, c]) {
      normals[id * 3] += nx;
      normals[id * 3 + 1] += ny;
      normals[id * 3 + 2] += nz;
    }
  }
  return normals;
}

export function sculptFace(m, appearance, palette) {
  const { positions, colors, faces } = faceData();
  const maiden = appearance.faceBase === 'maiden';
  const type = maiden ? 1 : 0;
  const coords = positions[type],
    photoColors = colors[type];
  const jawEdit = (appearance.jaw - (maiden ? 24 : 44)) / 50;
  const eyesEdit = (appearance.eyes - (maiden ? 73 : 56)) / 50;
  const noseEdit = (appearance.nose - (maiden ? 34 : 54)) / 50;
  const points = [],
    indices = Array.from(faces);
  for (let k = 0; k < coords.length; k += 3) {
    const x = coords[k] / 24000;
    const y = coords[k + 1] / 24000;
    const z = coords[k + 2] / 24000;
    const jaw = jawEdit * smooth((-y - 0.1) / 0.29);
    const eyeY = maiden ? 0.058 : 0.064;
    const eye = falloff((Math.abs(x) - 0.171) / 0.102, (y - eyeY) / 0.061);
    const nose = noseEdit * falloff(x / 0.076, (y + 0.127) / 0.123);
    points.push([
      x * (1 + 0.24 * jaw + 0.16 * nose) + Math.sign(x) * (Math.abs(x) - 0.171) * 0.19 * eyesEdit * eye,
      y - 0.047 * jaw + (y - eyeY) * 0.62 * eyesEdit * eye - 0.024 * nose,
      z + 0.009 * eye + 0.047 * nose + 0.018 * jaw,
    ]);
  }
  const faceCount = points.length;
  closeSkull(points, indices);
  const normals = normalsOf(points, indices);
  const start = m.vertices.length / 11;
  const base = maiden ? [224, 192, 177] : [205, 170, 151];
  for (let i = 0; i < points.length; i++) {
    const n = i * 3,
      k = i * 6;
    const length = Math.hypot(normals[n], normals[n + 1], normals[n + 2]) || 1;
    const nx = normals[n] / length,
      ny = normals[n + 1] / length,
      nz = normals[n + 2] / length;
    let tint = palette.skin;
    if (i < faceCount) {
      const iris = photoColors[k + 3] / 255;
      const eyeOpening = photoColors[k + 4] / 255,
        brow = photoColors[k + 5] / 255;
      // 원화에는 이미 정면의 확산광이 들어 있다. 중앙 얼굴에서만 중복 명암을 줄인다.
      const diffuse = Math.max(0, -0.52 * nx + 0.69 * ny + 0.5 * nz);
      const fill = 0.65 + 0.35 * Math.max(nz, 0),
        sky = 0.5 + 0.5 * ny;
      const light = [
        0.65 + 0.089 * fill + 0.12 * sky + 0.33 * diffuse,
        0.65 + 0.073 * fill + 0.11 * sky + 0.3 * diffuse,
        0.72 + 0.068 * fill + 0.1 * sky + 0.23 * diffuse,
      ];
      const balance = 0.72 * smooth((points[i][2] - 0.13) / 0.17);
      tint = base.map((neutral, c) => {
        const photo = photoColors[k + c];
        const skin = Math.min(1, (photo * palette.skin[c]) / neutral);
        const strands = (photo * (0.48 + 1.75 * palette.hair[c])) / 255;
        const unpainted = blend(blend(skin, photo / 235, eyeOpening), strands, brow * 0.67);
        const eye = Math.min(1, palette.eye[c] * (0.14 + photo / 121));
        return blend(unpainted, eye, iris) / blend(1, light[c], balance);
      });
    }
    // 턱 아랫면에서 목으로 돌아가는 부분은 원화 정면광의 영향을 덜 받는다.
    const underJaw = smooth((-points[i][1] - 0.13) / 0.18) * smooth((-ny - 0.12) / 0.77);
    m.vertices.push(...points[i], nx, ny, nz,
      tint[0] * (1 - 0.095 * underJaw), tint[1] * (1 - 0.13 * underJaw),
      tint[2] * (1 - 0.14 * underJaw), 0.075, m.bone);
  }
  for (const i of indices) m.indices.push(start + i);
}

export function sculptEars(m, appearance, palette) {
  const maiden = appearance.faceBase === 'maiden';
  const photo = faceData().ears[maiden ? 1 : 0];
  const neutral = maiden ? [224, 192, 177] : [205, 170, 151];
  for (const side of [-1, 1]) {
    m.ball([side * 0.373, -0.013, -0.018], [0.024, 0.11, 0.061], palette.skin, 0.09, 24, 16);
    m.surface(
      28,
      40,
      (u, v) => {
        const span = Math.max(0.002, Math.sin(Math.PI * v)) ** 0.57;
        const z = -0.012 + 0.033 * (v - 0.5) + (u - 0.5) * 0.143 * span;
        const y = 0.11 - 0.245 * v + 0.015 * (u - 0.5) * span;
        const helix = 0.019 * Math.exp(-(((u - 0.17) / 0.14) ** 2));
        const bowl = 0.016 * falloff((u - 0.58) / 0.26, (v - 0.49) / 0.21);
        const lobe = 0.012 * falloff((u - 0.46) / 0.45, (v - 0.84) / 0.17);
        const x = 0.394 + (0.028 + helix - bowl + lobe) * span - 0.016 * u;
        return [side * x, y, z];
      },
      (_, u, v) => {
        const k = (Math.round(v * 40) * 29 + Math.round(u * 28)) * 3;
        return neutral.map((base, c) => (palette.skin[c] * photo[k + c]) / base);
      },
      0.07,
      false,
    );
    m.ball([side * 0.402, -0.126, -0.002], [0.013, 0.016, 0.014], palette.gold, 0.55, 16, 10);
  }
}
