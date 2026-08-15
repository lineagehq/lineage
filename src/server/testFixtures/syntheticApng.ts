import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function syntheticPngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.allocUnsafe(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(syntheticPngCrc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function frameControl(sequence: number): Buffer {
  const data = Buffer.alloc(26);
  data.writeUInt32BE(sequence, 0);
  data.writeUInt32BE(1080, 4);
  data.writeUInt32BE(1080, 8);
  data.writeUInt16BE(1, 20);
  data.writeUInt16BE(10, 22);
  data[24] = 0;
  data[25] = 0;
  return data;
}

function rgbaFrame(red: number, green: number, blue: number): Buffer {
  const row = Buffer.alloc(1 + (1080 * 4));
  for (let pixel = 0; pixel < 1080; pixel += 1) {
    const offset = 1 + (pixel * 4);
    row[offset] = red;
    row[offset + 1] = green;
    row[offset + 2] = blue;
    row[offset + 3] = 255;
  }
  const frame = Buffer.alloc(row.length * 1080);
  for (let y = 0; y < 1080; y += 1) row.copy(frame, y * row.length);
  return frame;
}

export function createSyntheticApng1080Square(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1080, 0);
  ihdr.writeUInt32BE(1080, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(2, 0);
  animationControl.writeUInt32BE(0, 4);
  const first = deflateSync(rgbaFrame(49, 92, 136), { level: 9 });
  const second = deflateSync(rgbaFrame(136, 49, 92), { level: 9 });
  const frameData = Buffer.allocUnsafe(second.length + 4);
  frameData.writeUInt32BE(2, 0);
  second.copy(frameData, 4);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('acTL', animationControl),
    chunk('fcTL', frameControl(0)),
    chunk('IDAT', first),
    chunk('fcTL', frameControl(1)),
    chunk('fdAT', frameData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
