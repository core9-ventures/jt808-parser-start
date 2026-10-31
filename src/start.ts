import type { Socket } from "net";
import { Jtt808Server } from "./main";
import { extractPayloads, parseAttributes } from "./parser/jt808-frame";

const port = 7618;
const server = new Jtt808Server();

const MessageId = {
  TERMINAL_RESPONSE: 0x0001,
  REGISTER: 0x0100,
} as const;

/** Builds the reply for a payload, or null if no reply is needed */
function buildReply(payload: Buffer): Buffer | null {
  switch (payload.readUInt16BE(0)) {
    case MessageId.TERMINAL_RESPONSE:
      return null; // never acknowledge an acknowledgement
    case MessageId.REGISTER:
      return server.sendRegisterResponse(payload);
    default:
      return server.sendGeneralResponse(payload); // auth, heartbeat, location, etc.
  }
}

const queried = new WeakSet<Socket>();


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
  .on("message", ({ socket, chunk }) => {
    for (const payload of extractPayloads(chunk)) {
      
      if (payload.readUInt16BE(0) === 0x0107) {
        console.log("Device attributes:", parseAttributes(payload));
        continue; // it's a response, don't acknowledge it
      }
      
      const reply = buildReply(payload);
      if (reply) socket.write(reply);

      if (!queried.has(socket)) {
        queried.add(socket);
        socket.write(server.buildQueryAttributes(payload));
      }
      
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
