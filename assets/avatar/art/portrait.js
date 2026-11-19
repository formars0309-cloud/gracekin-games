import { sculptFace, sculptEars } from './face.js';
import { BONE, TAU, add, cross, dye, mul, rgb, sub, unit } from './sculpt.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const f = clamp(x);
  return f * f * (3 - 2 * f);
};
// 머릿결의 단면을 매끄럽게 이어 측면에서도 다발이 꺾이지 않게 한다.
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
  const start = m.vertices.length;
  sculptFace(m, a, p);
  sculptEars(m, a, p);
  sculptHair(m, a, p.hair);
  for (let i = start; i < m.vertices.length; i += 11) {
    let y = m.vertices[i + 1];
    if (p.job === 'arcanist' && y > 0.27) y = 0.27 + (y - 0.27) * 0.74;
    m.vertices[i + 1] = y + headY;
  }
}
