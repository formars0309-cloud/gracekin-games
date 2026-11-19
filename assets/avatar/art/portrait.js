import { BONE } from './sculpt.js';
import { sculptFace, sculptEars } from './face.js';
import { sculptHair } from './hair.js';

export function sculptHead(m, a, p, headY) {
  m.bone = BONE.head;
  const start = m.vertices.length;
  sculptFace(m, a, p);
  sculptEars(m, a, p);
  sculptHair(m, a, p);
  for (let i = start; i < m.vertices.length; i += 11) {
    let y = m.vertices[i + 1];
    if (p.job === 'arcanist' && y > 0.27) y = 0.27 + (y - 0.27) * 0.74;
    m.vertices[i + 1] = y + headY;
  }
}
