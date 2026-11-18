import { TAU, BONE, add, dye, mix, rgb } from './sculpt.js';

export const JOB_LABELS = { guardian: '수호기사', ranger: '숲길잡이', arcanist: '룬술사', healer: '별빛치유사' };

export function jewel(m, x, y, z, w, h, color) {
  m.relief(
    [
      [x, y + h, z],
      [x + w, y, z],
      [x, y - h, z],
      [x - w, y, z],
    ],
    [x, y, z + w * 0.6],
    0.014,
    color,
    0.75,
  );
}

function star(m, x, y, z, r, color) {
  const path = Array.from({ length: 8 }, (_, i) => {
    const t = (i * TAU) / 8,
      radius = i % 2 ? r * 0.27 : r;
    return [x + Math.sin(t) * radius * 0.85, y + Math.cos(t) * radius, z];
  });
  m.relief(path, [x, y, z + r * 0.23], 0.012, color, 0.7);
}

function mantle(m, p, job, shoulder) {
  const healer = job === 'healer',
    knight = job === 'guardian';
  const length = healer ? 0.7 : knight ? 0.63 : job === 'arcanist' ? 0.83 : 1.0;
  const low = healer ? p.cream : dye(p.cloth, '#1c1834', 0.32);
  const drape = (u, v) => {
    const end = 1 - v,
      angle = (u - 0.5) * 3.1,
      fold = Math.cos(u * Math.PI * 12);
    const w = shoulder + 0.016 + end * (healer ? 0.14 : 0.081);
    return [
      Math.sin(angle) * w,
      1.926 - end * length - 0.13 * Math.sin(Math.PI * u) + 0.064 * (1 - Math.cos(u * TAU * 3)) * end ** 5,
      -0.026 - Math.cos(angle) * (0.24 + end * 0.105) - (0.016 + end * 0.025) * fold,
    ];
  };
  m.bone = BONE.cape;
  m.surface(48, 9, drape, low, 0.12, false);
  m.surface(48, 1, (u, v) => add(drape(u, 0.028 + v * 0.027), [0, 0, -0.005]), p.gold, 0.52, false);
  for (const u of [0.08, 0.92])
    m.line(
      [0, 0.25, 0.5, 0.75, 1].map((v) => drape(u, v)),
      0.009,
      p.gold,
      0.52,
    );
  m.bone = BONE.chest;
}

function shield(m, x, p) {
  const y = 1.32,
    z = 0.245;
  const shape = [
    [0, 0.358],
    [0.2, 0.282],
    [0.23, 0.176],
    [0.198, -0.095],
    [0.125, -0.238],
    [0, -0.351],
    [-0.136, -0.239],
    [-0.214, -0.082],
    [-0.224, 0.191],
    [-0.199, 0.276],
  ];
  const layer = (scale, offset, color) => {
    const path = shape.map(([dx, dy]) => [
      x + dx * scale,
      y + dy * scale,
      z + offset - 0.055 * Math.abs(dx / 0.23),
    ]);
    m.relief(path, [x, y, z + offset + 0.064], 0.054, color, 0.62);
  };
  layer(1, 0, p.gold);
  layer(0.88, 0.029, p.metal);
  layer(0.72, 0.054, p.cloth);
  jewel(m, x, y + 0.021, z + 0.126, 0.113, 0.194, p.gold);
  jewel(m, x, y + 0.021, z + 0.163, 0.062, 0.132, p.gem);
  for (const s of [-1, 1]) m.ball([x + s * 0.145, y + 0.218, z + 0.075], [0.021, 0.021, 0.017], p.cream, 0.72);
}

function sword(m, x, p) {
  const y = 1.092,
    z = 0.17;
  const at = (dx, dy, dz = 0) => [x + dx - dy * 0.21, y + dy, z + dz];
  m.rod(at(0, -0.065), at(0, 0.163), 0.035, p.leather, 0.17);
  for (let i = 0; i < 4; i++) m.rod(at(0, 0.01 + i * 0.035), at(0, 0.019 + i * 0.035), 0.037, p.gold, 0.62);
  jewel(m, ...at(0, 0.19), 0.045, 0.057, p.gold);
  m.relief(
    [
      at(-0.157, -0.12),
      at(-0.139, -0.059),
      at(-0.035, -0.039),
      at(0, -0.008),
      at(0.036, -0.037),
      at(0.142, -0.055),
      at(0.158, -0.113),
      at(0, -0.084),
    ],
    at(0, -0.059, 0.03),
    0.052,
    p.gold,
    0.74,
  );
  m.relief(
    [at(-0.059, -0.085), at(0.059, -0.085), at(0.059, -0.56), at(0, -0.767), at(-0.061, -0.574)],
    at(0, -0.426, 0.049),
    0.049,
    p.silver,
    0.72,
  );
  jewel(m, ...at(0, -0.16, 0.034), 0.023, 0.07, p.gem);
}

