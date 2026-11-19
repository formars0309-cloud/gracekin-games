import test from 'node:test';
import assert from 'node:assert/strict';
import { sculptFace } from '../assets/avatar/art/face.js';
import { BONE, Sculpture, rgb } from '../assets/avatar/art/sculpt.js';
import { createAvatarPreset } from '../assets/avatar/model.js';

function face(appearance, eye = '#71635b') {
  const model = new Sculpture();
  model.bone = BONE.head;
  sculptFace(model, appearance, { skin: rgb('#deb99c'), eye: rgb(eye), hair: rgb('#493329') });
  return model;
}

test('두 원형은 같은 체형·머리·색에서도 다른 얼굴 좌표와 원화 색을 쓴다', () => {
  const appearance = createAvatarPreset('youth').appearance;
  const youth = face(appearance);
  const maiden = face({ ...appearance, faceBase: 'maiden' });
  assert.deepEqual(youth.indices, maiden.indices);
  const geometry = (model) => model.vertices.filter((_, i) => i % 11 < 3);
  const pigment = (model) => model.vertices.filter((_, i) => i % 11 >= 6 && i % 11 <= 8);
  assert.notDeepEqual(geometry(youth), geometry(maiden));
  assert.notDeepEqual(pigment(youth), pigment(maiden));
  assert.deepEqual(face({ ...appearance, hairStyle: 2 }).vertices, youth.vertices);
});

test('원화로 구운 얼굴과 뒤통수가 열린 틈 없이 연결되고 눈 색은 홍채에서만 달라진다', () => {
  const appearance = createAvatarPreset('maiden').appearance;
  const model = face(appearance),
    edited = face(appearance, '#36a9e2');
  const edges = new Map();
  for (let k = 0; k < model.indices.length; k += 3) {
    for (let side = 0; side < 3; side++) {
      const a = model.indices[k + side],
        b = model.indices[k + ((side + 1) % 3)];
      const key = Math.min(a, b) * 65536 + Math.max(a, b);
      const edge = edges.get(key) || { count: 0, direction: 0 };
      edge.count++;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  assert.ok([...edges.values()].every(({ count, direction }) => count === 2 && direction === 0));
  const changes = [0, 0];
  for (let k = 0; k < model.vertices.length; k += 11) {
    if (model.vertices[k + 6] === edited.vertices[k + 6]) continue;
    const [x, y, z] = model.vertices.slice(k, k + 3);
    assert.ok(Math.abs(x) > 0.12 && Math.abs(x) < 0.24 && y > 0.021 && y < 0.1 && z > 0.25);
    changes[Number(x > 0)]++;
  }
  assert.ok(changes.every((count) => count > 25));
});
