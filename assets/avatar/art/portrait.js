import { BONE, TAU, add, cross, dye, mix, mul, rgb, sub, unit } from './sculpt.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const f = clamp(x);
  return f * f * (3 - 2 * f);
};
const bump = (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
const lerp = (a, b, t) => a + (b - a) * t;

// 단면·눈꺼풀·머릿결 모두 같은 매끄러운 보간을 써서 측면에서 꼭짓점이 도드라지지 않는다.
function spline(points, t) {
  const at = clamp(t) * (points.length - 1),
    i = Math.min(points.length - 2, Math.floor(at)),
    f = at - i;
  const a = points[Math.max(0, i - 1)],
    b = points[i],
    c = points[i + 1],
    d = points[Math.min(points.length - 1, i + 2)];
  return b.map(
    (v, k) =>
      v +
      0.5 * f * (c[k] - a[k] + f * (2 * a[k] - 5 * v + 4 * c[k] - d[k] + f * (3 * v - 3 * c[k] + d[k] - a[k]))),
  );
}

function faceShape(a) {
  const firm = smooth((a.jaw - 14) / 49),
    openness = smooth((a.eyes - 43) / 36),
    bridge = smooth((a.nose - 16) / 62);
  const chin = -0.442 - 0.047 * firm;
  const contour = [
    [chin, 0.016, 0.07, 0.052],
    [chin + 0.024, 0.094, 0.153, 0.082],
    [chin + 0.065, 0.153 + 0.018 * firm, 0.201, 0.085],
    [-0.292, 0.217 + 0.048 * firm, 0.251, 0.071],
    [-0.191, 0.293 + 0.033 * firm, 0.298, 0.048],
    [-0.079, 0.353 + 0.018 * firm, 0.332, 0.03],
    [0.048, 0.402, 0.367, 0.01],
    [0.166, 0.409, 0.382, -0.008],
    [0.289, 0.395, 0.367, -0.02],
    [0.389, 0.314, 0.296, -0.025],
    [0.466, 0.185, 0.192, -0.034],
    [0.503, 0.01, 0.012, -0.031],
  ];
  function profile(y) {
    let i = 1;
    while (i < contour.length - 1 && y > contour[i][0]) i++;
    const f = clamp((y - contour[i - 1][0]) / (contour[i][0] - contour[i - 1][0]));
    return spline(contour, (i - 1 + f) / (contour.length - 1));
  }
  const noseY = -0.07 - 0.055 * bridge,
    eyeX = 0.151 + 0.012 * firm,
    eyeY = 0.055 + 0.004 * openness;
  function relief(x, y) {
    const sx = Math.abs(x);
    return (
      -0.032 * bump(sx, y, eyeX, eyeY, 0.121, 0.076) +
      0.032 * bump(sx, y, 0.224, -0.065, 0.095, 0.084) +
      0.022 * bump(sx, y, 0.158, 0.131, 0.116, 0.051) +
      (0.058 + 0.038 * bridge) * bump(x, y, 0, -0.016, 0.039 + 0.009 * bridge, 0.149) +
      (0.051 + 0.035 * bridge) * bump(x, y, 0, noseY, 0.046, 0.041) +
      0.029 * bump(sx, y, 0.044, noseY - 0.015, 0.021, 0.02) -
      0.01 * bump(x, y, 0, noseY - 0.052, 0.048, 0.024) +
      0.024 * bump(x, y, 0, -0.211, 0.118, 0.072) +
      0.022 * bump(x, y, 0, -0.346 - 0.019 * firm, 0.107, 0.058)
    );
  }
  const surface = (x, y) => {
    const [, rx, rz, dz] = profile(y),
      front = Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
    return dz + rz * front + relief(x, y) * front ** 1.7;
  };
  return { firm, openness, bridge, chin, eyeX, eyeY, noseY, contour, profile, surface, relief };
}

function skinSurface(m, f, p) {
  const { skin } = p;
  m.surface(
    112,
    80,
    (u, v) => {
      const y = lerp(f.chin, 0.503, v),
        [, rx, rz, dz] = f.profile(y),
        t = u * TAU;
      const x = rx * Math.sin(t),
        front = Math.cos(t);
      return [x, y, dz + rz * front + f.relief(x, y) * Math.max(0, front) ** 1.7];
    },
    ([x, y, z]) => {
      const sx = Math.abs(x),
        front = smooth((z - 0.025) / 0.23);
      const blush = 0.37 * bump(sx, y, 0.224, -0.071, 0.093, 0.064) + 0.14 * bump(x, y, 0, f.noseY, 0.057, 0.041);
      const socket = 0.2 * bump(sx, y, f.eyeX, 0.092, 0.123, 0.052);
      const nostril = 0.53 * bump(sx, y, 0.039, f.noseY - 0.022, 0.012, 0.0055);
      const philtrum = 0.12 * bump(x, y, 0, -0.165, 0.017, 0.022);
      const tinted = dye(skin, '#d27f77', clamp(blush * front));
      return dye(tinted, '#92615d', clamp((socket + nostril + philtrum) * front));
    },
    0.24,
  );
}

function sculptEye(m, s, f, p) {
  const { skin, hair, eye: iris } = p;
  const w = 0.098 + 0.023 * f.openness,
    up = 0.024 + 0.029 * f.openness,
    down = 0.016 + 0.015 * f.openness;
  const tilt = 0.004 + 0.019 * f.openness - 0.002 * f.firm;
  const cx = s * f.eyeX,
    cy = f.eyeY,
    brow = dye(hair, '#493339', 0.16);
  const corner = (u) => cy + tilt * u + 0.003 * u * u;
  const arch = (u) => Math.max(0, 1 - u * u) ** 0.76;
  const upper = (u) => corner(u) + up * arch(u) * (1 - 0.16 * u);
  const lower = (u) => corner(u) - down * arch(u) * (1 + 0.13 * u);
  const eyePoint = (u, y, offset = 0) => {
    const x = cx + s * w * u,
      v = (y - corner(u)) / (up + down),
      globe = Math.max(0, 1 - u * u - 1.45 * v * v);
    return [x, y, f.surface(x, y) + 0.005 + 0.016 * globe + offset];
  };
  m.surface(
    38,
    12,
    (u, v) => {
      const t = u * 2 - 1;
      return eyePoint(t, lerp(lower(t), upper(t), v));
    },
    (_, u, v) => dye(rgb('#f8e9da'), '#a28b91', 0.32 * smooth((v - 0.5) / 0.5) + 0.18 * Math.abs(u * 2 - 1) ** 3),
    0.24,
    false,
  );
  // 윗눈꺼풀로 홍채 상단을 잘라 눈동자가 공막 위에 떠 보이지 않게 한다.
  const r = 0.043 + 0.02 * f.openness,
    irCenter = -0.039,
    iy = cy + 0.009;
  m.surface(
    44,
    22,
    (u, v) => {
      const dx = (u * 2 - 1) * r,
        t = irCenter + dx / w,
        h = Math.sqrt(Math.max(0, r * r - dx * dx));
      return eyePoint(
        t,
        lerp(Math.max(lower(t) + 0.0003, iy - h), Math.min(upper(t) - 0.0003, iy + h), v),
        0.0025,
      );
    },
    ([x, y]) => {
      const dx = (x - (cx + s * w * irCenter)) / r,
        dy = (y - iy) / r,
        rad = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const rays = (0.5 + 0.5 * Math.sin(21 * angle + 0.7 * Math.sin(4 * angle))) * 0.14 * smooth((rad - 0.4) * 4);
      let color = dye(iris, '#d7eed4', clamp(0.31 - 0.27 * dy + rays));
      color = dye(color, '#293345', 0.52 * smooth((dy + 0.1) / 0.72) + 0.33 * smooth((rad - 0.79) / 0.21));
      color = dye(color, '#d7b890', 0.19 * bump(rad, 0, 0.52, 0, 0.12, 1));
      const lidShadow = smooth(1 - (upper((x - cx) / (s * w)) - y) / (0.024 + 0.006 * f.openness));
      color = dye(color, '#343743', lidShadow * 0.39);
      color = dye(color, '#202530', 1 - smooth((rad - 0.37) / 0.105));
      const glint = 1 - smooth((Math.hypot((dx + 0.27) / 0.18, (dy - 0.32) / 0.16) - 0.64) / 0.52);
      const fleck = bump(dx, dy, 0.39, -0.47, 0.11, 0.067);
      return dye(color, '#fffaee', Math.max(glint, 0.7 * fleck));
    },
    0.27,
    false,
  );
  // 사선에서도 동공에 작은 창문 모양 반사광이 남는다.
  const cxGlint = irCenter - (0.23 * r) / w,
    cyGlint = iy + r * 0.28;
  m.surface(
    14,
    3,
    (u, v) => {
      const t = cxGlint + (0.0065 * Math.sin(u * TAU) * v) / w,
        y = cyGlint + 0.0052 * Math.cos(u * TAU) * v;
      return eyePoint(t, y, 0.0038);
    },
    rgb('#fff8eb'),
    0.1,
  );
  // 두 눈꺼풀의 두께와 접힘을 안구 돌출부에서 뺨의 곡면까지 연결한다.
  for (const top of [true, false]) {
    m.surface(
      36,
      7,
      (u, v) => {
        const t = u * 2 - 1,
          y0 = top ? upper(t) : lower(t),
          x = cx + s * w * t;
        const span = arch(t) * (top ? 0.025 : 0.013),
          y = y0 + (top ? 1 : -1) * span * v;
        const base = eyePoint(t, y0, 0.003)[2],
          end = f.surface(x, y) + 0.001;
        return [x, y, lerp(base, end, v) + 0.008 * Math.sin(Math.PI * v) * arch(t)];
      },
      (_, u, v) => dye(skin, top ? '#976960' : '#c08579', (0.1 + 0.16 * (1 - v)) * arch(u * 2 - 1)),
      0.19,
      false,
    );
  }
  m.surface(
    36,
    2,
    (u, v) => {
      const t = -1 + u * 2.13,
        inside = Math.min(1, t);
      const y = upper(inside) + 0.068 * (t - inside),
        x = cx + s * w * t;
      const thickness =
        (0.002 + (0.006 + 0.005 * f.openness) * Math.sin(Math.PI * u) ** 0.62 + 0.008 * u * u) *
        (1 - smooth((u - 0.88) / 0.12));
      return [x, y + v * thickness, eyePoint(inside, upper(inside), 0.005)[2] - 0.017 * (t - inside)];
    },
    dye(brow, '#382d38', 0.36),
    0.12,
    false,
  );
  const browAt = (t) => {
    const x = cx + s * w * 1.12 * t;
    const lift = 0.118 + 0.023 * f.openness,
      slope = (0.008 + 0.018 * f.firm) * t;
    const y =
      lift + slope + (0.01 + 0.014 * f.openness) * Math.sin((Math.PI * (t + 1)) / 2) + 0.006 * s * (1 - t * t);
    return [x, y, f.surface(x, y) + 0.003];
  };
  m.surface(
    30,
    5,
    (u, v) => {
      const t = u * 2 - 1,
        [x, y] = browAt(t);
      const taper = Math.sin(Math.PI * u) ** 0.45 * (1 - 0.52 * u),
        width = (0.013 + 0.015 * f.firm) * taper;
      const yy = y + (v - 0.45) * width;
      return [x, yy, f.surface(x, yy) + 0.002 + 0.004 * Math.sin(Math.PI * v)];
    },
    (_, u, v) => dye(brow, '#a07963', 0.14 * v + 0.1 * u),
    0.14,
    false,
  );
}

function softenPaintedSurface(m, start, f) {
  for (let i = start; i < m.vertices.length; i += 11) {
    const [x, y] = m.vertices.slice(i, i + 2),
      d = 0.001;
    const dx = (f.surface(x + d, y) - f.surface(x - d, y)) / (2 * d);
    const dy = (f.surface(x, y + d) - f.surface(x, y - d)) / (2 * d);
    const sign = m.vertices[i + 5] < 0 ? -1 : 1,
      base = mul(unit([-dx, -dy, 1]), sign);
    const normal = unit(mix(m.vertices.slice(i + 3, i + 6), base, 0.78));
    for (let k = 0; k < 3; k++) m.vertices[i + 3 + k] = normal[k];
  }
}

function sculptMouth(m, f, p) {
  const start = m.vertices.length;
  const width = 0.094 + 0.024 * (1 - f.firm),
    center = -0.222 - 0.023 * f.bridge;
  const lip = dye(p.skin, '#be7070', 0.53 + 0.23 * (1 - f.firm));
  const seam = (u) => center + 0.0165 * u * u + 0.0055 * u + 0.0015 * Math.cos(u * Math.PI * 2);
  for (const upper of [true, false]) {
    m.surface(
      48,
      9,
      (u, v) => {
        const t = u * 2 - 1,
          x = t * width,
          y0 = seam(t),
          taper = Math.max(0, 1 - t * t);
        const bow = 0.012 + 0.01 * bump(Math.abs(t), 0, 0.25, 0, 0.23, 1);
        const amp = (upper ? bow : 0.02 + 0.006 * (1 - f.firm)) * taper;
        const y = y0 + (upper ? 1 : -1) * amp * v;
        return [x, y, f.surface(x, y) + 0.001 + taper * (0.004 * (1 - v) + 0.012 * Math.sin(v * Math.PI))];
      },
      (_, u, v) => {
        const tint = upper ? dye(lip, '#9e6260', 0.22) : dye(lip, '#f2bcaa', 0.17);
        return mix(tint, p.skin, smooth((v - 0.52) / 0.48) * 0.93 + Math.abs(2 * u - 1) ** 8 * 0.06);
      },
      upper ? 0.21 : 0.31,
      false,
    );
  }
  m.surface(
    40,
    2,
    (u, v) => {
      const t = u * 2 - 1,
        x = t * width,
        y = seam(t) + (v - 0.5) * 0.0043 * (1 - t * t);
      return [x, y, f.surface(x, y) + 0.006 * (1 - t * t) + 0.001];
    },
    dye(lip, '#79514f', 0.62),
    0.11,
    false,
  );
  softenPaintedSurface(m, start, f);
}

function sculptEar(m, s, p) {
  // 귓바퀴는 머리 옆면을 향하고, 귓불의 안쪽은 볼과 이어진다.
  const patch = (u, v) => {
    const t = u * TAU,
      dy = 0.103 * Math.sin(t) * v,
      dz = 0.064 * Math.cos(t) * v - 0.21 * dy;
    const ridge = 0.024 * Math.exp(-(((v - 0.78) / 0.145) ** 2));
    const x = 0.413 + 0.019 * (1 - v * v) + ridge + 0.17 * dy - 0.34 * dz;
    return [s * x, -0.014 + dy, -0.017 + dz];
  };
  m.ball([s * 0.39, -0.008, -0.025], [0.049, 0.097, 0.064], p.skin, 0.16, 20, 12);
  m.surface(40, 15, patch, (_, u, v) => dye(p.skin, '#ad7266', 0.47 * (1 - smooth((v - 0.4) / 0.41))), 0.18);
  const fold = [
    [0.426, -0.071, 0.003],
    [0.444, -0.043, 0.012],
    [0.451, -0.009, -0.004],
    [0.447, 0.026, -0.033],
  ];
  m.sweep(
    fold.map(([x, y, z]) => [s * x, y, z]),
    [0.004, 0.012, 0.01, 0.002],
    [0.003, 0.008, 0.008, 0.001],
    dye(p.skin, '#dd9980', 0.23),
    0.17,
    10,
    [s, 0, 0.2],
  );
  m.ball([s * 0.41, -0.109, -0.003], [0.017, 0.02, 0.018], p.gold, 0.62, 16, 10);
}

// 각 다발은 매끄러운 중심선과 길이 방향의 색 변화를 가진 타원 단면으로 만든다.
function silk(m, knots, hair, outward = [0, 0, 1], lightness = 0) {
  const rows = (knots.length - 1) * 5;
  const sections = Array.from({ length: rows + 1 }, (_, i) => {
    const t = i / rows,
      p = spline(knots, t),
      a = spline(knots, Math.max(0, t - 0.003)),
      b = spline(knots, Math.min(1, t + 0.003));
    const axis = unit(sub(b.slice(0, 3), a.slice(0, 3))),
      right = unit(cross(axis, outward)),
      normal = unit(cross(right, axis));
    return [p, right, normal];
  });
  const ribbon = (u, v, bias = 0) => {
    const [p, right, normal] = sections[Math.round(v * rows)],
      t = u * TAU;
    return add(
      p.slice(0, 3),
      add(
        mul(right, Math.sin(t) * Math.max(0.0005, p[3])),
        mul(normal, Math.cos(t) * Math.max(0.0005, p[4]) + bias),
      ),
    );
  };
  m.surface(
    20,
    rows,
    ribbon,
    (_, u, v) => {
      const ridge = (0.5 + 0.5 * Math.cos(TAU * (u * 5 + 0.21 * Math.sin(v * 4)))) ** 5;
      const sheen = 0.055 * Math.exp(-(((v - 0.43) / 0.21) ** 2));
      return dye(hair, '#d6b8bb', lightness + 0.078 * ridge + sheen);
    },
    0.46,
  );
  // 넓은 다발 위에 폭과 길이가 다른 실크 광택 두 줄을 얹는다.
  for (const [offset, span] of [
    [-0.079, 0.032],
    [0.052, 0.016],
  ]) {
    m.surface(
      5,
      rows,
      (u, v) => {
        const t = offset + 0.025 * Math.sin(v * 4 + 0.6) + (u - 0.5) * span * Math.sin(Math.PI * v) ** 0.68;
        return ribbon(t, v, 0.003);
      },
      (_, u, v) => dye(hair, '#dac2c0', 0.055 + 0.17 * Math.sin(v * Math.PI) ** 2 * Math.sin(u * Math.PI)),
      0.38,
      false,
    );
  }
}

function sculptHair(m, a, hair) {
  const style = a.hairStyle,
    long = style === 2,
    root = dye(hair, '#271f30', 0.15);
  m.surface(
    112,
    32,
    (u, v) => {
      const t = TAU * u,
        f = 1 - v,
        wave = t + (1 - f) * (0.97 + 0.18 * Math.sin(t));
      const end = 1.76 - 0.74 * Math.cos(t) + 0.087 * Math.sin(5 * t + 0.3);
      const phi = 0.003 + f * end;
      const groove = 0.012 * Math.cos(14 * t + 0.46 * Math.sin(t * 3)) + 0.004 * Math.cos(29 * t);
      const r = Math.sin(phi) * (1 + groove * f);
      return [Math.sin(wave) * r * 0.443, 0.096 + Math.cos(phi) * 0.485, -0.034 + Math.cos(wave) * r * 0.424];
    },
    (_, u, v) => dye(root, '#c3a2a7', 0.06 * (0.5 + 0.5 * Math.cos(TAU * (u * 14 + 0.18 * (1 - v))))),
    0.39,
  );
  const flip = style === 3 ? -1 : 1;
  const strand = (pts, tint = hair, amount = 0, guide = [0, 0, 1]) =>
    silk(
      m,
      pts.map(([x, y, z, w, d]) => [flip * x, y, z, w, d]),
      tint,
      guide,
      amount,
    );
  // 여덟 방향의 뒷단이 둥근 두상을 감싸고 목덜미에서 서로 다른 길이로 끝난다.
  for (let i = 0; i < 11; i++) {
    const t = 0.98 + (i * (TAU - 1.96)) / 10,
      sn = Math.sin(t),
      cs = Math.cos(t);
    const earOpening = long ? 0 : Math.exp(-((Math.abs(Math.cos(t)) / 0.34) ** 2));
    const start = t + 0.53,
      endY = long ? -0.35 : -0.235 - 0.065 * Math.cos(3 * t) + 0.25 * earOpening;
    const p = [
      [0.21 * Math.sin(start), 0.5, -0.024 + 0.18 * Math.cos(start), 0.064, 0.022],
      [0.378 * Math.sin(t + 0.26), 0.342, -0.029 + 0.345 * Math.cos(t + 0.26), 0.111, 0.035],
      [0.437 * sn, 0.128, -0.03 + 0.401 * cs, 0.117, 0.037],
      [
        0.429 * Math.sin(t - 0.1),
        -0.046 + 0.13 * earOpening,
        -0.03 + 0.388 * Math.cos(t - 0.1) - 0.023 * earOpening,
        0.097,
        0.035,
      ],
      [0.37 * Math.sin(t - 0.18), endY + 0.066, -0.022 + 0.335 * Math.cos(t - 0.18), 0.049, 0.021],
      [0.346 * Math.sin(t - 0.26), endY, -0.018 + 0.31 * Math.cos(t - 0.26), 0.001, 0.001],
    ];
    silk(m, p, i % 3 === 0 ? root : hair, [sn, 0.04, cs], (i % 3) * 0.009);
  }
  if (long) {
    // 높이 묶은 머리의 두 갈래가 어깨 뒤로 돌아 사선·측면에서도 긴 흐름이 남는다.
    m.ball([0.017, 0.321, -0.366], [0.125, 0.074, 0.098], rgb('#c5a06d'), 0.58);
    for (const s of [-1, 1]) {
      strand(
        [
          [0.012, 0.344, -0.384, 0.068, 0.07],
          [s * 0.065, 0.401, -0.481, 0.117, 0.104],
          [s * 0.129, 0.255, -0.559, 0.134, 0.114],
          [s * 0.193, 0.028, -0.533, 0.133, 0.098],
          [s * 0.276, -0.198, -0.424, 0.119, 0.08],
          [s * 0.327, -0.391, -0.291, 0.085, 0.057],
          [s * 0.302, -0.526, -0.213, 0.043, 0.025],
          [s * 0.249, -0.611, -0.161, 0.001, 0.001],
        ],
        hair,
        0.018,
        [s * 0.34, 0, -1],
      );
    }
  }
  const lock = (pts, tint = hair, lightness = 0.012) => strand(pts, tint, lightness);
  if (long) {
    lock(
      [
        [-0.015, 0.512, 0.123, 0.028, 0.012],
        [-0.036, 0.449, 0.242, 0.042, 0.025],
        [-0.097, 0.356, 0.329, 0.044, 0.027],
        [-0.187, 0.275, 0.362, 0.031, 0.021],
        [-0.231, 0.19, 0.356, 0.014, 0.009],
        [-0.224, 0.144, 0.354, 0.001, 0.001],
      ],
      hair,
      0.035,
    );
    lock(
      [
        [0.009, 0.512, 0.126, 0.031, 0.013],
        [0.084, 0.424, 0.271, 0.047, 0.028],
        [0.169, 0.343, 0.322, 0.045, 0.024],
        [0.243, 0.286, 0.337, 0.031, 0.018],
        [0.269, 0.226, 0.327, 0.001, 0.001],
      ],
      hair,
      0.035,
    );
    // 가르마에서 양 볼을 따라 턱 옆으로 휘는 긴 옆머리.
    for (const s of [-1, 1]) {
      lock(
        [
          [s * 0.005, 0.53, 0.102, 0.042, 0.016],
          [s * 0.09, 0.451, 0.254, 0.099, 0.035],
          [s * 0.209, 0.329, 0.326, 0.098, 0.046],
          [s * 0.338, 0.185, 0.27, 0.078, 0.042],
          [s * 0.379, 0.027, 0.209, 0.056, 0.033],
          [s * 0.352, -0.137, 0.228, 0.046, 0.022],
          [s * 0.317, -0.259, 0.229, 0.033, 0.017],
          [s * 0.327, -0.356, 0.171, 0.001, 0.001],
        ],
        hair,
        s > 0 ? 0.024 : 0.008,
      );
      lock(
        [
          [s * 0.083, 0.502, 0.157, 0.029, 0.012],
          [s * 0.159, 0.383, 0.287, 0.05, 0.028],
          [s * 0.228, 0.278, 0.34, 0.043, 0.023],
          [s * 0.291, 0.211, 0.32, 0.026, 0.012],
          [s * 0.31, 0.127, 0.3, 0.001, 0.001],
        ],
        root,
        0.014,
      );
    }
  } else {
    lock(
      [
        [0.151, 0.48, 0.141, 0.021, 0.013],
        [0.112, 0.565, 0.134, 0.032, 0.016],
        [0.041, 0.59, 0.101, 0.031, 0.016],
        [-0.051, 0.582, 0.065, 0.018, 0.011],
        [-0.093, 0.562, 0.043, 0.001, 0.001],
      ],
      hair,
      0.025,
    );
    // 소년풍 앞머리는 비스듬한 가르마에서 바람결처럼 겹쳐 내려온다.
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      lock(
        [
          [0.164 - 0.045 * k, 0.5 + 0.014 * k, 0.145, 0.035, 0.016],
          [0.131 - 0.083 * k, 0.443 + 0.003 * k, 0.265, 0.078, 0.043],
          [0.058 - 0.175 * k, 0.341 + 0.031 * k, 0.355 - 0.02 * k, 0.081, 0.044],
          [-0.037 - 0.209 * k, 0.261 + 0.017 * k, 0.394 - 0.048 * k, 0.067, 0.038],
          [-0.089 - 0.21 * k, 0.173 - 0.032 * k, 0.403 - 0.078 * k, 0.038, 0.022],
          [-0.148 - 0.174 * k, 0.097 - 0.035 * k, 0.386 - 0.1 * k, 0.001, 0.001],
        ],
        i % 2 ? hair : root,
        i * 0.009,
      );
    }
    lock([
      [0.157, 0.498, 0.144, 0.043, 0.018],
      [0.222, 0.409, 0.25, 0.082, 0.038],
      [0.286, 0.299, 0.298, 0.081, 0.043],
      [0.339, 0.205, 0.28, 0.055, 0.031],
      [0.334, 0.112, 0.295, 0.021, 0.015],
      [0.308, 0.068, 0.302, 0.001, 0.001],
    ]);
    for (const s of [-1, 1])
      lock([
        [s * 0.309, 0.335, 0.213, 0.06, 0.025],
        [s * 0.386, 0.213, 0.204, 0.067, 0.031],
        [s * 0.405, 0.068, 0.175, 0.057, 0.03],
        [s * 0.375, -0.07, 0.179, 0.028, 0.017],
        [s * 0.371, -0.153, 0.148, 0.001, 0.001],
      ]);
  }
  if (style === 1 || style === 3) {
    for (const s of [-1, 1]) {
      if (style === 3) {
        m.ball([s * 0.361, 0.318, -0.173], [0.16, 0.151, 0.146], root, 0.32, 32, 20);
        for (let i = 0; i < 3; i++) {
          const arc = Array.from({ length: 7 }, (_, k) => {
            const t = (k / 6) * 3.5 + i * 1.8;
            return [
              s * (0.361 + 0.14 * Math.sin(t)),
              0.318 + 0.143 * Math.cos(t),
              -0.17 + 0.074 * Math.sin(t + i),
              0.026,
              0.022,
            ];
          });
          silk(m, arc, hair, [s, 0, -0.3], 0.022);
        }
      } else {
        for (let i = 0; i < 2; i++) {
          const braid = Array.from({ length: 14 }, (_, k) => {
            const t = k / 13,
              twist = t * TAU * 2 + i * Math.PI;
            return [
              s * (0.36 + 0.056 * Math.sin(twist) + 0.042 * t),
              -0.002 - 0.58 * t,
              -0.198 + 0.052 * Math.cos(twist),
              0.074 * (1 - 0.63 * t),
              0.065 * (1 - 0.63 * t),
            ];
          });
          silk(m, braid, hair, [s * 0.5, 0, -1], i * 0.02);
        }
        m.ball([s * 0.403, -0.574, -0.198], [0.045, 0.026, 0.044], rgb('#c9a86f'), 0.57);
      }
    }
  }
}

export function sculptHead(m, a, p, headY) {
  m.bone = BONE.head;
  const start = m.vertices.length,
    f = faceShape(a);
  skinSurface(m, f, p);
  for (const s of [-1, 1]) {
    sculptEye(m, s, f, p);
    sculptEar(m, s, p);
  }
  sculptMouth(m, f, p);
  const hairStart = m.vertices.length;
  sculptHair(m, a, p.hair);
  for (let i = start; i < m.vertices.length; i += 11) {
    let y = m.vertices[i + 1];
    if (p.job === 'arcanist' && y > 0.27) y = 0.27 + (y - 0.27) * 0.74;
    if (i < hairStart) y += 0.137 * (1 - smooth((m.vertices[i + 2] + 0.045) / 0.33)) * smooth((-y - 0.06) / 0.34);
    m.vertices[i + 1] = y + headY;
  }
}