function bow(m, x, p) {
  const z = 0.15;
  for (const s of [-1, 1]) {
    const points = [
      [x, 1.19, z],
      [x - 0.06, 1.19 + s * 0.18, z],
      [x - 0.182, 1.19 + s * 0.385, z],
      [x - 0.205, 1.19 + s * 0.545, z],
      [x - 0.14, 1.19 + s * 0.71, z],
    ];
    m.sweep(points, [0.037, 0.044, 0.041, 0.031, 0.009], [0.034, 0.035, 0.032, 0.024, 0.008], p.wood, 0.22);
    m.line(
      [points[2], points[3], points[4]].map((q) => add(q, [0, 0, 0.018])),
      0.01,
      p.gold,
      0.52,
    );
    m.rod([x - 0.14, 1.19 + s * 0.71, z], [x + 0.088, 1.19, z], 0.005, p.cream, 0.15);
  }
  m.rod([x, 1.106, z], [x, 1.268, z], 0.048, p.leather);
}

function quiver(m, p) {
  const low = [-0.193, 1.13, -0.32],
    high = [0.308, 1.955, -0.378];
  m.rod(low, high, 0.102, p.leather, 0.15, 0.124, 16);
  m.rod(mix(low, high, 0.89), high, 0.128, p.gold, 0.54, 0.132);
  for (const [dx, dy, dz] of [
    [0, 0.065, -0.05],
    [0.083, 0.011, 0],
    [-0.066, 0, 0.044],
  ]) {
    const base = add(high, [dx, 0, dz]),
      end = add(base, [0.124, 0.24 + dy, -0.023]);
    m.rod(base, end, 0.012, p.wood);
    const f = mix(base, end, 0.36);
    m.relief(
      [f, add(end, [-0.066, -0.036, 0]), end, add(end, [0.013, -0.086, 0])],
      mix(f, end, 0.67),
      0.011,
      p.leaf,
      0.12,
    );
  }
}

function staff(m, x, p, healer) {
  const z = 0.144,
    y = healer ? 2.01 : 2.12;
  m.rod([x, 0.2, z], [x, y, z], 0.027, p.wood, 0.21, 0.043, 12);
  for (const h of [0.22, 1.1, 1.235, y - 0.084, y - 0.034])
    m.rod([x, h, z], [x, h + 0.038, z], 0.046, p.gold, 0.72);
  if (healer) {
    const cy = y + 0.177;
    for (const s of [-1, 1]) {
      const arc = [
        [x, y - 0.027, z],
        [x + s * 0.102, y + 0.06, z],
        [x + s * 0.15, cy + 0.026, z],
        [x + s * 0.116, cy + 0.122, z],
        [x + s * 0.057, cy + 0.17, z],
      ];
      m.sweep(arc, [0.032, 0.035, 0.027, 0.02, 0.002], [0.029, 0.033, 0.024, 0.017, 0.002], p.gold, 0.73);
      m.line(
        [arc[0], add(arc[1], [s * 0.025, 0.015, -0.032]), add(arc[2], [s * 0.025, 0.037, -0.044])],
        0.014,
        p.cream,
        0.52,
      );
    }
    star(m, x, cy + 0.026, z, 0.118, p.gem);
    star(m, x, cy + 0.026, z + 0.029, 0.062, p.cream);
  } else {
    const gem = rgb('#87d8e1');
    m.sweep(
      [
        [x, y + 0.04, z],
        [x, y + 0.154, z],
        [x, y + 0.281, z],
        [x, y + 0.397, z],
      ],
      [0, 0.103, 0.087, 0],
      [0, 0.087, 0.071, 0],
      gem,
      0.84,
      6,
      [0, 0, 1],
      true,
    );
    for (const s of [-1, 1]) {
      const arc = [
        [x, y - 0.02, z],
        [x + s * 0.148, y + 0.096, z + 0.015],
        [x + s * 0.17, y + 0.23, z],
        [x + s * 0.124, y + 0.345, z - 0.017],
      ];
      m.sweep(arc, [0.034, 0.046, 0.027, 0], [0.03, 0.035, 0.025, 0], p.gold, 0.74, 6, [0, 0, 1], true);
    }
  }
}

