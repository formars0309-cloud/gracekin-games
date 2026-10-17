/* 비공개 제보·운영 도구 공통 처리. 모든 데이터와 권한은 같은 출처 서버에서 확인한다. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  function make(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  async function request(path, data) {
    if (!/^\/(?:admin|community|account)(?:\/|\?|$)/.test(path) || path.includes('\\')) throw new Error('요청 주소를 확인해 주세요.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api${path}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      let body; try { body = await response.json(); } catch (_) { throw new Error('서버 응답을 확인하지 못했어요. 다시 시도해 주세요.'); }
      if (!response.ok) {
        const detail = body.error || body;
        const error = new Error(response.status === 429 ? '요청이 많아요. 잠시 후 다시 시도해 주세요.' : /[가-힣]/.test(detail.message || '') ? detail.message : '요청을 처리하지 못했어요. 입력 내용과 로그인 상태를 확인해 주세요.');
        error.status = response.status; throw error;
      }
      return body;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('연결이 끊겼거나 응답이 늦어요. 저장 여부를 목록에서 확인한 뒤 다시 시도해 주세요.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function message(node, text, error = false) { node.textContent = text; node.hidden = !text; node.classList.toggle('is-error', error); }
  function busy(form, value) { form.setAttribute('aria-busy', String(value)); for (const node of form.querySelectorAll('input,textarea,select,button')) node.disabled = value; }
  function field(label, name, options = {}) {
    const wrap = make('div', null, 'tool-field'); const caption = make('label', label); const node = make(options.multiline ? 'textarea' : options.choices ? 'select' : 'input');
    node.name = name; node.id = `${name}-${++field.sequence}`; caption.htmlFor = node.id;
    if (options.choices) for (const [value, text] of options.choices) { const option = make('option', text); option.value = value; node.append(option); }
    else if (!options.multiline) node.type = options.type || 'text';
    if (options.multiline) node.rows = 4;
    for (const key of ['required', 'minLength', 'maxLength', 'min', 'max', 'step', 'placeholder', 'pattern']) if (options[key] !== undefined) node[key] = options[key];
    if (options.value !== undefined) node.value = options.value;
    wrap.append(caption, node); return wrap;
  }
  field.sequence = 0;
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
  function detail(node, label, value) { if (value !== undefined && value !== null && value !== '') { const p = make('p', null, 'tool-detail'); p.append(make('strong', `${label} · `), make('span', value)); node.append(p); } }
  window.grainTools = { byId, make, request, message, busy, field, formatDate, detail };
})();
