import { loadCharacterArt, renderCharacter } from './render.js';

export const DRAFT_KEY = 'gracekin-character-draft-v1';
export function readDraft(storage, validate, fallback) {
  try { const data = JSON.parse(storage.getItem(DRAFT_KEY)); validate(data); return structuredClone(data); }
  catch { return structuredClone(fallback); }
}
export function writeDraft(storage, data) {
  try { storage.setItem(DRAFT_KEY, JSON.stringify(data)); return true; } catch { return false; }
}
export function transition(state, action) {
  switch (action.type) {
    case 'next': return { ...state, step: state.appearanceOnly ? 3 : Math.min(3, state.step + 1) };
    case 'back': return { ...state, step: state.appearanceOnly ? 1 : Math.max(0, state.step - 1) };
    case 'edit': return { ...state, mode: 'edit', step: action.appearanceOnly ? 1 : 0, appearanceOnly: !!action.appearanceOnly };
    case 'cancel': return { ...state, mode: 'member', step: 0, appearanceOnly: false };
    case 'saved': return { ...state, mode: 'member', step: 0, appearanceOnly: false };
    case 'empty': return { ...state, mode: 'create', step: 0, appearanceOnly: false };
    default: return state;
  }
}
export function characterDestination(location) {
  if (!['gracekingames.com', 'www.gracekingames.com'].includes(location.hostname)) return null;
  return `https://community.gracekingames.com/character/${location.search || ''}${location.hash || ''}`;
}
export function errorMessage(status, code, detail) {
  if (status === 401) return '로그인이 필요해요. 만들던 모습은 이 화면에 남아 있어요. 로그인한 뒤 다시 저장해 주세요.';
  if (status === 409) return '다른 창에서 캐릭터가 바뀌었어요. 최신 캐릭터를 확인한 뒤 다시 수정해 주세요.';
  if (code === 'CHANGE_LOCKED') return '레벨 10부터 종족과 직업이 정해져요. 외형은 계속 바꿀 수 있어요.';
  if (code === 'RESET_NOT_READY') return '아직 무료 초기화 날짜가 되지 않았어요. 다음 무료 날짜를 확인해 주세요.';
  if (status === 422) return /[가-힣]/.test(detail || '') ? detail : '선택한 값이나 남은 포인트를 확인해 주세요.';
  if (status === 429) return '요청이 많아요. 잠시 쉬었다 다시 시도해 주세요.';
  return '지금 연결하지 못했어요. 저장 결과를 다시 확인한 뒤 시도해 주세요.';
}

