import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLink,expandLink,validateMediaURL} from '../src/links.mjs';

test('extract only the Douyin link from copied share text',()=>{
 assert.equal(extractLink('5.87 复制打开抖音 https://v.douyin.com/m_hYTkSEUow/ RxF:/').href,'https://v.douyin.com/m_hYTkSEUow/');
 assert.equal(extractLink('https://www.douyin.com/video/7685290972925709587?tracking=private').href,'https://www.douyin.com/video/7685290972925709587');
});
test('reject non-video links, malicious hosts, local network and credential URLs',()=>{
 for(const input of ['http://127.0.0.1/a','https://www.douyin.com.evil.example/video/7685290972925709587','https://evil@www.douyin.com/video/7685290972925709587','https://www.douyin.com:8443/video/7685290972925709587','https://www.douyin.com/user/abc','file:///etc/passwd','plain text','x'.repeat(5000)])assert.throws(()=>extractLink(input));
});
test('expand a short link and strip unrelated share parameters',async()=>{
 const id=await expandLink('https://v.douyin.com/example/',{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://www.iesdouyin.com/share/video/7685290972925709587/?did=private'}})});
 assert.equal(id,'7685290972925709587');
});
test('never follow a redirect to another host',async()=>{
 let calls=0;
 await assert.rejects(expandLink('https://v.douyin.com/example/',{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data/'}});}}));
 assert.equal(calls,1);
});
test('bound redirect loops',async()=>{
 let calls=0;
 await assert.rejects(expandLink('https://v.douyin.com/example/',{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://v.douyin.com/example/'}});}}));
 assert.equal(calls,5);
});
test('reject wrong-video, placeholder and arbitrary media URLs',()=>{
 const id='7685290972925709587';
 assert.ok(validateMediaURL(`https://v11-weba.douyinvod.com/file?__vid=${id}`,id));
 for(const url of ['http://v11-weba.douyinvod.com/a','https://v11-weba.douyinvod.com.evil.example/a','https://lf-douyin-pc-web.douyinstatic.com/loading.mp4','https://v11-weba.douyinvod.com/a?__vid=123','https://localhost/a'])assert.equal(validateMediaURL(url,id),null);
});
