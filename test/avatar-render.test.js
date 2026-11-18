import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildAdventurer } from '../assets/avatar/art/adventurer.js';
import { pose } from '../assets/avatar/art/pose.js';

const digest = (model) => createHash('sha256').update(Buffer.from(model.vertices.buffer)).digest('hex');
const resting = { angle: 0, time: 0, motion: 'idle', mode: 'studio', view: 'full', width: 390, height: 480 };

test('네 직업과 네 머리 모양의 모든 면·관절이 모바일 공통 버퍼 범위에 들어간다', () => {
  for (const job of ['guardian', 'ranger', 'arcanist', 'healer']) {
    const styles = new Set();
    for (let hairStyle = 0; hairStyle < 4; hairStyle++) {
      const model = buildAdventurer({ job, appearance: { hairStyle } }, 'studio');
      const count = model.vertices.length / 11;
      assert.ok(count < 65536);
      assert.ok(model.vertices.every(Number.isFinite));
      assert.ok(model.indices.every((i) => i < count));
      for (let k = 10; k < model.vertices.length; k += 11) {
        const bone = model.vertices[k];
        assert.ok(Number.isInteger(bone) && model.pivots[bone]);
      }
      assert.ok(pose(model, resting).bones.every(Number.isFinite));
      styles.add(digest(model));
    }
    assert.equal(styles.size, 4);
  }
});

test('외형 항목을 하나씩 바꾸면 해당 조형·재질 또는 신장이 달라진다', () => {
  const baseline = buildAdventurer({}, 'portrait');
  const hash = digest(baseline);
  for (const key of [
    'build',
    'shoulders',
    'jaw',
    'eyes',
    'nose',
    'skinColor',
    'hairColor',
    'eyeColor',
    'clothColor',
  ]) {
    const value = key.endsWith('Color') ? '#971aca' : 100;
    assert.notEqual(digest(buildAdventurer({ appearance: { [key]: value } }, 'portrait')), hash, key);
  }
  const tall = buildAdventurer({ appearance: { height: 100 } }, 'portrait');
  assert.ok(tall.scaleY > baseline.scaleY);
  assert.notDeepEqual(pose(tall, resting).bones, pose(baseline, resting).bones);
});

test('게임 말·초상화·역할놀이가 같은 인물을 쓰고 회전 한 바퀴 뒤에 같은 자세로 돌아온다', () => {
  const samples = ['studio', 'board', 'rpg', 'portrait'].map((mode) => buildAdventurer({ job: 'ranger' }, mode));
  function figureVertices(model) {
    const start = model.vertices.findIndex((v, i) => i % 11 === 10 && v !== 0) - 10;
    return model.vertices.subarray(start);
  }
  for (const model of samples.slice(1)) assert.deepEqual(figureVertices(samples[0]), figureVertices(model));
  const original = pose(samples[0], resting).bones;
  const spun = pose(samples[0], { ...resting, angle: Math.PI * 2 }).bones;
  assert.ok(original.every((value, i) => Math.abs(value - spun[i]) < 1e-6));
  const walking = pose(samples[0], { ...resting, time: 0.34, motion: 'walk' }).bones;
  assert.notDeepEqual(walking, original);
  assert.ok(pose(samples[0], { ...resting, view: 'face' }).sy > pose(samples[0], resting).sy);
});
