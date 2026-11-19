import { findPath } from './pathfinding.js';
import { drawAvatar } from './avatar.js';

const byId = id => document.getElementById(id);
const state = { session: null, socket: null, selfId: null, players: new Map(), channels: [], channelId: null, villageId: null, avatar: null, revision: 0, blocked: new Set(), retries: 0, reconnect: null, stopped: false, scene: null, game: null, map: null, mapPath: null, goal: null };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const emoteSymbols = { wave: '안녕 👋', heart: '♡', laugh: '하하!', surprise: '!', clap: '짝짝!', dance: '♪' };
const status = (text, error = false) => { byId('action-status').textContent = text; byId('action-status').classList.toggle('error', error); };
async function api(path, body, method = 'POST') {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { method, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error?.message || '요청을 처리하지 못했어요.'); error.status = response.status; error.code = data.error?.code; throw error; }
  return data;
}
function send(message) {
  if (state.socket?.readyState !== WebSocket.OPEN) { status('마을에 다시 연결한 뒤 시도해 주세요.', true); return false; }
  state.socket.send(JSON.stringify(message)); return true;
}
function setChannels(channels) {
  if (Array.isArray(channels)) state.channels = channels;
  const select = byId('channel-select'); select.replaceChildren();
  for (const channel of state.channels) { const option = document.createElement('option'); option.value = channel.id; option.textContent = `${channel.id}번 · ${channel.count}/${channel.capacity || 50}명`; option.selected = channel.id === state.channelId; select.append(option); }
  const next = Math.max(0, ...state.channels.map(channel => channel.id)) + 1;
  const option = document.createElement('option'); option.value = next; option.textContent = `${next}번 · 새 광장`; select.append(option);
}
function addPlayer(player) {
  const previous = state.players.get(player.id);
  const merged = { ...previous, ...player };
  if (previous?.node) { merged.node = previous.node; merged.displayX = previous.displayX; merged.displayY = previous.displayY; }
  state.players.set(player.id, merged);
  state.scene?.drawPlayer(merged, previous);
}
function clearPlayers() {
  for (const player of state.players.values()) player.node?.destroy();
  state.players.clear();
}
function received(message) {
  if (message.villageId && message.villageId !== state.villageId) return;
  if (message.channelId && message.type !== 'welcome' && message.channelId !== state.channelId) return;
  if (message.type === 'welcome') {
    clearPlayers(); state.selfId = message.selfId; state.channelId = message.channelId; state.goal = null;
    applyVillage(message.village);
    for (const player of message.players || []) addPlayer(player);
    if (message.village.mapPath !== state.mapPath) void loadWorld(message.village.mapPath).catch(error => status(error.message, true));
    setChannels(message.channels); byId('connection-status').textContent = `${message.village.name} ${message.channelId}번 광장에 도착했어요. 바닥을 누르면 걸어요.`;
    byId('chat-log').replaceChildren(); state.scene?.followSelf(); renderPeople();
  } else if (message.type === 'channels') {
    setChannels(message.channels);
  } else if (message.type === 'notice') {
    status(message.message);
  } else if (message.type === 'snapshot') {
    for (const player of message.players || []) addPlayer(player);
    for (const id of message.removed || []) { state.players.get(id)?.node?.destroy(); state.players.delete(id); }
    if (message.channels) setChannels(message.channels);
    if (byId('people-dialog').open) renderPeople();
  } else if (message.type === 'chat') {
    if (state.session.user.ageBand === 'under14' && message.kind !== 'phrase') return;
    if (state.blocked.has(message.userId)) return;
    const row = document.createElement('p'); row.className = 'chat-row';
    const name = document.createElement('strong'); name.textContent = message.name; row.append(name, document.createTextNode(message.text));
    const log = byId('chat-log'); log.append(row); while (log.children.length > 100) log.firstElementChild.remove(); log.scrollTop = log.scrollHeight;
    state.scene?.bubble(message.userId, message.text, 5000);
  } else if (message.type === 'emote') {
    if (!state.blocked.has(message.userId)) state.scene?.bubble(message.userId, emoteSymbols[message.id] || '♪', 2500);
  } else if (message.type === 'correction') {
    const self = state.players.get(state.selfId); if (self) { self.x = message.x; self.y = message.y; self.displayX = message.x; self.displayY = message.y; self.moving = false; }
    state.goal = null; status(message.message || '걸어갈 수 있는 길로 다시 이동해 주세요.', true);
  } else if (message.type === 'shutdown') {
    byId('connection-status').textContent = message.message || '잠시 뒤 다시 연결할게요.';
  } else if (message.type === 'error') { if (!showAdmission(message)) status(message.message, true); }
}
function showAdmission(error) {
  if (!['VILLAGE_NOT_OPEN', 'VILLAGE_GUARDIAN_CONSENT_REQUIRED'].includes(error.code)) return false;
  state.stopped = true; clearTimeout(state.reconnect); state.socket?.close();
  byId('entry-message').textContent = error.message; byId('entry-panel').hidden = false;
  byId('village-play').hidden = true; byId('login-panel').hidden = true;
  byId('tour-controls').hidden = true;
  byId('connection-status').textContent = error.message;
  if (byId('wardrobe-dialog').open) byId('wardrobe-dialog').close();
  return true;
}
function applyVillage(village) {
  state.villageId = village.id; state.requestedMapPath = village.mapPath;
  document.documentElement.style.setProperty('--green', village.accent);
  document.documentElement.dataset.village = village.id;
  byId('village-title').textContent = village.name; document.title = `${village.name} · 분수 광장`;
  configureChat();
  byId('village-play').setAttribute('aria-label', `${village.name} 분수 광장`);
  const operator = state.session.user.isOperator === true;
  byId('operator-label').hidden = !operator; byId('tour-controls').hidden = !operator;
  if (operator) {
    const select = byId('tour-select'); select.replaceChildren();
    for (const item of state.session.villages) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === village.id; select.append(option);
    }
  }
}
function configureChat() {
  const free = state.villageId === 'general' && state.session.user.canFreeChat === true;
  byId('child-chat-note').hidden = free; byId('chat-slot').hidden = !free;
  if (free === Boolean(byId('chat-form'))) return;
  const slot = byId('chat-slot'); slot.replaceChildren();
  if (!free) return;
  slot.append(byId('chat-template').content.cloneNode(true));
  const form = byId('chat-form'), input = byId('chat-input');
  form.addEventListener('submit', event => { event.preventDefault(); if (input.dataset.composing === 'true') return; const text = input.value.trim(); if (text && send({ type: 'chat', text })) input.value = ''; });
  input.addEventListener('compositionstart', () => input.dataset.composing = 'true');
  input.addEventListener('compositionend', () => input.dataset.composing = 'false');
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault(); });
}
let worldChange = Promise.resolve();
function loadWorld(path) {
  worldChange = worldChange.catch(() => {}).then(async () => {
    if (state.mapPath === path && state.game) return;
    let map;
    if (path === '/assets/village/maps/plaza.json') {
      const response = await fetch('/assets/village/maps/plaza.json');
      if (!response.ok) throw new Error('광장 지도를 불러오지 못했어요.');
      map = await response.json();
    } else map = (await api('/village/map')).map;
    if (state.requestedMapPath !== path) return;
    if (state.game) {
      state.scene = null;
      const old = state.game;
      await new Promise(resolve => { old.events.once('destroy', resolve); old.destroy(true); });
      for (const player of state.players.values()) { player.node = null; player.bubble = null; }
    }
    state.map = map; state.mapPath = path; state.game = createWorld(map);
  });
  return worldChange;
}
function connect() {
  if (state.stopped) return;
  clearTimeout(state.reconnect); byId('connection-status').textContent = '광장과 연결하고 있어요.';
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/village/ws`); state.socket = socket;
  socket.addEventListener('open', () => { state.retries = 0; });
  socket.addEventListener('message', event => { try { received(JSON.parse(event.data)); } catch { status('마을 소식을 읽지 못했어요. 다시 연결해 주세요.', true); } });
  socket.addEventListener('close', event => {
    if (state.socket !== socket || state.stopped) return;
    if ([4002, 4009, 4409].includes(event.code)) { state.stopped = true; byId('connection-status').textContent = '다른 창에서 입장해 이 창의 연결을 마쳤어요. 다시 입장하려면 새로고침해 주세요.'; return; }
    if ([4001, 4003, 4401, 4403].includes(event.code)) { state.stopped = true; byId('connection-status').textContent = '회원 정보를 다시 확인해 주세요.'; byId('login-panel').hidden = false; return; }
    const wait = Math.min(30000, 1000 * 2 ** Math.min(state.retries++, 5));
    byId('connection-status').textContent = `연결이 잠시 끊겼어요. ${Math.ceil(wait / 1000)}초 뒤 다시 연결할게요.`;
    state.reconnect = setTimeout(async () => {
      try { const current = await api('/village/session'); if (!current.user) { state.stopped = true; byId('login-panel').hidden = false; byId('connection-status').textContent = '로그인한 뒤 다시 입장해 주세요.'; return; } state.session = current; applyVillage(current.village); connect(); }
      catch (error) { if (showAdmission(error)) return; if ([401, 403].includes(error.status)) { state.stopped = true; byId('login-panel').hidden = false; byId('connection-status').textContent = '로그인한 뒤 다시 입장해 주세요.'; } else connect(); }
    }, wait);
  });
  socket.addEventListener('error', () => { byId('connection-status').textContent = '마을 연결을 확인하고 있어요.'; });
}
function moveTo(goal) {
  if (byId('wardrobe-dialog').open || byId('people-dialog').open || byId('report-dialog').open) return;
  const self = state.players.get(state.selfId); if (!self || !state.map) return;
  const start = { x: Math.round(self.x), y: Math.round(self.y) };
  const path = findPath(state.map, start, goal);
  if (!path.length) { if (goal.x !== start.x || goal.y !== start.y) status('그곳에는 걸어갈 수 없어요. 빈 바닥을 골라 주세요.'); return; }
  state.goal = goal; if (send({ type: 'move', path: path.slice(0, 120) })) { status(''); state.scene?.markTarget(goal); }
}
function avatarFromForm() {
  const fields = new FormData(byId('wardrobe-form'));
  return { v: 1, kind: 'placeholder', colors: { skin: fields.get('skin'), hair: fields.get('hair'), outfit: fields.get('outfit') } };
}
function previewAvatar() {
  const data = avatarFromForm();
  for (const [key, value] of Object.entries(data.colors)) byId('wardrobe-preview').style.setProperty(`--${key}`, value);
}
function openWardrobe() {
  const fields = byId('wardrobe-fields'); fields.replaceChildren();
  const labels = { skin: '피부', hair: '머리', outfit: '옷' };
  for (const [key, colors] of Object.entries(state.session.palette)) {
    const field = document.createElement('fieldset'); field.className = 'color-field'; const legend = document.createElement('legend'); legend.textContent = labels[key]; field.append(legend);
    const options = document.createElement('div'); options.className = 'color-options';
    colors.forEach((color, index) => { const label = document.createElement('label'), input = document.createElement('input'), swatch = document.createElement('span'); input.type = 'radio'; input.name = key; input.value = color; input.required = true; input.checked = color === (state.avatar?.colors[key] || colors[0]); input.setAttribute('aria-label', `${labels[key]} ${index + 1}번 색`); swatch.style.backgroundColor = color; label.append(input, swatch); options.append(label); });
    field.append(options); fields.append(field);
  }
  byId('wardrobe-save').textContent = state.revision ? '색 저장하기' : '저장하고 입장'; byId('wardrobe-cancel').hidden = !state.revision;
  byId('wardrobe-status').textContent = ''; previewAvatar(); byId('wardrobe-dialog').showModal();
}
function openWardrobeAfterConflict() {
  for (const input of byId('wardrobe-fields').querySelectorAll('input')) input.checked = input.value === state.avatar?.colors[input.name];
  previewAvatar(); byId('wardrobe-status').textContent = '다른 창에서 색이 바뀌었어요. 최신 색을 확인한 뒤 다시 골라 주세요.';
}
async function renderBlocks() {
  const list = byId('blocked-list'); list.replaceChildren();
  const data = await api('/village/blocks'); const items = data.blocks || [];
  state.blocked = new Set(items.map(item => typeof item === 'string' ? item : item.targetId || item.id));
  for (const item of items) {
    const id = typeof item === 'string' ? item : item.targetId || item.id;
    const row = document.createElement('div'); row.className = 'person-row'; const name = document.createElement('span'); name.textContent = item.name || '차단한 주민';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '차단 해제'; button.addEventListener('click', async () => { button.disabled = true; try { await api('/village/blocks', { targetId: id }, 'DELETE'); state.blocked.delete(id); await renderBlocks(); renderPeople(); status('차단을 해제했어요.'); } catch (error) { status(error.message, true); button.disabled = false; } }); row.append(name, button); list.append(row);
  }
  if (!items.length) list.textContent = '차단한 주민이 없어요.';
}
let reportTarget = null;
function renderPeople() {
  const list = byId('people-list'); list.replaceChildren();
  for (const player of state.players.values()) {
    const row = document.createElement('div'); row.className = 'person-row'; const name = document.createElement('span'); name.textContent = `${player.name}${player.isOperator ? ' · 운영자' : ''}${player.id === state.selfId ? ' (나)' : ''}`; row.append(name);
    if (player.id !== state.selfId) {
      const block = document.createElement('button'); block.type = 'button'; block.textContent = state.blocked.has(player.id) ? '차단 중' : '차단'; block.disabled = state.blocked.has(player.id);
      block.addEventListener('click', async () => { block.disabled = true; try { await api('/village/blocks', { targetId: player.id }); state.blocked.add(player.id); player.bubble?.destroy(); renderPeople(); await renderBlocks(); status(`${player.name} 님을 차단했어요.`); } catch (error) { block.disabled = false; status(error.message, true); } });
      const report = document.createElement('button'); report.type = 'button'; report.textContent = '신고'; report.addEventListener('click', () => { reportTarget = player.id; byId('report-target').textContent = `${player.name} 님을 신고해요.`; byId('report-form').reset(); byId('report-dialog').showModal(); }); row.append(block, report);
    }
    list.append(row);
  }
}

function createWorld(map) {
  const Phaser = window.Phaser, font = getComputedStyle(document.body).fontFamily;
  const halfW = 24, halfH = 14, originX = map.height * halfW + 80, originY = 80;
  const iso = (x, y) => ({ x: originX + (x - y) * halfW, y: originY + (x + y) * halfH });
  const fromIso = (x, y) => ({ x: Math.round(((x - originX) / halfW + (y - originY) / halfH) / 2), y: Math.round(((y - originY) / halfH - (x - originX) / halfW) / 2) });
  const property = (object, key) => object.properties?.find(prop => prop.name === key)?.value;
  const worldWidth = (map.width + map.height) * halfW + 160, worldHeight = (map.width + map.height) * halfH + 200;
  class Plaza extends Phaser.Scene {
    preload() { this.load.image('owl', '/assets/slime-race/art/owl-host.png'); }
    create() {
      state.scene = this;
      this.cameras.main.setBackgroundColor('#cbd7b4'); this.cameras.main.setBounds(0, 0, worldWidth, worldHeight); this.cameras.main.setZoom(innerWidth < 741 ? 1 : 1.12);
      const floor = map.layers.find(layer => layer.name === 'ground').data;
      const graphic = this.add.graphics();
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const position = iso(x, y); const paved = floor[y * map.width + x] === 1; const tint = paved ? ((x + y) % 3 ? 0xe7dec9 : 0xeee6d4) : ((x + y) % 4 ? 0xb9cba3 : 0xc2d3ad);
        graphic.fillStyle(tint).lineStyle(.5, paved ? 0xd6cdb8 : 0xafc399, .65); graphic.beginPath(); graphic.moveTo(position.x, position.y - halfH); graphic.lineTo(position.x + halfW, position.y); graphic.lineTo(position.x, position.y + halfH); graphic.lineTo(position.x - halfW, position.y); graphic.closePath(); graphic.fillPath(); graphic.strokePath();
      }
      this.drawFountain(); this.drawDecor(iso);
      for (const object of map.layers.find(layer => layer.name === 'doors').objects) {
        const at = iso(object.x / map.tilewidth, object.y / map.tileheight), container = this.add.container(at.x, at.y).setDepth(at.y);
        const art = this.add.graphics(); art.fillStyle(0x756650,.15).fillEllipse(0, 6, 85, 24); art.fillStyle(0xe7cfaf).fillRoundedRect(-31, -65, 62, 66, 10); art.fillStyle(0xb58c74).fillRoundedRect(-19, -52, 38, 52, 16); art.lineStyle(3, 0xf5e9ce).strokeRoundedRect(-29, -65, 58, 66, 10); art.fillStyle(0xe0ba79).fillCircle(10,-22,3);
        const sign = this.add.text(0, -82, property(object, 'label') || object.name, { fontFamily: font, fontSize: '13px', color: '#5c5748', backgroundColor: '#fff5dd', padding: { x: 7, y: 5 } }).setOrigin(.5);
        container.add([art, sign]);
      }
      for (const object of map.layers.find(layer => layer.name === 'npcs').objects) { const at = iso(object.x / map.tilewidth, object.y / map.tileheight); this.add.ellipse(at.x, at.y, 38, 14, 0x69724f, .18).setDepth(at.y); this.add.image(at.x, at.y - 25, 'owl').setDisplaySize(54, 60).setDepth(at.y + 1); this.add.text(at.x, at.y + 16, object.name, { fontFamily: font, fontSize: '11px', color: '#596148', backgroundColor: '#fff8e7', padding: {x:5,y:3} }).setOrigin(.5).setDepth(at.y + 2); }
      this.target = this.add.graphics().setDepth(1);
      this.input.on('pointerdown', pointer => { byId('village-game').focus({ preventScroll: true }); const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y); moveTo(fromIso(point.x, point.y)); });
      this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D'); this.input.keyboard.removeCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'W', 'A', 'S', 'D']);
      this.keyAt = 0; this.nearbyAt = 0; this.nearbyId = null; this.npcBubble = null;
      for (const player of state.players.values()) this.drawPlayer(player);
      this.followSelf(); byId('recenter').onclick = () => this.followSelf();
      this.game.scale.on('resize', () => this.cameras.main.setZoom(innerWidth < 741 ? 1 : 1.12));
    }
    drawFountain() {
      const p = iso(19.5, 14), c = this.add.container(p.x, p.y).setDepth(p.y + 45), art = this.add.graphics();
      art.fillStyle(0x697a64,.16).fillEllipse(0,19,230,96); art.fillStyle(0xb4ad9d).fillEllipse(0,0,223,113); art.fillStyle(0xd7d3bd).fillEllipse(0,-10,223,106); art.fillStyle(0x8bbac0).fillEllipse(0,-12,187,76); art.lineStyle(3,0xc8e7dc,.8).strokeEllipse(0,-16,150,47);
      art.fillStyle(0xd9d6bf).fillRoundedRect(-11,-86,22,81,5).fillEllipse(0,-77,93,32); art.fillStyle(0x9dc9cd).fillEllipse(0,-84,80,22); art.fillStyle(0xe5dfc6).fillRoundedRect(-7,-128,14,49,6).fillEllipse(0,-130,47,16);
      art.lineStyle(3,0xd6f0e9,.8); for (const sign of [-1,1]) { art.beginPath(); art.moveTo(sign*7,-131); art.lineTo(sign*28,-116); art.lineTo(sign*39,-86); art.strokePath(); } c.add(art);
      const glint = this.add.ellipse(0,-133,9,5,0xe2f5ea,.9); c.add(glint); if (!reducedMotion) this.tweens.add({ targets: glint, scaleX: 1.4, scaleY:.7, alpha:.45, duration:1200, yoyo:true, repeat:-1, ease:'Sine.easeInOut' });
    }
    drawDecor(project) {
      for (const object of map.layers.find(layer => layer.name === 'decor')?.objects || []) {
        const p = project(object.x / map.tilewidth, object.y / map.tileheight), art = this.add.graphics().setPosition(p.x,p.y).setDepth(p.y);
        if (object.type === 'tree') { art.fillStyle(0x70845b,.15).fillEllipse(4,2,68,27); art.fillStyle(0x9d8362).fillRoundedRect(-6,-49,12,48,4); art.fillStyle(0x95ae7b).fillCircle(0,-64,30).fillCircle(-18,-49,23).fillCircle(20,-53,23); art.fillStyle(0xaac18d).fillCircle(-9,-70,19); art.fillStyle(0xe3c7a2).fillCircle(14,-62,3).fillCircle(-18,-51,3); }
        else { art.lineStyle(5,0x88745f).lineBetween(-25,-8,-25,5).lineBetween(25,-8,25,5); art.fillStyle(0xc59d76).fillRoundedRect(-34,-23,68,12,3).fillRoundedRect(-34,-9,68,9,3); }
      }
    }
    drawPlayer(player, previous) {
      if (!player.node) {
        const p = iso(player.x,player.y); player.node = this.add.container(p.x,p.y); player.avatarNode = this.add.container(0,0); player.parts = drawAvatar(player.avatarNode, player.avatar); player.label = this.add.text(0,13,`${player.name}${player.isOperator ? ' · 운영자' : ''}${player.id === state.selfId ? ' · 나' : ''}`, { fontFamily:font,fontSize:'11px',color:player.id===state.selfId?'#574572':'#58634c',backgroundColor:'#fffaf0de',padding:{x:5,y:3} }).setOrigin(.5,0); player.node.add([player.avatarNode,player.label]); player.displayX = player.x; player.displayY = player.y;
      } else if (JSON.stringify(previous?.avatar) !== JSON.stringify(player.avatar)) player.parts = drawAvatar(player.avatarNode, player.avatar);
    }
    followSelf() { const self = state.players.get(state.selfId); if (self?.node) this.cameras.main.startFollow(self.node, true, reducedMotion ? 1 : .12, reducedMotion ? 1 : .12, 0, 20); }
    markTarget(goal) { const p = iso(goal.x,goal.y); this.target.clear().lineStyle(2,0x7d8b64,.7).strokeEllipse(p.x,p.y,35,17); }
    bubble(id,text,duration) {
      const player = state.players.get(id); if (!player?.node) return; player.bubble?.destroy();
      const bubble = this.add.text(0,-78,text,{fontFamily:font,fontSize:'12px',color:'#514b42',backgroundColor:'#fffaf3',padding:{x:10,y:8},wordWrap:{width:180},align:'center'}).setOrigin(.5,1); player.node.add(bubble); player.bubble = bubble; this.time.delayedCall(duration, () => { if (player.bubble === bubble) { bubble.destroy(); player.bubble = null; } });
    }
    update(time,delta) {
      for (const player of state.players.values()) {
        if (!player.node) continue;
        const dx = player.x - player.displayX, dy = player.y - player.displayY, moving = Math.abs(dx)+Math.abs(dy)>.025;
        const factor = Math.min(1,delta/85); player.displayX += dx*factor; player.displayY += dy*factor;
        const p = iso(player.displayX,player.displayY); if (Math.abs(dx-dy)>.01) player.avatarNode.scaleX = dx-dy < 0 ? -1 : 1;
        player.node.setPosition(p.x,p.y).setDepth(p.y+2);
        // 한 걸음 250ms 루프: 아크 + 스쿼시 앤 스트레치, 그림자는 보조 동작이다.
        const hop = moving && !reducedMotion ? Math.abs(Math.sin(time/250*Math.PI))*5 : 0;
        player.parts.body.y = -hop; player.parts.body.setScale(1-hop*.008,1+hop*.008); player.parts.shadow.setScale(1-hop*.045,1-hop*.025);
      }
      const self = state.players.get(state.selfId); if (!self) return;
      const focused = document.activeElement; const typing = focused && ['INPUT','TEXTAREA','SELECT','BUTTON'].includes(focused.tagName);
      if (!typing && !byId('wardrobe-dialog').open && !byId('people-dialog').open && !byId('report-dialog').open && time-this.keyAt>260) {
        let x=0,y=0; if(this.keys.LEFT.isDown||this.keys.A.isDown)x=-1; else if(this.keys.RIGHT.isDown||this.keys.D.isDown)x=1; else if(this.keys.UP.isDown||this.keys.W.isDown)y=-1; else if(this.keys.DOWN.isDown||this.keys.S.isDown)y=1;
        if(x||y){this.keyAt=time;moveTo({x:Math.round(self.x)+x,y:Math.round(self.y)+y});}
      }
      if (time-this.nearbyAt>400) { this.nearbyAt=time; let nearby=null;
        for (const layer of map.layers.filter(item=>['doors','npcs'].includes(item.name))) for(const object of layer.objects){const x=object.x/map.tilewidth,y=object.y/map.tileheight;if(Math.abs(self.x-x)+Math.abs(self.y-y)<=3)nearby={layer:layer.name,object};}
        const id=nearby?.object.id; if(id!==this.nearbyId){this.nearbyId=id;this.npcBubble?.destroy();this.npcBubble=null;if(nearby){const text=nearby.layer==='doors'?`${property(nearby.object,'label')||nearby.object.name} · 준비 중이에요. 곧 만나요!`:property(nearby.object,'message');byId('world-tip').textContent=text;if(nearby.layer==='npcs'){const p=iso(nearby.object.x/map.tilewidth,nearby.object.y/map.tileheight);this.npcBubble=this.add.text(p.x,p.y-65,text,{fontFamily:font,fontSize:'12px',color:'#514b42',backgroundColor:'#fffaf3',padding:{x:10,y:8},wordWrap:{width:180},align:'center'}).setOrigin(.5,1).setDepth(p.y+10);}}else byId('world-tip').textContent='바닥을 톡 눌러 걸어 보세요.';}
      }
    }
  }
  const host = byId('village-game');
  return new Phaser.Game({type:Phaser.AUTO,parent:host,width:host.clientWidth,height:host.clientHeight,backgroundColor:'#cbd7b4',scene:Plaza,render:{antialias:true},scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},audio:{noAudio:true},input:{keyboard:{target:host}},banner:false});
}

byId('tour-start').addEventListener('click', () => send({ type: 'tour', villageId: byId('tour-select').value }));
byId('wardrobe-fields').addEventListener('change',previewAvatar);
byId('village-game').addEventListener('keydown',event=>{if(event.target===byId('village-game')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))event.preventDefault();});
byId('wardrobe-form').addEventListener('submit',async event=>{
  event.preventDefault(); const button=byId('wardrobe-save');button.disabled=true;
  try{const data=await api('/village/avatar',{avatar:avatarFromForm(),revision:state.revision},'PUT');state.avatar=data.avatar.data;state.revision=data.avatar.revision;byId('wardrobe-dialog').close();if(!state.socket)connect();status('마을에서 입을 색을 저장했어요.');}
  catch(error){if(!showAdmission(error)){byId('wardrobe-status').textContent=error.message;if(error.status===409){try{const fresh=await api('/village/session');state.avatar=fresh.avatar?.data;state.revision=fresh.avatar?.revision||0;openWardrobeAfterConflict();}catch(refreshError){if(!showAdmission(refreshError))byId('wardrobe-status').textContent=`최신 색을 확인하지 못했어요. ${refreshError.message}`;}}}}
  finally{button.disabled=false;}
});
byId('wardrobe-dialog').addEventListener('cancel',event=>{if(!state.revision)event.preventDefault();});
byId('wardrobe-cancel').addEventListener('click',()=>byId('wardrobe-dialog').close());byId('wardrobe-open').addEventListener('click',openWardrobe);
byId('channel-change').addEventListener('click',()=>{const channelId=Number(byId('channel-select').value);if(channelId!==state.channelId)send({type:'channel',villageId:state.villageId,channelId});});
byId('people-open').addEventListener('click',async()=>{renderPeople();byId('people-dialog').showModal();try{await renderBlocks();renderPeople();}catch(error){status(error.message,true);}});byId('people-close').addEventListener('click',()=>byId('people-dialog').close());byId('report-cancel').addEventListener('click',()=>byId('report-dialog').close());
byId('report-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;try{await api('/village/reports',{targetId:reportTarget,reason:byId('report-reason').value.trim()});byId('report-dialog').close();status('신고를 접수했어요. 운영자가 확인할게요.');}catch(error){status(error.message,true);}finally{button.disabled=false;}});
window.addEventListener('pagehide',()=>{state.stopped=true;clearTimeout(state.reconnect);state.socket?.close();});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
async function initialize(){
  if(window.gracekinCommunityRedirecting)return;
  try{
    state.session=await api('/village/session');if(!state.session.user){byId('login-panel').hidden=false;byId('connection-status').textContent='로그인하면 마을에 들어갈 수 있어요.';return;}
    applyVillage(state.session.village);
    state.avatar=state.session.avatar?.data;state.revision=state.session.avatar?.revision||0;
    byId('village-play').hidden=false;
    byId('phrase-buttons').replaceChildren();byId('emote-buttons').replaceChildren();
    for(const phrase of state.session.phrases){const button=document.createElement('button');button.type='button';button.textContent=phrase.text;button.addEventListener('click',()=>send({type:'phrase',id:phrase.id}));byId('phrase-buttons').append(button);}
    for(const emote of state.session.emotes){const button=document.createElement('button');button.id=`emote-${emote.id}`;button.type='button';button.textContent=emote.label;button.addEventListener('click',()=>send({type:'emote',id:emote.id}));byId('emote-buttons').append(button);}
    setChannels(state.session.channels);await renderBlocks();if(!window.Phaser&&document.readyState!=='complete')await new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));if(!window.Phaser)throw new Error('마을 그림 도구를 불러오지 못했어요.');await loadWorld(state.session.village.mapPath);
    if(!state.revision)openWardrobe();else connect();
  }catch(error){if(showAdmission(error))return;byId('connection-status').textContent=error.message;if(error.status===401||error.status===403){byId('login-panel').hidden=false;status('회원 정보를 확인한 뒤 다시 입장해 주세요.');}else status('새로고침해 다시 입장해 주세요.',true);}
}
initialize();
