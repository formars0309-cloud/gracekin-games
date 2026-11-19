// 얼굴과 같은 로컬 좌표계. +Z가 이마, +Y가 정수리이며 귀 중심은 X ±0.41 부근이다.
import { hairTone } from './hair-tone.js';
import { TAU, cross, mix, rgb, sub, unit } from './sculpt.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => clamp(x) ** 2 * (3 - 2 * clamp(x));
const bell = (x) => Math.exp(-x * x);
const halfWave = (x) => 0.5 + 0.5 * Math.cos(x);

// 런타임 텍스처 없이 원화의 미세 명암을 두상과 끝머리의 정점 색에 굽는다.
function fiber(u, v) {
  const x = clamp(u) * 179, y = clamp(v) * 67;
  const col = Math.min(178, Math.floor(x)), row = Math.min(66, Math.floor(y));
  const k = row * 180 + col, fx = x - col, fy = y - row;
  return ((hairTone[k] * (1 - fx) + hairTone[k + 1] * fx) * (1 - fy)
    + (hairTone[k + 180] * (1 - fx) + hairTone[k + 181] * fx) * fy) / 255;
}

function frontFiber(x, y, t, style) {
  const top = 0.096 + 0.486 * Math.sqrt(Math.max(0.01, 1 - (x / 0.457) ** 2));
  const inner = hairline(t, style);
  return fiber(0.5 + x / 0.91, (top - y) / Math.max(0.055, top - inner));
}

// 같은 염색 안에서 뿌리와 겹친 결은 어둡고, 빛을 받는 결은 조금 더 따뜻하다.
function hairDye(hair) {
  const shadow = hair.map((c) => 0.013 + c * 0.57);
  const light = hair.map((c, i) => Math.min(1, c * 1.07 + [0.126, 0.112, 0.097][i]));
  return (value) => mix(shadow, light, clamp(value));
}

