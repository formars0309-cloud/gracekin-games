// 지급 코드와 비로그인 공개 안내가 함께 참조하는 그레인 보상 정책입니다.
const deepFreeze = value => {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
};

export const REWARD_DAY_MS = 86400000;
export const GRAIN_REWARD_POLICY = deepFreeze({
  dayMs: REWARD_DAY_MS,
  kstOffsetMs: 9 * 3600000,
  activity: {
    attendance: { amount: 300, dailyLimit: 1 },
    post: { amount: 500, dailyLimit: 3, minBodyLength: 30 },
    comment: { amount: 100, dailyLimit: 10, minBodyLength: 10 },
    dailyTotalLimit: 3000,
    confirmationDelayMs: REWARD_DAY_MS,
  },
  bugReport: {
    simple: { amount: 2000, label: '단순' },
    normal: { amount: 5000, label: '일반' },
    critical: { amount: 20000, label: '중대' },
  },
  bestPost: { amount: 3000 },
});
