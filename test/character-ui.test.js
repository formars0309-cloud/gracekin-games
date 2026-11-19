import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recolorPixels, characterLayers, LAYER_ORDER, rgbToHsv, hsvToRgb } from '../assets/character/render.js';
import { readDraft, writeDraft, transition, errorMessage, characterDestination, DRAFT_KEY } from '../assets/character/character.js';
import { createDefaultCharacter, validateCharacterData } from './fixtures/character/model.js';
const manifest = JSON.parse(await readFile(new URL('./fixtures/character/manifest.json',import.meta.url)));
const pixel = (...rgba) => Uint8ClampedArray.from(rgba);
const white = pixel(255,255,255,255);

test('색 변경은 목표색을 입히고 선·무채색·투명 화소·마스크 밖을 보존한다', () => {
  const source = pixel(180,90,45,255, 20,10,5,255, 150,150,150,255, 180,90,45,0, 180,90,45,255);
  const mask = pixel(...white,...white,...white,...white,0,0,0,255);
  const out = recolorPixels(source,mask,[50,150,100]);
  assert.deepEqual([...out.slice(0,4)],[50,150,100,255]);
  assert.deepEqual([...out.slice(4)],[...source.slice(4)]);
  assert.deepEqual([...source.slice(0,4)],[180,90,45,255]);
});
test('명암 비율과 중앙값을 보존하고 부분 강도 마스크는 원본과 섞는다', () => {
  const source = pixel(100,50,25,180, 200,100,50,255, 150,75,37,255);
  const mask = pixel(...white,...white,128,128,128,255);
  const out = recolorPixels(source,mask,[120,180,60]);
  assert.equal(out[3],180); assert.equal(out[1],120); assert.equal(out[5],240);
  const fully = recolorPixels(source,pixel(...white,...white,...white),[120,180,60]);
  assert.equal(out[8],Math.round(source[8]*(1-128/255)+fully[8]*128/255));
  assert.equal(out[9],Math.round(source[9]*(1-128/255)+fully[9]*128/255));
});
test('유효 화소가 없으면 그대로 반환하고 채도가 0인 목표색도 처리한다', () => {
  assert.deepEqual([...recolorPixels(pixel(10,10,10,255),white,[255,0,0])],[10,10,10,255]);
  const color = recolorPixels(pixel(180,90,45,255),white,[150,150,150]);
  assert.deepEqual([...color],[150,144,144,255]);
  assert.throws(() => recolorPixels(white,new Uint8ClampedArray(0),[1,2,3]));
});
test('HSV 왕복과 경계값에서 명도·채도 보존 조건을 적용한다', () => {
  for (const rgb of [[255,0,0],[0,255,0],[0,0,255],[124,74,44],[0,0,0],[255,255,255]]) assert.deepEqual(hsvToRgb(rgbToHsv(rgb)),rgb);
  const source = pixel(55,30,20,255, 200,180,180,255);
  assert.deepEqual([...recolorPixels(source,pixel(...white,...white),[0,255,0])],[...source]);
});
test('층은 계약 순서이고 없는 층은 제외하며 고정 피부에는 색을 입히지 않는다', () => {
  const data = createDefaultCharacter(); data.race = 'cat';
  assert.deepEqual(characterLayers(manifest,data).map(row => row.name),['back','body','outfit','hairFront','ears']);
  const all = structuredClone(manifest); all.hair.h1.back='hair-back.png';
  assert.deepEqual(characterLayers(all,data).map(row => row.name),LAYER_ORDER);
  data.race='dragon'; data.appearance.skin=null;
  assert.equal(characterLayers(manifest,data).find(row => row.name==='body').masks[0][1],null);
  assert.throws(() => characterLayers(manifest,{...data,job:'invalid'}));
});
test('초안은 복원·검증하며 손상된 JSON·다른 버전·저장 차단은 기본값으로 처리한다', () => {
  const fallback = createDefaultCharacter(), custom = {...fallback,race:'cat'};
  let stored;
  const storage = { getItem:key => { assert.equal(key,DRAFT_KEY);return stored; },setItem:(key,value) => { assert.equal(key,DRAFT_KEY);stored=value; } };
  assert.equal(writeDraft(storage,custom),true); assert.deepEqual(readDraft(storage,validateCharacterData,fallback),custom);
  for (const invalid of ['{','null',JSON.stringify({...custom,v:3})]) { stored=invalid; assert.deepEqual(readDraft(storage,validateCharacterData,fallback),fallback); }
  const blocked = { getItem(){throw Error();},setItem(){throw Error();} };
  assert.deepEqual(readDraft(blocked,validateCharacterData,fallback),fallback); assert.equal(writeDraft(blocked,custom),false); assert.equal(writeDraft(null,custom),false);
});
test('만들기 단계·외형만 변경·취소·저장 전환은 범위를 지킨다', () => {
  let state={mode:'create',step:0};
  for (let i=0;i<5;i++) state=transition(state,{type:'next'});
  assert.equal(state.step,3); for (let i=0;i<5;i++) state=transition(state,{type:'back'}); assert.equal(state.step,0);
  state=transition(state,{type:'saved'});assert.equal(state.mode,'member');
  state=transition(state,{type:'edit',appearanceOnly:true});assert.equal(state.step,1);
  state=transition(state,{type:'next'});assert.equal(state.step,3);state=transition(state,{type:'back'});assert.equal(state.step,1);
  state=transition(state,{type:'cancel'});assert.equal(state.mode,'member');
  state=transition(state,{type:'empty'});state=transition(state,{type:'next'});assert.equal(state.step,1);
});
test('정적 호스트만 같은 경로·쿼리·해시를 유지해 커뮤니티로 이동한다', () => {
  assert.equal(characterDestination({hostname:'gracekingames.com',search:'?game=slimeline&from=account',hash:'#preview'}),'https://community.gracekingames.com/character/?game=slimeline&from=account#preview');
  assert.equal(characterDestination({hostname:'community.gracekingames.com'}),null);
  assert.equal(characterDestination({hostname:'localhost'}),null);
});
test('401·409·422·초기화와 변경 잠김을 사용자 말로 안내한다', () => {
  assert.match(errorMessage(401),/로그인/);assert.match(errorMessage(409),/다른 창/);
  assert.match(errorMessage(422,'CHANGE_LOCKED'),/레벨 10/);assert.match(errorMessage(422,'RESET_NOT_READY'),/무료 초기화/);
  assert.equal(errorMessage(422,'INVALID','포인트가 부족해요.'),'포인트가 부족해요.');
  assert.doesNotMatch(errorMessage(422,'INVALID','invalid value'),/invalid value/);
});