// 원형마다 이마 돌출과 관자 깊이가 달라 앞쪽 삼각망을 작은 높이 지도로 읽는다.
function foreheadDepth(m) {
  const width = 79, height = 65, step = 0.012;
  const left = -0.468, bottom = -0.20;
  const grid = new Float32Array(width * height).fill(-1);
  const vertices = m.vertices;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = 11 * m.indices[i], b = 11 * m.indices[i + 1], c = 11 * m.indices[i + 2];
    if (vertices[a + 10] !== m.bone || vertices[a + 1] > 0.6 || vertices[a + 2] < 0) continue;
    const ax = (vertices[a] - left) / step, ay = (vertices[a + 1] - bottom) / step;
    const bx = (vertices[b] - left) / step - ax, by = (vertices[b + 1] - bottom) / step - ay;
    const cx = (vertices[c] - left) / step - ax, cy = (vertices[c + 1] - bottom) / step - ay;
    const det = bx * cy - by * cx;
    if (Math.abs(det) < 1e-6) continue;
    const x0 = Math.max(0, Math.ceil(ax + Math.min(0, bx, cx)));
    const x1 = Math.min(width - 1, Math.floor(ax + Math.max(0, bx, cx)));
    const y0 = Math.max(0, Math.ceil(ay + Math.min(0, by, cy)));
    const y1 = Math.min(height - 1, Math.floor(ay + Math.max(0, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = ((x - ax) * cy - (y - ay) * cx) / det;
      const v = ((y - ay) * bx - (x - ax) * by) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = vertices[a + 2] * (1 - u - v) + vertices[b + 2] * u + vertices[c + 2] * v;
      grid[y * width + x] = Math.max(grid[y * width + x], z);
    }
  }
  return (x, y) => {
    const col = (x - left) / step, row = (y - bottom) / step;
    const i = Math.floor(col), j = Math.floor(row);
    if (i < 0 || j < 0 || i + 1 >= width || j + 1 >= height) return -1;
    const k = j * width + i, u = col - i, v = row - j;
    return (1 - v) * ((1 - u) * grid[k] + u * grid[k + 1])
      + v * ((1 - u) * grid[k + width] + u * grid[k + width + 1]);
  };
}

const HAIRLINE_PEAK = [0.24, -0.14, 0.03, -0.22];
const TEMPLE_RECESS = [0.058, 0.027, 0.024, 0.034];

// 경계의 각도는 이마 중앙이 0, 구레나룻이 약 ±1.25, 목덜미가 π다.
function hairline(t, style) {
  const a = Math.abs(t);
  const peak = HAIRLINE_PEAK[style];
  const recess = TEMPLE_RECESS[style];
  const front = 0.304 + 0.037 * bell((t - peak) / 0.22)
    - recess * bell((t - peak + 0.39) / 0.31) - 0.024 * bell((t - peak - 0.45) / 0.3);
  const temple = smooth((a - 0.40) / 0.91);
  const ear = 0.114 * bell((a - 1.63) / 0.26);
  const nape = (style === 0 ? 0.264 : 0.223) * smooth((a - 1.58) / 1.25);
  // 앞이마의 잔가닥은 가르마에서 관자 쪽으로 길어지며 피부 위에 얇게 눕는다.
  const feather = 0.0015 * Math.sin(t * 33 + 1.7 * Math.cos(9 * t))
    - (0.003 + 0.004 * halfWave(13 * t)) * halfWave(t * 48 + 2.4 * Math.sin(t * 9)) ** 3 * (1 - temple);
  const sweep = style === 0 ? 0.076 * bell((t + 0.53) / 0.56) + 0.028 * bell((t + 0.57) / 0.13) : 0;
  return (front - sweep) * (1 - temple) + (0.018 - nape + ear) * temple
    - 0.052 * bell((a - 1.30) / 0.13) + feather + 0.019 * Math.sin(t * 7) * smooth((a - 1.82) / 0.65);
}

function combedScalp(m, style, shade, skin, faceZ) {
  const radiusY = 0.469;
  // 앞머리의 결을 후두부의 묶이는 지점까지 잇는다. 짧은 머리는 뒤쪽 가마에서 퍼진다.
  const paired = style === 1 || style === 3;
  const crown = paired ? [0, 1, 0] : unit([style === 0 ? 0.14 : -0.035, style === 0 ? 0.81 : 0.49, -1]);
  const part = [0.158, -0.045, 0.008, -0.08][style];
  const seat = (p, t, v) => {
    if (p[2] < 0.085 || Math.cos(t) < 0.22) return p;
    const skinZ = faceZ(p[0], p[1]);
    if (skinZ < 0.09) return p;
    const contact = (1 - smooth(v / 0.12)) * smooth((Math.cos(t) - 0.22) / 0.40);
    p[2] += (skinZ + 0.009 + 0.020 * smooth(v / 0.09) - p[2]) * contact;
    p[2] = Math.max(p[2], skinZ + 0.011);
    return p;
  };
  const point = (t, v, offset = 0) => {
    t = Math.atan2(Math.sin(t), Math.cos(t));
    const ey = (hairline(t, style) - 0.096) / radiusY;
    const er = Math.sqrt(1 - ey * ey);
    const edge = [Math.sin(t) * er, ey, Math.cos(t) * er];
    const angle = Math.acos(crown.reduce((s, c, k) => s + c * edge[k], 0));
    const sn = Math.sin(angle);
    const a = Math.sin((1 - v) * angle) / sn;
    const b = Math.sin(v * angle) / sn;
    let [x, y, z] = edge.map((c, k) => a * c + b * crown[k]);
    const sweep = Math.sin(Math.PI * v);
    const front = (1 + Math.cos(t)) / 2;
    x += (paired ? 0.034 * Math.cos(t) : 0.34 * Math.sin(2 * t - part) * front + 0.105 * Math.sin(t + 1.9 * v) + part) * sweep;
    if (style === 0) x += 0.54 * front * bell((t + 0.42) / 0.73) * sweep;
    // 목덜미 결은 정수리로 방사하지 않고 귀 뒤에서 안쪽으로 감겨 올라간다.
    const twist = (paired ? 0.045 : style === 0 ? 0.69 : 0.44) * sweep * (1 - 0.65 * front);
    [x, z] = [x * Math.cos(twist) - z * Math.sin(twist), z * Math.cos(twist) + x * Math.sin(twist)];
    [x, y, z] = unit([x, y, z]);
    const flow = 22 * t + 2.1 * Math.sin(4 * t + 1.5 * v) + 3 * Math.sin(2 * t - 2.3 * v);
    const lift = smooth(v / 0.09) * smooth((1 - v) / 0.26);
    const seam = bell((x - part * (0.72 + 0.28 * z)) / 0.052) * (paired ? 1 : smooth((z + 0.33) / 0.48));
    const crownLift = (style === 0 ? 0.042 : 0.026) * bell((x + 0.37) / 0.36) * bell((y - 0.87) / 0.29)
      + 0.022 * bell((x - 0.46) / 0.29) * bell((y - 0.87) / 0.27);
    const fullness = (0.010 + crownLift + 0.0008 * Math.sin(flow) + 0.008 * Math.sin(t * 3 - 2 * v)
      + 0.007 * Math.cos(t * 5 + 3 * v) - 0.021 * seam) * lift;
    // 이마 끝은 납작하게 눕히고 뒤쪽 끝은 목덜미의 안으로 말아 넣는다.
    const nape = smooth((-Math.cos(t) - 0.2) / 0.68);
    const taper = 1 - smooth(v / (0.094 + nape * 0.17));
    const d = fullness + offset - (0.026 + nape * 0.054) * taper;
    return seat([(0.449 + d) * x, 0.096 + (radiusY + d) * y, -0.024 + (0.422 + d) * z], t, v);
  };
  // 뿌리의 얇은 경계를 위해 같은 예산에서 끝부분의 단면을 촘촘히 배치한다.
  const along = (v) => 0.29 * v + 0.71 * v ** 1.42;
  const color = ([x, y, z], t, v, grain, distance) => {
    if (t > Math.PI) t -= TAU;
    const phase = 22 * grain + 2.1 * Math.sin(4 * grain + 1.5 * distance) + 3 * Math.sin(2 * grain - 2.3 * distance);
    const fine = Math.sin(93 * grain + 2.5 * Math.sin(13 * grain + 5 * distance) + 7 * Math.sin(grain * 3 - 2 * distance));
    const seam = bell((x - part * (0.72 + z * 0.65) * 0.449) / 0.008) * smooth((z + 0.11) / 0.31);
    const ridge = 0.12 * halfWave(phase) - 0.15 * halfWave(2.3 * Math.sin(grain * 7 + 2 * distance) + grain * 59 - distance * 3) ** 4;
    const strands = (ridge + 0.23 * fine) * smooth((1 - distance) / 0.24);
    const sweep = fiber(0.5 + 0.48 * Math.sin(grain + 0.17 * distance), 0.90 - 0.81 * distance);
    const facing = smooth((z + 0.095) / 0.34);
    const tone = sweep * (1 - facing) + frontFiber(x, y, t, style) * facing;
    const base = shade(0.18 + 0.60 * tone + 0.92 * strands + 0.035 * Math.sin(grain * 3 - 3 * distance) - 0.11 * seam);
    const hairlineTint = (0.19 + 0.17 * halfWave(78 * t)) * (1 - smooth(v / 0.037)) * smooth((Math.cos(t) + 0.42) / 0.67);
    return mix(base, skin, hairlineTint + 0.18 * seam * (1 - hairlineTint));
  };
  if (paired) {
    // 가르마와 헤어라인을 경계로 삼고 귀 뒤 매듭까지의 곡면을 좌우 한 장씩 잇는다.
    const target = style === 1 ? unit([0.79, 0.04, -0.61]) : unit([0.78, 0.29, -0.55]);
    const polar = (t) => Math.acos((hairline(t, style) - 0.096) / radiusY);
    const nape = -polar(Math.PI), brow = polar(0);
    for (const side of [-1, 1]) {
      const edges = sample(240, (u) => {
        if (u <= 0.625) {
          const t = side * Math.PI * u / 0.625, lat = polar(t);
          return [Math.sin(t) * Math.sin(lat), Math.cos(lat), Math.cos(t) * Math.sin(lat)];
        }
        const f = (u - 0.625) / 0.375, lat = nape + (brow - nape) * f;
        return unit([part * 0.40 * Math.sin(Math.PI * f), Math.cos(lat), Math.sin(lat)]);
      });
      const pole = [side * target[0], target[1], target[2]];
      m.surface(240, 34, (u, row) => {
        const edge = edges[Math.round(u * 240)];
        const v = along(row), sn = Math.sin(Math.PI * v);
        const axis = edge.reduce((sum, c, i) => sum + c * pole[i], 0);
        const arc = Math.acos(Math.max(-1, Math.min(1, axis)));
        const k = Math.sin((1 - v) * arc), l = Math.sin(v * arc);
        const [x, y, z] = unit(edge.map((c, i) => c * k + pole[i] * l
          + (i === 1 ? 0.10 : i === 2 ? -0.062 : 0) * sn * Math.sin(2.5 * u + v)));
        const t = Math.atan2(x, z);
        const q = (0.096 + radiusY * y - hairline(t, style));
        const rear = smooth((-Math.cos(t) - 0.2) / 0.68);
        const taper = 1 - smooth(q / (0.075 + 0.070 * rear));
        const lift = 0.007 * Math.sin(TAU * 5 * u + 1.7 * v) + 0.0011 * Math.sin(TAU * 25 * u + 2 * v);
        const d = 0.009 + lift * sn - (0.035 + rear * 0.064) * taper;
        return seat([(0.449 + d) * x, 0.096 + (radiusY + d) * y, -0.024 + (0.422 + d) * z], t, clamp(q / radiusY));
      }, (p, u, row) => {
        const t = Math.atan2(p[0], p[2] + 0.024);
        const q = (p[1] - hairline(t, style)) / radiusY;
        return color(p, t, clamp(q), u * TAU * 0.72, along(row));
      }, 0.045);
    }
  } else {
    m.surface(240, 67, (u, v) => point(u * TAU, along(v)),
      (p, u, v) => color(p, u * TAU, along(v), u * TAU, along(v)), 0.045);
  }
  return { point, color };
}

// 넓고 납작한 단면에 결을 칠해 실루엣에 필요한 갈래만 입체로 남긴다.
function lock(m, path, outward, shade, phase, sides = 14) {
  const frames = path.map((p, i) => {
    const axis = unit(sub(path[Math.min(path.length - 1, i + 1)].slice(0, 3), path[Math.max(0, i - 1)].slice(0, 3)));
    const right = unit(cross(axis, outward));
    return [right, unit(cross(right, axis))];
  });
  m.surface(sides, path.length - 1, (u, v) => {
    const i = Math.round(v * (path.length - 1));
    const p = path[i], [right, normal] = frames[i];
    const w = Math.sin(u * TAU) * p[3], d = Math.cos(u * TAU) * p[4];
    return p.slice(0, 3).map((c, k) => c + right[k] * w + normal[k] * d);
  }, (_, u, v) => shade(0.52 + 0.11 * Math.sin(TAU * 3 * u + phase + 1.1 * v)
    + 0.075 * Math.sin(TAU * 7 * u + 1.4 * Math.sin(3 * v + phase)) - 0.09 * v), 0.075);
}

const sample = (n, fn) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));

