import { chromium } from 'playwright';
import { AppError } from './errors.mjs';
import { expandLink } from './links.mjs';
import {fromDetail} from './metadata.mjs';

export class Resolver {
  constructor({timeoutMs=35000, maxConcurrent=2, proxy, headless=true}={}) {
    this.timeoutMs=timeoutMs; this.maxConcurrent=maxConcurrent; this.proxy=proxy; this.headless=headless;
    this.active=0; this.cache=new Map(); this.inflight=new Map();
  }
  async browser() {
    if (!this.launching) {
      const launching = chromium.launch({headless:this.headless,chromiumSandbox:true,timeout:15000,args:['--renderer-process-limit=1'],proxy:this.proxy?{server:this.proxy}:undefined})
        .then(b=>{b.on('disconnected',()=>{if(this.launching===launching)this.launching=null;});return b;})
        .catch(e=>{if(this.launching===launching)this.launching=null;throw e;});
      this.launching=launching;
    }
    return this.launching;
  }
  async resolve(text) {
    const deadline=Date.now()+this.timeoutMs;
    const id=await expandLink(text,{signal:AbortSignal.timeout(Math.min(10000,this.timeoutMs))});
    const cached=this.cache.get(id);
    if(cached && cached.expires>Date.now()) return cached.value;
    if(this.inflight.has(id)) return this.inflight.get(id);
    if(this.active>=this.maxConcurrent) throw new AppError('BUSY','正在处理其他下载，请稍后再轻点背面。',429);
    this.active++;
    clearTimeout(this.idleTimer);
    const task=this.inspect(id,deadline).then(value=>{
      for(const [k,v] of this.cache) if(v.expires<=Date.now()) this.cache.delete(k);
      if(this.cache.size>=100) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(id,{value,expires:Date.now()+60000});return value;
    }).finally(()=>{
      this.active--;this.inflight.delete(id);
      if(this.active===0) this.idleTimer=setTimeout(()=>{
        if(this.active===0 && this.launching) {
          const old=this.launching;this.launching=null;
          old.then(b=>b.close()).catch(()=>{});
        }
      },1000).unref();
    });
    this.inflight.set(id,task);return task;
  }
  async inspect(id,deadline) {
    const browser=await this.browser();
    const context=await browser.newContext({locale:'zh-CN',viewport:{width:640,height:480},serviceWorkers:'block'});
    const remaining=()=>Math.max(1,deadline-Date.now());
    try {
      // No personal profiles, cookies, CAPTCHA solving, or media transfer.
      await context.route('**/*',route=>{
        const request=route.request(),host=new URL(request.url()).hostname;
        if(['image','font','media'].includes(request.resourceType())||/zijieapi\.com$|zlink\.toutiao\.com$/.test(host))return route.abort();
        return route.continue();
      });
      const page=await context.newPage();
      const detail=page.waitForResponse(r=>{
        const u=new URL(r.url());
        return u.hostname==='www.douyin.com'&&u.pathname==='/aweme/v1/web/aweme/detail/'&&u.searchParams.get('aweme_id')===id&&r.status()===200;
      },{timeout:remaining()});
      // Attach a rejection handler immediately, including when navigation fails first.
      detail.catch(()=>{});
      await page.goto(`https://www.douyin.com/video/${id}`,{waitUntil:'commit',timeout:remaining()});
      const response=await detail;
      return fromDetail(await response.json(),id);
    } catch(e) {
      if(e instanceof AppError)throw e;
      throw new AppError('RESOLVE_FAILED','抖音暂未返回视频信息，可能是网络、平台验证或作品限制，请稍后重试。',502);
    } finally {
      await context.close();
    }
  }
  async close() {clearTimeout(this.idleTimer);if(this.launching) await (await this.launching).close();}
}