async function start() {
  const destination = characterDestination(location);
  if (destination) { location.replace(destination); return; }
  const byId = id => document.getElementById(id);
  const say = (id, text) => { byId(id).textContent = text; byId(id).hidden = !text; };
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  const button = (text, handler, className = '') => { const node = make('button', text, className); node.type = 'button'; node.addEventListener('click', handler); return node; };
  let model, art, user = null, character = null, data, state = { mode: 'create', step: 0, appearanceOnly: false }, busy = false, conflict = false, renderVersion = 0;
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const draft = () => { if (state.mode === 'create' && !writeDraft(storage, data)) say('draft-note', '이 브라우저에는 초안을 보관할 수 없어요. 창을 닫기 전에 로그인하고 저장해 주세요.'); };
  async function request(path = '', method = 'GET', body) {
    let response;
    try { response = await fetch(`/api/character/me${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error(errorMessage(0)); }
    let result;
    try { result = await response.json(); } catch { throw new Error(errorMessage(0)); }
    if (!response.ok) {
      const detail = result.error || result;
      throw Object.assign(new Error(errorMessage(response.status, detail.code, detail.message)), { status: response.status });
    }
    return result;
  }
  const label = (rows, id) => rows.find(row => row.id === id)?.label || '';
  const statLabel = id => label(model.STATS, id);
  const summary = () => `${label(model.RACES,data.race)} · ${label(model.JOBS,data.job)}`;
  function focusHeading() { byId('panel-title').focus(); }
  async function picture() {
    const current = ++renderVersion;
    byId('character-canvas').setAttribute('aria-label', `${summary()} 전신 미리보기`);
    byId('portrait-canvas').setAttribute('aria-label', `${summary()} 초상 미리보기`);
    try {
      await Promise.all([renderCharacter(byId('character-canvas'), data, { art, size: 512 }), renderCharacter(byId('portrait-canvas'), data, { art, mode: 'portrait', size: 96 })]);
      if (current === renderVersion) say('art-message', '');
    } catch (error) { if (current === renderVersion) say('art-message', error.message); }
  }
  function choose(field, value) {
    data = field === 'race' || field === 'job' ? { ...data, [field]: value } : { ...data, appearance: { ...data.appearance, [field]: value } };
    if (field === 'race') data.appearance = { ...data.appearance, skin: model.FIXED_SKIN_RACES.includes(value) ? null : (data.appearance.skin || 's1') };
    draft(); draw(false);
    say('selection-status', `${summary()} · 선택한 모습을 반영했어요.`);
  }
  function choices(legend, rows, field, selected, describe, palette = false) {
    const group = make('fieldset'), title = make('legend', legend), options = make('div', null, palette ? 'color-options' : 'choice-grid'); group.append(title, options);
    for (const row of rows) {
      const item = make('label', null, palette ? 'color-choice' : 'character-choice'), input = make('input'); input.type = 'radio'; input.name = field; input.value = row.id; input.checked = row.id === selected;
      input.addEventListener('change', () => choose(field,row.id));
      item.append(input);
      if (palette) { const swatch = make('span', null, 'swatch'); swatch.style.backgroundColor = `rgb(${row.rgb.join(',')})`; swatch.setAttribute('aria-hidden','true'); item.append(swatch); }
      item.append(make('span',row.label)); if (describe) item.append(make('small',describe(row)));
      options.append(item);
    }
    return group;
  }
  function statsTable(target, stats, allocate = false) {
    const list = make('dl',null,'stat-grid');
    for (const stat of model.STATS) {
      const item = make('div', null, 'stat-row'); item.append(make('dt',stat.label),make('dd',String(stats[stat.id])));
      if (allocate) {
        const add = button('+', () => mutate('/allocate', { stat: stat.id, amount: 1 }, `${stat.label}에 1점을 나눴어요.`), 'stat-add');
        add.setAttribute('aria-label',`${stat.label}에 1점 분배`); add.disabled = busy || conflict || character.progress.points < 1; item.append(add);
      }
      list.append(item);
    }
    target.append(list);
  }
  function branches(target, stats, level) {
    const section = make('section', null, 'branches'); section.append(make('h3','다음 모험, 2차 전직'),make('p','게임 기록 연결 뒤 열립니다. 지금은 갈래와 조건을 살펴보세요.'));
    for (const branch of model.branchStatus(data.job,stats,level)) {
      const card = make('article',null,'branch-card'); card.append(make('h4', `${branch.label} · 잠김`));
      const list = make('ul'); list.append(make('li',`레벨 15 이상 · ${level >= 15 ? '충족' : `현재 ${level}`}`));
      for (const [id, need] of Object.entries(branch.requirements)) list.append(make('li',`${statLabel(id)} ${need} 이상 · 현재 ${stats[id]}${stats[id] >= need ? ' · 충족' : ''}`));
      list.append(make('li','전직 시험: 서로 다른 게임 2개에서 각 5판 · 아직 연결되지 않았어요.')); card.append(list); section.append(card);
    }
    target.append(section);
  }
  function draw(moveFocus = true) {
    const active = document.activeElement;
    const focusKey = active?.matches('input[type=radio]') ? [active.name,active.value] : null;
    const focusLabel = active?.getAttribute('aria-label');
    byId('wizard').hidden = state.mode === 'member'; byId('member-view').hidden = state.mode !== 'member';
    byId('step-list').hidden = state.mode === 'member';
    byId('preview-caption').textContent = summary();
    byId('nickname').textContent = user ? `${user.name}님의 모험가` : '아직 이름 없는, 나의 모험가';
    byId('draft-note').hidden = state.mode !== 'create';
    byId('login-guide').hidden = !!user;
    byId('login-link').hidden = !!user;
    byId('conflict-reload').hidden = !conflict;
    const steps = ['종족 고르기','모습 꾸미기','직업 고르기','확인하고 저장'];
    for (const [index,node] of [...byId('step-list').children].entries()) { if (index === state.step) node.setAttribute('aria-current','step'); else node.removeAttribute('aria-current'); }
    const stats = state.mode === 'member' ? character.stats : model.statsOf(data, character?.alloc || {});
    byId('panel-title').textContent = state.mode === 'member' ? '내 캐릭터' : state.mode === 'edit' ? `캐릭터 바꾸기 · ${steps[state.step]}` : steps[state.step];
    const content = byId('step-content'); content.replaceChildren();
    if (state.mode !== 'member') {
      if (state.step === 0) content.append(choices('어떤 종족으로 모험할까요?',model.RACES,'race',data.race,row => Object.entries(row.bonus).map(([id,n]) => `${statLabel(id)} +${n}`).join(' · ')));
      if (state.step === 1) {
        content.append(choices('머리 모양',Object.entries(art.manifest.hair).map(([id,row]) => ({id,...row})),'hair',data.appearance.hair));
        for (const [title,key,field] of [['머리색','hair','hairColor'],['눈 색','eye','eyeColor'],['피부색','skin','skin'],['옷 강조색','accent','outfitColor']]) {
          if (field === 'skin' && model.FIXED_SKIN_RACES.includes(data.race)) content.append(make('p','이 종족의 피부색은 고유한 색으로 정해져 있어요.','muted'));
          else content.append(choices(title,art.manifest.palettes[key],field,data.appearance[field],null,true));
        }
      }
      if (state.step === 2) {
        content.append(choices('어떤 일을 하고 싶나요?',model.JOBS,'job',data.job,row => row.mainStats.map(id => `${statLabel(id)} +3`).join(' · ')));
        content.append(make('h3',character ? '변경 후 스탯 · 분배 포인트 유지' : '처음 스탯 · 총합 68'));
        statsTable(content,stats); content.append(make('p','스탯은 전직과 칭호에 쓰여요. 게임 안 능력에는 영향을 주지 않아요.','muted'));
      }
      if (state.step === 3) {
        content.append(make('h3',summary()),make('p','캐릭터 이름은 계정 닉네임을 그대로 써요. 외형은 언제든, 종족과 직업은 레벨 10 전까지 바꿀 수 있어요.'));
        statsTable(content,stats); branches(content,stats,character?.progress.level || 1);
      }
      byId('previous-step').hidden = state.step === 0 || (state.appearanceOnly && state.step === 1);
      byId('next-step').hidden = state.step === 3; byId('save-character').hidden = state.step !== 3;
      byId('cancel-edit').hidden = state.mode !== 'edit';
    } else {
      const member = byId('member-view'); member.replaceChildren();
      member.append(make('p',`레벨 ${character.progress.level} · ${summary()}`,'member-level'));
      const expLabel = make('label',`경험치 ${character.progress.exp} / ${character.progress.need}`); expLabel.htmlFor = 'experience';
      const exp = make('progress'); exp.id = 'experience'; exp.max = character.progress.need; exp.value = character.progress.exp; member.append(expLabel,exp);
      const checkin = button(character.checkedInToday ? '오늘 출석 완료' : '오늘 출석하기 · 경험치 30', () => mutate('/checkin', undefined,'출석을 확인했어요.'));
      checkin.disabled = busy || conflict || character.checkedInToday; member.append(checkin);
      member.append(make('h3',`남은 포인트 ${character.progress.points}점`)); statsTable(member,stats,true);
      const reset = button('분배 포인트 초기화', () => byId('reset-dialog').showModal(),'quiet-button'); reset.disabled = busy || conflict || !character.reset.available; member.append(reset);
      if (!character.reset.available) {
        const date = new Date(character.reset.nextFreeAt);
        member.append(make('p',`다음 무료 초기화: ${Number.isNaN(date.getTime()) ? '아직 확인하지 못했어요' : date.toLocaleDateString('ko-KR',{ timeZone: 'Asia/Seoul' })}`,'muted'));
      } else member.append(make('p','첫 초기화는 무료예요. 그다음부터는 마지막 초기화 30일 뒤 무료로 할 수 있어요.','muted'));
      member.append(make('h3','모은 칭호'));
      const titles = make('ul',null,'title-list'); for (const title of character.titles) titles.append(make('li',title.label));
      member.append(character.titles.length ? titles : make('p','스탯 30·50·80에 도달하면 칭호를 받아요.','muted'));
      const tools = make('div',null,'member-actions');
      tools.append(button('외형 바꾸기',() => edit(true)));
      const change = button('종족·직업 바꾸기',() => edit(false)); change.disabled = character.progress.level >= model.CHANGE_LOCK_LEVEL || conflict || busy; tools.append(change); member.append(tools);
      if (character.progress.level >= model.CHANGE_LOCK_LEVEL) member.append(make('p','레벨 10부터 종족과 직업이 정해져요.','muted'));
      branches(member,stats,character.progress.level);
    }
    for (const node of document.querySelectorAll('#wizard button, #wizard input')) node.disabled = busy || conflict;
    if (busy || conflict) for (const node of document.querySelectorAll('#member-view button')) node.disabled = true;
    byId('character-app').setAttribute('aria-busy',String(busy));
    picture();
    if (moveFocus) focusHeading();
    else if (focusKey) [...content.querySelectorAll('input')].find(input => input.name === focusKey[0] && input.value === focusKey[1])?.focus();
    else if (focusLabel) [...document.querySelectorAll('#member-view button')].find(node => node.getAttribute('aria-label') === focusLabel)?.focus();
  }
  function edit(appearanceOnly) { data = structuredClone(character.data); state = transition(state,{type:'edit',appearanceOnly}); draw(); }
  function receive(result) { character = result.character; data = structuredClone(character.data); state = transition(state,{type:'saved'}); conflict = false; }
  async function mutate(path, extra, success) {
    if (busy || conflict) return;
    const previousMode = state.mode, focusLabel = document.activeElement?.getAttribute('aria-label');
    busy = true; say('character-error',''); say('character-result',''); draw(false);
    try {
      const body = path === '/checkin' ? {} : { revision: character?.revision || 0, ...extra };
      const result = await request(path,path === '' ? 'PUT' : 'POST',body);
      receive(result);
      if (path === '') { try { storage?.removeItem(DRAFT_KEY); } catch {} }
      say('character-result', path === '/checkin' ? (result.granted ? `출석했어요! 경험치 ${result.amount}을 받았어요.` : '오늘 출석은 이미 반영됐어요.') : success);
    } catch (error) {
      if (error.status === 401) { user = null; if (state.mode === 'create') draft(); }
      if (error.status === 409) conflict = true;
      say('character-error',error.message);
    } finally {
      busy = false; draw(previousMode !== state.mode);
      if (focusLabel && previousMode === state.mode) {
        const target = [...document.querySelectorAll('#member-view button')].find(node => node.getAttribute('aria-label') === focusLabel);
        if (target && !target.disabled) target.focus(); else focusHeading();
      }
    }
  }
  byId('next-step').addEventListener('click',() => { state = transition(state,{type:'next'}); draw(); });
  byId('previous-step').addEventListener('click',() => { state = transition(state,{type:'back'}); draw(); });
  byId('save-character').addEventListener('click',() => {
    draft();
    if (!user) { say('character-error',errorMessage(401)); byId('login-link').focus(); return; }
    try { model.validateCharacterData(data); } catch (error) { say('character-error',error.message); return; }
    mutate('',{data},'캐릭터를 저장했어요. 이제 함께 모험해요.');
  });
  byId('cancel-edit').addEventListener('click',() => { data = structuredClone(character.data); state = transition(state,{type:'cancel'}); draw(); });
  byId('reset-confirm').addEventListener('click',() => { byId('reset-dialog').close(); mutate('/reset',{},'포인트를 모두 돌려받았어요. 다시 나눠 보세요.'); });
  byId('reset-cancel').addEventListener('click',() => byId('reset-dialog').close());
  async function refresh() {
    if (busy) return;
    busy = true; byId('retry-load').hidden = true; say('character-error','');
    try {
      model ||= await import('./model.js'); art ||= await loadCharacterArt();
      const session = await fetch('/api/account/session',{ credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000) });
      if (!session.ok) throw new Error('로그인 상태를 확인하지 못했어요. 다시 불러와 주세요.');
      user = (await session.json()).user;
      character = null;
      if (user) {
        try { character = (await request()).character; } catch (error) { if (error.status === 401) user = null; else throw error; }
      }
      conflict = false;
      if (character) receive({character});
      else { data = readDraft(storage,model.validateCharacterData,model.createDefaultCharacter()); state = transition(state,{type:'empty'}); }
      byId('character-app').hidden = false; byId('loading').hidden = true;
      busy = false; draw(false);
      say('character-result',character ? '저장된 캐릭터를 불러왔어요.' : '원하는 종족부터 골라 보세요.');
    } catch (error) { say('character-error',/[가-힣]/.test(error.message) ? error.message : '캐릭터 화면을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); byId('retry-load').hidden = false; byId('loading').hidden = true; }
    finally { busy = false; }
  }
  byId('retry-load').addEventListener('click',refresh);
  byId('conflict-reload').addEventListener('click',async () => { await refresh(); if (character && !conflict) focusHeading(); });
  window.addEventListener('pageshow',event => { if (event.persisted) refresh(); });
  await refresh();
}
if (typeof document !== 'undefined' && document.getElementById('character-app')) start();