function looseEnds(m, style, point, shade) {
  // 구레나룻은 귀를 타고 돌며 끝에서만 피부로부터 떨어진다.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const angle = 1.20 + 0.057 * i + 0.015 * side;
      const edge = point(side * angle, 0, 0.004);
      const length = (style === 2 ? 0.125 : 0.064) * (1 - 0.14 * i);
      const path = sample(14, (v) => {
        const p = point(side * angle, 0.087 * (1 - v), -0.007 + 0.007 * v);
        const w = (0.012 - 0.002 * i) * (1 - v ** 1.5) + 0.0006;
        return [p[0] + side * (0.007 * Math.sin(Math.PI * v) - 0.004 * v),
          p[1] - length * v ** 2, p[2] + 0.011 * v * Math.sin(4 * v + i) + 0.012 * edge[2] * v, w, w * 0.34];
      });
      lock(m, path, [side * 0.85, 0, 0.45], shade, i, 10);
    }
  }
  // 후두부 하단도 길이가 다른 가는 겹으로 마무리한다.
  for (let i = 0; i < 23; i++) {
    const t = 1.88 + i * (TAU - 3.76) / 22;
    const path = sample(9, (v) => {
      const p = point(t + 0.042 * v + 0.025 * Math.sin(t * 4 + v), (1 - v) * 0.22, 0.002);
      const fall = smooth((v - 0.40) / 0.60);
      const w = (0.009 + 0.012 * halfWave(i * 1.5)) * (1 - v) + 0.0007;
      return [p[0] * (1 - 0.055 * fall), p[1] - (0.019 + 0.039 * halfWave(i * 2.11)) * fall,
        p[2] * (1 - 0.052 * fall), w, w * 0.31];
    });
    lock(m, path, [Math.sin(t), 0, Math.cos(t)], shade, i, 8);
  }
}

