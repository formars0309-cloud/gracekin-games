import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdventurer } from '../assets/avatar/art/adventurer.js';
import { pose } from '../assets/avatar/art/pose.js';
import { BONE } from '../assets/avatar/art/sculpt.js';

function projectedBounds(model, options, onlyBone) {
  const { bones, sx, sy } = pose(model, options);
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  const v = model.vertices;
  for (let i = 0; i < v.length; i += 11) {
    const bone = v[i + 10];
    if (onlyBone !== undefined && bone !== onlyBone) continue;
    const j = bone * 16;
    const x = (bones[j] * v[i] + bones[j + 4] * v[i + 1] + bones[j + 8] * v[i + 2] + bones[j + 12]) * sx;
    const y = (bones[j + 1] * v[i] + bones[j + 5] * v[i + 1] + bones[j + 9] * v[i + 2] + bones[j + 13]) * sy;
    left = Math.min(left, x);
    right = Math.max(right, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
  }
  return { left, right, bottom, top };
}

test('공방의 전신은 모험가 비례를 유지하고 얼굴 확대에는 턱 아래 어깨가 담긴다', () => {
  for (const size of [0, 100]) {
    const appearance = { height: size, build: size, shoulders: size, hairStyle: 0 };
    const model = buildAdventurer({ job: 'guardian', appearance }, 'rpg');
    const camera = { mode: 'rpg', view: 'full', width: 390, height: 440, angle: 0, cycle: 0, motion: 'idle' };
    const head = projectedBounds(model, camera, BONE.head);
    const body = projectedBounds(model, camera);
    const ratio = (body.top - body.bottom) / (head.top - head.bottom);
    assert.ok(ratio > 5.3 && ratio < 7, `전신이 머리의 ${ratio}배`);

    const portrait = projectedBounds(model, { ...camera, view: 'face' }, BONE.head);
    assert.ok(portrait.top < 1 && portrait.top > 0.56, '정수리 여백');
    assert.ok(portrait.bottom > -0.65 && portrait.bottom < 0.12, '턱밑과 어깨 여백');
    assert.ok(portrait.top - portrait.bottom > 1, '확대한 머리가 화면 높이의 절반 이상');
  }
});

test('좁은 전신 화면에서 돌아서거나 걸어도 발·무기·모자 끝이 잘리지 않는다', () => {
  for (const job of ['guardian', 'ranger', 'arcanist', 'healer']) {
    const model = buildAdventurer({ job, appearance: { height: 100, shoulders: 100, build: 100 } }, 'studio');
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const cycle of [0.25, 0.75]) {
        const camera = { width: 140, height: 390, mode: 'studio', view: 'full', motion: 'walk', cycle, angle };
        const { left, right, top, bottom } = projectedBounds(model, camera);
        assert.ok(left > -1 && right < 1 && bottom > -1 && top < 1, `${job} 각도 ${angle} 보행 ${cycle}`);
      }
    }
  }
});
