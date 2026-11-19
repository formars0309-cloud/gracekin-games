import { createDefaultCharacter, createAvatarPreset, characterError, JOBS } from './model.js';
import { createAvatarView } from './renderer.js';
import { mountScene } from './studio-scene.js';
import { mountRecords } from './studio-records.js';
import { mountAvatarExport } from './gamekit.js';

const byId = id => document.getElementById(id);
const all = selector => document.querySelectorAll(selector);
const copy = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const jobLabel = id => JOBS.find(job => job.id === id)?.label || '';
const shapeFields = { height: '키', build: '체격', shoulders: '어깨 너비', jaw: '턱선', eyes: '눈매', nose: '코 모양' };
const colorFields = { skinColor: '피부색', hairColor: '머리색', eyeColor: '눈동자색', clothColor: '옷 색' };
const youth = createAvatarPreset('youth');
const maiden = createAvatarPreset('maiden');
const traveler = createAvatarPreset('youth');
Object.assign(traveler.appearance, { height: 61, build: 58, jaw: 56, hairStyle: 3, hairColor: '#593f35', clothColor: '#688059', eyeColor: '#909355' });
const presets = [
  { label: '미소년', character: youth }, { label: '미소녀', character: maiden }, { label: '들숲 여행자', character: traveler },
];
const fieldNames = Object.keys(createDefaultCharacter().appearance);
const sameLook = (a, b) => fieldNames.every(key => a[key] === b[key]);
let character = createDefaultCharacter();
let before = [], after = [], activeEdit = null;
let records;
const scene = mountScene(character);

function validDraft(item) {
  return typeof item?.name === 'string' && !characterError({ ...item, name: '초안' });
}

function render() {
  const a = character.appearance;
  if (byId('hero-name').value !== character.name) byId('hero-name').value = character.name;
  byId('plate-name').textContent = character.name.trim() || '이름 없는 모험가';
  byId('plate-job').textContent = jobLabel(character.job);
  byId('recommendation').hidden = !character.recommendedJob;
  byId('recommendation').textContent = '질문으로 찾은 직업 · ' + jobLabel(character.recommendedJob);
  all('[data-job]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.job === character.job)));
  all('[data-preset]').forEach(node => node.setAttribute('aria-pressed', String(sameLook(presets[Number(node.dataset.preset)].character.appearance, a))));
  all('[data-hair]').forEach(node => node.setAttribute('aria-pressed', String(Number(node.dataset.hair) === a.hairStyle)));
  all('[data-face-base]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.faceBase === a.faceBase)));
  all('input[data-appearance]').forEach(node => {
    const key = node.dataset.appearance;
    if (node.value !== String(a[key])) node.value = a[key];
    byId(key + '-value').textContent = a[key];
  });
  byId('undo').disabled = !before.length;
  byId('redo').disabled = !after.length;
  scene.update(character);
}

function change(next, group = null) {
  if (same(next, character)) return;
  if (!group || activeEdit !== group) {
    before.push(character);
    if (before.length > 70) before.shift();
  }
  after = [];
  activeEdit = group;
  character = next;
  render();
  records?.edited(group !== null && group !== 'name');
}

function replace(next, resetHistory = true) {
  if (!resetHistory && !same(character, next)) {
    before.push(character);
    after = [];
  }
  if (resetHistory) { before = []; after = []; }
  activeEdit = null;
  character = copy(next);
  render();
}

function timeTravel(undo) {
  const source = undo ? before : after;
  if (!source.length) return;
  (undo ? after : before).push(character);
  character = source.pop();
  activeEdit = null;
  render();
  records.edited();
}

function button(label, prop, value, action) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.dataset[prop] = value;
  node.addEventListener('click', action);
  return node;
}

function addField(key, title, parent, type) {
  const label = document.createElement('label');
  label.className = type === 'color' ? 'color-field' : 'slider-field';
  label.htmlFor = key;
  const text = document.createElement('span');
  text.textContent = title;
  const value = document.createElement('span');
  value.id = key + '-value';
  value.setAttribute('aria-hidden', 'true');
  const input = document.createElement('input');
  input.type = type;
  input.id = key;
  input.dataset.appearance = key;
  if (type === 'range') { input.min = '0'; input.max = '100'; input.step = '1'; }
  input.addEventListener('input', () => {
    const setting = type === 'range' ? input.valueAsNumber : input.value.toLowerCase();
    change({ ...character, appearance: { ...character.appearance, [key]: setting } }, key);
  });
  input.addEventListener('change', () => { activeEdit = null; });
  input.addEventListener('blur', () => { activeEdit = null; });
  label.append(text, value, input);
  byId(parent).append(label);
}

const previews = [];
for (const [index, preset] of presets.entries()) {
  const choice = button('', 'preset', index, () => change({ ...character, appearance: copy(preset.character.appearance) }));
  choice.setAttribute('aria-label', preset.label);
  const art = document.createElement('span');
  art.className = 'preset-art';
  art.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'preset-name';
  label.textContent = preset.label;
  choice.append(art, label);
  byId('presets').append(choice);
  try {
    const portrait = createAvatarView(art, preset.character, { mode: 'portrait' });
    portrait.setView('face');
    previews.push(portrait);
  } catch { art.hidden = true; }
}
JOBS.forEach(job => byId('jobs').append(button(job.label, 'job', job.id, () => change({ ...character, job: job.id }))));
all('[data-face-base]').forEach(node => node.addEventListener('click', () => {
  change({ ...character, appearance: { ...character.appearance, faceBase: node.dataset.faceBase } });
}));
for (const [key, title] of Object.entries(shapeFields)) addField(key, title, ['height', 'build', 'shoulders'].includes(key) ? 'body-fields' : 'face-fields', 'range');
for (const [key, title] of Object.entries(colorFields)) addField(key, title, 'color-fields', 'color');
['짧은 머리', '양 갈래 땋은 머리', '높이 묶은 머리', '양쪽 올림머리'].forEach((label, i) => byId('hair-fields').append(button(label, 'hair', i, () => change({ ...character, appearance: { ...character.appearance, hairStyle: i } }))));

function section(key) {
  all('[data-pane]').forEach(pane => { pane.hidden = pane.dataset.pane !== key; });
  all('[data-section]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.section === key)));
}
all('[data-section]').forEach(node => node.addEventListener('click', () => section(node.dataset.section)));
const nameField = byId('hero-name');
nameField.addEventListener('input', () => {
  nameField.setCustomValidity('');
  change({ ...character, name: nameField.value }, 'name');
});
nameField.addEventListener('blur', () => { activeEdit = null; });
byId('undo').onclick = () => timeTravel(true);
byId('redo').onclick = () => timeTravel(false);
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  timeTravel(!event.shiftKey);
});
function validateName() {
  const error = characterError(character);
  if (!error) return true;
  section('profile');
  nameField.setCustomValidity(error);
  nameField.reportValidity();
  nameField.focus();
  return false;
}

