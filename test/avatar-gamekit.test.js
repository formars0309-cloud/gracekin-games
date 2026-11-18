import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameSnapshot } from '../assets/avatar/gamekit.js';

function draft() {
  return {
    id: null, revision: 0, session: '비공개', userId: '회원',
    character: {
      name: '개인 이름', recommendedJob: 'ranger', answers: ['원 응답'], job: 'healer',
      appearance: {
        height: 0, build: 100, shoulders: 50, jaw: 10, eyes: 90, nose: 35, hairStyle: 3,
        skinColor: '#f4d1ae', hairColor: '#301e33', eyeColor: '#432e37', clothColor: '#ba9236',
        memo: '비공개 메모',
      },
    },
  };
}

test('게임 스냅샷은 미저장·저장 상태를 표현하고 허용한 값만 복사한다', () => {
  const input = draft();
  const result = gameSnapshot(input);
  assert.deepEqual(result, {
    version: 1, id: null, revision: 0, character: {
      job: 'healer',
      appearance: {
        height: 0, build: 100, shoulders: 50, jaw: 10, eyes: 90, nose: 35, hairStyle: 3,
        skinColor: '#f4d1ae', hairColor: '#301e33', eyeColor: '#432e37', clothColor: '#ba9236',
      },
    },
  });
  input.character.appearance.jaw = 77;
  assert.equal(result.character.appearance.jaw, 10);
  for (const job of ['guardian', 'ranger', 'arcanist', 'healer']) {
    input.character.job = job;
    input.id = '아바타-A/01';
    input.revision = 4;
    const saved = gameSnapshot(input);
    assert.equal(saved.id, input.id);
    assert.equal(saved.revision, 4);
    assert.equal(saved.character.job, job);
  }
});

test('허용 필드 안의 자유 입력·잘못된 형식은 파일 생성 전에 거른다', () => {
  for (const [key, value] of [
    ['height', 101], ['build', -1], ['shoulders', 70.5], ['jaw', '비공개'],
    ['eyes', null], ['nose', NaN], ['hairStyle', 4], ['skinColor', '#123456\n'],
    ['hairColor', ['#123456']], ['clothColor', '#ZZZZZZ'], ['eyeColor', '#123456 메모'],
  ]) {
    const input = draft();
    input.character.appearance[key] = value;
    assert.throws(() => gameSnapshot(input));
  }
  for (const [key, value] of [['revision', {}], ['revision', 1], ['id', ['회원']], ['id', '']]) {
    const input = draft();
    input[key] = value;
    assert.throws(() => gameSnapshot(input));
  }
  const input = draft();
  input.character.job = '자유 입력';
  assert.throws(() => gameSnapshot(input));
});
