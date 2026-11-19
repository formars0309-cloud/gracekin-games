import { BONE, TAU } from './sculpt.js';
import { sculptFace, sculptEars } from './face.js';
import { sculptHair } from './hair.js';

// 턱밑에서 목 앞쪽으로 돌아가는 살을 덧대고, 아래 단면은 원래 목 안으로 수렴시킨다.
function sculptThroat(m, skin) {
  m.surface(
    64,
    32,
    (u, v) => {
      const angle = u * TAU,
        front = Math.cos(angle);
      const y = -0.524 + 0.415 * v;
      const lift = Math.max(0, Math.min(1, (y + 0.501) / 0.132));
      const throat = 0.085 * lift * lift * (3 - 2 * lift);
      return [
        Math.sin(angle) * (0.143 + 0.057 * v * v),
        y,
        -0.008 * v + front * (0.141 + 0.059 * v * v) + Math.max(0, front) ** 2 * throat,
      ];
    },
    ([, y], u, v) => {
      // 턱이 가리는 목 위쪽은 반사광이 적다. 목깃 쪽으로 갈수록 본래 피부색으로 돌아간다.
      const front = Math.cos(u * TAU);
      const jawY = -0.309 - 0.099 * front - 0.026 * Math.max(0, front) ** 2;
      const t = Math.max(0, Math.min(1, (y - jawY + 0.113) / 0.116));
      const shade = t * t * (3 - 2 * t) * (1 - 0.68 * Math.max(0, front));
      return skin.map((c, k) => c * (0.927 + 0.034 * v) * (1 - shade * [0.183, 0.158, 0.112][k]));
    },
    0.09,
  );
}

export function sculptHead(m, a, p, headY) {
  m.bone = BONE.head;
  const start = m.vertices.length;
  sculptFace(m, a, p);
  sculptEars(m, a, p);
  sculptThroat(m, p.skin);
  sculptHair(m, a, p);
  for (let i = start; i < m.vertices.length; i += 11) {
    let y = m.vertices[i + 1];
    if (p.job === 'arcanist' && y > 0.27) y = 0.27 + (y - 0.27) * 0.74;
    m.vertices[i + 1] = y + headY;
  }
}