function breastplate(m, p, shoulder) {
  const w = shoulder - 0.01;
  // 갑옷의 판을 몸통 곡선에 밀착시키고 가슴과 복부 사이에 서로 포개지는 관절판을 둔다.
  m.rings(
    0,
    0,
    [
      [1.425, w * 0.78, 0.215],
      [1.469, w * 0.82, 0.237],
      [1.503, w * 0.86, 0.246],
      [1.61, w * 0.93, 0.263],
      [1.755, w, 0.258],
      [1.828, w * 1.01, 0.219],
      [1.88, w * 0.73, 0.19],
    ],
    p.metal,
    0.63,
    28,
  );
  for (let i = 0; i < 2; i++) {
    const y = 1.452 + i * 0.072,
      r = w * (0.86 + i * 0.047);
    m.rings(
      0,
      0,
      [
        [y, r, 0.241 + i * 0.012],
        [y + 0.014, r + 0.003, 0.247 + i * 0.012],
        [y + 0.053, r + 0.012, 0.24 + i * 0.016],
      ],
      i === 0 ? dye(p.metal, '#374354', 0.12) : p.metal,
      0.7,
      28,
    );
  }
  for (const s of [-1, 1]) {
    const outline = [
      [0, 1.6, 0.273],
      [s * 0.048, 1.694, 0.273],
      [s * w * 0.77, 1.78, 0.19],
      [s * w * 0.63, 1.689, 0.221],
      [s * w * 0.79, 1.697, 0.181],
      [s * w * 0.39, 1.636, 0.255],
    ];
    m.relief(outline, [s * w * 0.32, 1.687, 0.278], 0.012, p.gold, 0.72);
  }
}

function woodland(m, p, shoulder, headY) {
  m.bone = BONE.chest;
  m.rings(
    0,
    0,
    [
      [1.829, 0.211, 0.171],
      [1.866, 0.245, 0.19],
      [1.94, 0.202, 0.167],
      [2.013, 0.147, 0.146],
    ],
    p.leaf,
    0.19,
    24,
  );
  m.relief(
    [
      [-0.125, 1.931, 0.146],
      [0.125, 1.922, 0.146],
      [0.082, 1.813, 0.204],
      [-0.06, 1.736, 0.258],
    ],
    [0.014, 1.853, 0.23],
    0.019,
    p.leaf,
    0.2,
  );
  m.bone = BONE.rightArm;
  for (let i = 0; i < 4; i++) {
    const z = 0.142 - i * 0.083,
      end = [shoulder + 0.075 + (i % 2) * 0.034, 1.718 + i * 0.012, z];
    m.sweep(
      [[shoulder - 0.063, 1.914, z * 0.65], [shoulder + 0.008, 1.871, z], [shoulder + 0.069, 1.824, z], end],
      [0.015, 0.059, 0.053, 0.002],
      [0.012, 0.035, 0.031, 0.002],
      i % 2 ? p.leaf : p.lining,
      0.22,
    );
  }
  m.bone = BONE.head;
  // 깃털은 뒤로 살짝 누워 옆모습에서도 비늘 모양의 잎맥이 읽힌다.
  const x = 0.395,
    y = headY + 0.22;
  m.sweep(
    [
      [x, y, 0.122],
      [x + 0.069, y + 0.097, 0.083],
      [x + 0.106, y + 0.176, 0.023],
      [x + 0.125, y + 0.269, -0.045],
    ],
    [0.008, 0.061, 0.052, 0],
    [0.008, 0.027, 0.026, 0],
    p.leaf,
    0.28,
  );
  m.line(
    [
      [x, y, 0.135],
      [x + 0.064, y + 0.1, 0.107],
      [x + 0.101, y + 0.184, 0.044],
      [x + 0.125, y + 0.257, -0.026],
    ],
    0.008,
    p.gold,
    0.49,
  );
}
function healerCrown(m, p, headY) {
  m.bone = BONE.head;
  const points = [];
  for (let i = 0; i <= 28; i++) {
    const t = -1.6 + (i * 3.2) / 28;
    points.push([0.504 * Math.sin(t), headY + 0.229 + 0.078 * Math.abs(Math.sin(t)), 0.496 * Math.cos(t) - 0.008]);
  }
  m.line(points, 0.015, p.gold, 0.76);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const t = 0.43 + i * 0.255,
        x = s * 0.504 * Math.sin(t),
        y = headY + 0.237 + 0.078 * Math.sin(t),
        z = 0.496 * Math.cos(t) - 0.008;
      m.sweep(
        [
          [x, y, z],
          [x + s * 0.026, y + 0.045, z - 0.009],
          [x + s * 0.032, y + 0.094, z - 0.027],
        ],
        [0.004, 0.025, 0.001],
        [0.003, 0.014, 0.001],
        i % 2 ? p.cream : p.gold,
        0.6,
      );
    }
  }
  star(m, 0, headY + 0.23, 0.49, 0.066, p.gold);
  jewel(m, 0, headY + 0.229, 0.513, 0.019, 0.031, p.gem);
}

