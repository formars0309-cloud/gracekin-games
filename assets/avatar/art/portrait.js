import { BONE, TAU, add, dye, mix, rgb } from './sculpt.js';

function sculptHair(m, a, hair) {
  const style = a.hairStyle;
  const shade = dye(hair, '#18131f', 0.24);
  const light = dye(hair, '#ffe0b4', 0.16);
  const root = dye(hair, '#372739', 0.16);
  const locks = [10, 12, 11, 13][style];
  const point = (t, f) => {
    // 빗질한 결이 정수리의 가마에서 관자와 목덜미로 자연스럽게 흐른다.
    const front = Math.cos(t);
    const phi = 0.002 + f * (1.72 - 0.59 * front);
    const angle = t + (1 - f) * 0.58;
    return [
      Math.sin(angle) * Math.sin(phi) * 0.486,
      0.092 + Math.cos(phi) * 0.503,
      -0.044 + Math.cos(angle) * Math.sin(phi) * 0.449,
    ];
  };
  m.surface(48, 13, (u, v) => point(TAU * u, 1 - v), shade, 0.38);
  for (let i = 0; i < locks; i++) {
    const t = (TAU * i) / locks;
    const path = [0, 0.23, 0.48, 0.74, 1].map((f) => point(t, f));
    const end = path.at(-1);
    const frontness = Math.cos(t);
    const drop = style === 1 ? 0.18 : style === 2 ? 0.09 : 0.12;
    path.push([
      end[0] * 1.02 + 0.026 * Math.cos(t),
      end[1] - drop * (1 - frontness * 0.4),
      end[2] + 0.022 * Math.cos(t),
    ]);
    m.sweep(
      path,
      [0.01, 0.075, 0.122, 0.135, 0.1, 0.003],
      [0.012, 0.035, 0.047, 0.055, 0.04, 0.002],
      i % 3 === 0 ? dye(hair, '#f8d4ba', 0.075) : hair,
      0.34,
      12,
      [Math.sin(t), 0.18, Math.cos(t)],
    );
    const ridge = path
      .slice(1, 5)
      .map((p, k) => add(p, [0.031 * Math.sin(t + 0.7), 0.022 * (1 - k / 4), 0.037 * Math.cos(t)]));
    m.line(ridge, 0.008, light, 0.34);
  }

  const lock = (p, w, d, c = hair) => m.sweep(p, w, d, c, 0.38, 14);
  // 앞머리는 잎처럼 겹치며 이마에서 눈썹 옆으로 갈라진다.
  const flip = style === 3 ? -1 : 1;
  const fringe = [
    [
      [0.2, 0.47, 0.17],
      [0.12, 0.42, 0.287],
      [-0.006, 0.34, 0.365],
      [-0.145, 0.235, 0.402],
      [-0.22, 0.116, 0.4],
    ],
    [
      [0.22, 0.467, 0.16],
      [0.025, 0.442, 0.245],
      [-0.183, 0.334, 0.319],
      [-0.314, 0.233, 0.332],
      [-0.382, 0.066, 0.29],
    ],
    [
      [0.232, 0.464, 0.15],
      [0.286, 0.389, 0.245],
      [0.34, 0.29, 0.294],
      [0.36, 0.19, 0.299],
      [0.385, 0.106, 0.285],
    ],
  ];
  fringe.forEach((p, i) => {
    const points = p.map(([x, y, z]) => [flip * x, y + (style === 2 && i === 0 ? 0.061 : 0), z + 0.023]);
    lock(points, [0.027, 0.096, 0.113, 0.071, 0.002], [0.022, 0.06, 0.078, 0.054, 0.002], i === 1 ? root : hair);
    m.line(
      points.slice(1, 4).map((q) => add(q, [0.009, 0.016, 0.056])),
      0.008,
      light,
      0.35,
    );
  });
  for (const s of [-1, 1]) {
    const length = style === 1 ? 0.36 : style === 3 ? 0.3 : 0.14;
    lock(
      [
        [s * 0.355, 0.31, 0.205],
        [s * 0.426, 0.19, 0.212],
        [s * 0.444, 0.032, 0.199],
        [s * 0.423, -length, 0.189],
      ],
      [0.048, 0.087, 0.073, 0.002],
      [0.038, 0.074, 0.062, 0.002],
    );
  }
  if (style === 0) {
    lock(
      [
        [-0.04, 0.5, -0.14],
        [-0.108, 0.568, -0.09],
        [-0.169, 0.616, -0.05],
        [-0.232, 0.626, 0.018],
      ],
      [0.032, 0.058, 0.042, 0.002],
      [0.031, 0.042, 0.039, 0.002],
    );
  } else if (style === 1) {
    for (const s of [-1, 1]) {
      const x = s * 0.36;
      m.ball([x, -0.075, -0.21], [0.104, 0.073, 0.097], rgb('#c79850'), 0.67);
      for (let j = 0; j < 5; j++) {
        const k = 1 - j * 0.12;
        m.ball(
          [x + s * (0.054 + j * 0.014), -0.15 - j * 0.093, -0.23 + 0.025 * (j % 2)],
          [0.134 * k, 0.115 * k, 0.117 * k],
          j % 2 ? hair : root,
          0.3,
        );
      }
      m.ball([x + s * 0.112, -0.575, -0.227], [0.054, 0.042, 0.056], rgb('#dec18a'), 0.76);
      lock(
        [
          [x + s * 0.112, -0.57, -0.227],
          [x + s * 0.13, -0.63, -0.232],
          [x + s * 0.154, -0.719, -0.215],
        ],
        [0.035, 0.046, 0.001],
        [0.032, 0.038, 0.002],
      );
    }
  } else if (style === 2) {
    m.ball([0, 0.38, -0.34], [0.13, 0.122, 0.087], rgb('#c99452'), 0.68);
    lock(
      [
        [0, 0.4, -0.36],
        [0.008, 0.47, -0.48],
        [0.028, 0.394, -0.6],
        [0.07, 0.16, -0.66],
        [0.11, -0.07, -0.6],
        [0.14, -0.25, -0.51],
      ],
      [0.08, 0.147, 0.169, 0.146, 0.085, 0.005],
      [0.07, 0.125, 0.147, 0.13, 0.087, 0.005],
    );
  } else {
    for (const s of [-1, 1]) {
      m.ball([s * 0.38, 0.32, -0.16], [0.211, 0.198, 0.205], root, 0.35, 24);
      for (let i = 0; i < 3; i++) {
        const p = [0, 0.25, 0.5, 0.75, 1].map((f) => {
          const t = f * 3.7 + i * 1.8;
          return [s * (0.38 + 0.172 * Math.sin(t)), 0.32 + 0.17 * Math.cos(t), -0.155 + 0.1 * Math.sin(t + i)];
        });
        m.line(p, 0.022, light, 0.32);
      }
    }
  }
}

