import { BONE } from './sculpt.js';

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function product(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  return out;
}
function shift(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function scale(x, y, z) {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}
function rotate(axis, t) {
  const m = identity(),
    a = (axis + 1) % 3,
    b = (axis + 2) % 3,
    c = Math.cos(t),
    s = Math.sin(t);
  m[a * 4 + a] = c;
  m[a * 4 + b] = s;
  m[b * 4 + a] = -s;
  m[b * 4 + b] = c;
  return m;
}
function joint(p, x, y, z) {
  const turn = product(rotate(1, y), product(rotate(2, z), rotate(0, x)));
  return product(shift(...p), product(turn, shift(-p[0], -p[1], -p[2])));
}

export function pose(model, { angle, time, cycle, motion, mode, view, width, height }) {
  const face = view === 'face',
    walking = motion === 'walk',
    phase = cycle === undefined ? time * 4.6 : cycle * 2 * Math.PI;
  const rhythm = walking ? Math.sin(phase) : 0,
    breath = cycle === undefined ? Math.sin(time * 1.86) : Math.cos(phase);
  const pitch = face ? 0.042 : mode === 'board' ? 0.278 : mode === 'rpg' ? 0.165 : 0.104;
  // 정수리와 모자 끝은 실제 조형에서 읽고 얼굴 배율에 맞춰 어깨까지 담는다.
  const top = face ? model.crown + 0.16 * model.headScale : model.figureTop + 0.14;
  const bottom = face ? model.headY - 1.22 * model.headScale : 0;
  const hasPlinth = mode === 'board' || mode === 'studio';
  const floorSpace = hasPlinth ? 0.22 + 0.79 * Math.sin(pitch) : 0.14;
  const upper = top * model.scaleY;
  const lower = face ? bottom * model.scaleY : -floorSpace;
  const span = face ? 1.64 * model.headScale : 2.74;
  const portion = Math.max(upper - lower, span * height / width);
  const center = (upper + lower) * 0.5;
  const observer = product(rotate(0, pitch), rotate(1, angle));
  const camera = product(shift(0, -center * Math.cos(pitch), 0), observer);
  const body = product(camera, scale(1, model.scaleY, 1));
  const lift = walking ? 0.036 * (1 - Math.cos(phase * 2)) * 0.5 : 0.005 * breath;
  const base = product(body, shift(walking ? 0.031 * rhythm : 0.009, lift, 0));
  const bones = Array(12);
  const put = (id, parent, x = 0, y = 0, z = 0) => {
    bones[id] = product(parent, joint(model.pivots[id], x, y, z));
  };
  bones[BONE.floor] = camera;
  put(
    BONE.chest,
    base,
    walking ? 0.038 : 0.006 * breath,
    0.016 + rhythm * 0.075,
    walking ? 0.023 * rhythm : 0.008 * breath,
  );
  put(BONE.head, bones[BONE.chest], 0.006 * breath, -0.047 * rhythm + 0.012 * breath, 0.012 + 0.014 * rhythm);
  put(BONE.cape, bones[BONE.chest], walking ? -0.105 - 0.055 * Math.cos(phase * 2) : -0.012 * (1 + breath));
  for (const s of [-1, 1]) {
    const arm = s < 0 ? BONE.leftArm : BONE.rightArm,
      elbow = s < 0 ? BONE.leftElbow : BONE.rightElbow;
    const hip = s < 0 ? BONE.leftHip : BONE.rightHip,
      knee = s < 0 ? BONE.leftKnee : BONE.rightKnee;
    // 지팡이를 든 손은 보폭을 따라 작게 움직이고 지팡이 끝은 어깨 위에 머무른다.
    const staffArm = model.carriesStaff && s < 0;
    put(
      arm,
      bones[BONE.chest],
      s * rhythm * (staffArm ? 0.19 : 0.29) + (s < 0 ? 0.083 : -0.032),
      s * 0.045,
      s * (0.058 + 0.012 * breath),
    );
    const bend = s < 0 && !staffArm ? -0.19 : -0.1;
    put(elbow, bones[arm], bend - Math.max(0, -s * rhythm) * (staffArm ? 0.08 : 0.15));
    put(hip, base, -s * rhythm * 0.5 + s * 0.04, s * 0.045, s * 0.042);
    put(knee, bones[hip], walking ? 0.055 + 0.52 * Math.max(0, s * Math.cos(phase)) : 0.023);
  }
  return {
    bones: new Float32Array(bones.flatMap((b) => Array.from(b))),
    sx: (2 * height) / (portion * width),
    sy: 2 / portion,
  };
}
