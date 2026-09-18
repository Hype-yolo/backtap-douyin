import test from 'node:test';
import assert from 'node:assert/strict';
import {fromDetail} from '../src/metadata.mjs';
const id='7685290972925709587';
const payload=(video)=>({status_code:0,aweme_detail:{aweme_id:id,desc:'测试视频',video}});
test('requires the exact target video and rejects image galleries',()=>{
 assert.throws(()=>fromDetail({status_code:0,aweme_detail:{aweme_id:'111'}},id),{code:'VIDEO_UNAVAILABLE'});
 assert.throws(()=>fromDetail({...payload({}),aweme_detail:{...payload({}).aweme_detail,images:[{}]}},id),{code:'UNSUPPORTED_TYPE'});
});
test('prefers compatible source and refuses unrelated media hosts',()=>{
 const p=payload({duration:12000,play_addr_h264:{width:1080,height:1920,url_list:['https://evil.test/movie','https://v11-weba.douyinvod.com/movie.mp4']},play_addr:{url_list:['https://v26-web.douyinvod.com/hevc.mp4']}});
 const result=fromDetail(p,id);assert.equal(result.width,1080);assert.equal(result.duration,12);assert.equal(result.video_url,'https://v11-weba.douyinvod.com/movie.mp4');
 assert.throws(()=>fromDetail(payload({play_addr:{url_list:['https://evil.test/movie']}}),id),{code:'VIDEO_UNAVAILABLE'});
});