function embroidery(m, p, job) {
  m.bone = BONE.chest;
  if (job === 'healer') {
    for (const s of [-1, 1]) {
      const path = [
        [s * 0.21, 1.899, 0.158],
        [s * 0.165, 1.725, 0.238],
        [s * 0.16, 1.51, 0.236],
        [s * 0.15, 1.287, 0.244],
        [s * 0.184, 1.034, 0.267],
        [s * 0.202, 0.784, 0.283],
        [s * 0.215, 0.59, 0.294],
      ];
      m.sweep(
        path,
        [0.036, 0.051, 0.049, 0.043, 0.045, 0.048, 0.047],
        [0.009, 0.012, 0.012, 0.012, 0.011, 0.011, 0.009],
        p.cream,
        0.23,
      );
      m.line(
        path.map((q) => add(q, [s * 0.034, 0, 0.008])),
        0.005,
        p.gold,
        0.51,
      );
      star(m, s * 0.208, 0.696, 0.303, 0.032, p.gold);
    }
  } else if (job === 'arcanist') {
    const path = [
      [-0.09, 0.855, 0.303],
      [0.018, 0.924, 0.314],
      [-0.038, 1.016, 0.29],
      [0.096, 1.097, 0.275],
    ];
    m.line(path, 0.005, p.gold, 0.54);
    path.forEach((q, i) => star(m, ...q, i % 2 ? 0.029 : 0.02, p.cream));
  }
}

