const FLAG = 0x7e;
const ESCAPE = 0x7d;
const MIN_FRAME_LENGTH = 13; // 12-byte header + 1-byte checksum

/** Reverses JT808 escaping: 7d 02 → 7e, 7d 01 → 7d */
function unescape(data: Buffer): Buffer {
  if (!data.includes(ESCAPE)) return data; // most frames have nothing to unescape

  const out = Buffer.allocUnsafe(data.length);
  let length = 0;

  for (let i = 0; i < data.length; i++) {
    out[length++] = data[i] === ESCAPE
      ? (data[++i] === 0x02 ? FLAG : ESCAPE)
      : data[i];
  }

  return out.subarray(0, length);
}

/**
 * Splits a raw TCP chunk into JT808 payloads.
 * Each payload starts at the message ID, with flags and checksum removed.
 */
export function extractPayloads(chunk: Buffer): Buffer[] {
  const payloads: Buffer[] = [];
  let start = chunk.indexOf(FLAG);

  while (start !== -1) {
    const end = chunk.indexOf(FLAG, start + 1);
    if (end === -1) break;

    const frame = unescape(chunk.subarray(start + 1, end));

    if (frame.length < MIN_FRAME_LENGTH) {
      start = end; // stray flag, use it as the next frame's start
      continue;
    }

    payloads.push(frame.subarray(0, -1)); // drop checksum
    start = chunk.indexOf(FLAG, end + 1);
  }

  return payloads;
}