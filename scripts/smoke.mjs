import {Resolver} from '../src/resolver.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createWriteStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
const resolver=new Resolver({timeoutMs:45000,proxy:process.env.BROWSER_PROXY});
try {
 const result=await resolver.resolve(process.argv[2]||'https://v.douyin.com/m_hYTkSEUow/');
 await mkdir('artifacts',{recursive:true});
 const response=await fetch(result.video_url,{headers:{Referer:'https://www.douyin.com/'},signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`Video download HTTP ${response.status}`);
 const path=`artifacts/${result.filename}`;
 await pipeline(Readable.fromWeb(response.body),createWriteStream(path));
 const media=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height','-of','json',path],{encoding:'utf8'}));
 if(!media.streams.some(s=>s.codec_type==='video')||Number(media.format.duration)<=0)throw new Error('Not a playable video');
 const report={checked_at:new Date().toISOString(),id:result.id,title:result.title,media,path,status:'desktop resolver and downloaded file verified; iPhone Photos not yet verified'};
 await writeFile('artifacts/smoke-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await resolver.close();}
