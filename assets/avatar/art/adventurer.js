import { Sculpture, TAU, BONE, add, dye, mix, rgb } from './sculpt.js';
import { sculptHead } from './portrait.js';
import { jewel, vestments, JOB_LABELS } from './regalia.js';

const colors = { skinColor: '#c58f70', hairColor: '#493329', eyeColor: '#427d76', clothColor: '#386b76' };
const numbers = ['height', 'build', 'shoulders', 'jaw', 'eyes', 'nose'];

export function readAppearance(character) {
  const raw = character?.appearance || {},
    appearance = {};
  for (const key of numbers)
    appearance[key] = Number.isFinite(raw[key]) ? Math.max(0, Math.min(100, raw[key])) : 50;
  for (const [key, defaultColor] of Object.entries(colors))
    appearance[key] = /^#[0-9a-f]{6}$/i.test(raw[key]) ? raw[key] : defaultColor;
  appearance.hairStyle =
    Number.isInteger(raw.hairStyle) && raw.hairStyle >= 0 && raw.hairStyle <= 3 ? raw.hairStyle : 0;
  const job = Object.hasOwn(JOB_LABELS, character?.job) ? character.job : 'guardian';
  return { appearance, job };
}

function palette(a, job) {
  const gems = { guardian: '#63b7cb', ranger: '#b0c968', arcanist: '#98dde3', healer: '#f6c96e' };
  const cloth = rgb(a.clothColor);
  return {
    job,
    skin: rgb(a.skinColor),
    hair: rgb(a.hairColor),
    eye: rgb(a.eyeColor),
    cloth,
    gold: rgb('#cda767'),
    silver: rgb('#cbdada'),
    metal: rgb('#6c8799'),
    cream: rgb('#f7eace'),
    linen: rgb('#d4c9ab'),
    leather: rgb('#6e4939'),
    wood: rgb('#644438'),
    leaf: dye(cloth, '#849454', 0.51),
    gem: rgb(gems[job]),
    lining: dye(cloth, '#1b2234', 0.5),
    trousers: rgb('#454351'),
    boot: rgb('#523933'),
  };
}

function plinth(m, board) {
  m.bone = BONE.floor;
  const r = board ? 0.745 : 0.785;
  const stone = rgb('#424957'),
    edge = rgb('#a88a61'),
    top = rgb('#59606a');
  m.rings(
    0,
    0,
    [
      [-0.141, 0, 0],
      [-0.141, r * 0.91, r * 0.91],
      [-0.116, r, r],
      [-0.041, r, r],
      [-0.018, r * 0.945, r * 0.945],
      [-0.018, 0, 0],
    ],
    stone,
    0.26,
    48,
  );
  m.rings(
    0,
    0,
    [
      [-0.099, r * 1.001, r * 1.001],
      [-0.083, r * 1.001, r * 1.001],
    ],
    edge,
    0.55,
    48,
  );
  m.rings(
    0,
    0,
    [
      [-0.017, r * 0.942, r * 0.942],
      [-0.014, r * 0.927, r * 0.927],
      [-0.014, r * 0.898, r * 0.898],
      [-0.012, r * 0.895, r * 0.895],
      [-0.012, 0, 0],
    ],
    top,
    0.23,
    48,
  );
  m.rings(
    0,
    0,
    [
      [-0.011, r * 0.84, r * 0.84],
      [-0.011, r * 0.832, r * 0.832],
    ],
    edge,
    0.38,
    64,
  );
  for (let i = 0; i < 16; i++) {
    const t = (i * TAU) / 16,
      point = (delta, rr) => [Math.sin(t + delta) * rr, -0.01, Math.cos(t + delta) * rr];
    const long = i % 4 === 0;
    m.surface(
      1,
      1,
      (u, v) => point((u - 0.5) * (long ? 0.028 : 0.014), r * (0.87 + v * (long ? 0.051 : 0.029))),
      edge,
      0.4,
      false,
    );
  }
}

