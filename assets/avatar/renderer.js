import { buildAdventurer, readAppearance } from './art/adventurer.js';
import { JOB_LABELS } from './art/regalia.js';
import { pose } from './art/pose.js';
import { createHardware } from './art/light.js';
import { createPaper } from './art/paper.js';

const views = new WeakMap();
const modes = new Set(['studio', 'board', 'rpg', 'portrait']);

// 이 인스턴스는 자신이 만든 표면만 소유한다. 같은 칸에 새 말을 놓으면 앞선 렌더 자원을 돌려준다.
export function createAvatarView(container, character, { mode = 'studio' } = {}) {
  if (!container?.ownerDocument) throw new TypeError('아바타를 표시할 요소가 필요합니다.');
  views.get(container)?.dispose();
  if (!modes.has(mode)) mode = 'studio';
  const doc = container.ownerDocument,
    win = doc.defaultView;
  const host = doc.createElement('div');
  Object.assign(host.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });
  host.setAttribute('role', 'img');
  if (mode === 'studio') {
    host.tabIndex = 0;
    host.style.touchAction = 'pan-y';
    host.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
  }
  container.append(host);
  const makeCanvas = () => {
    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      display: 'block',
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    host.append(canvas);
    return canvas;
  };
  let canvas = makeCanvas(),
    backend = createHardware(canvas),
    software = !backend;
  let view = mode === 'portrait' ? 'face' : 'full',
    motion = 'idle',
    angle = mode === 'board' ? 0.42 : -0.265;
  let model,
    modelKey,
    pending = character,
    dirty = true,
    needsModel = true,
    disposed = false;
  let visible = true,
    frameId = 0,
    elapsed = 0,
    lastDraw = 0,
    pointer = null;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0,
    height = 0;
  function switchToPaper() {
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.remove();
    canvas = makeCanvas();
    backend = createPaper(canvas);
    software = true;
    if (model) backend?.setModel(model);
  }
  function onContextLost(event) {
    event.preventDefault();
    backend?.dispose();
    switchToPaper();
    invalidate();
  }
  if (software) switchToPaper();
  else canvas.addEventListener('webglcontextlost', onContextLost);
  function requestFrame() {
    if (!disposed && !frameId && visible && !doc.hidden) frameId = win.requestAnimationFrame(draw);
  }
  function invalidate() {
    dirty = true;
    requestFrame();
  }
  function draw(now) {
    frameId = 0;
    if (disposed || !visible || doc.hidden) return;
    if (!width || !height) {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }
    if (width <= 0 || height <= 0) return;
    if (needsModel) {
      const key = JSON.stringify(readAppearance(pending));
      if (key !== modelKey) {
        model = buildAdventurer(pending, mode);
        backend?.setModel(model);
        modelKey = key;
      }
      needsModel = false;
    }
    const animate = !reduced.matches && (motion === 'walk' || mode === 'studio' || mode === 'rpg');
    const interval = software ? (motion === 'walk' ? 110 : 220) : 1000 / 30;
    if (dirty || now - lastDraw >= interval - 0.75) {
      elapsed += lastDraw ? Math.min((now - lastDraw) / 1000, 0.22) : 0;
      lastDraw = now;
      const ratio = Math.min(
        win.devicePixelRatio || 1,
        software ? 1 : 1.75,
        (software ? 440 : 1280) / Math.max(width, height),
      );
      const w = Math.max(1, Math.round(width * ratio)),
        h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      backend?.draw(
        pose(model, {
          angle,
          time: reduced.matches ? 0 : elapsed,
          motion: reduced.matches ? 'idle' : motion,
          mode,
          view,
          width,
          height,
        }),
      );
      dirty = false;
    }
    if (animate && backend) requestFrame();
  }
  function onSize(entries) {
    const box = entries[0].contentRect;
    width = box.width;
    height = box.height;
    invalidate();
  }
  const resize = win.ResizeObserver ? new win.ResizeObserver(onSize) : null;
  resize?.observe(host);
  const onWindowResize = () => {
    width = 0;
    height = 0;
    invalidate();
  };
  if (!resize) win.addEventListener('resize', onWindowResize);
  function visibility() {
    if (!visible || doc.hidden) {
      win.cancelAnimationFrame(frameId);
      frameId = 0;
      lastDraw = 0;
    } else invalidate();
  }
  const observer = win.IntersectionObserver
    ? new win.IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        visibility();
      })
    : null;
  observer?.observe(host);
  doc.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', invalidate);
  function rotate(deltaRadians) {
    if (!Number.isFinite(deltaRadians) || disposed) return;
    angle = (angle + deltaRadians) % (Math.PI * 2);
    invalidate();
  }
  function keydown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      rotate(e.key === 'ArrowLeft' ? -0.15 : 0.15);
    }
  }
  function down(e) {
    if (!e.isPrimary || e.button !== 0) return;
    pointer = { id: e.pointerId, x: e.clientX };
    host.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (pointer?.id !== e.pointerId) return;
    rotate(((e.clientX - pointer.x) * Math.PI) / Math.max(100, width * 0.68));
    pointer.x = e.clientX;
  }
  function release(e) {
    if (pointer?.id === e.pointerId) pointer = null;
  }
  if (mode === 'studio') {
    host.addEventListener('keydown', keydown);
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('lostpointercapture', release);
  }
  function label() {
    const name = typeof pending?.name === 'string' && pending.name.trim() ? pending.name : '모험가';
    const job = JOB_LABELS[readAppearance(pending).job];
    const recommended = Object.hasOwn(JOB_LABELS, pending?.recommendedJob)
      ? JOB_LABELS[pending.recommendedJob]
      : '';
    const text =
      name +
      ' · ' +
      job +
      (view === 'face' ? ' 얼굴' : ' 전신') +
      (recommended ? '. 추천 직업은 ' + recommended + '입니다' : '');
    host.setAttribute('aria-label', text + (mode === 'studio' ? '. 좌우 방향키로 회전합니다.' : ''));
    if (!backend) host.textContent = text;
  }
  function update(next) {
    if (disposed) return;
    pending = next;
    needsModel = true;
    label();
    invalidate();
  }
  function setView(next) {
    if (disposed || !['full', 'face'].includes(next)) return;
    view = next;
    label();
    invalidate();
  }
  function setMotion(next) {
    if (disposed || !['walk', 'idle'].includes(next)) return;
    motion = next;
    invalidate();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    win.cancelAnimationFrame(frameId);
    resize?.disconnect();
    observer?.disconnect();
    doc.removeEventListener('visibilitychange', visibility);
    reduced.removeEventListener('change', invalidate);
    win.removeEventListener('resize', onWindowResize);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    host.removeEventListener('keydown', keydown);
    host.removeEventListener('pointerdown', down);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('lostpointercapture', release);
    backend?.dispose();
    canvas.width = 1;
    canvas.height = 1;
    host.remove();
    backend = null;
    model = null;
    pending = null;
    views.delete(container);
  }
  const api = { update, setView, rotate, setMotion, dispose };
  views.set(container, api);
  update(character);
  return api;
}
