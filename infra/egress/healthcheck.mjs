import net from "node:net";
import { bindAddress } from "./bind.mjs";
const socket = net.connect({ host: bindAddress(), port: 3128 });
socket.setTimeout(1000, () => process.exit(1));
socket.once("error", () => process.exit(1));
socket.once("connect", () =>
  socket.end("GET / HTTP/1.1\r\nHost: healthcheck\r\n\r\n"),
);
socket.once("data", (data) => {
  process.exit(data.toString().startsWith("HTTP/1.1 403") ? 0 : 1);
});
