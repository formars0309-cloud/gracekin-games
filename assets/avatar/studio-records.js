const byId = id => document.getElementById(id);
const guest = 'guest';
const prefix = 'member:';

// 현재 탭의 이 방문 기록에 편집 초안만 남긴다. 회원 기록은 확인된 계정별로 복구한다.
export function mountRecords({ current, replace, makeDefault, validDraft, validateName }) {
  const drafts = new Map();
  for (const item of Array.isArray(history.state?.avatarDrafts) ? history.state.avatarDrafts : []) {
    if (Array.isArray(item) && typeof item[0] === 'string' && validDraft(item[1]?.character) && Number.isSafeInteger(item[1].revision)) drafts.set(item[0], item[1]);
  }
  let owner = guest, revision = 0, saved = null, pending = null;
  let ready = false, busy = false, retry = false, timer, refreshQueued = false;
  const bench = document.querySelector('.bench');
  function shieldPrivateView() {
    if (owner === guest) return;
    bench.inert = true;
    bench.classList.add('awaiting-account');
  }
  function revealView() {
    bench.inert = false;
    bench.classList.remove('awaiting-account');
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const status = text => { byId('sync-status').textContent = text; };
  function flush() {
    clearTimeout(timer);
    try { history.replaceState({ ...history.state, avatarDrafts: Array.from(drafts) }, ''); }
    catch { byId('storage-warning').hidden = false; }
  }
  function refreshButtons() {
    const member = owner !== guest;
    byId('save').hidden = !member && !retry;
    byId('login').hidden = member || retry;
    byId('save').disabled = busy || !ready || !member || !!pending;
    byId('load').disabled = busy;
    byId('load').textContent = retry || !member ? '계정 다시 확인' : '불러오기';
    byId('draft-actions').hidden = !member || !drafts.has(guest);
    byId('use-guest').disabled = busy || !!pending;
    byId('conflict-actions').hidden = !pending;
    byId('use-server').disabled = byId('keep-local').disabled = busy;
  }
  function edited(liveInput = false) {
    const character = current();
    if (!pending && saved && same(saved.character, character)) drafts.delete(owner);
    else drafts.set(owner, { revision, character });
    clearTimeout(timer);
    if (liveInput) timer = setTimeout(flush, 160);
    else flush();
    if (pending) status('저장된 기록이 바뀌었어요. 아래에서 이어갈 기록을 골라 주세요.');
    else if (owner === guest) status('이 탭에 손님 초안을 보관해요. 로그인한 뒤 가져올 수 있어요.');
    else status('편집 중인 초안을 이 탭에 보관했어요.');
    refreshButtons();
  }
  async function decode(response) {
    if (!response.ok) {
      let message = '연결을 확인한 뒤 다시 시도해 주세요.';
      if (response.status === 422) {
        const body = await response.json().catch(() => null);
        message = body?.error?.message || '이름과 외형 설정을 확인해 주세요.';
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  const options = () => ({ cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000) });
  async function identity() {
    const data = await decode(await fetch('/api/account/session', options()));
    if (data.user === null) return guest;
    if (!data.user?.id || typeof data.user.id !== 'string') throw new Error('계정을 확인할 수 없어요.');
    return prefix + data.user.id;
  }
  async function readAvatar() {
    const { avatar } = await decode(await fetch('/api/avatar/me', options()));
    if (avatar === null) return null;
    if (!avatar?.id || !Number.isSafeInteger(avatar.revision) || avatar.revision < 1 || !validDraft(avatar.character)) throw new Error('저장된 기록을 읽을 수 없어요.');
    return avatar;
  }
  function useGuest() {
    const changed = owner !== guest;
    owner = guest;
    saved = pending = null;
    revision = 0;
    if (changed) replace(drafts.get(guest)?.character || makeDefault());
    status('손님으로 만들 수 있어요. 계정에 저장하려면 로그인해 주세요.');
  }
  function restore(account, remote, discard) {
    const changedOwner = account !== owner;
    const oldRevision = revision;
    const draft = drafts.get(account);
    owner = account;
    saved = remote;
    revision = remote?.revision || 0;
    pending = null;
    if (discard || !draft || same(draft.character, remote?.character)) {
      if (changedOwner || discard || revision !== oldRevision) replace(remote?.character || makeDefault());
      drafts.delete(owner);
      status(remote ? '계정에 저장한 모험가를 불러왔어요.' : '첫 모험가의 외형을 고르고 계정에 저장해 주세요.');
    } else {
      if (changedOwner) replace(draft.character);
      if (draft.revision !== revision) {
        pending = { remote };
        revision = draft.revision;
        status('다른 곳에서 기록이 바뀌었어요. 이어갈 기록을 골라 주세요.');
      } else status('이 탭에서 편집하던 초안을 열었어요.');
    }
    flush();
  }

  function confirmLoad(text) {
    const dialog = byId('confirm-dialog');
    byId('confirm-copy').textContent = text;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
  }

  async function run(work) {
    if (busy) return;
    busy = true;
    refreshButtons();
    try { await work(); }
    catch (error) {
      ready = false;
      retry = true;
      if (error.status === 401) {
        useGuest();
        retry = false;
        status('로그인이 풀렸어요. 같은 계정으로 돌아오면 편집하던 초안을 열 수 있어요.');
      } else {
        useGuest();
        status('기록을 확인하지 못했어요. 편집본은 이 탭에 보관했으니 계정을 다시 확인해 주세요.');
      }
    } finally {
      busy = false;
      refreshButtons();
      if (refreshQueued && !document.hidden) { refreshQueued = false; refresh(); }
      else if (!document.hidden) revealView();
    }
  }
  async function refresh(manual = false) {
    if (busy) { if (!manual) refreshQueued = true; return; }
    await run(async () => {
      const account = await identity();
      if (account === guest) { useGuest(); ready = true; retry = false; return; }
      const remote = await readAvatar();
      if (await identity() !== account) { refreshQueued = true; return; }
      let discard = false;
      if (manual && account === owner && drafts.has(owner)) {
        discard = await confirmLoad(remote ? '이 탭에서 편집한 내용을 계정의 저장본으로 바꿀까요?' : '계정에 저장한 모험가가 없어요. 편집하던 초안을 기본 모습으로 바꿀까요?');
        if (!discard) return;
      }
      restore(account, remote, discard);
      ready = true;
      retry = false;
    });
  }
  byId('save').onclick = () => run(async () => {
    if (!validateName() || pending || !ready || owner === guest) return;
    if (await identity() !== owner) { refreshQueued = true; return; }
    const character = current();
    const payload = { revision, character: { ...character, name: character.name.trim() } };
    const response = await fetch('/api/avatar/me', { ...options(), method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (response.status === 409) {
      const remote = await readAvatar();
      if (await identity() !== owner) { refreshQueued = true; return; }
      pending = { remote };
      edited();
      return;
    }
    if (response.status === 422) {
      try { await decode(response); } catch (error) { status(error.message); }
      return;
    }
    const result = await decode(response);
    if (!result.avatar?.id || !Number.isSafeInteger(result.avatar.revision) || !validDraft(result.avatar.character)) throw new Error('저장 결과를 확인하지 못했어요.');
    if (await identity() !== owner) { refreshQueued = true; return; }
    saved = result.avatar;
    revision = saved.revision;
    if (same(current(), character)) {
      replace(saved.character, false);
      drafts.delete(owner);
      status('계정에 저장했어요. 보드판과 탐험에서도 이 모습으로 만나요.');
    } else edited();
    flush();
  });
  byId('load').onclick = () => refresh(true);
  byId('use-guest').onclick = () => {
    if (busy || pending || owner === guest || !drafts.has(guest)) return;
    replace(drafts.get(guest).character, false);
    drafts.delete(guest);
    edited();
    status('손님 초안을 가져왔어요. 계정에 저장하면 적용돼요.');
  };
  byId('use-server').onclick = () => {
    if (!pending) return;
    restore(owner, pending.remote, true);
    refreshButtons();
  };
  byId('keep-local').onclick = () => {
    if (!pending) return;
    saved = pending.remote;
    revision = saved?.revision || 0;
    pending = null;
    edited();
    status('내 편집본을 선택했어요. 계정에 저장하면 최신 기록을 바꿔요.');
  };
  if (drafts.has(guest)) replace(drafts.get(guest).character);
  byId('login').addEventListener('click', () => { flush(); status('새 창에서 로그인하고 이 공방 탭으로 돌아오세요.'); });
  window.addEventListener('pagehide', () => { flush(); shieldPrivateView(); });
  document.querySelector('.editor').addEventListener('change', flush);
  document.querySelector('.editor').addEventListener('focusout', flush);
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  window.addEventListener('focus', () => { if (!document.hidden && !byId('confirm-dialog').open) refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flush(); shieldPrivateView(); } else refresh(); });
  refresh();
  return { edited };
}
