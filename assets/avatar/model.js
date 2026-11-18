export const JOBS = Object.freeze([
  { id: 'guardian', label: '수호기사' },
  { id: 'ranger', label: '숲길잡이' },
  { id: 'arcanist', label: '룬술사' },
  { id: 'healer', label: '별빛치유사' },
].map(job => Object.freeze(job)));

const proportions = ['height', 'build', 'shoulders', 'jaw', 'eyes', 'nose'];
const colors = ['skinColor', 'hairColor', 'eyeColor', 'clothColor'];
const appearanceFields = [...proportions, 'hairStyle', ...colors];
const jobIds = new Set(JOBS.map(job => job.id));

const presetAppearances = new Map([
  ['youth', {
    height: 64, build: 43, shoulders: 59, jaw: 44, eyes: 56, nose: 54,
    hairStyle: 0, skinColor: '#e5b798', hairColor: '#3d3040', eyeColor: '#627d89', clothColor: '#526da2',
  }],
  ['maiden', {
    height: 48, build: 31, shoulders: 36, jaw: 24, eyes: 73, nose: 34,
    hairStyle: 2, skinColor: '#edc4ad', hairColor: '#754652', eyeColor: '#568275', clothColor: '#8d5d86',
  }],
]);

export function createAvatarPreset(id) {
  const appearance = presetAppearances.get(id);
  if (!appearance) throw new RangeError('지원하지 않는 아바타 프리셋입니다.');
  return {
    name: '새별',
    appearance: { ...appearance },
    job: 'guardian',
    recommendedJob: null,
  };
}

export function createDefaultCharacter() {
  return createAvatarPreset('youth');
}

function hasFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

// 브라우저와 서버가 같은 범위·필수 항목을 검사한다. 성공 시 오류 메시지는 없다.
export function characterError(character) {
  if (!hasFields(character, ['name', 'appearance', 'job', 'recommendedJob'])) return '캐릭터 항목을 확인해 주세요.';
  const name = typeof character.name === 'string' ? character.name.trim() : '';
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(character.name)) return '캐릭터 이름은 한 줄로 1~24자를 입력해 주세요.';
  if (!jobIds.has(character.job) || (character.recommendedJob !== null && !jobIds.has(character.recommendedJob))) return '캐릭터의 직업을 확인해 주세요.';
  const appearance = character.appearance;
  if (!hasFields(appearance, appearanceFields)) return '캐릭터의 외형 항목을 확인해 주세요.';
  if (proportions.some(key => !Number.isInteger(appearance[key]) || appearance[key] < 0 || appearance[key] > 100)) return '얼굴과 체형은 0~100 사이의 정수를 선택해 주세요.';
  if (!Number.isInteger(appearance.hairStyle) || appearance.hairStyle < 0 || appearance.hairStyle > 3) return '머리 모양을 확인해 주세요.';
  if (colors.some(key => typeof appearance[key] !== 'string' || !/^#[0-9a-f]{6}$/.test(appearance[key]))) return '색상은 # 뒤에 소문자 16진수 여섯 자리를 입력해 주세요.';
  return null;
}
