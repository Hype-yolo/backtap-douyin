import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Resolver } from './resolver.mjs';
import { AppError } from './errors.mjs';
import { DailyQuota } from './quota.mjs';
import { extractLink } from './links.mjs';
import { isIP } from 'node:net';

function authenticated(req,token) {
  const supplied=Buffer.from(req.headers.authorization||'');
  const expected=Buffer.from(`Bearer ${token}`);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}

export function createServer({resolver,token,rateLimit=10,now=Date.now,publicAccess=false,quota,trustProxy=false,requestDeadlineMs=50000,onStall=()=>{}}) {
  if(!publicAccess&&(typeof token!=='string'||token.length<24||token.startsWith('replace-'))) throw new Error('API_TOKEN must contain at least 24 characters; generate one with openssl rand -hex 24.');
  if(publicAccess&&!quota)throw new Error('Public mode requires a persistent daily quota.');
  const buckets=new Map();
  let totalWindow=0,totalRequests=0;
  return http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    try {
      const u=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&u.pathname==='/health') return json(200,{ok:true,service:'backtap-douyin',version:'0.2.0'});
      if(req.method==='GET'&&u.pathname==='/download/backtap-douyin.shortcut') {
        let bytes;
        try{bytes=await readFile(new URL('../public/backtap-douyin.shortcut',import.meta.url));}
        catch(e){if(e.code==='ENOENT')return json(404,{ok:false,error:{code:'SHORTCUT_NOT_CONFIGURED',message:'管理员尚未提供本站快捷指令安装包。'}});throw e;}
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename=\"backtap-douyin.shortcut\"; filename*=UTF-8''"+encodeURIComponent('轻点下载.shortcut')});
        return res.end(bytes);
      }
      if(req.method==='GET'&&u.pathname==='/') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(await readFile(new URL('../public/index.html',import.meta.url)));
      }
      if(u.pathname!=='/v1/resolve') return json(404,{ok:false,error:{code:'NOT_FOUND',message:'接口不存在。'}});
      if(!['GET','POST'].includes(req.method)) return json(405,{ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'请使用 GET 或 POST。'}});
      if(!publicAccess&&!authenticated(req,token)) throw new AppError('UNAUTHORIZED','服务密钥不正确，请检查快捷指令顶部的设置。',401);
      const time=now();
      let address=req.socket.remoteAddress;
      const forwarded=req.headers['x-real-ip'];
      if(trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)&&typeof forwarded==='string'&&isIP(forwarded))address=forwarded;
      for(const [key,bucket] of buckets) if(time-bucket.start>=60000) buckets.delete(key);
      if(time-totalWindow>=60000){totalWindow=time;totalRequests=0;}
      const bucket=buckets.get(address)||{start:time,count:0};
      if(bucket.count>=rateLimit||totalRequests>=rateLimit*4) {res.setHeader('Retry-After','60');throw new AppError('RATE_LIMITED','下载请求较多，请一分钟后重试。',429);}
      bucket.count++;totalRequests++;buckets.set(address,bucket);
      let input=u.searchParams.get('url');
      if(req.method==='POST') {
        if(!String(req.headers['content-type']).startsWith('application/json')) throw new AppError('INVALID_REQUEST','请发送 JSON 请求。',415);
        let body='';
        for await (const chunk of req) {body+=chunk.toString();if(Buffer.byteLength(body)>8192)throw new AppError('TOO_LARGE','请求内容过长。',413);}
        try{input=JSON.parse(body).url;}catch{throw new AppError('INVALID_REQUEST','请求格式不正确。',400);}
      }
      if(publicAccess){input=extractLink(input).href;await quota.take();}
      let deadline;
      const timedOut=new Promise((_,reject)=>{
        deadline=setTimeout(()=>{
          reject(new AppError('RESOLVE_TIMEOUT','解析超时，服务正在恢复，请一分钟后重试。',504));
          onStall();
        },requestDeadlineMs);
      });
      let result;
      try{result=await Promise.race([resolver.resolve(input),timedOut]);}
      finally{clearTimeout(deadline);}
      return json(200,{ok:true,...result});
    } catch(e) {
      if(res.headersSent) return res.end();
      const known=e instanceof AppError;
      // Never log clipboard text, credentials, signed media URLs or upstream response bodies.
      console.info(JSON.stringify({request_id:requestId,code:known?e.code:'INTERNAL_ERROR'}));
      return json(known?e.status:502,{ok:false,error:{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'服务暂时不可用，请稍后再试。'},request_id:requestId});
    }
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const positive=(name,fallback)=>{const n=Number(process.env[name]||fallback);if(!Number.isInteger(n)||n<1)throw new Error(`${name} must be a positive integer`);return n;};
  const resolver=new Resolver({timeoutMs:positive('RESOLVE_TIMEOUT_MS',40000),maxConcurrent:positive('MAX_CONCURRENT',1),proxy:process.env.BROWSER_PROXY});
  const publicAccess=process.env.PUBLIC_ACCESS==='1';
  const server=createServer({resolver,token:process.env.API_TOKEN,rateLimit:positive('RATE_LIMIT_PER_MINUTE',10),publicAccess,trustProxy:process.env.TRUST_PROXY==='1',onStall:()=>setTimeout(()=>process.exit(1),1000).unref(),quota:publicAccess?new DailyQuota(process.env.QUOTA_FILE||'.local/quota.json',positive('DAILY_LIMIT',100)):undefined});
  server.requestTimeout=15000;server.headersTimeout=10000;
  const host=process.env.HOST||'127.0.0.1',port=positive('PORT',8796);
  server.listen(port,host,()=>console.info(`轻点下载 listening at http://${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();resolver.close().finally(()=>process.exit(0));});
}
