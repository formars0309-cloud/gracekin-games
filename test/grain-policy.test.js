import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAIN_REWARD_POLICY, REWARD_DAY_MS } from '../server/grain-policy.js';
import { REWARD_DAY_MS as compatibleDay } from '../server/grain-rewards.js';

test('공개 보상 정책은 확정 지급량·한도를 유지하며 하위 객체까지 변경할 수 없음', () => {
  assert.deepEqual(GRAIN_REWARD_POLICY, {
    dayMs: 86400000, kstOffsetMs: 32400000,
    activity: {
      attendance: { amount: 300, dailyLimit: 1 },
      post: { amount: 500, dailyLimit: 3, minBodyLength: 30 },
      comment: { amount: 100, dailyLimit: 10, minBodyLength: 10 },
      dailyTotalLimit: 3000, confirmationDelayMs: 86400000,
    },
    bugReport: { simple: { amount: 2000, label: '단순' }, normal: { amount: 5000, label: '일반' }, critical: { amount: 20000, label: '중대' } },
    bestPost: { amount: 3000 },
  });
  function frozen(value) {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child);
  }
  frozen(GRAIN_REWARD_POLICY);
  assert.throws(() => { GRAIN_REWARD_POLICY.activity.post.amount = 1; }, TypeError);
  assert.throws(() => { GRAIN_REWARD_POLICY.bugReport.critical.amount = 1; }, TypeError);
  assert.equal(compatibleDay, REWARD_DAY_MS);
  assert.equal(REWARD_DAY_MS, GRAIN_REWARD_POLICY.activity.confirmationDelayMs);
});
