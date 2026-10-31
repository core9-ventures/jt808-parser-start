import net from "net";
import { EventEmitter } from "events";
import { Jtt808ProtocolParser } from "../parser/jtt808-parser";
import { Jtt808ProtocolData } from "../parser/jtt808-protocol-data";

/**
 * JT/T808 Server Instance
 */
export class Jtt808Server {

  #server: net.Server;
  #event: EventEmitter;
  #parser: Jtt808ProtocolParser;

  private serverSequence = 0;



  constructor() {
    this.#server = net.createServer();
    this.#event = new EventEmitter();
    this.#parser = new Jtt808ProtocolParser();

    this.#server.on("connection", this._onConnection.bind(this));
    this.#server.on("close", this._onClose.bind(this));
  }

  /**
   * Get TCP server that connect JT/T808 protocol
   */
  get server() {
    return this.#server;
  }

  private nextSeq(): number {
    this.serverSequence = (this.serverSequence + 1) & 0xffff;
    return this.serverSequence;
  }

  buildQueryAttributes(request: Buffer): Buffer {
    const is2019 = (request.readUInt16BE(2) & 0x4000) !== 0;
    const phoneOffset = is2019 ? 5 : 4;
    const phoneLength = is2019 ? 10 : 6;
    const serialOffset = phoneOffset + phoneLength;

    const header = Buffer.alloc(serialOffset + 2);
    header.writeUInt16BE(0x8107, 0);
    header.writeUInt16BE(is2019 ? 0x4000 : 0, 2);   // body length 0
    if (is2019) header[4] = request[4];             // protocol version
    request.copy(header, phoneOffset, phoneOffset, serialOffset); // device phone
    header.writeUInt16BE(this.nextSeq(), serialOffset);

    return this.buildPacket(header);
  }

  sendGeneralResponse(buffer: Buffer, result = 0): Buffer {
    // Original request header
    const requestMessageId = buffer.readUInt16BE(0);
    const props = buffer.readUInt16BE(2);

    // Check whether this is a JT/T 808-2019 header
    const is2019 = (props & 0x4000) !== 0;

    // Extract terminal phone and request serial number
    const phoneOffset = is2019 ? 5 : 4;
    const phoneLen = is2019 ? 10 : 6;
    const serialOffset = phoneOffset + phoneLen;

    const phoneBytes = buffer.subarray(
      phoneOffset,
      phoneOffset + phoneLen
    );

    const requestSerial = buffer.readUInt16BE(serialOffset);

    // General response body:
    // Original request serial (2) + message ID (2) + result (1)
    const body = Buffer.alloc(5);

    body.writeUInt16BE(requestSerial, 0);
    body.writeUInt16BE(requestMessageId, 2);
    body.writeUInt8(result, 4);

    // Build response header
    const headerLen = serialOffset + 2;
    const header = Buffer.alloc(headerLen);

    header.writeUInt16BE(0x8001, 0);

    // Body length = 5; preserve the 2019 version flag
    header.writeUInt16BE(
      5 | (is2019 ? 0x4000 : 0),
      2
    );

    if (is2019) {
      header.writeUInt8(buffer.readUInt8(4), 4);
    }

    phoneBytes.copy(header, phoneOffset);

    // Server's outgoing message serial number
    header.writeUInt16BE(this.nextSeq(), serialOffset);

    // Add checksum, escaping, and 0x7E delimiters
    return this.buildPacket(Buffer.concat([header, body]));
  }

  sendRegisterResponse(buffer: Buffer, result = 0): Buffer {
    const props = buffer.readUInt16BE(2);
    const is2019 = (props & 0x4000) !== 0;

    // 2013: id(2) props(2) phone(6)  serial(2)  -> 12 bytes
    // 2019: id(2) props(2) ver(1) phone(10) serial(2) -> 17 bytes

    const phoneOffset = is2019 ? 5 : 4;
    const phoneLen = is2019 ? 10 : 6;
    const serialOffset = phoneOffset + phoneLen;
    const headerLen = serialOffset + 2;

    const reqSerial = buffer.readUInt16BE(serialOffset);
    const phoneBytes = buffer.subarray(phoneOffset, phoneOffset + phoneLen);

    // Body: reply serial (2) + result (1) + auth code (only on success)
    const parts: Buffer[] = [
      Buffer.from([(reqSerial >> 8) & 0xff, reqSerial & 0xff, result]),
    ];
    if (result === 0) parts.push(Buffer.from('AUTH123456', "ascii"));
    const body = Buffer.concat(parts);

    const header = Buffer.alloc(headerLen);
    header.writeUInt16BE(0x8100, 0);
    // bits 0-9 = body length; keep the 2019 version flag if applicable
    header.writeUInt16BE((body.length & 0x03ff) | (is2019 ? 0x4000 : 0), 2);
    if (is2019) header.writeUInt8(buffer.readUInt8(4), 4); // protocol version
    phoneBytes.copy(header, phoneOffset);
    header.writeUInt16BE(this.nextSeq(), serialOffset);

    return this.buildPacket(Buffer.concat([header, body]));
  }

