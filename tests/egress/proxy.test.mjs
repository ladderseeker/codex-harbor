import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import tls from 'node:tls';
import { once } from 'node:events';
import { createProxy } from '../../infra/egress/proxy.mjs';
import { LIMITS } from '../../infra/egress/policy.mjs';
const closed = socket => new Promise(resolve => socket.once('close', resolve));
async function setup(t, options = {}) {
  const gateway = createProxy(options); gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
  t.after(() => gateway.close());
  const port = gateway.server.address().port;
  return { gateway, port, make:()=>net.connect({host:'127.0.0.1',port}), text:(path='/v1/responses',host=`127.0.0.1:${port}`,extra='')=>`POST ${path} HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n${extra}\r\n{}` };
}
async function exchange(make,bytes){const socket=make();socket.on('error',()=>{});let text='';socket.on('data',data=>text+=data);socket.write(bytes);await closed(socket);return text;}
async function upstream(t,handler){const sockets=new Set();const server=http.createServer(handler);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve))});return server.address().port;}
function transport(port,inspect=()=>{}) { return (options,callback)=>{inspect(options);return http.request({...options,protocol:'http:',hostname:'127.0.0.1',port},callback)}; }
test('CONNECT, absolute URLs, foreign Host and Upgrade are rejected without resolution',async t=>{
  const g=await setup(t,{lookup:()=>assert.fail('Must not resolve rejected route')});
  for(const text of ['CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n',g.text('/v1/responses','www.cloudflare.com'),g.text('https://api.openai.com/v1/responses'),g.text('/v1/responses?x=1'),g.text('/v1/responses',undefined,'Upgrade: websocket\r\nConnection: Upgrade\r\n')])assert.match(await exchange(g.make,text),/^HTTP\/1.1 403/);
});
test('direct TLS with a foreign SNI cannot turn the HTTP listener into a tunnel',async t=>{
  const g=await setup(t,{lookup:()=>assert.fail('TLS must not dispatch')});
  const socket=tls.connect({host:'127.0.0.1',port:g.port,servername:'www.cloudflare.com',rejectUnauthorized:true});let secured=false;socket.on('secureConnect',()=>secured=true);socket.on('error',()=>{});await closed(socket);assert.equal(secured,false);
});
test('every DNS answer is checked and pinned upstream owns TLS SNI and Host',async t=>{
  const port=await upstream(t,(req,res)=>{assert.equal(req.headers.host,'api.openai.com');assert.equal(req.headers.authorization,'Bearer fixture');assert.equal(req.headers['x-forwarded-host'],undefined);assert.equal(req.url,'/v1/responses');req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');setTimeout(()=>res.end('data: last\n\n'),10)})});
  let calls=0;
  const g=await setup(t,{lookup:async()=>++calls===1?[{address:'1.1.1.1',family:4}]:[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}],request:transport(port,o=>{assert.equal(o.hostname,'1.1.1.1');assert.equal(o.servername,'api.openai.com');assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);assert.equal(o.headers.host,'api.openai.com')})});
  const text=await exchange(g.make,g.text('/v1/responses',undefined,'Authorization: Bearer fixture\r\nX-Forwarded-Host: www.cloudflare.com\r\n'));assert.match(text,/200 OK/);assert.match(text,/data: first/);assert.match(text,/data: last/);
  assert.match(await exchange(g.make,g.text()),/^HTTP\/1.1 502/);assert.equal(calls,2);
});
test('upstream redirects are rejected and do not leak Location or follow destinations',async t=>{
  const port=await upstream(t,(_req,res)=>{res.writeHead(302,{location:'https://evil.com/secret'});res.end()});
  const g=await setup(t,{lookup:async()=>[{address:'1.1.1.1',family:4}],request:transport(port)});
  const text=await exchange(g.make,g.text());assert.match(text,/502/);assert.doesNotMatch(text,/evil|secret|location/i);
});
test('partial and oversized headers, framing smuggling and stalled resolution are bounded',async t=>{
  const g=await setup(t,{lookup:()=>new Promise(()=>{}),limits:{...LIMITS,preludeMs:40,connectMs:40}});
  const partial=g.make();partial.on('error',()=>{});partial.write('POST');await closed(partial);
  assert.equal(await exchange(g.make,'X'.repeat(9000)),'');
  assert.equal(await exchange(g.make,g.text('/v1/responses',undefined,'Transfer-Encoding: chunked\r\n')),'');
  assert.match(await exchange(g.make,g.text()),/504/);
});
test('rate/concurrency limits and shutdown close sockets',async t=>{
  const g=await setup(t,{limits:{...LIMITS,connections:1,requestsPerMinute:1}});
  const first=g.make();first.on('error',()=>{});await once(first,'connect');const second=g.make();second.on('error',()=>{});await closed(second);first.destroy();await closed(first);
  assert.match(await exchange(g.make,g.text('/bad')),/403/);assert.match(await exchange(g.make,g.text('/bad')),/429/);
  const socket=g.make();socket.on('error',()=>{});await once(socket,'connect');const done=closed(socket);await g.gateway.close();await done;
});
test('disconnect during DNS cannot create late upstream',async t=>{
  let complete;const g=await setup(t,{lookup:()=>new Promise(resolve=>complete=resolve),request:()=>assert.fail('Disconnected request must not dial')});
  const socket=g.make();socket.on('error',()=>{});socket.write(g.text());while(!complete)await new Promise(resolve=>setTimeout(resolve,1));socket.destroy();await closed(socket);await new Promise(resolve=>setTimeout(resolve,5));complete([{address:'1.1.1.1',family:4}]);await new Promise(resolve=>setTimeout(resolve,5));
});
test('streamed request and response byte limits and total lifetime terminate work',async t=>{
  for(const mode of ['request','response','total','idle']){
    const port=await upstream(t,(req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});if(mode==='response')res.end('x'.repeat(100));else if(mode==='total'){res.write('data: first\n\n');const timer=setInterval(()=>res.write('data: more\n\n'),5);res.on('close',()=>clearInterval(timer))}else if(mode==='idle')res.write('data: first\n\n');else res.end('done')})});
    const limits={...LIMITS,...(mode==='request'?{requestBytes:1}:mode==='response'?{responseBytes:10}:mode==='idle'?{idleMs:30}:{totalMs:60})};
    const g=await setup(t,{limits,lookup:async()=>[{address:'1.1.1.1',family:4}],request:transport(port)});
    const text=await exchange(g.make,g.text());if(mode==='request')assert.match(text,/413/);else assert.doesNotMatch(text,/x{100}/);
  }
});
