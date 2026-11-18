import { packGameFiles } from './gamekit-zip.js';

const boardSize = 512;
const cellSize = 192;
const directions = [
  ['down', 0], ['left', -Math.PI / 2], ['right', Math.PI / 2], ['up', Math.PI],
];
const cycles = [
  { motion: 'idle', frameMs: 500, phases: [0, 0.25] },
  { motion: 'walk', frameMs: 125, phases: [0, 0.25, 0.5, 0.75] },
];
const columns = cycles.reduce((sum, cycle) => sum + cycle.phases.length, 0);
const jobs = ['guardian', 'ranger', 'arcanist', 'healer'];

export function gameSnapshot(avatar) {
  const { id, revision, character } = avatar;
  if ((id !== null && (typeof id !== 'string' || !id.length)) ||
      !Number.isSafeInteger(revision) || revision < 0 || (id === null && revision !== 0)) {
    throw new Error('아바타 저장 정보를 확인해 주세요.');
  }
  if (!jobs.includes(character?.job)) throw new Error('직업을 확인해 주세요.');
  const source = character.appearance;
  const appearance = {};
  for (const key of ['height', 'build', 'shoulders', 'jaw', 'eyes', 'nose', 'hairStyle']) {
    const value = source?.[key];
    const maximum = key === 'hairStyle' ? 3 : 100;
    if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error('외형 수치를 확인해 주세요.');
    appearance[key] = value;
  }
  for (const key of ['skinColor', 'hairColor', 'eyeColor', 'clothColor']) {
    const value = source[key];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/.test(value) || value.length !== 7) {
      throw new Error('외형 색상을 확인해 주세요.');
    }
    appearance[key] = value;
  }
  return { version: 1, id, revision, character: { appearance, job: character.job } };
}

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('그림판을 만들 수 없습니다.');
  return context;
}

function paintFrame(renderer, target, options, x, y, size) {
  const frame = renderer.captureFrame(options);
  target.drawImage(frame, x, y, size, size);
  const pixels = target.getImageData(x, y, size, size).data;
  let visible = false;
  let transparent = false;
  for (let alpha = 3; alpha < pixels.length; alpha += 4) {
    if (pixels[alpha] === 0) transparent = true;
    if (pixels[alpha] > 0) visible = true;
    if (visible && transparent) return;
  }
  throw new Error('투명한 인물 그림을 얻을 수 없습니다.');
}

function png(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob?.size && blob.type === 'image/png') resolve(blob);
    else reject(new Error('PNG 파일을 만들 수 없습니다.'));
  }, 'image/png'));
}

function json(data) {
  return new Blob([JSON.stringify(data, null, 2), '\n'], { type: 'application/json' });
}

async function buildKit(snapshot, signal) {
  const { createAvatarView } = await import('./renderer.js');
  signal.throwIfAborted();
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.inert = true;
  Object.assign(stage.style, {
    position: 'fixed', left: '-10000px', top: '0', width: boardSize + 'px',
    height: boardSize + 'px', pointerEvents: 'none', overflow: 'hidden',
  });
  document.body.append(stage);
  let renderer;
  let board;
  let sheet;
  try {
    renderer = createAvatarView(stage, snapshot.character, { mode: 'board' });
    board = surface(boardSize, boardSize);
    const files = [];
    for (const [filename, view] of [['portrait.png', 'face'], ['pawn.png', 'full']]) {
      signal.throwIfAborted();
      board.clearRect(0, 0, boardSize, boardSize);
      paintFrame(renderer, board, { angle: 0, phase: 0, motion: 'idle', view }, 0, 0, boardSize);
      files.push([filename, await png(board.canvas)]);
    }

    renderer.dispose();
    renderer = null;
    signal.throwIfAborted();
    stage.style.width = stage.style.height = cellSize + 'px';
    renderer = createAvatarView(stage, snapshot.character, { mode: 'rpg' });
    sheet = surface(columns * cellSize, directions.length * cellSize);
    const atlas = {
      version: 1, image: 'sprites.png', origin: 'top-left', units: 'px',
      width: sheet.canvas.width, height: sheet.canvas.height, frameSize: { w: cellSize, h: cellSize },
      animations: [],
    };
    for (const [row, [direction, angle]] of directions.entries()) {
      signal.throwIfAborted();
      let column = 0;
      for (const { motion, frameMs, phases } of cycles) {
        const frames = [];
        for (const phase of phases) {
          const x = column++ * cellSize;
          const y = row * cellSize;
          paintFrame(renderer, sheet, { angle, phase, motion, view: 'full' }, x, y, cellSize);
          frames.push({ x, y, w: cellSize, h: cellSize });
        }
        atlas.animations.push({ direction, motion, frameMs, loop: true, frames });
      }
      // 모바일에서 방향 하나를 그릴 때마다 입력과 화면 갱신에 제어권을 돌려준다.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    files.push(['sprites.png', await png(sheet.canvas)], ['atlas.json', json(atlas)], ['avatar.json', json(snapshot)]);
    return packGameFiles(files);
  } finally {
    try { renderer?.dispose(); } finally {
      stage.remove();
      if (board) board.canvas.width = 0;
      if (sheet) sheet.canvas.width = 0;
    }
  }
}

export function mountAvatarExport(container, getAvatar) {
  const root = document.createElement('section');
  root.setAttribute('aria-label', '게임 자산 내보내기');
  root.className = 'avatar-gamekit';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '게임 파일 만들기';
  const link = document.createElement('a');
  link.textContent = '게임 파일 받기 (ZIP)';
  link.download = 'avatar-gamekit.zip';
  link.hidden = true;
  for (const control of [button, link]) {
    Object.assign(control.style, { minHeight: '44px', padding: '0.65em 1em', boxSizing: 'border-box', maxWidth: '100%' });
  }
  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' });
  actions.append(button, link);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = '보드게임용 초상과 말, RPG용 네 방향 동작을 ZIP 파일로 담습니다.';
  root.append(actions, status);
  container.append(root);

  const lifetime = new AbortController();
  let url;
  function clearDownload() {
    link.hidden = true;
    link.removeAttribute('href');
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  }
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    clearDownload();
    status.textContent = '인물과 동작을 그리는 중입니다…';
    try {
      const snapshot = gameSnapshot(getAvatar());
      const archive = await buildKit(snapshot, lifetime.signal);
      lifetime.signal.throwIfAborted();
      url = URL.createObjectURL(archive);
      link.href = url;
      link.hidden = false;
      status.textContent = '준비됐습니다. 게임 파일을 받아 압축을 풀어 주세요. 외형을 바꾼 뒤에는 파일을 다시 만드세요.';
    } catch {
      if (!lifetime.signal.aborted) status.textContent = '게임 파일을 만들지 못했습니다. 아바타와 브라우저의 그래픽 지원을 확인하고 다시 시도해 주세요.';
    } finally {
      button.disabled = false;
    }
  }, { signal: lifetime.signal });

  return {
    dispose() {
      lifetime.abort();
      clearDownload();
      root.remove();
    },
  };
}