function bootsAndLegs(m, p, job, hip) {
  for (const s of [-1, 1]) {
    const leg = s * hip * 0.57,
      foot = leg + s * 0.036;
    m.bone = s < 0 ? BONE.leftHip : BONE.rightHip;
    m.pivots[m.bone] = [leg, 1.086, 0];
    m.sweep(
      [
        [leg, 1.133, 0],
        [leg, 1.024, 0],
        [leg + s * 0.011, 0.829, 0.006],
        [foot, 0.629, 0.019],
      ],
      [0.145, 0.162, 0.144, 0.11],
      [0.146, 0.152, 0.134, 0.11],
      p.trousers,
      0.11,
      16,
    );
    m.bone = s < 0 ? BONE.leftKnee : BONE.rightKnee;
    m.pivots[m.bone] = [foot, 0.636, 0.019];
    m.ball([foot, 0.633, 0.02], [0.116, 0.123, 0.114], p.trousers, 0.1);
    m.rings(
      foot,
      0,
      [
        [0.157, 0.105, 0.117],
        [0.234, 0.11, 0.124],
        [0.427, 0.124, 0.121],
        [0.591, 0.141, 0.138],
        [0.622, 0.138, 0.144],
        [0.63, 0.093, 0.098],
      ],
      p.boot,
      0.23,
      20,
    );
    m.rings(
      foot,
      0,
      [
        [0.524, 0.14, 0.139],
        [0.565, 0.154, 0.147],
        [0.624, 0.155, 0.149],
        [0.638, 0.131, 0.124],
      ],
      p.leather,
      0.21,
      20,
    );
    m.rings(
      foot,
      0,
      [
        [0.614, 0.156, 0.15],
        [0.628, 0.156, 0.15],
      ],
      p.gold,
      0.56,
      20,
    );
    const z = 0.071;
    m.rings(
      foot,
      z,
      [
        [0.004, 0.127, 0.202, 0.029],
        [0.022, 0.145, 0.218, 0.023],
        [0.071, 0.145, 0.216, 0.022],
        [0.124, 0.133, 0.204, 0.027],
        [0.173, 0.116, 0.168, 0.009],
        [0.229, 0.106, 0.119, -0.037],
        [0.254, 0.094, 0.109, -0.039],
      ],
      p.boot,
      0.28,
      20,
    );
    m.rings(
      foot,
      z,
      [
        [0.008, 0.13, 0.205, 0.028],
        [0.028, 0.147, 0.222, 0.023],
        [0.049, 0.147, 0.22, 0.023],
      ],
      dye(p.boot, '#211d27', 0.49),
      0.18,
      20,
    );
    for (const y of [0.314, 0.396]) {
      m.sweep(
        [
          [foot - 0.096, y + 0.046, 0.074],
          [foot, y, 0.125],
          [foot + 0.102, y - 0.029, 0.066],
        ],
        [0.021, 0.02, 0.018],
        [0.012, 0.014, 0.009],
        p.leather,
        0.3,
      );
    }
    if (job === 'guardian') {
      m.relief(
        [
          [foot, 0.588, 0.145],
          [foot + 0.086, 0.52, 0.114],
          [foot + 0.061, 0.326, 0.117],
          [foot, 0.257, 0.13],
          [foot - 0.073, 0.332, 0.11],
          [foot - 0.088, 0.514, 0.112],
        ],
        [foot, 0.454, 0.162],
        0.03,
        p.metal,
        0.61,
      );
    }
  }
}

function arms(m, p, job, shoulder, hand) {
  for (const s of [-1, 1]) {
    const x = s * shoulder,
      elbow = x + s * 0.068,
      palm = s * hand;
    m.bone = s < 0 ? BONE.leftArm : BONE.rightArm;
    m.pivots[m.bone] = [x, 1.843, 0];
    m.sweep(
      [
        [x, 1.925, -0.006],
        [x, 1.845, -0.006],
        [x + s * 0.026, 1.709, -0.012],
        [elbow, 1.512, -0.014],
      ],
      [0.06, 0.144, 0.141, 0.095],
      [0.06, 0.148, 0.138, 0.095],
      p.cloth,
      0.14,
      20,
    );
    m.bone = s < 0 ? BONE.leftElbow : BONE.rightElbow;
    m.pivots[m.bone] = [elbow, 1.522, -0.015];
    m.ball([elbow, 1.524, -0.014], [0.097, 0.096, 0.1], p.lining, 0.14);
    m.sweep(
      [
        [elbow, 1.54, -0.01],
        [elbow + s * 0.022, 1.467, 0.013],
        [palm, 1.32, 0.08],
        [palm, 1.253, 0.125],
      ],
      [0.091, 0.1, 0.077, 0.071],
      [0.092, 0.104, 0.086, 0.069],
      job === 'healer' ? p.cream : p.leather,
      0.21,
      18,
    );
    m.sweep(
      [
        [elbow + s * 0.012, 1.493, 0.004],
        [elbow + s * 0.019, 1.469, 0.012],
      ],
      [0.104, 0.107],
      [0.105, 0.109],
      p.gold,
      0.62,
      16,
    );
    m.sweep(
      [
        [palm, 1.297, 0.095],
        [palm, 1.267, 0.115],
      ],
      [0.078, 0.079],
      [0.081, 0.077],
      p.gold,
      0.6,
    );
    m.ball([palm, 1.192, 0.13], [0.082, 0.102, 0.085], p.skin, 0.14, 18);
    m.ball([palm - s * 0.067, 1.206, 0.169], [0.038, 0.052, 0.041], p.skin, 0.15, 12);
    for (let i = 0; i < 3; i++)
      m.ball([palm + s * (i - 1) * 0.035, 1.176, 0.185], [0.028, 0.044, 0.032], p.skin, 0.13, 12);
  }
}