const quizDialog = byId('quiz-dialog');
let disposeQuiz;
async function openQuiz() {
  if (quizDialog.open) return;
  const root = byId('quiz-root');
  const bar = quizDialog.querySelector('.dialog-bar');
  bar.hidden = false;
  root.textContent = '질문을 펼치는 중…';
  quizDialog.showModal();
  try {
    const { mountJobQuiz } = await import('./quiz.js');
    if (!quizDialog.open) return;
    bar.hidden = true;
    disposeQuiz = mountJobQuiz(root, {
      onRecommend(jobId) {
        if (!jobLabel(jobId)) return;
        change({ ...character, job: jobId, recommendedJob: jobId });
        section('profile');
      },
      onClose() { quizDialog.close(); },
    });
  } catch { bar.hidden = false; root.textContent = '질문을 불러오지 못했어요. 창을 닫고 다시 열어 주세요.'; }
}
byId('open-quiz').onclick = openQuiz;
byId('close-quiz').onclick = () => quizDialog.close();
quizDialog.addEventListener('close', () => {
  if (typeof disposeQuiz === 'function') disposeQuiz();
  disposeQuiz = null;
  byId('quiz-root').replaceChildren();
  byId('open-quiz').focus({ preventScroll: true });
});
render();
records = mountRecords({ current: () => character, replace, makeDefault: createDefaultCharacter, validDraft, validateName });
const gameFiles = mountAvatarExport(byId('game-files'), records.getAvatar);
if (location.hash === '#quiz' || new URLSearchParams(location.search).get('mode') === 'quiz') openQuiz();
window.addEventListener('pagehide', event => {
  if (!event.persisted) { gameFiles.dispose(); previews.forEach(preview => preview.dispose()); scene.dispose(); }
});
