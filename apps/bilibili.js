import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'child_process';
import ConfigLoader from '../model/config_loader.js';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'bilibili');
const configDir = path.join(pluginRoot, 'config');
const BILI_VIDEO_INFO_API = "http://api.bilibili.com/x/web-interface/view";
const BILI_PLAY_STREAM_API = "https://api.bilibili.com/x/player/playurl";
const BILI_STREAM_INFO_API = "https://api.live.bilibili.com/room/v1/Room/get_info";
const COMMON_HEADER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
};
const BILI_DFN_MAP = {
    120: "4K 超高清", 116: "1080P 60帧", 112: "1080P 高码率", 80: "1080P 高清",
    74: "720P 60帧", 64: "720P 高清", 32: "480P 清晰", 16: "360P 流畅",
};

export class BilibiliParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] B站解析',
            dsc: '处理B站视频、直播链接',
            event: 'message',
            priority: 4100,
            rule: [
                {
                    reg: '(bilibili.com|b23.tv|bili2233.cn|t.bilibili.com|^BV[1-9a-zA-Z]{10}$)',
                    fnc: 'parse'
                },
                { reg: '^#B站登录$', fnc: 'login', permission: 'master' }
            ]
        });
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    // --- 修改点 ---: 重构了解析逻辑，使其更健壮
    async parse(e) {
        const rawMsg = e.raw_message || e.msg || "";
        let contentToParse = '';

        // 检查是否为JSON卡片
        if (rawMsg.startsWith('[CQ:json,data=')) {
            // 从卡片中用正则提取URL，这种方法对转义字符有更好的抵抗力
            const urlMatch = rawMsg.match(/"qqdocurl":"(https?:\/\/[^"]+)"/);
            if (urlMatch && urlMatch[1]) {
                // 成功提取，去除可能存在的转义反斜杠
                contentToParse = urlMatch[1].replace(/\\/g, '');
            } else {
                // 是JSON卡片，但没有找到B站链接，判定为无关消息，静默退出
                return false;
            }
        } else {
            // 不是JSON卡片，直接使用原始消息
            contentToParse = rawMsg;
        }

        // 只有在获取到有效内容后，才进行关键词匹配
        if (!/(bilibili\.com|b23\.tv|^BV[1-9a-zA-Z]{10}$|^av[0-9]+)/i.test(contentToParse)) {
            return false;
        }

        try {
            const normalizedUrl = await this.normalizeUrl(contentToParse);
            if (normalizedUrl.includes("live.bilibili.com")) {
                await this.handleLive(e, normalizedUrl);
            } else if (normalizedUrl.includes("/video/")) {
                await this.handleVideo(e, normalizedUrl);
            } else {
                return false;
            }
        } catch (error) {
            // 任何后续的错误都认定为解析失败，静默退出以避免骚扰
            // logger.warn(`[荷花插件][B站] 解析步骤失败: ${error.message}`);
            return false;
        }
        return true;
    }


    async handleVideo(e, url) {
        const videoInfo = await this.getVideoInfo(url);
        if (!videoInfo) throw new Error("未能获取到视频信息");

        const pParam = this.getPParam(url);
        const { duration, displayTitle, partTitle } = this.getDurationAndTitle(videoInfo, pParam);
        await e.reply(this.constructInfoMessage(videoInfo, displayTitle, partTitle));
        
        const cfg = ConfigLoader.cfg;
        if (duration > cfg.bilibili.durationLimit) {
            return e.reply(`视频时长超过 ${(cfg.bilibili.durationLimit / 60).toFixed(0)} 分钟限制，不发送文件。`);
        }
        
        const tempPath = path.join(dataDir, `${e.group_id || e.user_id}_${Date.now()}`);
        
        if (cfg.bilibili.useBBDown) {
            const bbdownPath = await this.findCommandPath('BBDown');
            if (bbdownPath) {
                logger.info(`[荷花插件][B站] 检测到BBDown at ${bbdownPath}，优先使用BBDown下载...`);
                try {
                    await this.getSessData(true); 
                    await this.downloadWithBBDown(e, url, tempPath, videoInfo);
                } catch(loginError) {
                    await e.reply(loginError.message);
                }
                return;
            } else {
                logger.warn('[荷花插件][B站] 配置了使用BBDown，但未在环境中检测到。将回退至API下载。');
                await e.reply("【提示】BBDown已启用但未找到，将使用备用方案下载。(请主人使用 #B站登录 指令进行引导或检查环境配置)");
            }
        }
        
        await this.downloadWithApi(e, videoInfo, tempPath, url);
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
        
        const qrcodePath = path.join(configDir, 'bbdown_qrcode.png');
        if (fs.existsSync(qrcodePath)) fs.unlinkSync(qrcodePath);

        await e.reply("正在启动BBDown登录进程，请稍候...");
        
        const bbdown = spawn(bbdownPath, ['login'], { cwd: configDir });

        let stdout = '';
        const onData = data => { stdout += data.toString(); };
        bbdown.stdout.on('data', onData);
        bbdown.stderr.on('data', onData);

        const checkQRCode = setInterval(async () => {
            if (fs.existsSync(qrcodePath)) {
                clearInterval(checkQRCode);
                await e.reply([segment.image(qrcodePath), "请使用Bilibili APP扫描二维码进行登录。"]);
            }
        }, 1000);

        bbdown.on('close', (code) => {
            clearInterval(checkQRCode);
            if (stdout.includes("登录成功")) {
                e.reply("BBDown登录成功！Cookie已保存至BBDown.data。");
            } else {
                e.reply("BBDown登录进程已结束，可能已超时或失败。");
            }
        });
        bbdown.on('error', err => {
            clearInterval(checkQRCode);
            logger.error(`[荷花插件][B站登录] 失败:`, err);
            e.reply(`启动BBDown登录进程失败: ${err.message}`);
        });
        return true;
    }
    
    async downloadWithBBDown(e, url, tempPath, videoInfo) {
        await fs.promises.mkdir(tempPath, { recursive: true });
        const pParam = this.getPParam(url);
        const finalFileName = `${videoInfo.bvid}.mp4`;
        const tempFileNameForBBDown = videoInfo.bvid;

        try {
            await this.runBBDown(url, tempPath, tempFileNameForBBDown, pParam);
            const downloadedFile = path.join(tempPath, finalFileName);
            
            if (fs.existsSync(downloadedFile)) {
                await this.sendVideo(e, downloadedFile, finalFileName);
            } else {
                throw new Error(`BBDown执行完毕，但未找到输出文件: ${finalFileName}`);
            }
        } catch(error) {
            logger.error(`[荷花插件][BBDown] 失败:`, error);
            await e.reply(`BBDown下载失败: ${error.message.split('\n')[0]}`);
        } finally {
            if (fs.existsSync(tempPath)) fs.rm(tempPath, { recursive: true, force: true }, () => {});
        }
    }

    async downloadWithApi(e, videoInfo, tempPath, originalUrl) {
         try {
            await e.reply("(小提示：启用BBDown并登录，可解析更高画质和会员视频哦！)");
            await fs.promises.mkdir(tempPath, { recursive: true });
            
            const pParam = this.getPParam(originalUrl);
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
                await this.mergeFiles(videoFile, audioFile, outputFile);
            } else {
                fs.renameSync(videoFile, outputFile);
            }
            
            const finalFileName = `av${videoInfo.aid}.mp4`;
            await this.sendVideo(e, outputFile, finalFileName);

        } catch(error) {
            logger.error(`[荷花插件][API下载] 失败:`, error);
            await e.reply(`视频下载失败: ${error.message}`);
        } finally {
            if (fs.existsSync(tempPath)) fs.rm(tempPath, { recursive: true, force: true }, () => {});
        }
    }
    
    async normalizeUrl(input) {
        const idMatch = input.match(/(BV[1-9a-zA-Z]{10})/i) || input.match(/(av[0-9]+)/i);
        if (idMatch) {
            return `https://www.bilibili.com/video/${idMatch[0]}`;
        }
        
        const shortUrlMatch = input.match(/https?:\/\/(b23\.tv|bili2233\.cn)\/[^\s]+/);
        if (shortUrlMatch) {
            try {
                const resp = await fetch(shortUrlMatch[0], { method: 'HEAD', redirect: 'follow' });
                return resp.url;
            } catch (err) {
                logger.error(`[荷花插件][B站] 短链展开失败: ${err.message}`);
                throw new Error("展开B站短链失败");
            }
        }
        
        const longUrlMatch = input.match(/https?:\/\/www\.bilibili\.com\/[^\s]+/);
        if (longUrlMatch) {
            return longUrlMatch[0];
        }

        throw new Error("无法识别的链接格式");
    }
    
    async getVideoInfo(url) {
        const idMatch = url.match(/video\/([a-zA-Z0-9]+)/);
        if (!idMatch) throw new Error("无法从URL中提取视频ID");
        const videoId = idMatch[1];
        let apiUrl = videoId.toLowerCase().startsWith('av') ?
            `${BILI_VIDEO_INFO_API}?aid=${videoId.substring(2)}` :
            `${BILI_VIDEO_INFO_API}?bvid=${videoId}`;

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
    
    constructInfoMessage(videoInfo, displayTitle, partTitle) {
        const { pic, stat, owner } = videoInfo;
        const info = [
            `${ConfigLoader.cfg.general.identifyPrefix} ${displayTitle}`,
            partTitle ? `P${partTitle}` : '',
            `UP: ${owner.name}`,
            `播放: ${stat.view} | 弹幕: ${stat.danmaku} | 点赞: ${stat.like}`,
        ].filter(Boolean).join('\n');
        return [segment.image(pic), info];
    }
    
    getPParam(url) {
        try { return new URL(url).searchParams.get('p'); } 
        catch (e) { const pMatch = url.match(/[?&]p=(\d+)/); return pMatch ? pMatch[1] : null; }
    }

    getDurationAndTitle(videoInfo, pParam) {
        let { duration, title: displayTitle, pages } = videoInfo;
        let partTitle = null;
        if (pParam && pages && pages.length >= pParam) {
            const page = pages[pParam - 1];
            duration = page.duration;
            if (page.part && page.part !== displayTitle) partTitle = `${pParam}: ${page.part}`;
        }
        return { duration, displayTitle, partTitle };
    }

    mergeFiles(videoFile, audioFile, outputFile) {
        return new Promise(async (resolve, reject) => {
            const ffmpegPath = await this.findCommandPath('ffmpeg');
            if (!ffmpegPath) return reject(new Error("未找到ffmpeg"));
            const ffmpeg = spawn(ffmpegPath, ['-i', videoFile, '-i', audioFile, '-c', 'copy', outputFile]);
            ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error("FFmpeg合并音视频失败")));
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
            if (e.isGroup && e.group.fs.upload) {
                await e.group.fs.upload(filePath, { name: fileName });
            } else { await e.group.sendFile(filePath); }
        } finally {
            if (fs.existsSync(filePath)) fs.unlink(filePath, ()=>{});
        }
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
                if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
            }
        } catch (err) {
            if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
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

            child.stdout.on('data', (data) => {
                output += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0 && output) {
                    resolve(output.trim().split('\n')[0]);
                } else {
                    resolve(null);
                }
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

    async runBBDown(url, cwd, filenameWithoutExt, pageNum) {
        const cfg = ConfigLoader.cfg;
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) throw new Error("未找到BBDown，请检查环境配置");

        const args = [ url, '--work-dir', cwd, '-F', filenameWithoutExt ];
        if (cfg.bilibili.useAria2) args.push('--use-aria2c');
        
        const { sessdata, source } = await this.getSessData();
        if (source === 'config' && sessdata) {
             args.push('-c', `SESSDATA=${sessdata}`);
        }
        
        if (pageNum) args.push('-p', String(pageNum));

        const preferredDfn = BILI_DFN_MAP[cfg.bilibili.resolution];
        if (preferredDfn) args.push('--dfn-priority', preferredDfn);

        return new Promise((resolve, reject) => {
            const bbdown = spawn(bbdownPath, args);
            let output = '';
            
            bbdown.stdout.on('data', (data) => { output += data.toString(); });
            bbdown.stderr.on('data', (data) => { output += data.toString(); });

            bbdown.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`BBDown进程退出，代码: ${code}\n日志: ${output}`));
                }
            });
            bbdown.on('error', (err) => reject(err));
        });
    }
}