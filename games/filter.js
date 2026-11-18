/* 자바스크립트가 없으면 게임 전체 목록을 그대로 읽을 수 있다. */
(() => {
  const filters = document.querySelector('.gb-filters');
  const buttons = [...filters.querySelectorAll('[data-filter]')];
  const cards = [...document.querySelectorAll('[data-genre]')];
  const empty = document.querySelector('#board-empty');
  const list = document.querySelector('#game-list');
  const status = document.querySelector('.gb-filter-status');
  const selected = () => {
    const hash = location.hash.slice(1);
    return buttons.some(button => button.dataset.filter === hash) ? hash : 'all';
  };
  function render() {
    const category = selected();
    for (const button of buttons) {
      const active = button.dataset.filter === category;
      button.setAttribute('aria-pressed', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const card of cards) card.hidden = category !== 'all' && card.dataset.genre !== category;
    empty.hidden = category !== 'board';
    list.hidden = category === 'board';
    const label = buttons.find(button => button.dataset.filter === category).textContent;
    status.textContent = category === 'board' ? '보드게임은 준비 중이에요.' : `${label}: ${cards.filter(card => !card.hidden).length}개 게임`;
  }
  function select(button) {
    const category = button.dataset.filter;
    history.pushState(null, '', category === 'all' ? location.pathname + location.search : `#${category}`);
    render();
  }
  for (const [index, button] of buttons.entries()) {
    button.addEventListener('click', () => select(button));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus();
      select(buttons[next]);
    });
  }
  addEventListener('hashchange', render);
  addEventListener('popstate', render);
  render();
  filters.hidden = false;
})();
