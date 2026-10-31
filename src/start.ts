import type { Socket } from "net";
import { Jtt808Server } from "./main";
import { extractPayloads, parseAttributes } from "./parser/jt808-frame";

const port = 7618;
const MessageId = {
  TERMINAL_RESPONSE: 0x0001,
  HEARTBEAT: 0x0002,
  REGISTER: 0x0100,
  ATTRIBUTES: 0x0107,
  LOCATION: 0x0200,
} as const;

const RESPONSE_RESULTS = ["success", "failure", "message error", "not supported"];

const server = new Jtt808Server();
const queried = new WeakSet<Socket>(); // sockets already asked for attributes

/** Returns the message body, skipping the 2013 or 2019 header */
function bodyOf(payload: Buffer): Buffer {
  const is2019 = (payload.readUInt16BE(2) & 0x4000) !== 0;
  return payload.subarray(is2019 ? 17 : 12);
}

function toHex(id: number): string {
  return "0x" + id.toString(16).padStart(4, "0");
}

/** Builds the reply for a payload, or null if none is needed */
function buildReply(payload: Buffer): Buffer | null {
  switch (payload.readUInt16BE(0)) {
    case MessageId.TERMINAL_RESPONSE:
    case MessageId.ATTRIBUTES:
      return null; // these are responses; never acknowledge a response
    case MessageId.REGISTER:
      return server.sendRegisterResponse(payload);
    default:
      return server.sendGeneralResponse(payload); // auth, heartbeat, location, etc.
  }
}

/** Logs the messages we're interested in */
function logPayload(payload: Buffer): void {
  switch (payload.readUInt16BE(0)) {
    case MessageId.ATTRIBUTES:
      console.log("Device attributes:", parseAttributes(payload));
      break;
    case MessageId.TERMINAL_RESPONSE: {
      const body = bodyOf(payload);
      const result = RESPONSE_RESULTS[body[4]] ?? body[4];
      console.log(`Device response to ${toHex(body.readUInt16BE(2))}: ${result}`);
      break;
    }
  }
}

/** Sends 0x8107 once per connection, after the device is clearly online */
function queryAttributesOnce(socket: Socket, payload: Buffer): void {
  const messageId = payload.readUInt16BE(0);
  const isOnline = messageId === MessageId.HEARTBEAT || messageId === MessageId.LOCATION;
  if (!isOnline || queried.has(socket)) return;

  queried.add(socket);
  const query = server.buildQueryAttributes(payload);
  console.log("Sent 0x8107:", query.toString("hex"));
  socket.write(query);
}


server
  .on("start", (port) => console.log(`JT/T808 server listening on port ${port}`))
  .on("connection", (socket) =>
    console.log(`Connected: ${socket.remoteAddress}:${socket.remotePort}`)
  )
  .on("raw_data", (chunk) => console.log("Raw:", chunk.toString("hex")))
  .on("data", (data) => {
    // if(data.messageType !== 0x0200) {
    //   console.log("Data:", data.toJSON())
    // } 
    console.log("Data:", data.toJSON())
  })
  // .on("message", ({ socket, chunk }) => {
  //   const messageId = chunk.readUInt16BE(1);
  //   switch (messageId) {
  //     case 0x0100: {
  //       // Terminal registration request
  //       const response = server.sendRegisterResponse(chunk);
  //       socket.write(response);
  //       break;
  //     }
  //     case 0x0102: {
  //       // Terminal authentication request
  //       const response = server.sendGeneralResponse(chunk);
  //       socket.write(response);
  //       break;
  //     }

  //     case 0x0002 : {
  //       // Terminal heartbeat request
  //       const response = server.sendGeneralResponse(chunk);
  //       socket.write(response);
  //       break;
  //     }

  //     case 0x0001: {
  //       // Terminal general response
  //       console.log("Terminal acknowledged a server message");
  //       break;
  //     }

  //     default: {
  //       console.log("Received message:", messageId);
  //       break;
  //     }
  //   }
  // })
  // .on("message", ({ socket, chunk }) => {
  //   for (const payload of extractPayloads(chunk)) {

  //     if (payload.readUInt16BE(0) == 0x0107) {
  //       console.log("Device attributes:", parseAttributes(payload));
  //       //continue; // it's a response, don't acknowledge it
  //     }

  //     if (payload.readUInt16BE(0) === 0x0001) {
  //       const is2019 = (payload.readUInt16BE(2) & 0x4000) !== 0;
  //       const body = payload.subarray(is2019 ? 17 : 12);
  //       console.log(
  //         `Device response to 0x${body.readUInt16BE(2).toString(16)}:`,
  //         ["success", "failure", "message error", "not supported"][body[4]] ?? body[4]
  //       );
  //     }

  //     const reply = buildReply(payload);
  //     if (reply) socket.write(reply);

  //     if (!queried.has(socket)) {
  //       queried.add(socket);
  //       let query = server.buildQueryAttributes(payload);
  //       console.log("Sent 0x8107:", query.toString("hex"));
  //       socket.write(query);
  //     }

  //   }
  // })
server.on("message", ({ socket, chunk }) => {
  for (const payload of extractPayloads(chunk)) {
    logPayload(payload);

    const reply = buildReply(payload);
    if (reply) socket.write(reply);

    queryAttributesOnce(socket, payload);
  }
})
  .on("data_error", (err) => console.error("Data error:", err.message))
  .on("error", (err) => console.error("Socket error:", err.message))
  .on("disconnected", () => console.log("Disconnected"))
  .on("close", () => console.log("Server closed"));


server.listen(port);

process.on("SIGINT", () => {
  server.server.close();
  process.exit(0);
});
