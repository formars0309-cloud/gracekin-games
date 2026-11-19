/* 캐릭터 부품 합성. 색 계산과 층 선택은 브라우저 없이도 시험할 수 있다. */
export const LAYER_ORDER = Object.freeze(['back', 'hairBack', 'body', 'outfit', 'hairFront', 'ears']);
const manifests = new Map(), images = new Map(), tinted = new Map(), requests = new WeakMap();
const clamp = value => Math.min(1, Math.max(0, value));

export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = (max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6;
  return [h, max ? delta / max : 0, max];
}
export function hsvToRgb([h, s, v]) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v,t,p], [q,v,p], [p,v,t], [p,q,v], [t,p,v], [v,p,q]][((i % 6) + 6) % 6].map(value => Math.round(value * 255));
}
const median = values => { values.sort((a,b) => a-b); const i = Math.floor(values.length / 2); return values.length % 2 ? values[i] : (values[i-1] + values[i]) / 2; };

export function recolorPixels(source, mask, target) {
  if (source.length !== mask.length || source.length % 4) throw new Error('그림과 색 영역 크기가 달라요.');
  const out = new Uint8ClampedArray(source), values = [], saturations = [];
  const eligible = i => source[i+3] > 0 && mask[i+3] > 0 && mask[i] > 0;
  for (let i = 0; i < source.length; i += 4) {
    if (!eligible(i)) continue;
    const [,s,v] = rgbToHsv(source.slice(i, i+3));
    if (v > .22 && s > .12) { values.push(v); saturations.push(s); }
  }
  if (!values.length) return out;
  const mv = median(values), ms = median(saturations), [ht,st,vt] = rgbToHsv(target);
  for (let i = 0; i < source.length; i += 4) {
    if (!eligible(i)) continue;
    const [,s,v] = rgbToHsv(source.slice(i, i+3));
    if (v <= .22 || s <= .12) continue;
    const rgb = hsvToRgb([ht, clamp(s / ms * Math.max(st,.04)), clamp(v / mv * vt)]), weight = mask[i] / 255 * mask[i+3] / 255;
    for (let channel = 0; channel < 3; channel++) out[i+channel] = source[i+channel] * (1-weight) + rgb[channel] * weight;
  }
  return out;
}

