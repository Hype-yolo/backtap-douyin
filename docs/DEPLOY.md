# 自建解析服务

面向有 Linux、域名和 SSH 经验的服务管理员。普通用户只需[安装快捷指令](INSTALL.md)。本项目提供有额度的公共试用服务；本页供希望自行维护后端的管理员使用，不需要购买第三方解析 API。

## 环境和容量

验证环境：Ubuntu 24.04 x86_64、Node.js 20.20.2、Playwright 1.63.0。需要可访问抖音的网络、HTTPS 域名、Python 3，以及 root/sudo 权限安装系统依赖。

Node.js 至少 20.20；可以使用 Node.js 22。先检查 `node --version`、`npm --version`。安装或升级 Node.js 不属于下面的服务安装步骤，已有服务器应沿用自己的运行时管理方式。

单请求样本解析约 32 秒，早期服务 cgroup 峰值约 421 MiB，后续测试已接近 450 MiB 上限。建议预留至少 600 MiB 可用内存供服务及运行开销；并发默认 1。仓库附带 450 MiB 内存硬上限和一个 CPU 核的算力上限，**这不是所有机器、视频和负载下的稳定性保证**。小内存共享服务器不要直接开放不限量公共接口。

## 1. 安装代码和浏览器

先检查 `/opt/backtap-douyin`、端口 `8796` 和服务名没有被其他产品占用。以下命令以 root 执行，源码目录由 root 持有，运行用户不能修改程序。

```bash
git clone https://github.com/Hype-yolo/backtap-douyin.git /opt/backtap-douyin
cd /opt/backtap-douyin
npm ci --omit=dev
npx playwright install-deps chromium
PLAYWRIGHT_BROWSERS_PATH=/opt/backtap-douyin/browsers npx playwright install chromium --only-shell
useradd --system --home-dir /var/lib/backtap-douyin --shell /usr/sbin/nologin backtap
install -d -o backtap -g backtap -m 700 /var/lib/backtap-douyin
```

`install-deps` 会安装浏览器所需的系统库。用户或目录已经存在时，不要重复创建或覆盖它们；先确认属于本服务。

Ubuntu 24.04 的 AppArmor 可能限制 Chromium 的用户命名空间。仓库提供只匹配本项目浏览器路径的配置，保留 Chromium 沙箱，不需要关闭全系统限制：

```bash
install -m 644 deploy/backtap-chromium.apparmor /etc/apparmor.d/backtap-chromium
apparmor_parser -r /etc/apparmor.d/backtap-chromium
```

仅在使用 AppArmor 的系统执行这一步。配置绑定 Chromium revision `1243` 和 x86_64 路径；升级 Playwright、换架构或换安装路径后，必须核实并更新对应路径。不要改成全目录或全系统放行。

## 2. 配置访问密钥

```bash
cp .env.example .env
openssl rand -hex 24
```

把生成的随机值写进 `.env` 的 `API_TOKEN`。保留 `HOST=127.0.0.1`、`PORT=8796`、`MAX_CONCURRENT=1`。然后安装配置与服务：

```bash
install -m 600 .env /etc/backtap-douyin.env
install -m 644 deploy/backtap-douyin.service /etc/systemd/system/backtap-douyin.service
systemctl daemon-reload
systemctl enable --now backtap-douyin
systemctl status backtap-douyin
curl http://127.0.0.1:8796/health
```

服务开始监听可能需要短暂等待。看到 `ok: true` 只证明进程运行，需要继续做真实解析验证。

## 3. 接入 HTTPS

选择未被其他产品使用的域名，把 DNS 指向你的服务器。已有 Nginx 的机器先备份并查看 `nginx -T`；不要覆盖其他站点。

可将下面内容放进独立站点配置，替换 `download.example.com`：

```nginx
server {
    listen 80;
    server_name download.example.com;
    location / {
        access_log off;
        error_log /dev/null crit;
        proxy_pass http://127.0.0.1:8796;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 8k;
        proxy_read_timeout 55s;
        add_header Referrer-Policy no-referrer always;
    }
}
```

执行 `nginx -t`，通过后 reload。用你已有的证书流程启用 HTTPS；使用 Certbot 的机器可以运行 `certbot --nginx -d download.example.com`。确认 HTTPS 能正常访问后再给手机使用；不要经明文 HTTP 发送服务密钥。

在 `/etc/backtap-douyin.env` 加入 `TRUST_PROXY=1`，再重启**本服务**，即可按 Nginx 提供的客户端地址限流。后端只信任来自本机代理的 `X-Real-IP`。

