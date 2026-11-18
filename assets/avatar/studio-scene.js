import { createAvatarView } from './renderer.js';

const directions = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const arrowKeys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const byId = id => document.getElementById(id);

export function mountScene(initial) {
  const scene = byId('scene');
  const world = byId('world');
  const actor = byId('avatar-view');
  const grid = byId('board-grid');
  const status = byId('render-status');
  const places = { studio: '별무리 작업대', portrait: '별무리 초상실', board: '바람길 보드판', rpg: '구름성 들판' };
  const board = { x: 3, y: 3 };
  const field = { x: .5, y: .66 };
  let mode = 'studio';
  let character = initial;
  let view;
  let face = false;
  let walking = false;
  let target = null;
  let held = new Set();
  let frame = 0;
  let last = 0;
  let stopWalk;
  let animating = false;
  let facing = 0;
  const tiles = Array.from({ length: 35 }, () => {
    const tile = document.createElement('span');
    tile.className = 'tile';
    grid.append(tile);
    return tile;
  });

  function setWalking(next) {
    if (animating !== next) view?.setMotion(next ? 'walk' : 'idle');
    animating = next;
  }

  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(stopWalk);
    frame = 0;
    last = 0;
    target = null;
    held.clear();
    setWalking(false);
  }

  function place() {
    const onBoard = mode === 'board';
    const x = onBoard ? (board.x + .5) / 7 : field.x;
    const y = onBoard ? (board.y + .58) / 5 : field.y;
    actor.style.left = (x * 100) + '%';
    actor.style.top = (y * 100) + '%';
    if (mode === 'rpg') actor.style.setProperty('--depth', String(.60 + .4 * y));
    if (onBoard) {
      tiles.forEach((tile, index) => tile.classList.toggle('current', index === board.y * 7 + board.x));
      byId('travel-hint').textContent = '가로 ' + (board.x + 1) + ' · 세로 ' + (board.y + 1) + '칸';
    }
  }

  function faceDirection(dx, dy) {
    const angle = Math.atan2(dx, dy);
    const turn = Math.atan2(Math.sin(angle - facing), Math.cos(angle - facing));
    if (Math.abs(turn) > .01) { view?.rotate(turn); facing = angle; }
  }

  function stepBoard(x, y) {
    const nextX = clamp(x, 0, 6);
    const nextY = clamp(y, 0, 4);
    if (board.x === nextX && board.y === nextY) return;
    faceDirection(nextX - board.x, nextY - board.y);
    board.x = nextX;
    board.y = nextY;
    place();
    setWalking(true);
    clearTimeout(stopWalk);
    stopWalk = setTimeout(() => setWalking(false), 190);
  }

  function travel(now) {
    frame = 0;
    const elapsed = Math.min((now - (last || now)) / 1000, .045);
    last = now;
    let dx = 0, dy = 0;
    for (const key of held) {
      dx += directions[key][0];
      dy += directions[key][1];
    }
    if (target) {
      dx = target.x - field.x;
      dy = target.y - field.y;
    }
    const width = world.clientWidth || 1;
    const height = world.clientHeight || 1;
    const px = target ? dx * width : dx;
    const py = target ? dy * height : dy;
    const length = Math.hypot(px, py);
    const distance = Math.min(target ? length : Infinity, elapsed * Math.min(width, height) * .85);
    if (!length || (target && length < 1)) { stop(); return; }
    const x = clamp(field.x + px / length * distance / width, .045, .955);
    const y = clamp(field.y + py / length * distance / height, .18, .96);
    faceDirection(px, py);
    setWalking(!elapsed || x !== field.x || y !== field.y);
    field.x = x;
    field.y = y;
    place();
    frame = requestAnimationFrame(travel);
  }

  function startTravel() {
    if (!frame) { last = 0; frame = requestAnimationFrame(travel); }
  }

  function move(key, continuous) {
    const [dx, dy] = directions[key];
    if (mode === 'board') { stepBoard(board.x + dx, board.y + dy); return; }
    if (mode !== 'rpg') return;
    if (continuous) {
      target = null;
      held.add(key);
    } else {
      target = { x: clamp(field.x + dx * .09, .045, .955), y: clamp(field.y + dy * .12, .18, .96) };
    }
    startTravel();
  }

  function release(key) {
    held.delete(key);
    if (!held.size && !target) stop();
  }

  function setMode(next) {
    stop();
    mode = next;
    scene.dataset.mode = next;
    const travelling = next === 'board' || next === 'rpg';
    byId('travel-tools').hidden = !travelling;
    byId('view-tools').hidden = travelling;
    byId('zoom').hidden = next !== 'studio';
    byId('motion').hidden = next !== 'studio';
    byId('location').textContent = places[next];
    scene.setAttribute('aria-label', places[next] + (travelling ? '. 방향키나 가고 싶은 곳을 눌러 이동' : '. 좌우 방향키로 회전'));
    byId('travel-hint').textContent = '방향키나 땅을 눌러 이동';
    document.querySelectorAll('[data-mode]').forEach(node => {
      if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', String(node.dataset.mode === next));
    });
    view?.dispose();
    view = null;
    facing = 0;
    actor.replaceChildren();
    if (travelling) place();
    else { actor.style.removeProperty('left'); actor.style.removeProperty('top'); }
    try {
      view = createAvatarView(actor, character, { mode });
      view.setView(next === 'portrait' || (next === 'studio' && face) ? 'face' : 'full');
      if (next === 'studio') setWalking(walking);
      status.hidden = true;
    } catch {
      status.textContent = '모습을 표시하지 못했어요. 장면을 다시 골라 주세요.';
      status.hidden = false;
    }
  }

  document.querySelectorAll('button[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  byId('rotate-left').onclick = () => view?.rotate(-Math.PI / 8);
  byId('rotate-right').onclick = () => view?.rotate(Math.PI / 8);
  byId('zoom').onclick = () => {
    face = !face;
    view?.setView(face ? 'face' : 'full');
    byId('zoom').textContent = face ? '전신 보기' : '얼굴 확대';
    byId('zoom').setAttribute('aria-pressed', String(face));
  };
  byId('motion').onclick = () => {
    walking = !walking;
    setWalking(walking);
    byId('motion').textContent = walking ? '멈추기' : '걸어 보기';
    byId('motion').setAttribute('aria-pressed', String(walking));
  };
  scene.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    const key = arrowKeys[event.key];
    if (!key) return;
    event.preventDefault();
    if (mode === 'rpg' || mode === 'board') move(key, true);
    else if (key === 'left' || key === 'right') view?.rotate(directions[key][0] * Math.PI / 8);
  });
  scene.addEventListener('keyup', event => { if (mode === 'rpg' && arrowKeys[event.key]) release(arrowKeys[event.key]); });
  scene.addEventListener('blur', () => { if (mode === 'rpg') stop(); });
  window.addEventListener('blur', () => { if (mode === 'rpg') stop(); });
  world.addEventListener('click', event => {
    if (mode !== 'board' && mode !== 'rpg') return;
    const rect = world.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    scene.focus({ preventScroll: true });
    if (mode === 'board') stepBoard(Math.floor(x * 7), Math.floor(y * 5));
    else {
      held.clear();
      target = { x: clamp(x, .045, .955), y: clamp(y, .18, .96) };
      startTravel();
    }
  });
  document.querySelectorAll('[data-direction]').forEach(button => {
    const key = button.dataset.direction;
    let repeat;
    const clear = () => { clearTimeout(repeat); release(key); };
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      button.setPointerCapture(event.pointerId);
      // 짧게 눌러도 한 걸음을 완성하고, 계속 누르면 자유롭게 걷는다.
      move(key, false);
      if (mode === 'rpg') repeat = setTimeout(() => move(key, true), 130);
    });
    button.addEventListener('lostpointercapture', clear);
    button.addEventListener('click', event => { if (event.detail === 0) move(key, false); });
  });
  setMode('studio');
  return { update(next) { character = next; view?.update(character); }, dispose() { stop(); view?.dispose(); } };
}
