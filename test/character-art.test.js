import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../assets/character/', import.meta.url));
const art = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const raceIds = ['human', 'elf', 'dwarf', 'cat', 'fox', 'rabbit', 'bear', 'dragon', 'fairy', 'moon'];
const jobIds = ['guardian', 'windblade', 'monk', 'shadow', 'ranger', 'runesmith', 'arcanist', 'alchemist', 'healer', 'bard'];
const sequence = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

// 외부 이미지 디코더 없이 RIFF 안의 세 가지 WebP 크기 헤더를 읽는다.
function dimensions(file) {
  const data = readFileSync(file);
  assert.equal(data.toString('ascii', 0, 4), 'RIFF', 'RIFF 형식이어야 합니다');
  assert.equal(data.toString('ascii', 8, 12), 'WEBP', 'WebP 형식이어야 합니다');
  assert.equal(data.readUInt32LE(4) + 8, data.length, '파일 길이가 헤더와 같아야 합니다');
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = data.toString('ascii', offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + length <= data.length, '청크가 파일 밖으로 나가지 않아야 합니다');
    if (kind === 'VP8X') {
      return { w: data.readUIntLE(start + 4, 3) + 1, h: data.readUIntLE(start + 7, 3) + 1, alpha: Boolean(data[start] & 0x10) };
    }
    if (kind === 'VP8L') {
      assert.equal(data[start], 0x2f);
      const bits = data.readUInt32LE(start + 1);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean(bits & 0x10000000) };
    }
    if (kind === 'VP8 ') {
      assert.equal(data.toString('hex', start + 3, start + 6), '9d012a');
      return { w: data.readUInt16LE(start + 6) & 0x3fff, h: data.readUInt16LE(start + 8) & 0x3fff, alpha: false };
    }
    offset = start + length + (length % 2);
  }
  assert.fail(`크기 헤더가 없습니다: ${file}`);
}

function addAsset(relative, mask = false) {
  assert.equal(typeof relative, 'string');
  assert.match(relative, /^parts\/(body|race|hair|outfit)\/[a-z0-9-]+\.webp$/);
  const file = path.join(root, relative);
  assert.ok(statSync(file).isFile(), `${relative} 파일이 있어야 합니다`);
  assert.ok(statSync(file).size <= 150_000, `${relative} 파일은 150KB 이하여야 합니다`);
  const size = dimensions(file);
  assert.deepEqual([size.w, size.h], [512, 768], `${relative} 크기를 확인합니다`);
  if (!mask) assert.equal(size.alpha, true, `${relative}에 알파 채널이 있어야 합니다`);
}

test('그림 계약의 버전·캔버스·초상 범위·층 순서를 지킨다', () => {
  assert.equal(art.v, 1);
  assert.deepEqual(art.canvas, { w: 512, h: 768 });
  assert.deepEqual(art.order, ['back', 'hairBack', 'body', 'outfit', 'hairFront', 'ears']);
  const { x, y, size } = art.portrait;
  for (const n of [x, y, size]) assert.ok(Number.isInteger(n) && n >= 0);
  assert.ok(size > 0 && x + size <= 512 && y + size <= 768);
});

test('종족 10종의 경로·크기·피부 고정·귀와 뒤층을 검사한다', () => {
  assert.deepEqual(Object.keys(art.races), raceIds);
  for (const [id, entry] of Object.entries(art.races)) {
    assert.deepEqual(Object.keys(entry).sort(), ['back', 'body', 'ears', 'eyeMask', 'skinMask']);
    addAsset(entry.body);
    addAsset(entry.eyeMask, true);
    if (['dragon', 'moon'].includes(id)) assert.equal(entry.skinMask, null, `${id}은 피부가 고정입니다`);
    else addAsset(entry.skinMask, true);
    for (const [field, expected] of [['ears', ['cat', 'fox', 'rabbit', 'bear', 'dragon']], ['back', ['cat', 'fox', 'bear', 'dragon', 'fairy']]]) {
      if (expected.includes(id)) addAsset(entry[field]);
      else assert.equal(entry[field], null);
    }
  }
});

test('머리 h1~h8의 앞층과 긴 머리 네 종의 뒤층·마스크를 검사한다', () => {
  assert.deepEqual(Object.keys(art.hair), sequence('h', 8));
  const labels = ['헝클어진 짧은 머리', '긴 생머리', '단정한 단발', '높은 포니테일', '양 갈래 땋은 머리', '뻗친 머리', '둥근 보브', '긴 웨이브'];
  for (const [index, entry] of Object.values(art.hair).entries()) {
    assert.equal(entry.label, labels[index]);
    addAsset(entry.front);
    addAsset(entry.mask, true);
    if ([1, 3, 4, 7].includes(index)) {
      addAsset(entry.back);
      addAsset(entry.backMask, true);
    } else {
      assert.equal(entry.back, null);
      assert.equal(entry.backMask, null);
    }
  }
});

test('직업 10벌의 ID·이미지·강조색 마스크를 검사한다', () => {
  assert.deepEqual(Object.keys(art.outfits), jobIds);
  for (const entry of Object.values(art.outfits)) {
    addAsset(entry.image);
    addAsset(entry.accentMask, true);
  }
});

test('색상 30개의 ID·한국어 이름·RGB 범위를 검사한다', () => {
  assert.deepEqual(Object.keys(art.palettes), ['hair', 'eye', 'skin', 'accent']);
  for (const [kind, prefix, count] of [['hair', 'c', 10], ['eye', 'e', 6], ['skin', 's', 6], ['accent', 'a', 8]]) {
    const choices = art.palettes[kind];
    assert.deepEqual(choices.map(c => c.id), sequence(prefix, count));
    for (const color of choices) {
      assert.match(color.label, /^[가-힣 ]+$/);
      assert.equal(color.rgb.length, 3);
      assert.ok(color.rgb.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
    }
  }
});

test('모든 납품 파일이 manifest에 연결되며 전체 6MB 이하이다', () => {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
  const files = walk(path.join(root, 'parts'));
  const paths = value => typeof value === 'string' && value.startsWith('parts/') ? [value]
    : value && typeof value === 'object' ? Object.values(value).flatMap(paths) : [];
  assert.deepEqual(files.map(f => path.relative(root, f)).sort(), [...new Set(paths(art))].sort());
  assert.ok(files.every(f => f.endsWith('.webp')), '납품은 WebP만 포함합니다');
  const bytes = files.reduce((sum, file) => sum + statSync(file).size, statSync(path.join(root, 'manifest.json')).size);
  assert.ok(bytes <= 6_000_000, `전체 용량 ${bytes}바이트가 예산을 지켜야 합니다`);
});
