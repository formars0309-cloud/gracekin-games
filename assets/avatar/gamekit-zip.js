// PNG는 이미 압축되어 있으므로 ZIP의 저장 방식(0)으로 묶는다.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// 파일명은 게임 키트가 지정한 ASCII 상수다. 날짜는 DOS 기준 1980년 1월 1일로 고정한다.
export async function packGameFiles(files) {
  const contents = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [filename, file] of files) {
    const name = new TextEncoder().encode(filename);
    const crc = checksum(new Uint8Array(await file.arrayBuffer()));
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(12, 33, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, file.size, true);
    header.setUint32(22, file.size, true);
    header.setUint16(26, name.length, true);
    contents.push(header, name, file);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    new Uint8Array(entry.buffer, 6, 24).set(new Uint8Array(header.buffer, 4, 24));
    entry.setUint32(42, offset, true);
    directory.push(entry, name);
    directorySize += entry.byteLength + name.length;
    offset += header.byteLength + name.length + file.size;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...contents, ...directory, end], { type: 'application/zip' });
}
