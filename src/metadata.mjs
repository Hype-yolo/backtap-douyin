import {AppError} from './errors.mjs';
import {validateMediaURL} from './links.mjs';

export function fromDetail(payload,id) {
 const item=payload?.aweme_detail;
 if(payload?.status_code!==0||!item||String(item.aweme_id)!==id)throw new AppError('VIDEO_UNAVAILABLE','平台未返回目标视频，作品可能不可用。');
 const video=item.video;
 if(!video||item.images?.length)throw new AppError('UNSUPPORTED_TYPE','目前只支持单条视频，暂不支持图集。');
 const choices=[video.play_addr_h264,video.play_addr,...(video.bit_rate||[]).filter(b=>!b.is_h265).map(b=>b.play_addr)].filter(Boolean);
 for(const address of choices){
  for(const raw of address.url_list||[]){
   const url=validateMediaURL(raw,id);
   if(!url||!/(?:^|\.)(?:douyinvod\.com|zjcdn\.com)$/.test(new URL(url).hostname))continue;
   return {id,title:String(item.desc||'抖音视频').slice(0,300),video_url:url,filename:`douyin-${id}.mp4`,duration:Number(video.duration)>0?Number(video.duration)/1000:null,width:address.width||video.width||null,height:address.height||video.height||null};
  }
 }
 throw new AppError('VIDEO_UNAVAILABLE','平台没有提供可下载的视频地址。');
}