  private buildPacket(data: Buffer): Buffer {
    // XOR checksum over header + body (before escaping)
    let checksum = 0;
    for (const b of data) checksum ^= b;

    const raw = Buffer.concat([data, Buffer.from([checksum])]);

    // Escape: 0x7e -> 0x7d 0x02, 0x7d -> 0x7d 0x01
    const escaped: number[] = [];
    for (const b of raw) {
      if (b === 0x7e) escaped.push(0x7d, 0x02);
      else if (b === 0x7d) escaped.push(0x7d, 0x01);
      else escaped.push(b);
    }

    return Buffer.concat([
      Buffer.from([0x7e]),
      Buffer.from(escaped),
      Buffer.from([0x7e]),
    ]);
  }

  /**
   * Listen server event
   * @param eventName Event Name
   * @param listener Event Listener
   */
  on(eventName: "message", listener: (event: { socket: net.Socket; chunk: Buffer }) => void): Jtt808Server;
  on(eventName: 'start', listener: (port: number) => void): Jtt808Server;
  on(eventName: 'connection', listener: (socket: net.Socket) => void): Jtt808Server;
  on(eventName: 'raw_data', listener: (chunk: Buffer) => void): Jtt808Server;
  on(eventName: 'data', listener: (data: Jtt808ProtocolData) => void): Jtt808Server;
  on(eventName: 'disconnected', listener: (socket: net.Socket) => void): Jtt808Server;
  on(eventName: 'error', listener: (err: Error) => void): Jtt808Server;
  on(eventName: 'data_error', listener: (err: Error) => void): Jtt808Server;
  on(eventName: 'close', listener: () => void): Jtt808Server;
  on(eventName: string, listener: (...args: any[]) => void) {
    this.#event.on(eventName, listener);
    return this;
  }


  /**
   * Listen server event once
   * @param eventName Event Name
   * @param listener Event Listener
   */
  once(eventName: 'start', listener: (port: number) => void): Jtt808Server;
  once(eventName: 'connection', listener: (socket: net.Socket) => void): Jtt808Server;
  once(eventName: 'raw_data', listener: (chunk: Buffer) => void): Jtt808Server;
  once(eventName: 'data', listener: (data: Jtt808ProtocolData) => void): Jtt808Server;
  once(eventName: 'disconnected', listener: (socket: net.Socket) => void): Jtt808Server;
  once(eventName: 'error', listener: (err: Error) => void): Jtt808Server;
  once(eventName: 'data_error', listener: (err: Error) => void): Jtt808Server;
  once(eventName: 'close', listener: () => void): Jtt808Server;
  once(eventName: string, listener: (...args: any[]) => void) {
    this.#event.once(eventName, listener);
    return this;
  }

  /**
   * Unlisten server event
   * @param eventName Event Name
   * @param listener Event Listener
   */
  off(eventName: 'start', listener: (port: number) => void): Jtt808Server;
  off(eventName: 'connection', listener: (socket: net.Socket) => void): Jtt808Server;
  off(eventName: 'raw_data', listener: (chunk: Buffer) => void): Jtt808Server;
  off(eventName: 'data', listener: (data: Jtt808ProtocolData) => void): Jtt808Server;
  off(eventName: 'disconnected', listener: (socket: net.Socket) => void): Jtt808Server;
  off(eventName: 'error', listener: (err: Error) => void): Jtt808Server;
  off(eventName: 'data_error', listener: (err: Error) => void): Jtt808Server;
  off(eventName: 'close', listener: () => void): Jtt808Server;
  off(eventName: string, listener: (...args: any[]) => void) {
    this.#event.off(eventName, listener);
    return this;
  }

  /**
   * Start server
   * @param port Server Port
   */
  listen(port = 7618) {
    if (this.#server.listening) {
      this.#server.close(() => {
        this.listen(port);
      });
      return;
    }

    this.#server.listen(port, () => {
      this.#event.emit("start", port);
    });
  }

  _onConnection(socket: net.Socket) {
    this.#event.emit("connection", socket);
    socket.on("data", (chunk: Buffer) => {
      this.#event.emit("raw_data", chunk);
      try {
        const data = this.#parser.parse(chunk);
        this.#event.emit("message", {
          socket,
          chunk,
        });
        this.#event.emit("data", data);
      } catch (err) {
        this.#event.emit("data_error", err);
      }
    });

    socket.on("end", () => {
      this.#event.emit("disconnected", socket);
    });

    socket.on("error", (err) => {
      this.#event.emit("error", err);
    });
  }

  _onClose() {
    this.#event.emit("close");
  }
}