test('캐릭터 전용 정적 검사 예외는 추가 저장소와 외부 요청을 계속 차단한다', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('verify_site','scripts/verify_site.py')
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
ui=Path('assets/character/character.js').read_text()
art=Path('assets/character/render.js').read_text()
assert not m.character_network_issues(ui)
assert not m.character_network_issues(art,renderer=True)
assert m.character_network_issues(ui+"\\nlocalStorage.setItem('token','x')")
assert m.character_network_issues(ui+"\\nsessionStorage.getItem('session')")
assert m.character_network_issues(art+"\\nfetch('https://example.test/tracker')",renderer=True)
assert m.character_network_issues(art.replace('new URL(base).origin !==','new URL(base).origin ==='),renderer=True)
`;
  execFileSync('python3',['-c',script],{cwd:new URL('../',import.meta.url)});
});


test('회색조 마스크는 빨간 채널 강도만 쓰고 원본 그림 알파를 보존한다', () => {
  const source=pixel(180,90,45,77);
  assert.deepEqual([...recolorPixels(source,pixel(128,128,128,255),[50,120,180])],[115,105,113,77]);
  assert.deepEqual([...recolorPixels(source,pixel(128,128,128,0),[50,120,180])],[115,105,113,77]);
});
test('부분 마스크 혼합을 끝낸 뒤 반올림하고 유효 화소 두 개의 중앙값을 쓴다', () => {
  const source=pixel(180,90,45,255,68,40,20,128);
  const out=recolorPixels(source,pixel(...white,128,128,128,255),[50,120,180]);
  assert.deepEqual([...out],[65,167,255,255,49,53,60,128]);
});
test('실제 manifest의 고정 피부와 긴 뒷머리를 계약 순서로 선택한다', async () => {
  const actual=JSON.parse(await readFile(new URL('../assets/character/manifest.json',import.meta.url)));
  for (const race of ['dragon','moon']) {
    const data=createDefaultCharacter();data.race=race;data.appearance.skin=null;data.appearance.hair='h2';
    const layers=characterLayers(actual,data);
    assert.equal(layers.find(row => row.name==='body').masks[0][0],null);
    assert.ok(layers.findIndex(row => row.name==='hairBack') < layers.findIndex(row => row.name==='body'));
    assert.ok(layers.findIndex(row => row.name==='hairFront') > layers.findIndex(row => row.name==='outfit'));
  }
});
