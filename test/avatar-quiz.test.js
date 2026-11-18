import test from 'node:test';
import assert from 'node:assert/strict';
import { questions, jobDescriptions, scoreJourney } from '../assets/avatar/quiz-story.js';

const jobs = ['guardian', 'ranger', 'arcanist', 'healer'];
const times = (job, count) => Array(count).fill(job);

test('서로 다른 열 장면에 네 직업의 고유한 행동이 하나씩 있다', () => {
  assert.equal(questions.length, 10);
  assert.equal(new Set(questions.map(scene => scene.title)).size, 10);
  assert.equal(new Set(questions.map(scene => scene.prompt)).size, 10);
  for (const { prompt, choices } of questions) {
    assert.ok(prompt.endsWith('?'));
    assert.deepEqual(Object.keys(choices).sort(), [...jobs].sort());
    assert.equal(new Set(Object.values(choices)).size, jobs.length);
    assert.ok(Object.values(choices).every(text => text.trim()));
  }
});

test('각 직업을 고른 행동이 근거가 되고 네 직업 모두 결과에 도달한다', () => {
  for (const job of jobs) {
    const others = jobs.filter(id => id !== job);
    const result = scoreJourney([...others, ...times(job, 7)]);
    assert.equal(result.job, job);
    assert.deepEqual(result.tied, [job]);
    assert.equal(result.scores[job], 7);
    assert.equal(Object.values(result.scores).reduce((sum, votes) => sum + votes, 0), 10);
    assert.ok(jobDescriptions[job]);
  }
});

test('두 직업 및 세 직업의 최다 득표 동률에서는 먼저 고른 동률 직업을 추천한다', () => {
  for (const first of jobs) {
    const [second, third, fourth] = jobs.filter(job => job !== first);
    const half = scoreJourney([first, ...times(second, 5), ...times(first, 4)]);
    assert.equal(half.job, first);
    assert.equal(half.tied.length, 2);
    const triple = scoreJourney([fourth, first, ...times(third, 3), ...times(second, 3), first, first]);
    assert.equal(triple.job, first);
    assert.equal(triple.tied.length, 3);
    assert.equal(triple.scores[fourth], 1);
  }
});

test('이전 선택을 바꾸면 새 결과에 그 장면의 표만 반영된다', () => {
  const answers = [...times('arcanist', 5), ...times('healer', 5)];
  assert.equal(scoreJourney(answers).job, 'arcanist');
  answers[0] = 'healer';
  const revised = scoreJourney(answers);
  assert.equal(revised.job, 'healer');
  assert.deepEqual(revised.scores, { guardian: 0, ranger: 0, arcanist: 4, healer: 6 });
});

test('미완료 응답과 목록 밖의 행동으로는 직업을 정할 수 없다', () => {
  for (const answers of [[], times('ranger', 9), times('ranger', 11), times('unknown', 10), Array(10)]) {
    assert.throws(() => scoreJourney(answers));
  }
});