export function vestments(m, p, job, shoulder, hip, hand, headY) {
  mantle(m, p, job, shoulder);
  if (job === 'guardian') breastplate(m, p, shoulder);
  if (job === 'ranger') woodland(m, p, shoulder, headY);
  if (job === 'healer') healerCrown(m, p, headY);
  embroidery(m, p, job);
  for (const s of [-1, 1]) {
    m.bone = s < 0 ? BONE.leftArm : BONE.rightArm;
    const x = s * shoulder,
      y = 1.827;
    if (job === 'guardian') {
      m.rings(
        x,
        0,
        [
          [y - 0.11, 0.141, 0.152],
          [y - 0.089, 0.186, 0.19],
          [y - 0.063, 0.19, 0.19],
          [y + 0.072, 0.15, 0.155],
          [y + 0.131, 0.048, 0.071],
          [y + 0.134, 0.001, 0.001],
        ],
        p.metal,
        0.68,
        16,
      );
      m.rings(
        x,
        0,
        [
          [y - 0.099, 0.18, 0.187],
          [y - 0.08, 0.193, 0.194],
          [y - 0.061, 0.19, 0.193],
        ],
        p.gold,
        0.7,
        16,
      );
      jewel(m, x, y + 0.02, 0.167, 0.042, 0.054, p.gold);
    } else if (job === 'healer') {
      for (let i = 0; i < 3; i++) {
        const off = i * 0.044;
        m.sweep(
          [
            [x - s * 0.038, 1.91, 0.026],
            [x + s * (0.03 + off), 1.85, 0.06 - off],
            [x + s * (0.106 + off), 1.73 + i * 0.016, 0.04 - off],
          ],
          [0.052, 0.083, 0.002],
          [0.042, 0.048, 0.002],
          i === 1 ? p.cream : p.linen,
          0.29,
        );
      }
    }
  }
  m.bone = BONE.chest;
  // 가슴의 깃과 유색 보석이 초상화에서도 직업색을 남긴다.
  for (const s of [-1, 1]) {
    const start = [s * 0.141, 2.001, 0.08],
      mid = [s * (shoulder - 0.087), 1.881, 0.162],
      end = [s * 0.055, 1.732, 0.252];
    m.relief(
      [start, mid, end, [s * 0.097, 1.899, 0.211]],
      [s * 0.148, 1.883, 0.24],
      0.032,
      job === 'guardian' ? p.metal : job === 'ranger' ? p.leaf : p.cream,
      0.38,
    );
    m.line([mid, mix(mid, end, 0.46), end], 0.012, p.gold, 0.68);
  }
  jewel(m, 0, 1.77, 0.257, 0.064, 0.081, p.gold);
  jewel(m, 0, 1.77, 0.28, 0.039, 0.049, p.gem);
  if (job === 'ranger') {
    m.sweep(
      [
        [-hip * 0.72, 1.3, 0.14],
        [-0.108, 1.476, 0.237],
        [0.131, 1.716, 0.249],
        [shoulder * 0.75, 1.923, 0.102],
      ],
      [0.046, 0.049, 0.05, 0.043],
      [0.015, 0.016, 0.017, 0.012],
      p.leather,
      0.22,
    );
    quiver(m, p);
  }
  if (job === 'arcanist') {
    // 비스듬한 마법사 모자. 챙과 안감까지 빚어 아래·뒤에서도 닫힌다.
    m.bone = BONE.head;
    const h = headY + 0.1;
    m.rings(
      0,
      -0.035,
      [
        [h + 0.35, 0.16, 0.16],
        [h + 0.304, 0.57, 0.522],
        [h + 0.322, 0.591, 0.535],
        [h + 0.384, 0.451, 0.408],
        [h + 0.468, 0.348, 0.311, 0, -0.014],
        [h + 0.63, 0.247, 0.226, -0.012, -0.056],
        [h + 0.776, 0.173, 0.156, -0.028, -0.123],
        [h + 0.838, 0.106, 0.094, -0.017, -0.239],
        [h + 0.815, 0.065, 0.064, 0.008, -0.35],
        [h + 0.722, 0.005, 0.005, 0.03, -0.43],
      ],
      dye(p.cloth, '#332644', 0.38),
      0.19,
      32,
    );
    m.rings(
      0,
      -0.035,
      [
        [h + 0.378, 0.46, 0.42],
        [h + 0.391, 0.45, 0.414],
        [h + 0.434, 0.411, 0.379, 0, -0.007],
      ],
      p.gold,
      0.61,
      32,
    );
    star(m, -0.16, h + 0.485, 0.26, 0.064, p.gold);
  }
  m.bone = BONE.leftElbow;
  if (job === 'guardian') shield(m, -hand - 0.03, p);
  if (job === 'ranger') bow(m, -hand, p);
  if (job === 'healer' || job === 'arcanist') staff(m, -hand, p, job === 'healer');
  m.bone = BONE.rightElbow;
  if (job === 'guardian') sword(m, hand, p);
  if (job === 'arcanist') {
    const x = hand,
      z = 0.148;
    const page = [
      [x - 0.113, 1.244, z],
      [x + 0.12, 1.199, z],
      [x + 0.12, 0.904, z],
      [x - 0.113, 0.949, z],
    ];
    m.relief(
      page.map((q) => add(q, [0, 0, -0.043])),
      [x, 1.07, z - 0.032],
      0.072,
      p.cream,
    );
    m.relief(page, [x, 1.072, z + 0.008], 0.022, p.leather, 0.23);
    jewel(m, x, 1.071, z + 0.012, 0.066, 0.086, p.gold);
    jewel(m, x, 1.071, z + 0.037, 0.035, 0.051, p.gem);
  }
}
