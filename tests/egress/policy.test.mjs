import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, validateAnswers, gatewayRequest } from '../../infra/egress/policy.mjs';
test('reserved, private, ambiguous and transition addresses fail in both families', () => {
  for (const address of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','192.0.0.9','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','255.255.255.255','127.1','0177.0.0.1','0x7f000001','2130706433','::','::1','fc00::1','fe80::1','fe80::1%eth0','ff02::1','::ffff:127.0.0.1','::ffff:8.8.8.8','64:ff9b::808:808','2002:7f00:1::','2001::1','2001:20::1','2001:db8::1','3fff::1','4000::1']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8','1.1.1.1','2606:4700::1111','2001:4860:4860::8888']) assert.equal(publicAddress(address), true, address);
});
test('every DNS answer is validated before choosing one', () => {
  const good = { address: '1.1.1.1', family: 4 };
  assert.deepEqual(validateAnswers([good]), good);
  for (const answers of [[],[good,{address:'127.0.0.1',family:4}],[good,{address:'::ffff:10.0.0.1',family:6}],[{address:'1.1.1.1',family:6}],Array(33).fill(good)]) assert.throws(() => validateAnswers(answers));
});
test('gateway accepts only exact route and its bound authority', () => {
  const request = () => ({method:'POST',url:'/v1/responses',socket:{localAddress:'172.19.0.1',localPort:3128},headers:{host:'172.19.0.1:3128','content-type':'application/json',authorization:'Bearer fixture'},rawHeaders:['Host','172.19.0.1:3128','Content-Type','application/json']});
  assert.equal(gatewayRequest(request()).host,'api.openai.com');
  for(const mutate of [r=>r.method='CONNECT',r=>r.url='https://api.openai.com/v1/responses',r=>r.url='/v1/responses?url=https://evil.com',r=>r.url='/v1/%72esponses',r=>r.url='/v1/../v1/responses',r=>r.headers.host='www.cloudflare.com',r=>r.headers.upgrade='websocket',r=>r.headers.connection='Host',r=>r.headers['proxy-authorization']='secret',r=>r.rawHeaders.push('Host','evil.com')]){const r=request();mutate(r);assert.throws(()=>gatewayRequest(r));}
});
