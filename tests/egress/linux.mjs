import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { provisionEgress, revokeEgress, EGRESS_IMAGE } from '../../infra/egress/network.mjs';
const exec = promisify(execFile);
const runId = `egresstest-${randomBytes(6).toString('hex')}`;
const identity = { instanceId: runId, projectId: 'project', sessionId: 'session', generation: 1 };
const containerNames = [];
let first, second;
async function docker(args) { return (await exec('docker', args, { timeout: 60000, maxBuffer: 128 * 1024 })).stdout.trim(); }
async function run(network, code) {
  const name = `${runId}-probe-${containerNames.length}`; containerNames.push(name);
  return docker(['run','--rm','--name',name,'--label',`org.codex-harbor.egress-test=${runId}`,'--network',network,'--user','10001:10001','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges:true','--pids-limit','64','--memory','128m','--memory-swap','128m','--cpus','0.5',EGRESS_IMAGE,'node','--input-type=module','-e',code]);
}
const connectFunction = `import net from 'node:net';
async function reachable(host,port){return new Promise(resolve=>{const s=net.connect({host,port});let done=false;function finish(ok){if(done)return;done=true;s.destroy();resolve(ok)}s.setTimeout(1200,()=>finish(false));s.on('error',()=>finish(false));s.on('connect',()=>finish(true));})}`;
try {
  first = await provisionEgress(identity);
  second = await provisionEgress({ ...identity, projectId: 'other', sessionId: 'other' });
  const internal = JSON.parse(await docker(['network','inspect',first.networkName]))[0];
  const proxy = JSON.parse(await docker(['inspect',first.proxyName]))[0];
  assert.equal(internal.Internal,true); assert.equal(internal.Options['com.docker.network.bridge.gateway_mode_ipv4'],'isolated'); assert.equal(internal.EnableIPv6,false);
  assert.equal(proxy.HostConfig.ReadonlyRootfs,true); assert.deepEqual(proxy.HostConfig.PortBindings,{}); assert.equal(proxy.Config.User,'10002:10002');
  assert.equal(Object.keys(proxy.NetworkSettings.Networks).length,2);
  const outboundAddress = proxy.NetworkSettings.Networks[first.outboundName].IPAddress;
  const firstProxy = new URL(first.proxyUrl).hostname;
  const secondProxy = new URL(second.proxyUrl).hostname;
  const forbidden = ['1.1.1.1','2606:4700:4700::1111','169.254.169.254','127.0.0.1','::1','10.0.0.1', secondProxy, outboundAddress];
  // No default route and no bridge host address; probe the nominal first subnet address too.
  const networkBase = internal.IPAM.Config[0].Subnet.split('/')[0].split('.'); networkBase[3] = String(Number(networkBase[3])+1); forbidden.push(networkBase.join('.'));
  const direct = await run(first.networkName, `${connectFunction}\nfor(const host of ${JSON.stringify(forbidden)}){if(await reachable(host,host===${JSON.stringify(secondProxy)}||host===${JSON.stringify(outboundAddress)}?3128:443))throw Error('Forbidden direct connection');}console.log('direct IPv4/IPv6, metadata, host and cross-project denial passed');`); console.log(direct);
  console.log(await run(first.outboundName, `${connectFunction}\nif(await reachable(${JSON.stringify(outboundAddress)},3128))throw Error('Proxy exposed on outbound interface');console.log('outbound proxy listener absent');`));
  console.log(await run(first.networkName, `import net from 'node:net';import tls from 'node:tls';import http from 'node:http';
async function raw(bytes){return new Promise((resolve,reject)=>{const s=net.connect({host:${JSON.stringify(firstProxy)},port:3128});let result='';s.setTimeout(3000,()=>{s.destroy();reject(Error('Gateway timeout'))});s.on('error',reject);s.on('connect',()=>s.write(bytes));s.on('data',data=>result+=data);s.on('end',()=>resolve(result))})}
for(const host of ['api.openai.com:443','www.cloudflare.com:443','169.254.169.254:443','[::1]:443']){if(!(await raw('CONNECT '+host+' HTTP/1.1\\r\\nHost: '+host+'\\r\\n\\r\\n')).startsWith('HTTP/1.1 403'))throw Error('CONNECT tunnel accepted')}
for(const [path,host] of [['/v1/responses','www.cloudflare.com'],['https://www.cloudflare.com/v1/responses',${JSON.stringify(firstProxy + ':3128')}],['/v1/responses?host=www.cloudflare.com',${JSON.stringify(firstProxy + ':3128')}]]){if(!(await raw('POST '+path+' HTTP/1.1\\r\\nHost: '+host+'\\r\\nContent-Type: application/json\\r\\nContent-Length: 2\\r\\n\\r\\n{}')).startsWith('HTTP/1.1 403'))throw Error('HTTP domain fronting accepted')}
await new Promise((resolve,reject)=>{const s=tls.connect({host:${JSON.stringify(firstProxy)},port:3128,servername:'www.cloudflare.com',rejectUnauthorized:true});s.setTimeout(3000,()=>{s.destroy();reject(Error('TLS timeout'))});s.on('secureConnect',()=>reject(Error('Foreign TLS SNI accepted')));s.on('error',()=>resolve());s.on('close',()=>resolve())});
console.log('CONNECT, TLS SNI and HTTP Host domain-fronting regressions denied');
await new Promise((resolve,reject)=>{const r=http.request({host:${JSON.stringify(firstProxy)},port:3128,path:'/v1/responses',method:'POST',headers:{'content-type':'application/json'}},response=>{response.resume();if(response.statusCode!==401)reject(Error('Expected real OpenAI unauthenticated 401'));response.on('end',resolve)});r.setTimeout(15000,()=>{r.destroy();reject(Error('Approved endpoint unavailable'))});r.on('error',reject);r.end('{}')});
console.log('approved api.openai.com fixed TLS gateway returned unauthenticated 401');`));
  await first.cleanup(); await first.cleanup(); first = undefined;
  await revokeEgress({ ...identity, projectId: 'other', sessionId: 'other' }); second = undefined;
  console.log('scoped idempotent cleanup and generation revocation passed');
} finally {
  for (const name of containerNames) {
    const ids = await docker(['ps','-aq','--filter',`name=^/${name}$`]);
    if(ids){const value=JSON.parse(await docker(['inspect',name]))[0];if(value.Config.Labels?.['org.codex-harbor.egress-test']!==runId)throw Error('Cleanup ownership mismatch');await docker(['rm','-f',name]);}
  }
  await first?.cleanup(); await second?.cleanup();
}
