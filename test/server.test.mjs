import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/server.mjs';
import {AppError} from '../src/errors.mjs';
const token='test-only-token-not-a-production-key';
async function fixture(t,options={}) {
 const calls=[];
 const server=createServer({token,resolver:{resolve:async url=>{calls.push(url);return{id:'7685290972925709587',video_url:'https://v11-weba.douyinvod.com/test',filename:'douyin-test.mp4'};}},...options});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 return {base:`http://127.0.0.1:${server.address().port}`,calls};
}
test('requires a non-placeholder token at startup',()=>{
 assert.throws(()=>createServer({token:'short'}));
 assert.throws(()=>createServer({token:'replace-with-a-long-random-token'}));
});
test('health is public but resolve requires authentication',async t=>{
 const {base,calls}=await fixture(t);
 assert.equal((await fetch(base+'/health')).status,200);
 assert.equal((await fetch(base+'/v1/resolve?url=x')).status,401);
 assert.equal(calls.length,0);
});
test('supports GET for Shortcuts and POST for integrations',async t=>{
 const {base,calls}=await fixture(t);
 const headers={authorization:`Bearer ${token}`};
 let r=await fetch(base+'/v1/resolve?url=https%3A%2F%2Fv.douyin.com%2Fexample%2F',{headers});
 assert.equal((await r.json()).ok,true);
 r=await fetch(base+'/v1/resolve',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({url:'https://v.douyin.com/other/'})});
 assert.equal(r.status,200);assert.deepEqual(calls,['https://v.douyin.com/example/','https://v.douyin.com/other/']);
});
test('rate limits are enforced before browser work',async t=>{
 const {base,calls}=await fixture(t,{rateLimit:1});
 const request=()=>fetch(base+'/v1/resolve?url=x',{headers:{authorization:`Bearer ${token}`}});
 assert.equal((await request()).status,200);assert.equal((await request()).status,429);assert.equal(calls.length,1);
});
test('structured error preserves useful user message',async t=>{
 const {base}=await fixture(t,{resolver:{resolve:async()=>{throw new AppError('VERIFICATION_REQUIRED','抖音要求验证。');}}});
 const r=await fetch(base+'/v1/resolve?url=x',{headers:{authorization:`Bearer ${token}`}});
 assert.equal(r.status,422);assert.equal((await r.json()).error.code,'VERIFICATION_REQUIRED');
});
test('unexpected errors do not leak upstream URLs or credentials',async t=>{
 const {base}=await fixture(t,{resolver:{resolve:async()=>{throw new Error('secret-token=https://private.example/');}}});
 const r=await fetch(base+'/v1/resolve?url=x',{headers:{authorization:`Bearer ${token}`}});
 assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret-token'));
});

test('public mode requires a quota and validates before consuming it',async t=>{
 assert.throws(()=>createServer({publicAccess:true}),/quota/);
 let used=0;
 const {base,calls}=await fixture(t,{publicAccess:true,quota:{take:async()=>{used++;}}});
 assert.equal((await fetch(base+'/v1/resolve?url=https://evil.test')).status,400);
 assert.equal(used,0);
 const r=await fetch(base+'/v1/resolve?url=https://v.douyin.com/example/');
 assert.equal(r.status,200);assert.equal(used,1);assert.equal(calls.length,1);
});
test('proxy-aware public rate limit distinguishes clients and rejects invalid forwarded IPs',async t=>{
 const {base}=await fixture(t,{publicAccess:true,quota:{take:async()=>{}},trustProxy:true,rateLimit:1});
 const request=ip=>fetch(base+'/v1/resolve?url=https://v.douyin.com/example/',{headers:{'x-real-ip':ip}});
 assert.equal((await request('192.0.2.1')).status,200);
 assert.equal((await request('192.0.2.1')).status,429);
 assert.equal((await request('192.0.2.2')).status,200);
 assert.equal((await request('invalid-one')).status,200);
 assert.equal((await request('invalid-two')).status,429);
});
test('stalled browser work returns a bounded error and triggers recovery',async t=>{
 let recoveries=0;
 const {base}=await fixture(t,{requestDeadlineMs:15,onStall:()=>{recoveries++;},resolver:{resolve:()=>new Promise(()=>{})}});
 const r=await fetch(base+'/v1/resolve?url=x',{headers:{authorization:`Bearer ${token}`}});
 assert.equal(r.status,504);assert.equal((await r.json()).error.code,'RESOLVE_TIMEOUT');assert.equal(recoveries,1);
});