// 두상 위의 같은 결을 따라 시작해 헤어라인에서 분리되는 갈래다.
function frontLayers(m, style, point, color, shade, faceZ) {
  function layer(t0, span, drop, curl, lean) {
    const strand = (u, v) => {
      const q = u * 2 - 1, tip = v ** 1.60;
      const width = span * (1 - smooth(v)) ** 0.85;
      const t = t0 + width * q + lean * (1 - v) + 0.038 * tip;
      const row = Math.max(0, 0.135 * (1 - v / 0.80));
      return [q, tip, t, row];
    };
    m.surface(22, 29, (u, v) => {
      const [q, tip, t, row] = strand(u, v);
      const d = 0.002 + 0.005 * (1 - q * q) * Math.sin(Math.PI * v);
      const p = point(t, row, d);
      p[0] += curl * tip * (0.2 + Math.sin(4.9 * v));
      p[1] -= drop * tip;
      p[2] = Math.max(p[2] + 0.017 * tip, faceZ(p[0], p[1]) + 0.014 + 0.005 * (1 - q * q));
      return p;
    }, (p, u, v) => {
      const [, , t, row] = strand(u, v);
      const dye = shade(0.28 + 0.50 * fiber(0.12 + 0.66 * u, 0.16 + 0.66 * v)
        + 0.054 * Math.sin(u * 38 + 2.3 * v));
      return mix(color(p, t, row, t, row), dye, smooth((v - 0.18) / 0.51));
    }, 0.055, false);
  }
  if (style === 0) {
    layer(-0.45, 0.112, 0.033, 0.022, 0.030);
    layer(-0.62, 0.092, 0.041, -0.011, 0.045);
    layer(-0.74, 0.057, 0.024, -0.018, 0.022);
  } else if (style === 2) {
    for (const side of [-1, 1]) {
      layer(side * 1.08, 0.120, 0.218 + side * 0.017, side * 0.035, -side * 0.08);
      layer(side * 1.18, 0.075, 0.171 - side * 0.018, side * 0.017, -side * 0.08);
    }
  }
}