function tunic(m, p, job, hip, waist, shoulder) {
  m.bone = BONE.chest;
  m.rings(
    0,
    0,
    [
      [1.255, waist, 0.177],
      [1.344, waist, 0.197],
      [1.52, waist + 0.015, 0.218],
      [1.72, shoulder - 0.057, 0.24],
      [1.844, shoulder - 0.016, 0.209],
      [1.922, shoulder - 0.088, 0.167],
      [1.958, 0.151, 0.128],
    ],
    p.cloth,
    0.17,
    32,
  );
  const robe = job === 'healer' || job === 'arcanist';
  const hem = job === 'healer' ? 0.548 : job === 'arcanist' ? 0.657 : 0.965;
  const panel = (u, v) => {
    const t = u * TAU,
      pleat = Math.cos(10 * t);
    const r = waist + (1 - v) * (hip - waist + 0.075) + (1 - v) * 0.013 * pleat;
    return [
      Math.sin(t) * r,
      hem + v * (1.353 - hem) + (1 - v) ** 4 * 0.038 * (1 + Math.cos(t * 6)),
      Math.cos(t) * (0.193 + (1 - v) * 0.091 + (1 - v) * 0.014 * pleat),
    ];
  };
  m.surface(60, 7, panel, robe ? p.lining : p.cloth, 0.12);
  m.surface(
    60,
    1,
    (u, v) => {
      const [x, y, z] = panel(u, 0.025 + v * 0.032);
      return [x * 1.008, y, z * 1.008];
    },
    p.gold,
    0.5,
  );
  const tabard = (u, v) => {
    const w = (0.19 + waist * 0.15) * (1 - v * 0.32),
      x = (u * 2 - 1) * w;
    return [
      x,
      hem - 0.086 + 0.112 * Math.abs(u * 2 - 1) + v * (1.37 - hem),
      0.211 + (1 - v) * 0.104 - 0.034 * (u * 2 - 1) ** 2,
    ];
  };
  m.surface(12, 5, tabard, job === 'healer' ? p.cream : p.cloth, 0.2, false);
  for (const u of [0.034, 0.966])
    m.line(
      [0, 0.4, 0.75, 1].map((v) => tabard(u, v)),
      0.009,
      p.gold,
      0.55,
    );
  const mark = tabard(0.5, 0.28);
  jewel(m, ...add(mark, [0, 0, 0.006]), 0.045, 0.082, p.gold);
  m.rings(
    0,
    0,
    [
      [1.289, waist + 0.019, 0.22],
      [1.31, waist + 0.029, 0.226],
      [1.385, waist + 0.026, 0.22],
      [1.398, waist + 0.016, 0.211],
    ],
    p.leather,
    0.23,
    32,
  );
  jewel(m, 0, 1.347, 0.237, 0.075, 0.056, p.gold);
  jewel(m, 0, 1.347, 0.263, 0.034, 0.027, p.lining);
  for (const s of [-1, 1]) {
    const x = s * (waist - 0.035);
    m.ball([x, 1.245, 0.148], [0.085, 0.089, 0.056], p.leather, 0.25);
    m.ball([x, 1.273, 0.201], [0.014, 0.014, 0.008], p.gold, 0.63);
  }
}