export function characterLayers(manifest, data) {
  const race = manifest.races[data.race], hair = manifest.hair[data.appearance.hair], outfit = manifest.outfits[data.job];
  if (!race || !hair || !outfit) throw new Error('선택한 캐릭터의 그림을 찾지 못했어요.');
  const color = (palette, id) => {
    if (id === null) return null;
    const item = manifest.palettes[palette]?.find(item => item.id === id);
    if (!item) throw new Error('선택한 색을 찾지 못했어요.');
    return item.rgb;
  };
  const a = data.appearance;
  const layers = {
    back: { image: race.back }, hairBack: { image: hair.back, masks: [[hair.backMask, color('hair', a.hairColor)]] },
    body: { image: race.body, masks: [[race.skinMask, color('skin', a.skin)], [race.eyeMask, color('eye', a.eyeColor)]] },
    outfit: { image: outfit.image, masks: [[outfit.accentMask, color('accent', a.outfitColor)]] },
    hairFront: { image: hair.front, masks: [[hair.mask, color('hair', a.hairColor)]] }, ears: { image: race.ears },
  };
  return (manifest.order || LAYER_ORDER).map(name => ({ name, ...layers[name] })).filter(layer => layer.image);
}
function limitedCache(cache, key, value, limit = 48) {
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  value.catch(() => { if (cache.get(key) === value) cache.delete(key); });
  return value;
}
export function loadCharacterArt(baseUrl = '/assets/character/') {
  const base = new URL(baseUrl, globalThis.location?.href || 'http://localhost/').href;
  if (new URL(base).origin !== new URL(globalThis.location?.href || 'http://localhost/').origin || !base.endsWith('/')) throw new Error('같은 사이트의 캐릭터 그림 주소를 사용해 주세요.');
  if (manifests.has(base)) return manifests.get(base);
  return limitedCache(manifests, base, (async () => {
    const response = await fetch(new URL('manifest.json', base), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('캐릭터 그림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    const manifest = await response.json();
    if (manifest.v !== 1 || !Number.isInteger(manifest.canvas?.w) || !Number.isInteger(manifest.canvas?.h) || manifest.canvas.w <= 0 || manifest.canvas.h <= 0 || manifest.canvas.w > 2048 || manifest.canvas.h > 3072 || !manifest.races || !manifest.hair || !manifest.outfits || !manifest.palettes || (manifest.order && manifest.order.join() !== LAYER_ORDER.join())) throw new Error('캐릭터 그림 형식을 확인하지 못했어요.');
    return { manifest, baseUrl: base };
  })());
}
function imageUrl(base, path) {
  const url = new URL(path, base);
  if (!url.href.startsWith(base) || url.origin !== new URL(base).origin) throw new Error('캐릭터 그림 주소를 확인하지 못했어요.');
  return url.href;
}
function loadImage(url) {
  if (images.has(url)) return images.get(url);
  return limitedCache(images, url, new Promise((resolve, reject) => {
    const img = new Image(), timer = setTimeout(() => { img.src = ''; reject(new Error('캐릭터 그림 응답이 늦어지고 있어요.')); }, 15000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('캐릭터 부품을 불러오지 못했어요.')); };
    img.src = url;
  }));
}
function surface(w,h) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return canvas; }
async function paintLayer(art, layer) {
  const { w,h } = art.manifest.canvas;
  const url = imageUrl(art.baseUrl, layer.image), masks = (layer.masks || []).filter(([path,color]) => path && color);
  if (!masks.length) return loadImage(url);
  const key = JSON.stringify([url,masks]);
  if (tinted.has(key)) return tinted.get(key);
  return limitedCache(tinted, key, (async () => {
    const canvas = surface(w,h), ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(await loadImage(url),0,0,w,h);
    for (const [path,color] of masks) {
      const maskCanvas = surface(w,h), maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      maskCtx.drawImage(await loadImage(imageUrl(art.baseUrl,path)),0,0,w,h);
      const pixels = ctx.getImageData(0,0,w,h);
      pixels.data.set(recolorPixels(pixels.data, maskCtx.getImageData(0,0,w,h).data, color));
      ctx.putImageData(pixels,0,0);
    }
    return canvas;
  })(), 24);
}
export async function renderCharacter(canvas, data, { mode = 'full', size, art } = {}) {
  const request = {}; requests.set(canvas, request);
  art ||= await loadCharacterArt();
  const { manifest } = art, { w,h } = manifest.canvas;
  const layers = await Promise.all(characterLayers(manifest,data).map(layer => paintLayer(art,layer)));
  if (requests.get(canvas) !== request) return false;
  const composite = surface(w,h), ctx = composite.getContext('2d');
  for (const layer of layers) ctx.drawImage(layer,0,0,w,h);
  const portrait = manifest.portrait;
  if (mode === 'portrait' && (!portrait || portrait.size <= 0 || portrait.x < 0 || portrait.y < 0 || portrait.x + portrait.size > w || portrait.y + portrait.size > h)) throw new Error('초상화 영역을 확인하지 못했어요.');
  canvas.width = Math.max(1, Math.round(size || (mode === 'portrait' ? 64 : w)));
  canvas.height = mode === 'portrait' ? canvas.width : Math.round(canvas.width*h/w);
  const target = canvas.getContext('2d'); target.clearRect(0,0,canvas.width,canvas.height);
  if (mode === 'portrait') target.drawImage(composite,portrait.x,portrait.y,portrait.size,portrait.size,0,0,canvas.width,canvas.height);
  else target.drawImage(composite,0,0,canvas.width,canvas.height);
  return true;
}
