import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {AppError} from './errors.mjs';

// Persist only a daily counter, never a user's IP, clipboard, or link.
export class DailyQuota {
  constructor(path,limit=100) {this.path=path;this.limit=limit;this.serial=Promise.resolve();}
  take() {
    const task=this.serial.then(async()=>{
      const day=new Date().toISOString().slice(0,10);
      let state={day,count:0};
      try{const saved=JSON.parse(await readFile(this.path,'utf8'));if(saved.day===day)state=saved;}
      catch(e){if(e.code!=='ENOENT')throw e;}
      if(!Number.isSafeInteger(state.count)||state.count<0)throw new Error('Invalid quota counter');
      if(state.count>=this.limit)throw new AppError('DAILY_LIMIT','试用服务今天的下载额度已用完，请明天再试，或使用自建服务。',429);
      state.count++;
      await mkdir(dirname(this.path),{recursive:true});
      await writeFile(this.path+'.tmp',JSON.stringify(state),{mode:0o600});
      await rename(this.path+'.tmp',this.path);
    });
    this.serial=task.catch(()=>{});return task;
  }
}
