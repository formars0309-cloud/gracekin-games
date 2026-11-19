// 운영 검토 후 항목을 추가할 수 있는 서버 공통 금칙어 목록입니다.
export const BLOCKED_WORDS = Object.freeze(['시발', '씨발', '개새끼', '병신']);

export function containsBlockedWord(value, words = BLOCKED_WORDS) {
  const compact = value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\u200b-\u200f\ufeff]/gu, '');
  return words.some(word => compact.includes(word.normalize('NFKC').toLowerCase()));
}
