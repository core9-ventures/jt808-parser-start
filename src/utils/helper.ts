export function phoneToBCD (deviceNumber: string): Buffer {
  const padded = deviceNumber.padStart(12, "0");

  if (!/^\d{12}$/.test(padded)) {
    throw new Error("Device number must contain up to 12 digits");
  }

  return Buffer.from(padded, "hex");
}


export function calculateChecksum(buffer: Buffer) {
  let checksum = 0;

  for (const byte of buffer) {
    checksum ^= byte;
  }

  return checksum;
}


export function buildPacket(body: Buffer) {
  const checksum = calculateChecksum(body);

  const packetBody = Buffer.concat([
    body,
    Buffer.from([checksum])
  ]);

  return Buffer.concat([
    Buffer.from([0x7e]),
    escapePacket(packetBody),
    Buffer.from([0x7e])
  ]);
}


function escapePacket(buffer: Buffer)  {
  const result = [];

  for (const byte of buffer) {
    if (byte === 0x7e) {
      result.push(0x7d, 0x02);
    } else if (byte === 0x7d) {
      result.push(0x7d, 0x01);
    } else {
      result.push(byte);
    }
  }

  return Buffer.from(result);
}