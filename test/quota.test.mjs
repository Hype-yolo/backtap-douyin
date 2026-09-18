import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DailyQuota} from '../src/quota.mjs';

test('daily quota persists across instances and serializes concurrent requests', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backtap-quota-'));
  try {
    const path=join(dir,'quota.json');
    const quota=new DailyQuota(path,3);
    const results=await Promise.allSettled(Array.from({length:6},()=>quota.take()));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,3);
    assert.equal(JSON.parse(await readFile(path,'utf8')).count,3);
    await assert.rejects(new DailyQuota(path,3).take(),{code:'DAILY_LIMIT'});
    await writeFile(path,JSON.stringify({day:'2000-01-01',count:3}));
    await new DailyQuota(path,3).take();
    assert.equal(JSON.parse(await readFile(path,'utf8')).count,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('malformed current quota fails closed instead of resetting',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backtap-quota-'));
  try {
    const path=join(dir,'quota.json');
    await writeFile(path,'not json');
    await assert.rejects(new DailyQuota(path).take());
    await writeFile(path,JSON.stringify({day:new Date().toISOString().slice(0,10),count:-1}));
    await assert.rejects(new DailyQuota(path).take(),/Invalid quota/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
