import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'child_process';
import ConfigLoader from '../model/config_loader.js';

const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'bilibili');
const BILI_VIDEO_INFO_API = "http://api.bilibili.com/x/web-interface/view";
const BILI_PLAY_STREAM_API = "https://api.bilibili.com/x/player/playurl";
const BILI_STREAM_INFO_API = "https://api.live.bilibili.com/room/v1/Room/get_info";
const COMMON_HEADER = {
    'User-Agent': 'Mozilla.5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
};
const redisBiliKey = "lotus:parser:bilibili_multi_page:";

export class BilibiliParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] B站解析',
            dsc: '处理B站视频、直播链接',
            event: 'message',
            priority: 0,
            rule: [
                {
                    reg: '(bilibili.com|b23.tv|bili2233.cn|t.bilibili.com|^BV[1-9a-zA-Z]{10}$)',
                    fnc: 'parse'
                },
                { reg: '^#B站登录$', fnc: 'login', permission: 'master' },
                { reg: '^#p\\s*(all|\\d+)$', fnc: 'handlePageSelection' }
            ]
        });
        this.cleanupDataDir();
    }

    cleanupDataDir() {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            return;
        }
        try {
            const files = fs.readdirSync(dataDir);
            for (const file of files) {
                const fullPath = path.join(dataDir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                }
            }
        } catch (err) {
            logger.error(`[荷花插件][B站] 自动清理临时文件失败: ${err.message}`);
        }
    }

    async parse(e) {
        const rawMsg = e.raw_message || e.msg || "";
        const cleanMsg = rawMsg.replace(/\\\//g, '/');
        const surgicalRegex = /(https?:\/\/(?:www\.bilibili\.com\/video\/[^"'\s,\]}]+|b23\.tv\/[^"'\s,\]}]+|live\.bilibili\.com\/[^"'\s,\]}]+))|(BV[1-9a-zA-Z]{10})/i;
        const match = cleanMsg.match(surgicalRegex);
        if (!match) return false;

        const contentToParse = match[1] || match[2];

        try {
            const normalizedUrl = await this.normalizeUrl(contentToParse);
            if (normalizedUrl.includes("live.bilibili.com")) {
                await this.handleLive(e, normalizedUrl);
                return true;
            }

            const videoInfo = await this.getVideoInfo(normalizedUrl);
            if (!videoInfo) throw new Error("未能获取到视频信息");

            if (videoInfo.pages.length > 1) {
                const redisKey = `${redisBiliKey}${e.group_id}:${e.user_id}`;
                await redis.set(redisKey, JSON.stringify({ url: normalizedUrl, videoInfo }), { EX: 300 });

                await e.reply(this.constructInfoMessage(videoInfo, null, true));
                await e.reply("这是一个视频合集，请在5分钟内回复 `#p[序号]` 或 `#p all` 进行下载。");

            } else {
                await this.handleSinglePageVideo(e, normalizedUrl, videoInfo);
            }
        } catch (error) {
            return false;
        }
        return true;
    }

    async handlePageSelection(e) {
        const redisKey = `${redisBiliKey}${e.group_id}:${e.user_id}`;
        const dataJson = await redis.get(redisKey);
        if (!dataJson) {
            return e.reply("分P选择已超时，请重新发送视频链接。");
        }
        await redis.del(redisKey);

        const { url, videoInfo } = JSON.parse(dataJson);
        const selection = e.msg.replace(/^#p\s*/, '').trim().toLowerCase();

        const tempPath = path.join(dataDir, `${e.group_id || e.user_id}_${Date.now()}`);

        try {
            if (selection === 'all') {
                await this.handleMergeAllPages(e, url, videoInfo, tempPath);
                return;
            }

            const pageNum = parseInt(selection);
            if (isNaN(pageNum)) return;

            const cfg = ConfigLoader.cfg;
            const pageInfo = videoInfo.pages[pageNum - 1];
            if (!pageInfo) {
                return e.reply(`指定的P${pageNum}不存在，该合集共有${videoInfo.pages.length}P。`);
            }
            if (pageInfo.duration > cfg.bilibili.durationLimit) {
                return e.reply(`P${pageNum}时长超过 ${(cfg.bilibili.durationLimit / 60).toFixed(0)} 分钟限制，不发送文件。`);
            }

            await fs.promises.mkdir(tempPath, { recursive: true });
            if (cfg.bilibili.useBBDown) {
                await this.downloadSingleWithBBDown(e, url, tempPath, videoInfo, pageNum);
            } else {
                await this.downloadWithApi(e, `${url}?p=${pageNum}`, videoInfo, tempPath);
            }
        } catch (error) {
            logger.error(`[荷花插件][B站][分P选择] 失败:`, error);
            await e.reply(`处理分P #${selection} 失败: ${error.message.split('\n')[0]}`);
        } finally {
            if (fs.existsSync(tempPath)) {
                try { await fs.promises.rm(tempPath, { recursive: true, force: true }); }
                catch (err) { logger.warn(`[荷花插件] 清理临时文件夹(分P) ${tempPath} 失败: ${err.message}`); }
            }
        }
    }
    
    async handleSinglePageVideo(e, url, videoInfo) {
        await e.reply(this.constructInfoMessage(videoInfo));
        const cfg = ConfigLoader.cfg;
        if (videoInfo.duration > cfg.bilibili.durationLimit) {
            return e.reply(`视频时长超过 ${(cfg.bilibili.durationLimit / 60).toFixed(0)} 分钟限制，不发送文件。`);
        }
        const tempPath = path.join(dataDir, `${e.group_id || e.user_id}_${Date.now()}`);
        try {
            await fs.promises.mkdir(tempPath, { recursive: true });
            if (cfg.bilibili.useBBDown) {
                await this.downloadSingleWithBBDown(e, url, tempPath, videoInfo);
            } else {
                await this.downloadWithApi(e, url, videoInfo, tempPath);
            }
        } catch (error) {
            logger.error(`[荷花插件][B站][单P] 失败:`, error);
            await e.reply(`解析失败: ${error.message.split('\n')[0]}`);
        } finally {
            if (fs.existsSync(tempPath)) {
                try { await fs.promises.rm(tempPath, { recursive: true, force: true }); }
                catch (err) { logger.warn(`[荷花插件] 清理临时文件夹(单P) ${tempPath} 失败: ${err.message}`); }
            }
        }
    }
    
    async handleMergeAllPages(e, url, videoInfo, tempPath) {
        await e.reply("已识别到合并全部P数指令，开始下载所有分P，过程可能需要数分钟，请耐心等待...");
        await fs.promises.mkdir(tempPath, { recursive: true });
        
        await this.runBBDown(url, tempPath);

        const filesInTemp = fs.readdirSync(tempPath, { withFileTypes: true });
        const subDir = filesInTemp.find(f => f.isDirectory());
        if (!subDir) {
            throw new Error("BBDown执行完毕，但未找到预期的子文件夹。");
        }
        
        const subDirPath = path.join(tempPath, subDir.name);
        const videoFiles = fs.readdirSync(subDirPath).filter(f => f.endsWith('.mp4') || f.endsWith('.mkv')).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        if (videoFiles.length === 0) {
            throw new Error("在子文件夹中未找到任何视频文件。");
        }

        await e.reply(`所有分P下载完成，共${videoFiles.length}个文件，开始合并...`);

        const filelistPath = path.join(tempPath, 'filelist.txt');
        const filelistContent = videoFiles.map(f => `file '${path.join(subDirPath, f).replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(filelistPath, filelistContent);

        const outputFile = path.join(tempPath, `${videoInfo.bvid}.mp4`);
        await this.mergeFilesWithFfmpeg(filelistPath, outputFile);

        await e.reply("视频合并完成，正在发送...");
        await this.sendVideo(e, outputFile, `${videoInfo.bvid}.mp4`);
    }

    async downloadSingleWithBBDown(e, url, tempPath, videoInfo, pageNum = null) {
        await this.runBBDown(url, tempPath, pageNum, `-F ${videoInfo.bvid}`);
        const expectedFile = path.join(tempPath, `${videoInfo.bvid}.mp4`);
        if (fs.existsSync(expectedFile)) {
            await this.sendVideo(e, expectedFile, `${videoInfo.bvid}.mp4`);
        } else {
            throw new Error(`BBDown执行完毕，但未找到预期的输出文件: ${videoInfo.bvid}.mp4`);
        }
    }
    
    async handleLive(e, url) {
        const roomId = url.match(/live\.bilibili\.com\/(\d+)/)?.[1];
        if (!roomId) throw new Error("无法获取直播间ID");
        const infoResp = await fetch(`${BILI_STREAM_INFO_API}?id=${roomId}`, { headers: COMMON_HEADER });
        const infoJson = await infoResp.json();
        if (infoJson.code !== 0) throw new Error(`获取直播间信息失败: ${infoJson.message}`);
        const { title, user_cover } = infoJson.data;
        const liveMessage = [
            segment.image(user_cover),
            `${ConfigLoader.cfg.general.identifyPrefix} B站直播: ${title}\n📺 独立播放器: https://www.bilibili.com/blackboard/live/live-activity-player.html?enterTheRoom=0&cid=${roomId}`
        ];
        await e.reply(liveMessage);
    }

    async login(e) {
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) {
            return e.reply("未找到BBDown.exe，请主人安装并配置好环境变量，或在parser.yaml中配置toolsPath后重试。");
        }
        
        const configDirForLogin = path.join(pluginRoot, 'config');
        const qrcodePath = path.join(configDirForLogin, 'qrcode.png');
        const logPath = path.join(configDirForLogin, 'login-temp.log');

        if (fs.existsSync(qrcodePath)) try { fs.unlinkSync(qrcodePath); } catch {}
        if (fs.existsSync(logPath)) try { fs.unlinkSync(logPath); } catch {}
        
        await e.reply("正在启动BBDown登录进程，请稍候...");

        const command = `"${bbdownPath}" login > "${logPath}" 2>&1`;
        const bbdown = spawn(command, { cwd: configDirForLogin, shell: true });

        let sent = false;
        const checkQRCode = setInterval(async () => {
            if (sent) {
                clearInterval(checkQRCode);
                return;
            }
            if (fs.existsSync(qrcodePath)) {
                sent = true;
                clearInterval(checkQRCode);
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await e.reply([segment.image(qrcodePath), "请使用Bilibili APP扫描二维码进行登录。"]);
                } catch (err) {
                    logger.error(`[荷花插件][B站登录] 发送二维码失败:`, err);
                    e.reply("生成二维码成功，但发送失败，请检查后台日志。");
                }
            }
        }, 1000);

        bbdown.on('close', async (code) => {
            sent = true;
            clearInterval(checkQRCode);
            
            let logContent = '';
            if (fs.existsSync(logPath)) {
                logContent = fs.readFileSync(logPath, 'utf8');
            }

            if (logContent.includes("登录成功")) {
                await e.reply("BBDown登录成功！Cookie已保存至BBDown.data。");
            } else {
                await e.reply("BBDown登录进程已结束，但未检测到明确的成功标识。\n如果已扫码，可能已经成功，请尝试解析一个会员视频以验证。");
            }

            setTimeout(() => {
                if (fs.existsSync(qrcodePath)) try { fs.unlinkSync(qrcodePath); } catch {}
                if (fs.existsSync(logPath)) try { fs.unlinkSync(logPath); } catch {}
            }, 2000);
        });

        bbdown.on('error', err => {
            sent = true;
            clearInterval(checkQRCode);
            logger.error(`[荷花插件][B站登录] 启动进程失败:`, err);
            e.reply(`启动BBDown登录进程失败: ${err.message}`);
        });
        return true;
    }

    async downloadWithApi(e, url, videoInfo, tempPath) {
         try {
            await e.reply("(小提示：启用BBDown并登录，可解析更高画质和会员视频哦！)");
            const pParam = this.getPParam(url);
            let targetCid = videoInfo.cid;
            if (pParam && videoInfo.pages && videoInfo.pages.length >= pParam) {
                targetCid = videoInfo.pages[pParam - 1].cid;
            }
            const { videoUrl, audioUrl } = await this.getDownloadUrl(videoInfo.bvid, targetCid);
            if (!videoUrl) throw new Error("未能获取到视频流链接");
            const videoFile = path.join(tempPath, 'video.m4s');
            const audioFile = path.join(tempPath, 'audio.m4s');
            const outputFile = path.join(tempPath, 'output.mp4');
            await this.downloadFile(videoFile, videoUrl);
            if (audioUrl) {
                await this.downloadFile(audioFile, audioUrl);
                await this.mergeFilesWithFfmpeg(null, outputFile, videoFile, audioFile);
            } else {
                fs.renameSync(videoFile, outputFile);
            }
            const finalFileName = `av${videoInfo.aid}.mp4`;
            await this.sendVideo(e, outputFile, finalFileName);
         } catch(error) {
            logger.error(`[荷花插件][API下载] 失败:`, error);
            await e.reply(`视频下载失败: ${error.message}`);
        }
    }
    
    async normalizeUrl(input) {
        if (input.startsWith('https://www.bilibili.com/video/') || input.startsWith('https://live.bilibili.com/')) {
            return input;
        }
        const idMatch = input.match(/(BV[1-9a-zA-Z]{10})/i) || input.match(/(av[0-9]+)/i);
        if (idMatch) {
            return `https://www.bilibili.com/video/${idMatch[0]}`;
        }
        const shortUrlMatch = input.match(/https?:\/\/b23\.tv\/[a-zA-Z0-9]+/);
        if (shortUrlMatch) {
            try {
                const resp = await fetch(shortUrlMatch[0], { method: 'HEAD', redirect: 'follow' });
                return resp.url;
            } catch (err) {
                logger.error(`[荷花插件][B站] 短链展开失败: ${err.message}`);
                throw new Error("展开B站短链失败");
            }
        }
        throw new Error("无法规范化链接格式");
    }
    
    async getVideoInfo(url) {
        const idMatch = url.match(/video\/([a-zA-Z0-9]+)/);
        if (!idMatch) throw new Error("无法从URL中提取视频ID");
        const videoId = idMatch[1];
        let apiUrl = videoId.toLowerCase().startsWith('av') ? `${BILI_VIDEO_INFO_API}?aid=${videoId.substring(2)}` : `${BILI_VIDEO_INFO_API}?bvid=${videoId}`;
        const resp = await fetch(apiUrl, { headers: COMMON_HEADER });
        const respJson = await resp.json();
        if (respJson.code !== 0) throw new Error(respJson.message || '请求错误');
        return respJson.data;
    }

    async getDownloadUrl(bvid, cid) {
        const { sessdata } = await this.getSessData();
        const cfg = ConfigLoader.cfg;
        const params = new URLSearchParams({ bvid, cid, qn: cfg.bilibili.resolution, fnval: 16, fourk: 1 }).toString();
        const url = `${BILI_PLAY_STREAM_API}?${params}`;
        const headers = { ...COMMON_HEADER, Cookie: `SESSDATA=${sessdata}` };
        const resp = await fetch(url, { headers });
        const respJson = await resp.json();
        if (respJson.code !== 0) throw new Error(`获取播放地址失败: ${respJson.message}`);
        const dash = respJson.data.dash;
        return { videoUrl: dash.video[0]?.baseUrl, audioUrl: dash.audio[0]?.baseUrl };
    }
    
    constructInfoMessage(videoInfo, partTitle = null, isMultiPage = false) {
        const { pic, stat, owner, title } = videoInfo;
        let infoText = [
            `${ConfigLoader.cfg.general.identifyPrefix} ${title}`,
            partTitle ? `P: ${partTitle}` : '',
            `UP: ${owner.name}`,
            `播放: ${stat.view} | 弹幕: ${stat.danmaku} | 点赞: ${stat.like}`,
        ];
        if (isMultiPage && !partTitle) {
            infoText.push(`(共${videoInfo.pages.length}P)`);
        }
        return [segment.image(pic), infoText.filter(Boolean).join('\n')];
    }
    
    getPParam(url) {
        try { return new URL(url).searchParams.get('p'); } 
        catch (e) { const pMatch = url.match(/[?&]p=([^&]+)/); return pMatch ? pMatch[1] : null; }
    }

    async mergeFilesWithFfmpeg(filelistPath, outputFile, videoFile = null, audioFile = null) {
        const ffmpegPath = await this.findCommandPath('ffmpeg');
        if (!ffmpegPath) throw new Error("未找到ffmpeg");

        let args;
        if (filelistPath) {
            args = ['-f', 'concat', '-safe', '0', '-i', filelistPath, '-c', 'copy', outputFile];
        } else if (videoFile && audioFile) {
            args = ['-i', videoFile, '-i', audioFile, '-c', 'copy', outputFile];
        } else {
            throw new Error("无效的合并参数");
        }
        
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, args);
            ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error("FFmpeg合并失败")));
            ffmpeg.on('error', reject);
        });
    }
    
    downloadFile(dest, url, headers = COMMON_HEADER) {
        return new Promise((resolve, reject) => {
            fetch(url, { headers }).then(res => {
                if (!res.ok) return reject(new Error(`下载失败: ${res.statusText}`));
                const fileStream = fs.createWriteStream(dest);
                res.body.pipe(fileStream);
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
            }).catch(reject);
        });
    }

    async uploadFile(e, filePath, fileName) {
        try {
            if (e.isGroup && e.group.upload) {
                await e.group.upload(filePath, fileName);
            } else if (e.group.fs?.upload) {
                await e.group.fs.upload(filePath, "/", fileName); 
            } else {
                 await e.reply("当前环境无法上传群文件。");
            }
        } finally {}
    }

    async sendVideo(e, filePath, fileName) {
        try {
            const stats = fs.statSync(filePath);
            const videoSize = Math.floor(stats.size / (1024 * 1024));
            const cfg = ConfigLoader.cfg;
            if (videoSize > cfg.general.videoSizeLimit) {
                await e.reply(`视频大小(${videoSize}MB)超过${cfg.general.videoSizeLimit}MB限制，转为上传群文件。`);
                await this.uploadFile(e, filePath, fileName);
            } else {
                await e.reply(segment.video(filePath));
            }
        } catch (err) {
            throw err;
        }
    }
    
    async findCommandPath(command) {
        const cfg = ConfigLoader.cfg;
        const exe = process.platform === 'win32' ? `${command}.exe` : command;
        if (cfg.external_tools.toolsPath) {
            const cmdPath = path.join(cfg.external_tools.toolsPath, exe);
            if (fs.existsSync(cmdPath)) return cmdPath;
        }
        return new Promise((resolve) => {
            const checkCmd = process.platform === 'win32' ? 'where' : 'which';
            const child = spawn(checkCmd, [command]);
            let output = '';
            child.stdout.on('data', (data) => { output += data.toString(); });
            child.on('close', (code) => {
                if (code === 0 && output) { resolve(output.trim().split('\n')[0]); }
                else { resolve(null); }
            });
            child.on('error', (err) => {
                logger.warn(`[荷花插件][环境检查] 执行 ${checkCmd} 失败: ${err.message}`);
                resolve(null);
            });
        });
    }

    async getSessData(forceCheckLogin = false) {
        const cfg = ConfigLoader.cfg;
        if (cfg.bilibili.sessData) {
            return { sessdata: cfg.bilibili.sessData, source: 'config' };
        }
        const bbdownPath = await this.findCommandPath('BBDown');
        if (bbdownPath) {
            const bbdownDir = path.dirname(bbdownPath);
            const bbdownDataPath = path.join(bbdownDir, 'BBDown.data');
            if (fs.existsSync(bbdownDataPath)) {
                try {
                    const cookieData = fs.readFileSync(bbdownDataPath, 'utf8');
                    const sessdataMatch = cookieData.match(/SESSDATA=([^;]+)/);
                    if (sessdataMatch && sessdataMatch[1]) {
                        logger.info('[荷花插件][B站] 已自动从BBDown.data中加载Cookie。');
                        return { sessdata: sessdataMatch[1], source: 'bbdown_data' };
                    }
                } catch (error) {
                    logger.warn(`[荷花插件][B站] 读取BBDown.data失败: ${error.message}`);
                }
            }
        }
        if (forceCheckLogin) {
            throw new Error("BBDown已启用但未找到有效登录凭据，请联系机器人管理员使用 #B站登录 指令进行登录。");
        }
        return { sessdata: "", source: 'none' };
    }

    async runBBDown(url, cwd, pageNum = null, extraArgsStr = '') {
        const cfg = ConfigLoader.cfg;
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) throw new Error("未找到BBDown，请检查环境配置");
        const resolutionMap = {
            120: '8K 超高清',
            116: '1080P 60帧',
            112: '1080P 高码率',
            80: '1080P 高清',
            74: '720P 60帧',
            64: '720P 高清', 
            32: '480P 清晰',
            16: '360P 流畅',
        };
        const dfnPriority = resolutionMap[cfg.bilibili.resolution] || String(cfg.bilibili.resolution);
        const args = [url];
        if (cfg.bilibili.useAria2) args.push('--use-aria2c');
        
        const { sessdata, source } = await this.getSessData();
        if (source === 'config' && sessdata) {
             args.push('-c', `SESSDATA=${sessdata}`);
        }
        if (pageNum) args.push('-p', String(pageNum));
        args.push('--dfn-priority', dfnPriority);
        if(extraArgsStr) args.push(...extraArgsStr.split(' '));
        args.push('--work-dir', cwd);

        return new Promise((resolve, reject) => {
            const bbdown = spawn(bbdownPath, args, { shell: false });
            let output = '';
            bbdown.stdout.on('data', (data) => { output += data.toString(); });
            bbdown.stderr.on('data', (data) => { output += data.toString(); });
            bbdown.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`BBDown进程退出，代码: ${code}\n日志: ${output}`));
                }
            });
            bbdown.on('error', (err) => reject(err));
        });
    }
}