function neckAndCollar(m, p) {
  m.bone = BONE.chest;
  // 목밑은 옷깃 안에서 넓어지고, 목덜미는 턱밑보다 높게 뒤통수로 들어간다.
  const sections = [
    [1.912, 0.16, 0.127, -0.01, 0.015],
    [1.967, 0.144, 0.123, -0.013, 0.016],
    [2.007, 0.124, 0.104, -0.014, 0.023],
    [2.042, 0.113, 0.096, -0.009, 0.031],
    [2.084, 0.11, 0.09, 0.002, 0.045],
    [2.12, 0.116, 0.091, 0.015, 0.056],
    [2.151, 0.13, 0.097, 0.023, 0.065],
    [2.2, 0.132, 0.092, 0.021, 0.052],
  ];
  m.surface(
    40,
    sections.length - 1,
    (u, v) => {
      const [y, rx, rz, z, rise] = sections[Math.round(v * (sections.length - 1))];
      const t = TAU * u, front = Math.cos(t);
      // 귀 뒤에서 쇄골 안쪽으로 내려오는 좌우 근육을 곡면에 완만하게 돋운다.
      const muscle = 0.01 * Math.sin(Math.PI * v) * Math.exp(-((front - 0.82 + 1.12 * v) ** 2) / 0.06);
      return [(rx + muscle) * Math.sin(t), y + rise * (1 - front) / 2, z + (rz + muscle) * front];
    },
    (_, u, v) => {
      const front = (1 + Math.cos(TAU * u)) / 2;
      const shade = Math.min(1, v * v * 2.7) * (0.09 + 0.16 * front);
      return [p.skin[0] * (1 - 0.78 * shade), p.skin[1] * (1 - shade), p.skin[2] * (1 - 1.08 * shade)];
    },
    0.09,
  );
  m.rings(
    0,
    0,
    [
      [1.895, 0.227, 0.17, -0.004],
      [1.939, 0.181, 0.155, -0.006],
      [1.977, 0.152, 0.137, -0.009],
      [2.001, 0.141, 0.126, -0.01],
      [2.012, 0.137, 0.122, -0.01],
      [2.014, 0.112, 0.099, -0.01],
    ],
    p.lining,
    0.22,
    24,
  );
  m.rings(
    0,
    0,
    [
      [1.992, 0.147, 0.133, -0.01],
      [2.002, 0.143, 0.128, -0.01],
      [2.009, 0.14, 0.125, -0.01],
    ],
    p.gold,
    0.5,
    24,
  );
}

// 목선 위는 얼굴·귀걸이·머리 장식을 한 덩어리로, 아래는 장비와 관절까지 같은 체격으로 맞춘다.
function fitProportions(m, build) {
  const bodyStretch = 1.17;
  const headScale = 0.452 + (50 - build) * 0.00025;
  // 얼굴 원점 아래 0.47에 있는 턱끝을 옷깃보다 0.069 높게 놓는다.
  const headY = 2.008 * bodyStretch + 0.069 + 0.47 * headScale;
  const headZ = 0.035;
  let crown = headY, figureTop = headY;
  const vertices = m.vertices;
  for (let i = 0; i < vertices.length; i += 11) {
    const bone = vertices[i + 10];
    if (bone === BONE.floor) continue;
    if (bone === BONE.head) {
      vertices[i] *= headScale;
      vertices[i + 1] = headY + vertices[i + 1] * headScale;
      vertices[i + 2] = headZ + vertices[i + 2] * headScale;
      crown = Math.max(crown, vertices[i + 1]);
    } else {
      vertices[i + 1] *= bodyStretch;
      // 세로로 늘린 면의 법선은 역배율을 적용한다. 두 렌더러가 조명 계산 때 정규화한다.
      vertices[i + 4] /= bodyStretch;
    }
    figureTop = Math.max(figureTop, vertices[i + 1]);
  }
  for (const pivot of m.pivots) {
    if (pivot) pivot[1] *= bodyStretch;
  }
  m.pivots[BONE.head] = [0, headY - 0.22 * headScale, headZ - 0.10 * headScale];
  return { headScale, headY, crown, figureTop };
}

export function buildAdventurer(character, mode) {
  const { appearance: a, job } = readAppearance(character),
    p = palette(a, job),
    m = new Sculpture();
  const hip = 0.285 + a.build * 0.0009,
    waist = 0.217 + a.build * 0.0011;
  const shoulder = 0.251 + a.shoulders * 0.00228 + a.build * 0.00027;
  const hand = shoulder + 0.132;
  m.pivots[BONE.floor] = [0, 0, 0];
  m.pivots[BONE.chest] = [0, 1.12, 0];
  m.pivots[BONE.cape] = [0, 1.9, -0.12];
  if (mode === 'studio' || mode === 'board') plinth(m, mode === 'board');
  bootsAndLegs(m, p, job, hip);
  tunic(m, p, job, hip, waist, shoulder);
  arms(m, p, job, shoulder, hand);
  neckAndCollar(m, p);
  vestments(m, p, job, shoulder, hip, hand, 0);
  sculptHead(m, a, p, 0);
  const framing = fitProportions(m, a.build);
  return {
    vertices: new Float32Array(m.vertices),
    indices: new Uint16Array(m.indices),
    pivots: m.pivots,
    carriesStaff: job === 'arcanist' || job === 'healer',
    scaleY: 0.89 + a.height * 0.0022,
    ...framing,
  };
}
