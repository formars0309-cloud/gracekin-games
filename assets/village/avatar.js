/* 부품 렌더러 교체 지점. 저장 값에는 그림·위치·애니메이션 상태를 넣지 않는다. */
export function drawAvatar(container, avatarData) {
  container.removeAll(true);
  const scene = container.scene;
  const colors = avatarData?.colors || { skin: '#ffe0bd', hair: '#49352f', outfit: '#8db9d3' };
  const tint = value => Number.parseInt(value.replace('#', ''), 16);
  const shadow = scene.add.ellipse(0, 0, 27, 10, 0x54634a, .22);
  const body = scene.add.container(0, 0);
  const art = scene.add.graphics();
  art.fillStyle(tint(colors.outfit)).fillRoundedRect(-11, -29, 22, 25, 8);
  art.fillStyle(tint(colors.skin)).fillCircle(0, -38, 16);
  art.fillStyle(tint(colors.hair)).fillEllipse(0, -48, 34, 18).fillRoundedRect(-17, -49, 8, 17, 4);
  art.fillStyle(0x493a35).fillCircle(-5, -38, 1.5).fillCircle(5, -38, 1.5);
  art.lineStyle(1.4, 0xb16e68).lineBetween(-2, -32, 2, -32);
  art.fillStyle(tint(colors.skin)).fillCircle(-12, -19, 4).fillCircle(12, -19, 4);
  art.fillStyle(0x655a55).fillRoundedRect(-9, -7, 7, 7, 3).fillRoundedRect(2, -7, 7, 7, 3);
  body.add(art); container.add([shadow, body]);
  return { body, shadow };
}