const tie = rgb('#957149');

function braids(m, shade) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const path = sample(40, (v) => {
        const t = TAU * (i / 3 + 2.65 * v) + 0.19 * side;
        const size = 0.063 * (1 - 0.59 * v);
        return [side * (0.305 + 0.097 * Math.sin(v * 2.1) + size * Math.cos(t)),
          0.086 - 0.637 * v, -0.244 + 0.085 * v + size * 0.51 * Math.sin(2 * t + 0.15),
          size * 0.79, size * 0.51];
      });
      lock(m, path, [0, 0, 1], shade, i + side);
    }
    m.ball([side * 0.392, -0.55, -0.159], [0.04, 0.014, 0.029], tie, 0.16, 16, 8);
    lock(m, sample(12, (v) => [side * (0.392 + 0.023 * Math.sin(v * 3)), -0.55 - 0.11 * v,
      -0.159 + 0.044 * v, 0.031 * (1 - v ** 2) + 0.001, 0.021 * (1 - v) + 0.001]), [0, 0, -1], shade, side);
  }
}

function ponytail(m, shade) {
  m.ball([0.005, 0.29, -0.385], [0.09, 0.062, 0.07], tie, 0.19, 24, 12);
  for (let i = 0; i < 9; i++) {
    const phase = i * TAU / 9;
    const path = sample(30, (v) => {
      const spread = (0.053 + 0.09 * Math.sin(Math.PI * v) ** 0.7) * (1 - 0.56 * v);
      const width = (0.04 + 0.026 * Math.sin(Math.PI * v)) * (1 - v ** 3) + 0.0009;
      return [0.015 + 0.13 * Math.sin(v * 4.7) * v + spread * Math.cos(phase + 2.9 * v),
        0.293 + 0.106 * Math.sin(v * 5.4) * (1 - v) - (0.815 + 0.094 * Math.sin(phase)) * v,
        -0.379 - 0.254 * Math.sin(Math.PI * v * 0.96) ** 0.72 + spread * 0.66 * Math.sin(phase + 2.9 * v)
        - 0.026 * Math.sin(phase + 2 * v) * v, width, 0.65 * width];
    });
    lock(m, path, [0, 0.33, -1], shade, phase, 18);
  }
}

function sideBuns(m, shade) {
  for (const side of [-1, 1]) {
    const center = [side * 0.333, 0.218, -0.227];
    const size = [0.158, 0.145, 0.135];
    m.surface(80, 30, (u, v) => {
      const lat = (v - 0.5) * Math.PI, t = u * TAU;
      const curl = 1 + 0.053 * Math.sin(3 * t + 14 * v + 0.36 * Math.sin(2 * t));
      return [center[0] + side * size[0] * Math.sin(lat),
        center[1] + size[1] * Math.cos(lat) * Math.cos(t) * curl,
        center[2] + size[2] * Math.cos(lat) * Math.sin(t) * curl];
    }, (_, u, v) => {
      const wave = TAU * 3 * u + v * 14 + 0.36 * Math.sin(u * TAU * 2);
      return shade(0.48 + 0.19 * Math.sin(wave) + 0.11 * Math.cos(wave * 4 + 0.8 * Math.sin(5 * v)));
    }, 0.1);
  }
}

export function sculptHair(m, a, palette) {
  const style = a.hairStyle, shade = hairDye(palette.hair);
  const faceZ = foreheadDepth(m);
  const { point, color } = combedScalp(m, style, shade, palette.skin, faceZ);
  looseEnds(m, style, point, shade);
  frontLayers(m, style, point, color, shade, faceZ);
  if (style === 1) braids(m, shade);
  if (style === 2) ponytail(m, shade);
  if (style === 3) sideBuns(m, shade);
}
