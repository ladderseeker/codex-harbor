import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { resolverProfile, parseDnsJson, queryDnsJson } from '../../infra/egress/resolver.mjs';
const host='api.openai.com';
const valid=()=>({Status:0,TC:false,CD:false,Question:[{name:host+'.',type:1}],Answer:[{name:host+'.',type:1,data:'1.1.1.1'}]});
test('resolver selection is a fixed administrator profile',()=>{
  assert.equal(resolverProfile(),'system');assert.equal(resolverProfile('cloudflare-doh'),'cloudflare-doh');
  for(const value of ['https://evil.com','cloudflare','',null])assert.throws(()=>resolverProfile(value));
});
test('authenticated DNS payload checks status, question, record types and alias ownership',()=>{
  assert.deepEqual(parseDnsJson(valid(),host,1),[{address:'1.1.1.1',family:4}]);
  const aliased=valid();aliased.Answer=[{name:host,type:5,data:'provider.example.'},{name:'provider.example.',type:1,data:'1.1.1.1'}];
  assert.equal(parseDnsJson(aliased,host,1).length,1);
  for(const mutate of [b=>b.Status=3,b=>b.TC=true,b=>b.CD=true,b=>b.Question[0].type=28,b=>b.Question[0].name='evil.com',b=>b.Answer[0].name='evil.com',b=>b.Answer[0].type=16,b=>b.Answer[0].data='127.1',b=>b.Answer=Array(33).fill(b.Answer[0]),b=>b.Answer=[{name:host,type:5,data:host}]]){
    const body=valid();mutate(body);assert.throws(()=>parseDnsJson(body,host,1));
  }
});
function transport(status,body,verify=()=>{},headers={'content-type':'application/dns-json'}){
  return (options,callback)=>{
    verify(options);const req=new EventEmitter();req.destroy=()=>{};
    req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.headers=headers;callback(res);res.end(body)});
    return req;
  };
}
test('DoH uses fixed bootstrap IP with verified TLS identity, rejects redirects and oversized bodies',async()=>{
  const answers=await queryDnsJson(host,1,transport(200,JSON.stringify(valid()),o=>{
    assert.equal(o.host,'1.1.1.1');assert.equal(o.servername,'cloudflare-dns.com');assert.equal(o.rejectUnauthorized,true);assert.equal(o.headers.Host,'cloudflare-dns.com');assert.equal(o.agent,false);assert.equal(o.path,'/dns-query?name=api.openai.com&type=1&cd=false');
  }));assert.equal(answers.length,1);
  await assert.rejects(queryDnsJson(host,1,transport(302,'',()=>{},{location:'https://evil.com'})));
  await assert.rejects(queryDnsJson(host,1,transport(200,'X'.repeat(16385))));
  await assert.rejects(queryDnsJson(host,1,transport(200,'{}')));
  assert.throws(()=>queryDnsJson('evil.com',1));
});
test('stalled authenticated DNS requests are destroyed at the fixed deadline',async()=>{
  let destroyed=false;
  await assert.rejects(queryDnsJson(host,1,()=>{const req=new EventEmitter();req.end=()=>{};req.destroy=()=>{destroyed=true};return req}));
  assert.equal(destroyed,true);
});