export function sculptHead(m, a, palette, headY) {
  m.bone = BONE.head;
  const start = m.vertices.length;
  const skin = palette.skin,
    hair = palette.hair,
    iris = palette.eye;
  const jaw = (a.jaw - 50) / 100;
  const contour = [
    [-0.43, 0.025, 0.07, 0.04],
    [-0.405, 0.119, 0.151, 0.043],
    [-0.348, 0.215 + jaw * 0.075, 0.236, 0.043],
    [-0.244, 0.329 + jaw * 0.09, 0.302, 0.037],
    [-0.122, 0.407 + jaw * 0.034, 0.356, 0.02],
    [0.013, 0.453, 0.386, 0],
    [0.14, 0.455, 0.392, -0.014],
    [0.27, 0.421, 0.374, -0.024],
    [0.385, 0.34, 0.324, -0.032],
    [0.466, 0.195, 0.218, -0.03],
    [0.493, 0.012, 0.012, -0.028],
  ];
  m.rings(0, 0, contour, skin, 0.16, 48);
  // 관자와 볼의 혈색을 정점색으로 스며들게 해 작은 초상화에도 뺨의 부피가 보인다.
  for (let i = start; i < m.vertices.length; i += 11) {
    const [x, y, z] = m.vertices.slice(i, i + 3);
    const blush =
      Math.exp(-(((Math.abs(x) - 0.264) / 0.126) ** 2 + ((y + 0.095) / 0.092) ** 2)) * Math.max(0, z / 0.37);
    const tint = dye(skin, '#cc766c', blush * 0.36);
    for (let k = 0; k < 3; k++) m.vertices[i + 6 + k] = tint[k];
  }
  const faceZ = (x, y) => {
    let i = 1;
    while (i < contour.length - 1 && y > contour[i][0]) i++;
    const [h0, ...r0] = contour[i - 1],
      [h1, ...r1] = contour[i];
    const [rx, rz, dz] = mix(r0, r1, Math.max(0, Math.min(1, (y - h0) / (h1 - h0))));
    return dz + rz * Math.sqrt(Math.max(0.01, 1 - (x / rx) ** 2));
  };
  const accent = dye(skin, '#b65f58', 0.48);
  const brow = dye(hair, '#271d29', 0.54);
  const ink = rgb('#332938'),
    white = rgb('#fff4db');
  for (const s of [-1, 1]) {
    m.sweep(
      [
        [s * 0.386, -0.068, -0.011],
        [s * 0.459, -0.017, -0.028],
        [s * 0.507, 0.05, -0.048],
        [s * 0.548, 0.115, -0.068],
      ],
      [0.058, 0.101, 0.068, 0.002],
      [0.056, 0.066, 0.045, 0.003],
      skin,
      0.14,
    );
    m.sweep(
      [
        [s * 0.428, -0.046, 0.032],
        [s * 0.471, 0.002, 0.022],
        [s * 0.517, 0.077, 0.002],
      ],
      [0.02, 0.047, 0.002],
      [0.011, 0.022, 0.002],
      accent,
    );
    m.ball([s * 0.455, -0.093, 0.011], [0.025, 0.032, 0.025], palette.gold, 0.82);
    const size = 0.86 + a.eyes * 0.003,
      cx = s * 0.18,
      cy = 0.038,
      rx = 0.137 * size,
      ry = 0.065 * size;
    const xy = (u, v) => [cx + s * rx * u, cy + v * ry + 0.013 * u];
    const eyeZ = (x, y) => faceZ(x, y) + 0.016;
    // 공막의 양 끝을 뾰족하게 다듬고 실제 얼굴 곡면에 홍채와 눈꺼풀 선을 얹는다.
    const arch = (u) => Math.max(0, 1 - u * u) ** 0.72;
    m.surface(
      18,
      6,
      (u, v) => {
        const t = u * 2 - 1,
          [x, y] = xy(t, arch(t) * (v * 2 - 1));
        return [x, y, eyeZ(x, y)];
      },
      white,
      0.26,
      false,
    );
    const eyeMark = (ux, uy, rxEye, ryEye, col, offset) => {
      const [x0, y0] = xy(ux, uy);
      m.surface(
        24,
        4,
        (u, v) => {
          const t = u * TAU,
            x = x0 + Math.sin(t) * rxEye * v,
            y = y0 + Math.cos(t) * ryEye * v;
          return [x, y, eyeZ(x, y) + offset];
        },
        col,
        0.2,
      );
    };
    eyeMark(-0.09, -0.01, 0.061 * size, 0.061 * size, dye(iris, '#282336', 0.66), 0.005);
    eyeMark(-0.09, -0.035, 0.052 * size, 0.052 * size, iris, 0.009);
    eyeMark(-0.09, 0.052, 0.028 * size, 0.035 * size, ink, 0.013);
    eyeMark(0.053, -0.48, 0.012 * size, 0.006 * size, dye(iris, '#fff5cc', 0.49), 0.015);
    eyeMark(-0.19, 0.32, 0.015 * size, 0.014 * size, rgb('#fff9e9'), 0.019);
    const lash = Array.from({ length: 13 }, (_, i) => {
      const u = -1 + i / 6,
        [x, y] = xy(u, arch(u));
      return [x, y, eyeZ(x, y) + 0.011];
    });
    lash.push([lash.at(-1)[0] + s * 0.018, lash.at(-1)[1] + 0.018, lash.at(-1)[2] - 0.012]);
    m.line(lash, 0.01, brow);
    const lower = Array.from({ length: 8 }, (_, i) => {
      const u = 0.19 + i * 0.11,
        [x, y] = xy(u, -arch(u));
      return [x, y, eyeZ(x, y) + 0.002];
    });
    m.line(lower, 0.0045, dye(brow, '#ac7863', 0.27));
    const browPoints = [
      [-0.85, 0.122],
      [-0.36, 0.154],
      [0.23, 0.164],
      [0.73, 0.146],
      [0.94, 0.132],
    ].map(([u, y]) => {
      const x = cx + s * u * rx;
      return [x, y, faceZ(x, y) + 0.014];
    });
    m.sweep(browPoints, [0.003, 0.018, 0.021, 0.012, 0.002], [0.002, 0.009, 0.012, 0.007, 0.002], brow);
    // 양 볼의 작은 주근깨도 피부색에 맞춰 염색한다.
    for (const [x, y, r] of [
      [0.254, -0.089, 0.008],
      [0.283, -0.07, 0.006],
      [0.304, -0.092, 0.006],
    ]) {
      m.ball([s * x, y, faceZ(x, y) + 0.003], [r, r * 0.76, r * 0.62], dye(skin, '#98583e', 0.41), 0, 8, 4);
    }
  }
  const nose = 0.75 + a.nose * 0.005;
  m.rings(
    0,
    0,
    [
      [-0.15, 0.009, 0.012, 0.365],
      [-0.134, 0.054 * nose, 0.036 * nose, 0.371],
      [-0.106, 0.065 * nose, 0.06 * nose, 0.369],
      [-0.077, 0.044 * nose, 0.043 * nose, 0.369],
      [0.05, 0.018, 0.018, 0.364],
    ],
    skin,
    0.16,
    20,
  );
  const lipColor = dye(skin, '#c77b78', 0.42);
  m.surface(
    18,
    5,
    (u, v) => {
      const t = u * 2 - 1,
        x = t * 0.093;
      const y = -0.234 + 0.014 * t * t - 0.016 * (1 - t * t) * Math.sin((v * Math.PI) / 2) + 0.002 * t;
      return [x, y, faceZ(x, y) + 0.004 + 0.009 * (1 - t * t) * Math.sin(v * Math.PI)];
    },
    lipColor,
    0.19,
    false,
  );
  const mouth = dye(skin, '#843e42', 0.72);
  m.line(
    [
      [-0.1, -0.216, faceZ(-0.1, -0.216) + 0.005],
      [-0.061, -0.227, faceZ(-0.061, -0.227) + 0.006],
      [0, -0.233, faceZ(0, -0.233) + 0.009],
      [0.065, -0.225, faceZ(0.065, -0.225) + 0.007],
      [0.099, -0.211, faceZ(0.099, -0.211) + 0.005],
    ],
    0.008,
    mouth,
  );
  m.line(
    [
      [-0.039, -0.25, faceZ(-0.039, -0.25) + 0.005],
      [0, -0.253, faceZ(0, -0.253) + 0.008],
      [0.038, -0.247, faceZ(0.038, -0.247) + 0.006],
    ],
    0.007,
    dye(skin, '#ec9e8c', 0.34),
  );
  sculptHair(m, a, hair);
  // 모자 아래에서는 다발의 윗부분이 눌리고 챙 아래의 앞머리와 뒷머리는 그대로 내려온다.
  if (palette.job === 'arcanist') {
    for (let i = start; i < m.vertices.length; i += 11) {
      if (m.vertices[i + 1] > 0.27) m.vertices[i + 1] = 0.27 + (m.vertices[i + 1] - 0.27) * 0.74;
    }
  }
  for (let i = start + 1; i < m.vertices.length; i += 11) m.vertices[i] += headY;
}
