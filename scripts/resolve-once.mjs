import {Resolver} from '../src/resolver.mjs';
import {writeFile} from 'node:fs/promises';
const start=Date.now(),resolver=new Resolver({timeoutMs:30000,maxConcurrent:1});
try {
 const result=await resolver.resolve(process.argv[2]||'https://www.douyin.com/video/7685290972925709587');
 if(process.env.RESULT_PATH)await writeFile(process.env.RESULT_PATH,JSON.stringify(result),{mode:0o600});
 const {video_url,...safe}=result;
 console.log(JSON.stringify({...safe,elapsed_ms:Date.now()-start,media_host:new URL(video_url).hostname}));
}finally{await resolver.close();}
