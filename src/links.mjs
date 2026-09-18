import { AppError } from './errors.mjs';

const hosts = new Set(['v.douyin.com','www.douyin.com','douyin.com','www.iesdouyin.com','v.iesdouyin.com']);
const idPattern = /^\d{18,20}$/;

export function validateDouyinURL(value) {
  let u;
  try { u = new URL(value); } catch { throw new AppError('INVALID_LINK','请先复制抖音视频的分享链接。',400); }
  if (!['https:','http:'].includes(u.protocol) || !hosts.has(u.hostname) || u.username || u.password || u.port) {
    throw new AppError('INVALID_LINK','只支持抖音视频链接。',400);
  }
  u.protocol = 'https:';
  return u;
}

export function extractLink(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new AppError('INVALID_LINK','链接内容不正确或过长。',400);
  const candidates = text.match(/https?:\/\/[^\s<>"\]\[，。！？）]+/g) || [];
  for (const candidate of candidates) {
    try {
      const u = validateDouyinURL(candidate);
      const id = videoId(u);
      if (id) return new URL(`https://www.douyin.com/video/${id}`);
      if (['v.douyin.com','v.iesdouyin.com'].includes(u.hostname) && /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) {
        return new URL(`https://${u.hostname}${u.pathname}`);
      }
    } catch {}
  }
  throw new AppError('INVALID_LINK','没有找到抖音视频链接，请在抖音中点“分享 → 复制链接”。',400);
}

export function videoId(url) {
  const u = typeof url === 'string' ? validateDouyinURL(url) : url;
  const id = u.pathname.match(/^\/(?:share\/)?video\/(\d+)\/?$/)?.[1] || u.searchParams.get('modal_id');
  return idPattern.test(id || '') ? id : null;
}

// Follow only Douyin's known hosts. Never fetch an arbitrary URL from the clipboard.
export async function expandLink(text, {fetchImpl = fetch, signal} = {}) {
  let u = extractLink(text);
  for (let i = 0; i < 5; i++) {
    const id = videoId(u);
    if (id) return id;
    const res = await fetchImpl(u, {redirect:'manual', signal, headers:{'User-Agent':'Mozilla/5.0'}});
    await res.body?.cancel();
    if (![301,302,303,307,308].includes(res.status)) break;
    const location = res.headers.get('location');
    if (!location) break;
    u = validateDouyinURL(new URL(location,u));
  }
  throw new AppError('LINK_EXPIRED','未能展开这个分享链接，请回到抖音重新复制。');
}

export function validateMediaURL(value, id) {
  let u; try { u = new URL(value); } catch { return null; }
  const allowed = ['douyinvod.com','douyin.com','snssdk.com','bytecdn.cn','bytecdn.com','zjcdn.com'];
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed.some(h=>u.hostname===h || u.hostname.endsWith('.'+h))) return null;
  const embedded = u.searchParams.get('__vid');
  if (embedded && embedded !== id) return null;
  return u.href;
}