若希望挂在已有 HTTPS 站点的 `/backtap/` 路径，使用 `deploy/nginx-path.conf`，只在目标站点的 HTTPS server 块中 include 它。手机的服务地址此时是 `https://你的域名/backtap`。

关闭访问和错误日志是为了不把分享链接写进日志；诊断用应用输出的错误编号与错误代码：`journalctl -u backtap-douyin -n 30`。分享日志前仍应检查是否包含其他组件添加的敏感内容。

## 4. 验证真实解析与媒体文件

在源码目录运行下面脚本，它读取本地 `.env`，不会把密钥或临时视频地址打印到终端。把基础地址和公开视频链接换成自己的：

```bash
node --env-file=.env --input-type=module - https://download.example.com https://v.douyin.com/你的短链接/ <<'JS'
const [base,url]=process.argv.slice(2);
const r=await fetch(base+'/v1/resolve',{
  method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer '+process.env.API_TOKEN},
  body:JSON.stringify({url}),signal:AbortSignal.timeout(55000)
});
const data=await r.json();
if(!r.ok||!data.ok)throw new Error(data.error?.message||'解析失败');
const video=await fetch(data.video_url,{
  headers:{Referer:'https://www.douyin.com/'},signal:AbortSignal.timeout(120000)
});
if(!video.ok)throw new Error('视频下载失败: '+video.status);
const {pipeline}=await import('node:stream/promises');
const {createWriteStream}=await import('node:fs');
await pipeline(video.body,createWriteStream('test-video.mp4'));
console.log({id:data.id,width:data.width,height:data.height,saved:'test-video.mp4'});
JS
```

打开 `test-video.mp4`，核对内容、声音与时长；如已安装 ffprobe，也可以使用它核验。最后按[自建版手机配置说明](SELFHOST-INSTALL.md)在 iPhone 验证存入相册。一次成功不代表所有视频都能解析。

## 5. 给用户安装

提供你的 HTTPS 基础地址和访问密钥，以及 v0.1.0 自建版 Release 下载链接，或下面生成的自有安装包（v0.2.0 公共版预填作者服务地址）。默认是一枚共享访问密钥；把它给某人即授权该人使用你的解析服务。公共推广前请自行决定访问控制、额度和成本。

如需自有品牌的快捷指令，可以在 macOS 生成预填服务地址的版本：

```bash
python3 scripts/build_shortcut.py --endpoint https://download.example.com
shortcuts sign --mode anyone --input shortcuts/轻点下载.unsigned.shortcut --output shortcuts/backtap-douyin.shortcut
```

这不会预填密钥，用户仍需填写。将签名文件复制为服务器的 `public/backtap-douyin.shortcut`，即可启用 `/download/backtap-douyin.shortcut`；未放置时该地址返回 404。静态首页的安装按钮指向本站下载路径。自行部署时请修改首页中的作者服务说明、额度和外部链接，使其符合自己的服务。

## 可选公共模式

只有准备好为所有访问者承担请求成本时再开启：

```dotenv
PUBLIC_ACCESS=1
DAILY_LIMIT=100
QUOTA_FILE=/var/lib/backtap-douyin/quota.json
MAX_CONCURRENT=1
RATE_LIMIT_PER_MINUTE=5
TRUST_PROXY=1
```

公共模式不检查密钥，使用 UTC 日期的持久化总请求额度；无效链接不扣额度，已受理的有效链接即使解析失败也会计入额度。它不是多用户配额或收费系统，只支持单进程写入一个额度文件。

给公共模式生成指令需要追加 `--public`。不要用本项目作者的域名作为你的服务地址；只有使用作者维护的公开试用版时才使用安装页预填的地址；自行部署时使用自己的域名。

## 更新、停止与排错

- 更新前备份代码、`/etc/backtap-douyin.env` 和额度状态；检查 changelog、依赖和浏览器版本后更新，最后只重启 `backtap-douyin`。
- 查看资源：`systemctl show backtap-douyin -p MemoryCurrent -p MemoryPeak -p NRestarts`。
- 停止：`systemctl disable --now backtap-douyin`，移除仅属于该服务的 Nginx 配置，`nginx -t` 后 reload。保留数据，便于恢复。
- `RESOLVE_FAILED`：检查公网访问、平台限制、资源上限和 journal；不要导入个人登录 Cookie 作为默认解决办法。
- `RESOLVE_TIMEOUT`：请求超过 50 秒时返回超时并退出本服务，由 systemd 自动恢复；不会重启整台服务器或其他产品。
- Chromium 沙箱错误：核对 AppArmor 配置的可执行文件路径与运行用户，不要简单添加 `--no-sandbox`。
- 反复被 OOM 杀死或影响其他服务：先停服务，降低开放范围或调整容量，不要直接取消资源限制。
