/* 슬라임 레이스: 공개 경기는 서버 상태만, 잔액·티켓·자격은 본인 응답만 사용한다. */
(() => {
  'use strict';
  const root = document.getElementById('slime-race');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const dialog = $('#sr-ticket');
  const canvas = $('canvas');
  $('.sr-prize > span').textContent='우승 시 총 당첨 · 원금 포함';
  const amountInput = $('[data-amount]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const API_BASE = ['https://gracekingames.com', 'https://www.gracekingames.com'].includes(location.origin) ? 'https://community.gracekingames.com' : location.origin;
  const PHASES = { sales: '티켓 접수 중', countdown: '구매 마감 · 출발 준비', racing: '경주 진행 중', results: '경기 결과' };
  const CONDITIONS = ['매우나쁨', '나쁨', '보통', '좋음', '매우좋음'];
  const STYLES = ['초반 질주형', '꾸준형', '후반 추격형', '순간 가속형', '변칙형'];
  const names = ['말랑', '딸기', '귤빛', '반짝', '클로', '물방울', '밤별', '보송', '구름', '초코'];
  const spots = [[-4,-31,-.12,30,19.6],[-5,-30.5,-.14,30,22.5],[-3,-32,-.06,38,24.3],[15.6,-13.5,0,20,8],[-8,-27.5,-.35,27,13.5],[-5,-31,-.06,32,22],[15.6,-13.5,0,20,8],[-9,-28.5,-.35,21,13.3],[-3,-33,-.08,30,15.6],[-4,-31,-.12,34,17.6]];
  const assets = Object.fromEntries(spots.map(([x,y,rot,w,h],i) => ['spot'+i,{x,y,rot,w,h}]));
  const images = {}, portraits = new Map();
  const state = { public: null, publicStatus: 'loading', me: null, meStatus: 'loading', selectedId: null, amount: 100, pending: null, busy: false, history: null, publicSeq: 0, meSeq: 0, historySeq: 0, anchorServer: 0, anchorMono: 0, publicAt: 0, positions: new Map(), previous: new Map(), positionAt: 0, sound: false, soundGeneration: 0, hidden: document.hidden, personalActive: document.hasFocus() && !document.hidden, privateEpoch: 0, raf: 0, particles: [], publicTimer: 0, motionTimer: 0, clockPhase: null, publicController: null, meController: null, closeTimer: 0, returnFocus: null, renderedKey: '', scenery: null, resultKey: null, announcerRound: null, announcerPhase: null, announcerLeader: null, announcerAt: 0, announcerText: '', spectatorTimer: 0 };
  let bgm = null, effect = null;
  const money = value => {
    try { if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value).toLocaleString('ko-KR'); }
    catch (_) { return '—'; }
    return Number.isSafeInteger(value) ? value.toLocaleString('ko-KR') : '—';
  };
  const oddsText = cents => Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) + '배' : '—';
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const currentRound = () => state.public?.round;
  const roundLabel = round => Number.isSafeInteger(round?.roundNo) && round.roundNo > 0 ? '제 '+round.roundNo+'회' : '';
  function historyLabel(record) {
    const label = roundLabel(record);
    if (label) return label;
    const date = new Date(record.startsAt);
    return Number.isFinite(record.startsAt) && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '경기 기록';
  }
  const entrants = () => currentRound()?.entrants || [];
  const selected = () => entrants().find(slime => slime.slimeId === state.selectedId);
  const now = () => state.anchorServer + performance.now() - state.anchorMono;
  const phase = () => {
    const round = currentRound();
    if (!round) return null;
    if (round.phase === 'sales' && now() >= round.salesCloseAt) return now() < round.raceStartsAt ? 'countdown' : 'racing';
    if (round.phase === 'countdown' && now() >= round.raceStartsAt) return 'racing';
    return round.phase;
  };
  const ownBet = id => state.me && currentRound() && state.me.roundId === currentRound().id ? state.me.bets.find(bet => bet.slimeId === id)?.amount || 0 : 0;
  // 이전 서버의 필드 누락은 무료 기본 안내를 유지하되, 명시된 다른 정책은 구매에 사용하지 않는다.
  function freeEconomyCompatible() {
    if (!state.public || !Object.hasOwn(state.public, 'economy')) return true;
    const economy = state.public.economy;
    return economy?.mode === 'free-only' && ['purchasable', 'cashRedeemable', 'itemExchangeAllowed', 'transferable', 'paidCurrencyConvertible'].every(key => economy[key] === false);
  }
  const salesOpen = () => freeEconomyCompatible() && state.publicStatus === 'ready' && performance.now() - state.publicAt < 12000 && currentRound()?.phase === 'sales' && now() < currentRound().salesCloseAt;
  const eligible = () => state.meStatus === 'ready' && state.me?.user && state.me.eligibility.canBet === true && state.me.roundId === currentRound()?.id;
  function message(text) { $('[data-purchase-message]').textContent = text; }
  function spectator(text) {
    clearTimeout(state.spectatorTimer);
    const target = $('[data-spectator-message]'); target.textContent = text; target.hidden = !text;
    if (text) state.spectatorTimer = setTimeout(() => { target.hidden = true; target.textContent = ''; }, 6500);
  }
  const publicFresh = () => state.publicStatus === 'ready' && performance.now() - state.publicAt < 12000;
  function announce(text) {
    if (state.announcerText === text) return;
    state.announcerText = text; state.announcerAt = performance.now();
    $('[data-announcer-message]').textContent = text;
  }
  // 서버 공개 단계와 현재 좌표만 중계한다. 시계가 먼저 넘어가도 우승을 추정하지 않는다.
  function updateAnnouncer() {
    const round = currentRound();
    if (!round) { announce(state.publicStatus === 'error' ? '연결을 다시 확인해 주세요.' : '경기를 확인하고 있어요.'); return; }
    if (!publicFresh()) {
      state.announcerLeader = null; state.announcerPhase = null;
      announce(state.publicStatus === 'error' ? '연결을 다시 확인해 주세요.' : '새 경기 정보를 확인 중이에요.');
      return;
    }
    if (state.announcerRound !== round.id) {
      state.announcerRound = round.id; state.announcerPhase = null; state.announcerLeader = null;
    }
    if (now() >= round.endsAt) { announce('다음 경기를 확인하고 있어요.'); return; }
    if (round.phase === 'racing' && now() >= round.resultsAt) { state.announcerLeader = null; announce('서버 결과를 확인하고 있어요.'); return; }
    const stage = phase();
    if (round.phase + ':' + stage !== state.announcerPhase) {
      state.announcerPhase = round.phase + ':' + stage; state.announcerLeader = null;
      if (stage === 'sales') announce('응원할 친구를 골라 주세요!');
      else if (stage === 'countdown') announce('구매 마감! 곧 출발해요.');
      else if (stage === 'racing') {
        const atStart = now() >= round.raceStartsAt && now()-round.raceStartsAt < 3500;
        announce(round.phase === 'racing' ? atStart ? '출발! 함께 응원해 주세요!' : '경주가 진행 중이에요!' : '경주 출발을 확인하고 있어요.');
      }
      else if (stage === 'results') {
        if (now() < round.resultsAt) { announce('서버 결과를 확인하고 있어요.'); return; }
        const winner = entrants().find(slime => slime.slimeId === round.winnerId);
        announce(winner ? winner.name + ', 우승! 박수 주세요!' : '서버 결과를 확인하고 있어요.');
      }
      return;
    }
    if (round.phase !== 'racing' || stage !== 'racing' || now() < round.raceStartsAt) return;
    const positions = [...round.animation.positions].sort((a,b) => b.progress-a.progress);
    // 동률과 출발선의 미세한 차이는 단독 선두로 부르지 않는다.
    const leader = positions[0].progress > .01 && positions[0].progress-positions[1].progress > .002 ? positions[0].slimeId : null;
    if (leader !== state.announcerLeader && performance.now()-state.announcerAt >= 4500) {
      const slime = entrants().find(slime => slime.slimeId === leader);
      if (slime) announce(slime.name + ' 선두! 힘내요!');
      else if (state.announcerLeader) announce('나란히 달리고 있어요!');
      state.announcerLeader = leader;
    }
  }
  function validSlime(slime) {
    return slime && typeof slime.slimeId === 'string' && names.includes(slime.name) && ['S','A','B','C'].includes(slime.grade) && STYLES.includes(slime.style);
  }
  function validatePublic(data) {
    const round = data?.round;
    if (!Number.isFinite(data?.serverNow) || !round || typeof round.id !== 'string' || !Object.hasOwn(PHASES, round.phase)) throw new Error('경기 상태를 확인하지 못했어요.');
    if (!['startsAt','salesCloseAt','raceStartsAt','resultsAt','endsAt'].every(key => Number.isFinite(round[key])) || !(round.startsAt < round.salesCloseAt && round.salesCloseAt < round.raceStartsAt && round.raceStartsAt < round.resultsAt && round.resultsAt < round.endsAt)) throw new Error('경기 시간을 확인하지 못했어요.');
    if (!Array.isArray(round.entrants) || round.entrants.length !== 5 || new Set(round.entrants.map(s => s.slimeId)).size !== 5 || !round.entrants.every(s => validSlime(s) && CONDITIONS.includes(s.condition) && Number.isSafeInteger(s.oddsCents) && s.oddsCents > 0 && Array.isArray(s.recentRanks) && s.recentRanks.every(rank => Number.isInteger(rank) && rank >= 1 && rank <= 5))) throw new Error('출전 선수 정보를 확인하지 못했어요.');
    if (!Array.isArray(data.roster) || data.roster.length !== 10 || !data.roster.every(validSlime)) throw new Error('선수 명단을 확인하지 못했어요.');
    if (!round.animation || !Array.isArray(round.animation.positions) || round.animation.positions.length !== 5 || new Set(round.animation.positions.map(p=>p.slimeId)).size !== 5 || !round.animation.positions.every(p => round.entrants.some(s=>s.slimeId===p.slimeId) && Number.isFinite(p.progress) && p.progress >= 0 && p.progress <= 1)) throw new Error('경주 위치를 확인하지 못했어요.');
    if (round.phase === 'results' && (typeof round.winnerId !== 'string' || !Array.isArray(round.finishOrder) || round.finishOrder.length !== 5 || new Set(round.finishOrder).size !== 5 || round.finishOrder[0] !== round.winnerId || !round.finishOrder.every(id => round.entrants.some(s => s.slimeId === id)))) throw new Error('경기 결과를 확인하지 못했어요.');
    return data;
  }
  function validateMe(data) {
    if (!data || typeof data.roundId !== 'string' || !Number.isSafeInteger(data.revision) || data.revision < 0 || !data.eligibility || typeof data.eligibility.canBet !== 'boolean' || !data.wallet || !Number.isSafeInteger(data.wallet.balance) || data.wallet.balance < 0 || !Array.isArray(data.bets) || !data.bets.every(b => typeof b.slimeId === 'string' && Number.isSafeInteger(b.amount) && b.amount >= 0)) throw new Error('내 티켓 정보를 확인하지 못했어요.');
    if (data.user !== null && (!data.user || typeof data.user.id !== 'string' || typeof data.user.name !== 'string')) throw new Error('계정 정보를 확인하지 못했어요.');
    return data;
  }
  async function request(kind, payload, controller) {
    if (!['state', 'me', 'tickets', 'history'].includes(kind)) throw new Error('요청 경로를 확인하지 못했어요.');
    const active = controller || new AbortController();
    const timer = setTimeout(() => active.abort(), payload ? 15000 : 12000);
    let response;
    try {
      response = await fetch(`${API_BASE}/api/slime-race/${kind}`, { method: payload ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', signal: active.signal, ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
      let body;
      try { body = await response.json(); } catch (_) { const error = new Error('서버 응답을 확인하지 못했어요.'); error.ambiguous = Boolean(payload); throw error; }
      if (!response.ok) { const error = new Error(typeof body?.error?.message === 'string' && /[가-힣]/.test(body.error.message) ? body.error.message : '요청을 처리하지 못했어요. 다시 확인해 주세요.'); error.code = body?.error?.code; error.status = response.status; error.ambiguous = Boolean(payload && response.status >= 500); throw error; }
      return body;
    } catch (error) {
      if (!response) { error.ambiguous = Boolean(payload); error.message = '연결이 끊겼거나 응답이 늦어지고 있어요.'; }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function refreshPublic() {
    if (state.hidden) return;
    clearTimeout(state.publicTimer);
    const sequence = ++state.publicSeq;
    state.publicController?.abort();
    const controller = new AbortController(); state.publicController = controller;
    const started = performance.now();
    try {
      const data = validatePublic(await request('state', undefined, controller));
      if (sequence !== state.publicSeq || state.hidden) return;
      // 네트워크 캐시·지연으로 과거 스냅샷이 오면 시계와 중계를 되감지 않는다.
      if (state.public && data.serverNow < state.public.serverNow) throw new Error('최신 경기 정보를 기다리고 있어요.');
      const changed = currentRound()?.id !== data.round.id;
      const oldPhase = currentRound()?.phase;
      state.anchorServer = data.serverNow; state.anchorMono = performance.now() - (performance.now() - started) / 2;
      state.previous = new Map(data.round.animation.positions.map(p => [p.slimeId, displayedProgress(p.slimeId)]));
      state.positions = new Map(data.round.animation.positions.map(p => [p.slimeId, p.progress])); state.positionAt = performance.now();
      state.public = data; state.publicStatus = 'ready'; state.publicAt = performance.now();
      $('[data-public-error]').hidden = true;
      if (!data.round.entrants.some(s => s.slimeId === state.selectedId)) state.selectedId = data.round.entrants[0].slimeId;
      if (changed) { state.renderedKey = ''; clearPrivate('loading'); if (dialog.open) void refreshMe(); }
      if (data.round.phase === 'results' && (changed || oldPhase !== 'results') && state.sound) playEffect('sfx-result');
      renderRoster(); render(); scheduleStartMotion(); startAnimation();
      if (dialog.open && (changed || oldPhase !== data.round.phase && data.round.phase === 'results')) void refreshMe();
    } catch (error) {
      if (sequence !== state.publicSeq || state.hidden) return;
      state.publicStatus = 'error'; $('[data-public-error]').hidden = false; $('[data-public-message]').textContent = '경기 연결을 확인해 주세요.'; render();
    } finally {
      if (sequence === state.publicSeq && !state.hidden) state.publicTimer = setTimeout(refreshPublic, nextPublicDelay());
    }
  }
  function nextPublicDelay() {
    if (state.publicStatus === 'error') return 5000;
    const round = currentRound();
    if (!round) return 5000;
    const stage = phase();
    const base = stage === 'countdown' || stage === 'racing' ? 1000 : 5000;
    // 응답에 기록된 단계의 끝을 기준으로 삼아, 오래된 단계를 100ms마다 재조회하지 않는다.
    const boundary = { sales: round.salesCloseAt, countdown: round.raceStartsAt, racing: round.resultsAt, results: round.endsAt }[round.phase];
    const remaining = boundary - now();
    if (remaining <= 0) return 1000;
    return remaining <= base ? remaining + 120 : base;
  }
  function scheduleStartMotion() {
    clearTimeout(state.motionTimer);
    const round = currentRound();
    if (!round || state.hidden || reduced.matches) return;
    const delay = round.raceStartsAt - now() - 650;
    if (delay > 0) state.motionTimer = setTimeout(() => { if (!state.hidden && !reduced.matches) startAnimation(); }, delay);
    else if (now() < round.raceStartsAt + 650) startAnimation();
  }
  function applyMe(data) {
    if (data.roundId !== currentRound()?.id) return false;
    if (state.me && state.me.user?.id === data.user?.id && state.me.roundId === data.roundId && data.revision < state.me.revision) return false;
    if (state.pending && data.user?.id && state.pending.userId !== data.user.id) { state.pending = null; state.busy = false; message('계정이 바뀌었어요. 새 계정의 정보를 확인해 주세요.'); }
    state.me = data; state.meStatus = 'ready'; renderRoster(); render(); return true;
  }
  async function refreshMe() {
    if (state.hidden || !state.personalActive) return;
    const sequence = ++state.meSeq; state.meController?.abort(); const controller = new AbortController(); state.meController = controller;
    try { const data = validateMe(await request('me', undefined, controller)); if (sequence !== state.meSeq || state.hidden || !state.personalActive) return; if (!applyMe(data)) { state.meStatus = 'loading'; render(); } }
    catch (error) { if (sequence !== state.meSeq || state.hidden || !state.personalActive) return; state.me = null; state.meStatus = 'error'; render(); }
  }
  function clearPrivate(status = 'loading') {
    state.privateEpoch += 1; state.meSeq += 1; state.historySeq += 1; state.meController?.abort(); state.me = null; state.meStatus = status; state.history = null; $('[data-history]').hidden = true; $('[data-history-summary]').textContent = ''; $('.sr-history-list').replaceChildren(); $('[data-result-personal]').textContent = ''; message(''); state.amount=100; amountInput.value='100'; renderRoster(); render();
  }
  function renderRoster() {
    const rosterKey = entrants().map(s => [s.slimeId,s.name,s.grade,s.style,s.condition,s.oddsCents,s.recentRanks.join(','),ownBet(s.slimeId)].join(':')).join('|') + ':' + portraits.size;
    if (rosterKey === state.renderedKey) return;
    state.renderedKey = rosterKey;
    const target = $('.sr-runners'); target.replaceChildren();
    if (!entrants().length) { target.append(node('p','sr-empty',state.publicStatus === 'error' ? '출전 정보를 불러오지 못했어요. 다시 불러오기를 눌러 주세요.' : '출전 선수를 불러오고 있어요.')); return; }
    for (const slime of entrants()) {
      const button = node('button','sr-runner'); button.type = 'button'; button.dataset.select = slime.slimeId; button.setAttribute('aria-pressed',String(slime.slimeId === state.selectedId));
      const image = node('img'); image.src = portraits.get(slime.name) || '/assets/slime-race/art/slime'+names.indexOf(slime.name)+'.png'; image.alt = '';
      const title = node('span','sr-runner-name',slime.name);
      const detail = node('span','sr-runner-detail');
      for (const [label,value] of [['기초체력',slime.grade],['주행 성향',slime.style],['컨디션',slime.condition]]) { const item = node('span','sr-info-item'); item.append(node('span','sr-info-label',label),node('span','sr-info-value',value)); detail.append(item); }
      const recent = node('span','sr-runner-recent'); recent.append(node('small',null,'최근 5경기'),node('span',null,slime.recentRanks.length ? slime.recentRanks.slice(0,5).join(' · ')+'위' : '첫 출전'));
      const odds = node('span','sr-runner-odds'); odds.append(node('small',null,'배당'),node('span',null,oddsText(slime.oddsCents)));
      if (ownBet(slime.slimeId)) title.append(node('span','sr-runner-ticket','티켓 보유'));
      button.append(image,title,detail,recent,odds); target.append(button);
    }
    const all = $('.sr-fullroster'); all.replaceChildren();
    for (const slime of state.public.roster) { const item = node('div'); const image = node('img'); image.src = portraits.get(slime.name) || '/assets/slime-race/art/slime'+names.indexOf(slime.name)+'.png'; image.alt = ''; const text = node('span',null,slime.name+' · '+slime.grade); text.append(node('small',null,slime.style)); item.append(image,text); all.append(item); }
  }
  function renderGate() {
    const gate = $('[data-gate]'); gate.replaceChildren(); gate.hidden=Boolean(freeEconomyCompatible()&&state.meStatus==='ready'&&state.me?.user&&state.me.eligibility.canBet);
    if (!freeEconomyCompatible()) gate.textContent = '그레인 이용 정책을 확인하지 못했어요. 티켓 구매를 잠시 중지했어요.';
    else if (state.meStatus === 'loading') gate.textContent = '계정과 구매 자격을 확인하고 있어요.';
    else if (state.meStatus === 'error') gate.textContent = '내 정보를 확인하지 못했어요. 새로고침 후 다시 확인해 주세요.';
    else if (!state.me?.user) { gate.append(document.createTextNode('로그인과 성인 확인을 마친 회원만 티켓을 구매할 수 있어요.')); const link = node('a',null,'로그인'); link.href = '/account/'; gate.append(link); }
    else if (!state.me.eligibility.canBet) gate.textContent = state.me.eligibility.message || '성인 확인을 마친 회원만 티켓을 구매할 수 있어요.';
    else gate.textContent = salesOpen() ? '최소 100 그레인 · 보유 잔액 안에서 여러 선수에게 구매할 수 있어요.' : '구매가 마감됐어요. 선수 정보와 내 티켓은 계속 확인할 수 있어요.';
  }
  function render() {
    const round = currentRound(), stage = phase(), slime = selected(), bet = ownBet(state.selectedId);
    const label = round ? roundLabel(round) || '이번 경기' : '경기 확인 중';
    $('[data-round-label]').textContent = label; $('[data-dialog-round]').textContent = label;
    $('[data-phase]').textContent = PHASES[stage] || '경기 확인 중';
    $('[data-economy-note]').textContent = freeEconomyCompatible() ? '무료 그레인 · 현금 구매·환전·경품 교환 불가' : '정책 확인 중 · 티켓 구매 일시 중지';
    $('[data-selected]').textContent = slime ? slime.name+' 티켓' : '선수를 선택해 주세요'; $('[data-selected-style]').textContent = slime ? slime.grade+' · '+slime.style : '';
    $('[data-odds]').textContent = slime ? oddsText(slime.oddsCents) : '—';
    const validAmount = Number.isSafeInteger(state.amount) && state.amount >= 100;
    const payout = slime && validAmount ? BigInt(state.amount) * BigInt(slime.oddsCents) / 100n : null;
    $('[data-estimate]').textContent = payout !== null ? payout.toLocaleString('ko-KR')+' 그레인' : '—'; $('[data-profit]').textContent = payout !== null ? (payout-BigInt(state.amount)).toLocaleString('ko-KR') : '—';
    $('[data-dialog-balance]').textContent = state.meStatus === 'ready' && state.me?.user ? '잔액 '+money(state.me.wallet.balance)+' 그레인' : state.meStatus === 'error' ? '계정 확인 필요' : state.meStatus === 'ready' ? '로그인 필요' : '계정 확인 중';
    $('[data-my-ticket]').textContent = state.meStatus === 'ready' && state.me?.user ? bet ? slime?.name+' '+money(bet)+' 그레인 보유' : '이 선수의 티켓 없음' : '내 티켓을 확인해 주세요';
    $('[data-amount-label]').textContent = bet ? '총 티켓 금액 · 최소 100 그레인' : '티켓 금액 · 최소 100 그레인';
    const locked = !salesOpen() || !eligible() || state.busy || Boolean(state.pending);
    amountInput.disabled = locked; root.querySelectorAll('[data-add]').forEach(button => { button.disabled = locked; });
    $('[data-action="buy"]').disabled = locked || !slime || !validAmount; $('[data-action="buy"]').textContent = state.busy ? '확인 중' : bet ? '금액 변경' : '티켓 구매'; $('[data-action="cancel"]').disabled = locked || !bet;
    $('[data-action="retry-purchase"]').hidden = !freeEconomyCompatible() || !state.pending || state.busy || !state.personalActive || state.meStatus !== 'ready' || !state.me?.user || state.pending.userId !== state.me.user.id; $('[data-action="retry-purchase"]').disabled = !freeEconomyCompatible() || state.meStatus !== 'ready' || !state.me?.user || state.pending?.userId !== state.me.user.id;
    root.querySelectorAll('[data-select]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.select === state.selectedId)));
    renderGate(); renderResult(); updateClock(); updateAnnouncer(); draw();
  }
  function updateClock() {
    const round = currentRound(), stage = phase();
    if (!round || !publicFresh()) { $('[data-timer]').textContent = '—'; $('[data-status]').textContent = state.publicStatus === 'error' ? '연결 확인' : '정보 확인 중'; return; }
    const end = stage === 'sales' ? round.salesCloseAt : stage === 'countdown' ? round.raceStartsAt : stage === 'racing' ? round.resultsAt : round.endsAt;
    const seconds = Math.max(0,Math.ceil((end-now())/1000)); $('[data-phase]').textContent=stage==='racing'&&seconds===0?'서버 결과 확인 중':PHASES[stage]; if(stage!==state.clockPhase){state.clockPhase=stage;if(stage==='countdown'||stage==='racing')startAnimation();} $('[data-timer]').textContent = String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'); $('[data-status]').textContent = stage === 'sales' ? '마감까지' : stage === 'countdown' ? '출발까지' : stage === 'racing' ? seconds ? '경주 진행 중' : '서버 결과 확인 중' : '다음 경기까지';
    if (!salesOpen()) { amountInput.disabled = true; $('[data-action="buy"]').disabled = true; $('[data-action="cancel"]').disabled = true; root.querySelectorAll('[data-add]').forEach(button => { button.disabled = true; }); }
  }
  function renderResult() {
    const round = currentRound(), box = $('.sr-result');
    const show = publicFresh() && round?.phase === 'results' && now() >= round.resultsAt && now() < round.endsAt && round.finishOrder?.length === 5;
    box.hidden = !show;
    if (!show) { if (state.resultKey) canvas.setAttribute('aria-label','달빛 숲의 다섯 직선 레인. 최신 경기 정보를 확인 중이에요.'); state.resultKey = null; return; }
    const resultKey = round.id + ':' + round.finishOrder.join(',') + ':' + state.meStatus + ':' + (state.me?.user?.id || '');
    if (state.resultKey === resultKey) return;
    state.resultKey = resultKey;
    const winner = entrants().find(s => s.slimeId === round.winnerId);
    $('[data-result-round]').textContent = (roundLabel(round) ? roundLabel(round)+' 경기 결과' : '이번 경기 결과'); $('[data-result-winner]').textContent = winner ? winner.name+', 우승!' : '경기 결과';
    $('[data-result-personal]').textContent = state.meStatus === 'ready' && state.me?.user ? '내 당첨과 손익은 기록에서 확인해 주세요.' : '숲속의 작은 챔피언에게 따뜻한 박수를 보내 주세요.';
    const ranking = $('[data-result-ranks]'); ranking.replaceChildren(); round.finishOrder.forEach((id,index) => ranking.append(node('li',null,(index+1)+'위 '+(entrants().find(s => s.slimeId === id)?.name || ''))));
    canvas.setAttribute('aria-label',(roundLabel(round) || '이번 경기')+' 슬라임 레이스 결과. '+round.finishOrder.map((id,i) => (i+1)+'위 '+entrants().find(s => s.slimeId === id)?.name).join(', '));
  }
  function requestId() { if (crypto.randomUUID) return crypto.randomUUID(); const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = bytes[6]&15|64; bytes[8] = bytes[8]&63|128; const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join(''); return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-'); }
  async function buy(cancel = false, retry = false) {
    if (state.busy) return;
    if (!freeEconomyCompatible()) { message('그레인 이용 정책을 다시 확인해 주세요. 티켓 구매를 잠시 중지했어요.'); return; }
    if (!retry) {
      if (!salesOpen() || !eligible() || state.pending || !selected()) { message('현재 구매 자격과 경기 마감을 다시 확인해 주세요.'); return; }
      const amount = cancel ? 0 : Number(amountInput.value), old = ownBet(state.selectedId);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount !== 0 && amount < 100 || !cancel && amount === 0) { message('100 그레인 이상의 정수 금액을 입력해 주세요.'); return; }
      if (BigInt(amount) > BigInt(state.me.wallet.balance)+BigInt(old)) { message('보유 잔액 안에서 티켓을 구매해 주세요.'); return; }
      state.pending = { userId: state.me.user.id, payload: { roundId: currentRound().id, slimeId: state.selectedId, amount, expectedRevision: state.me.revision, requestId: requestId() } };
    }
    const operation = state.pending; const operationEpoch = state.privateEpoch;
    if (!operation || !state.me?.user || operation.userId !== state.me.user.id) return;
    state.busy = true; state.meSeq += 1; state.meController?.abort(); message('서버에서 티켓을 확인하고 있어요.'); render();
    try {
      const raw = await request('tickets', operation.payload);
      try { validateMe(raw); } catch (error) { error.ambiguous=true; throw error; }
      if (state.pending !== operation) return;
      state.pending = null; state.busy = false;
      if (operationEpoch !== state.privateEpoch || state.hidden || !state.personalActive) { message(''); return; }
      state.meStatus='loading';
      message(operation.payload.amount ? '티켓 금액 '+money(operation.payload.amount)+' 그레인을 반영했어요.' : '선택 선수의 티켓을 취소했어요.');
      window.dispatchEvent(new CustomEvent('gracekin-account-change',{detail:{phase:'refresh',source:'slime-race'}}));
      if (!state.hidden && state.personalActive) await refreshMe();
    } catch (error) {
      if (state.pending !== operation) return;
      state.busy = false;
      if (operationEpoch !== state.privateEpoch || state.hidden || !state.personalActive) return;
      if (error.ambiguous) message('처리 결과를 아직 확인하지 못했어요. 같은 요청 재확인을 누르면 중복 구매 없이 결과를 확인해요.');
      else { state.pending = null; message(error.message); if (!state.hidden) void refreshMe(); }
    } finally { if (state.pending === operation) state.busy = false; renderRoster(); render(); }
  }
  async function loadHistory() {
    if(state.hidden || !state.personalActive) return;
    $('[data-history]').hidden = false; $('[data-history]').scrollIntoView({block:'nearest'}); const sequence = ++state.historySeq;
    const summary = $('[data-history-summary]'); summary.textContent = '내 기록을 불러오고 있어요.'; $('.sr-history-list').replaceChildren(); $('[data-action="history-retry"]').hidden = true;
    try {
      const data = await request('history'); if (sequence !== state.historySeq || state.hidden || !state.personalActive) return;
      if (!data?.summary || !Array.isArray(data.rounds) || !Number.isFinite(data.summary.hitRate)) throw new Error('기록을 확인하지 못했어요.');
      state.history = data;
      summary.textContent = '누적 티켓 '+money(data.summary.totalBet)+' 그레인 · 총 당첨 '+money(data.summary.payout)+' 그레인 · 손익 '+money(data.summary.profit)+' 그레인 · 적중률 '+(data.summary.hitRate*100).toFixed(1)+'%';
      const list = $('.sr-history-list'); if (!data.rounds.length) list.append(node('li',null,'아직 경기 기록이 없어요.'));
      for (const record of data.rounds) { const item = node('li'); const winner = state.public?.roster.find(s => s.slimeId === record.winnerId)?.name || '결과 확인 중'; item.append(node('strong',null,historyLabel(record)+' · '+winner),node('br'),document.createTextNode('티켓 '+money(record.totalBet)+' · 총 당첨 '+money(record.payout)+' · 손익 '+money(record.profit)+' 그레인')); list.append(item); }
    } catch (error) { if (sequence !== state.historySeq || state.hidden || !state.personalActive) return; summary.textContent = error.status === 401 ? '로그인 후 내 기록을 확인해 주세요.' : error.message; $('[data-action="history-retry"]').hidden = false; }
  }
  function openDialog(history = false) {
    state.personalActive=!document.hidden&&document.hasFocus();
    clearTimeout(state.closeTimer); dialog.classList.remove('sr-closing');
    if (!dialog.open) { state.returnFocus = document.activeElement; dialog.showModal(); dialog.querySelector('.sr-close').focus({preventScroll:true}); }
    if (state.meStatus !== 'ready') void refreshMe();
    if (history) void loadHistory();
  }
  function closeDialog() { if (!dialog.open) return; dialog.classList.add('sr-closing'); clearTimeout(state.closeTimer); state.closeTimer = setTimeout(() => { dialog.close(); dialog.classList.remove('sr-closing'); state.returnFocus?.focus(); },reduced.matches ? 0 : 180); }
  dialog.addEventListener('cancel',event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
  dialog.addEventListener('keydown',event => { if (event.key !== 'Tab') return; const controls = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href],summary')].filter(el => el.getClientRects().length); const first = controls[0], last = controls[controls.length-1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } });
  function playEffect(name) {
    if (!state.sound || state.hidden || !document.hasFocus()) return;
    if (effect) effect.pause();
    const generation = state.soundGeneration;
    const localAudio = new Audio('/assets/slime-race/'+name+'.mp3');
    effect = localAudio; localAudio.volume = .35;
    localAudio.play().catch(() => {
      if (effect !== localAudio || generation !== state.soundGeneration || !state.sound || state.hidden || !document.hasFocus()) return;
      spectator('효과음을 재생하지 못했어요. 소리 설정을 다시 확인해 주세요.');
    });
  }
  function pauseSound() { state.soundGeneration+=1; bgm?.pause(); effect?.pause(); }
  async function toggleSound() {
    const generation=++state.soundGeneration; state.sound = !state.sound; const button = $('[data-action="sound"]'); button.setAttribute('aria-pressed',String(state.sound)); button.textContent = state.sound ? '소리 켜짐' : '소리 꺼짐';
    if (!state.sound) { bgm?.pause(); effect?.pause(); return; }
    if (!bgm) { bgm = new Audio('/assets/slime-race/bgm-spring.mp3'); bgm.loop = true; bgm.preload = 'none'; bgm.volume = .18; }
    try { await bgm.play(); if(generation!==state.soundGeneration||!state.sound||state.hidden||!document.hasFocus())return; playEffect('sfx-pollen'); } catch (_) { if(generation!==state.soundGeneration||!state.sound||state.hidden||!document.hasFocus())return; state.sound = false; button.textContent = '소리 꺼짐'; button.setAttribute('aria-pressed','false'); spectator('음악을 재생하지 못했어요. 다시 눌러 주세요.'); }
  }
  root.addEventListener('click',event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.select) { state.selectedId = button.dataset.select; const bet = ownBet(state.selectedId); if (bet) { state.amount = bet; amountInput.value = String(bet); } message(''); render(); }
    if (button.dataset.add) { const amount = Number(amountInput.value) + Number(button.dataset.add); if (Number.isSafeInteger(amount)) { state.amount = amount; amountInput.value = String(amount); render(); } }
    const action = button.dataset.action;
    if (action === 'ticket') openDialog();
    else if (action === 'close') closeDialog();
    else if (action === 'retry') void refreshPublic();
    else if (action === 'refresh-me') void refreshMe();
    else if (action === 'buy') void buy();
    else if (action === 'cancel') void buy(true);
    else if (action === 'retry-purchase') void buy(false,true);
    else if (action === 'history' || action === 'history-retry') openDialog(true);
    else if (action === 'rules' || action === 'roster') { const panel = $(action === 'rules' ? '[data-rules]' : '[data-roster]'); panel.open = !panel.open; if (panel.open) panel.scrollIntoView({block:'nearest'}); }
    else if (action === 'sound') void toggleSound();
    else if (action === 'cheer') { spectator((selected()?.name || '슬라임 친구들')+'에게 응원을 보냈어요!'); if (!reduced.matches) { const t=performance.now(); state.particles.push(...Array.from({length:5},(_,i) => ({start:t+i*55,x:canvas.clientWidth*.5+i*12,y:canvas.clientHeight*.48+i*8,shape:i%2?'✧':'♡',color:i%2?'#fff5c5':'#cd6a85'}))); startAnimation(); } }
  });
  amountInput.addEventListener('input',() => { state.amount = Number(amountInput.value); message(''); render(); });
  function onHidden() { state.hidden = document.hidden; state.personalActive = !state.hidden && document.hasFocus(); if (state.hidden) { clearTimeout(state.publicTimer); clearTimeout(state.motionTimer); state.publicSeq += 1; state.publicController?.abort(); cancelAnimationFrame(state.raf); pauseSound(); clearPrivate('loading'); } else { void refreshPublic(); void refreshMe(); if (state.sound && bgm) bgm.play().catch(() => {}); } }
  document.addEventListener('visibilitychange',onHidden);
  window.addEventListener('blur',() => { state.personalActive=false; pauseSound(); clearPrivate('loading'); });
  window.addEventListener('focus',() => { if (!document.hidden) { state.personalActive=true; void refreshPublic(); void refreshMe(); if (state.sound && bgm) bgm.play().catch(() => {}); } });
  window.addEventListener('gracekin-account-change',event => { if (event.detail?.source === 'slime-race') return; if (event.detail?.phase === 'clear') { state.personalActive=false; state.pending=null; state.busy=false; clearPrivate('loading'); } else { state.personalActive=!document.hidden&&document.hasFocus(); void refreshMe(); } });
  window.addEventListener('pagehide',() => { state.hidden=true; state.personalActive=false; clearTimeout(state.publicTimer); clearTimeout(state.motionTimer); state.publicController?.abort(); cancelAnimationFrame(state.raf); pauseSound(); clearPrivate('loading'); });
  window.addEventListener('pageshow',event => { if (event.persisted) { state.hidden=false; state.personalActive=document.hasFocus(); void refreshPublic(); void refreshMe(); } });
  window.addEventListener('online',() => { if (!document.hidden) { void refreshPublic(); void refreshMe(); } });
  setInterval(() => { updateClock(); updateAnnouncer(); renderResult(); if (dialog.open && state.meStatus === 'ready' && !salesOpen()) renderGate(); },250);
  setInterval(() => { if (!state.hidden && dialog.open && !state.busy) void refreshMe(); },30000);
  new ResizeObserver(() => { state.scenery=null; draw(); }).observe(canvas);
  reduced.addEventListener('change',() => { state.particles=[]; scheduleStartMotion(); draw(); startAnimation(); });
  void refreshPublic();
  loadAssets().then(() => { state.renderedKey=''; renderRoster(); draw(); });

function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()}
function sprite(ctx,id,x,y,scale=1,time=0,running=false,prep=false){
 const body=images['slime'+id],acc=images['acc'+id];if(!body)return;
 const squash=reduced.matches?1:prep?1.14:(running?1+Math.sin(time*17+id)*.055:1);
 const lift=running&&!reduced.matches?-Math.abs(Math.sin(time*8.5+id))*(scale*3):0;
 ctx.save();ctx.translate(x,y+lift);ctx.scale(scale,scale);ctx.fillStyle='#3f382c25';ctx.beginPath();ctx.ellipse(0,-1,23*squash,5,0,0,Math.PI*2);ctx.fill();
 // 몸통 하단 원점의 변형을 공유해 장신구도 정수리와 함께 눌리고 도약한다.
 ctx.save();ctx.scale(squash,1/squash);ctx.drawImage(body,-32,-56,64,56);
 const a=assets['spot'+id];if(acc&&a){ctx.save();ctx.translate(a.x,a.y);ctx.rotate(a.rot||0);ctx.drawImage(acc,-a.w/2,-a.h/2,a.w,a.h);ctx.restore()}
 ctx.restore();ctx.restore();
}
function makePortrait(id){const c=document.createElement('canvas');c.width=144;c.height=112;const ctx=c.getContext('2d');sprite(ctx,id,72,105,1.7);return c.toDataURL('image/png')}

  function geometry(w,h) { const narrow=w<500; const top=w<=900?146:154; const laneH=narrow?46:w<=900?58:62; const laneStart=narrow?33:53; const finish=w-(narrow?44:78); const raceStart=laneStart+(narrow?26:43); return {narrow,top,laneH,laneStart,finish,raceStart,travel:finish-raceStart,scale:narrow?.84:1.28}; }
  function createScenery(w,h,dpr) { const scenery=document.createElement('canvas');scenery.width=Math.round(w*dpr);scenery.height=Math.round(h*dpr);const ctx=scenery.getContext('2d');ctx.scale(dpr,dpr);const {narrow,top,laneH,laneStart,finish,raceStart}=geometry(w,h);
 let grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#d6e4b1');grad.addColorStop(.25,'#b4d092');grad.addColorStop(1,'#8ab766');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
 // 먼 숲의 실루엣과 실제 원본 나무 그림을 겹쳐 깊이를 만든다.
 for(let i=0;i<16;i++){const x=i*w/14-25;ctx.fillStyle=i%2?'#82a76d45':'#678f6450';ctx.beginPath();ctx.ellipse(x,1+(i%3)*12,55,48,0,0,Math.PI*2);ctx.fill()}
 const tree=images.tree; if(tree){const tw=narrow?100:145;const th=tw*tree.height/tree.width;for(const pos of[-.03,.15,.76,.92])ctx.drawImage(tree,w*pos-tw/2,-th*.37,tw,th)}
 // 낮은 목책과 잔디, 작은 꽃.
 ctx.fillStyle='#c3a470';ctx.fillRect(0,top-12,w,5);ctx.fillStyle='#dfc28c';ctx.fillRect(0,top-14,w,3);for(let i=0;i<w;i+=35){ctx.fillStyle='#a78554';rounded(ctx,i,top-27,7,29,2);ctx.fillStyle='#dfc18a';ctx.fillRect(i+1,top-25,2,25)}
 for(let i=0;i<5;i++){const y=top+i*laneH;ctx.fillStyle='#608b4c';rounded(ctx,laneStart-4,y+3,w-laneStart-15,laneH-3,11);let dirt=ctx.createLinearGradient(0,y,0,y+laneH);dirt.addColorStop(0,'#d9ba86');dirt.addColorStop(.48,'#ecd3a5');dirt.addColorStop(1,'#d4ae75');ctx.fillStyle=dirt;rounded(ctx,laneStart,y,w-laneStart-19,laneH-7,9);ctx.strokeStyle='#f4dfb4';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(laneStart+12,y+3);ctx.lineTo(w-34,y+3);ctx.stroke();
 // 작고 고정된 흙 알갱이.
 for(let k=0;k<26;k++){const px=laneStart+12+(k*67+i*31)%(Math.max(10,w-laneStart-54)),py=y+8+(k*13+i*7)%(laneH-22);ctx.fillStyle=k%2?'#c49b6c55':'#fff4d54d';ctx.fillRect(px,py,k%3?2:3,1)}
 ctx.fillStyle='#8c6b45';rounded(ctx,9,y+laneH/2-10,22,23,4);ctx.fillStyle='#f5e5b8';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText(String(i+1),20,y+laneH/2+6);
 ctx.fillStyle='#f6ecd6b0';ctx.fillRect(raceStart+10,y+4,2,laneH-15);
 for(let q=0;q<6;q++){ctx.fillStyle=q%2?'#f5edcf':'#776d51';ctx.fillRect(finish,y+q*(laneH-8)/6,7,(laneH-8)/6)}
 }
 // 화면 폭에 맞춰 잔디꽃 밀도를 조정한다.
 const bottom=top+5*laneH;for(let i=0;i<Math.ceil(w/22);i++){const x=13+i*23+(i%2)*7,y=bottom+11+(i*13)%28;ctx.strokeStyle='#6d994b';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x,y+9);ctx.lineTo(x+2,y);ctx.stroke();ctx.fillStyle=i%3===0?'#f5e9b3':i%3===1?'#fff8e9':'#e6b1c0';for(let p=0;p<5;p++){const a=p*Math.PI*2/5;ctx.beginPath();ctx.ellipse(x+2+Math.cos(a)*2.4,y+Math.sin(a)*2.4,2,2,0,0,Math.PI*2);ctx.fill()}ctx.fillStyle='#d6a547';ctx.fillRect(x+1,y-1,2,2)}
 const bush=images.bush;if(bush){ctx.drawImage(bush,-24,bottom+10,83,70);ctx.drawImage(bush,w-54,bottom+14,86,72)}
 ctx.fillStyle='#638744';ctx.font='11'+'px system-ui';ctx.textAlign='center';ctx.fillText('출발',raceStart+11,top-16);ctx.fillText('결승',finish+4,top-16);
return scenery;
}
  function displayedProgress(id) {
    const target=state.positions.get(id) || 0;
    if (reduced.matches) return target;
    const t=Math.min(1,Math.max(0,(performance.now()-state.positionAt)/900));
    const eased=t*t*(3-2*t);
    return (state.previous.get(id) ?? target) + (target-(state.previous.get(id) ?? target))*eased;
  }
  function draw(time=performance.now()) {
    if (state.hidden) return;
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);state.scenery=null;}
    if(!state.scenery)state.scenery=createScenery(w,h,dpr);
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.drawImage(state.scenery,0,0,w,h);
    const {narrow,top,laneH,raceStart,travel,scale}=geometry(w,h),stage=phase(),round=currentRound();
    for(const [i,slime] of entrants().entries()){
      const id=names.indexOf(slime.name);if(id<0)continue;
      const p=stage==='racing'||stage==='results'?displayedProgress(slime.slimeId):0;
      const x=raceStart+p*travel,y=top+i*laneH+laneH-11;
      const elapsed=round?(now()-round.raceStartsAt)/1000:0;
      const prep=!reduced.matches&&(stage==='countdown'&&round.raceStartsAt-now()<650||stage==='racing'&&elapsed>=0&&elapsed<.65);
      sprite(ctx,id,x,y,scale,elapsed,stage==='racing'&&!reduced.matches,prep);
      if(stage==='sales'||stage==='countdown'){ctx.font='11px system-ui';ctx.fillStyle='#6d573c';ctx.textAlign='left';ctx.fillText(slime.name,raceStart+(narrow?43:59),y-11);}
    }
    state.particles=state.particles.filter(particle=>time-particle.start<850);
    for(const particle of state.particles){const t=(time-particle.start)/850;if(t<0||t>1)continue;ctx.globalAlpha=1-t;ctx.fillStyle=particle.color;ctx.font='18px Georgia';ctx.textAlign='center';ctx.fillText(particle.shape,particle.x+Math.sin(t*3)*12,particle.y-t*42);ctx.globalAlpha=1;}
  }
  function startAnimation() {
    cancelAnimationFrame(state.raf); if(state.hidden)return;
    let last=0;
    const tick=time=>{if(state.hidden)return;if(time-last>30){draw(time);last=time;}if(state.particles.length||!reduced.matches&&(phase()==='racing'||phase()==='countdown'&&currentRound().raceStartsAt-now()<650||time-state.positionAt<950))state.raf=requestAnimationFrame(tick);};
    state.raf=requestAnimationFrame(tick);
  }
  async function loadAssets() {
    const paths=[...names.flatMap((_,i)=>[['slime'+i,'slime'+i+'.png'],['acc'+i,'acc'+i+'.png']]),['tree','tree.webp'],['bush','bush.webp']];
    let failures=0;
    await Promise.all(paths.map(([key,file])=>new Promise(resolve=>{const image=new Image();image.onload=()=>{images[key]=image;resolve();};image.onerror=()=>{failures++;resolve();};image.src='/assets/slime-race/art/'+file;})));
    for(const [i,name] of names.entries())if(images['slime'+i])portraits.set(name,makePortrait(i));
    state.scenery=null;
    if(failures)spectator('일부 경기장 그림을 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.');
  }
})();
