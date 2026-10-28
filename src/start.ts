import { Jtt808Server } from "./main";

const port = 7618;
const server = new Jtt808Server();

server
  .on("start", (port) => console.log(`JT/T808 server listening on port ${port}`))
  .on("connection", (socket) =>
    console.log(`Connected: ${socket.remoteAddress}:${socket.remotePort}`)
  )
  .on("raw_data", (chunk) => console.log("Raw:", chunk.toString("hex")))
  .on("data", (data) => console.log("Data:", data.toJSON()))
  .on("data_error", (err) => console.error("Data error:", err.message))
  .on("error", (err) => console.error("Socket error:", err.message))
  .on("disconnected", () => console.log("Disconnected"))
  .on("close", () => console.log("Server closed"));

server.listen(port);

process.on("SIGINT", () => {
  server.server.close();
  process.exit(0);
});
