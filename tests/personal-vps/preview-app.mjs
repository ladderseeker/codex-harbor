import http from 'node:http';
import { WebSocketServer } from 'ws';
export function startPersonalPreviewApp(port) {
  const app = http.createServer((req,res) => {
    if(req.url === '/headers') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(req.headers)); return; }
    res.setHeader('content-type',req.url === '/large.js'?'application/javascript':'text/html');
    if(req.url === '/large.js') { res.end('/*'+'a'.repeat(1024*1024)+'*/\nwindow.largeLoaded = true;'); return; }
    res.end('<!doctype html><html><body><h1>Private development application</h1><p id="ws">Connecting</p><script src="/large.js"></script><script>const socket = new WebSocket("wss://"+location.host+"/hmr", "vite-hmr"); socket.onopen=()=>socket.send("preview-check"); socket.onmessage=e=>document.getElementById("ws").textContent=e.data;</script></body></html>');
  });
  const ws = new WebSocketServer({server:app});
  ws.on('connection',socket=>socket.on('message',data=>socket.send('HMR connected: '+data)));
  app.listen(port,'127.0.0.1');
  return app;
}
