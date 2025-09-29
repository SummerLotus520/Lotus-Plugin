import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'child_process';
import JSZip from 'jszip';
import YAML from 'yaml';

const _path = process.cwd();
const pluginRoot = path.join(_path, 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'bilibili');

const BILI_VIDEO_INFO_API = "http://api.bilibili.com/x/web-interface/view";
const BILI_PLAY_STREAM_API = "https://api.bilibili.com/x/player/playurl";
const BILI_STREAM_INFO_API = "https://api.live.bilibili.com/room/v1/Room/get_info";

const COMMON_HEADER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
};

export class BilibiliParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] B站解析',
            dsc: '处理B站视频、直播链接',
            event: 'message',
            priority: 0,
            rule: [
                {
                    reg: '(bilibili.com|b23.tv|bili2233.cn|t.bilibili.com|^BV[1-9a-zA-Z]{10}$|^av[0-9]+$)',
                    fnc: 'parse'
                },
                { reg: '^#B站登录$', fnc: 'login', permission: 'master' }
            ]
        });

        this.pluginConfig = {};
        this.init();
    }
    
    init() {
        this._loadConfig();
        this.cleanupDataDirOnStart();
    }
    
    _loadConfig() {
        const pluginConfigPath = path.join(pluginRoot, 'config', 'config.yaml');
        try {
            this.pluginConfig = YAML.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
        } catch (error) {
            logger.error('[荷花插件][B站] 加载主配置文件失败:', error);
            this.pluginConfig = {};
        }
    }
    
    cleanupDataDirOnStart() {
        try {
            if (fs.existsSync(dataDir)) {
                fs.rmSync(dataDir, { recursive: true, force: true });
            }
            fs.mkdirSync(dataDir, { recursive: true });
            logger.info('[荷花插件][B站] 缓存目录已在启动时清空。');
        } catch (err) {
            logger.error(`[荷花插件][B站] 启动时清理缓存目录失败: ${err.message}`);
        }
    }
    
    async checkCache(fileName) {
        this._loadConfig();
        const cfg = this.pluginConfig.bilibili || {};
        if (!cfg.enableCache) return null;
        const filePath = path.join(dataDir, fileName);
        if (fs.existsSync(filePath)) {
            logger.info(`[荷花插件][B站] 命中缓存: ${fileName}`);
            return filePath;
        }
        return null;
    }

    async parse(e) {
        this._loadConfig();
        const rawMsg = e.raw_message || e.msg || "";
        const cleanMsg = rawMsg.replace(/\\\//g, '/');
        const surgicalRegex = /(https?:\/\/(?:www\.bilibili\.com\/video\/[^"'\s,\]}]+|b23\.tv\/[^"'\s,\]}]+|live\.bilibili\.com\/[^"'\s,\]}]+))|(BV[1-9a-zA-Z]{10}|av[0-9]+)/i;
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
            await e.reply(this.constructInfoMessage(videoInfo));
            const cfg = this.pluginConfig.bilibili || {};
            if (cfg.durationLimit > 0 && videoInfo.duration > cfg.durationLimit) {
                return e.reply(`视频总时长超过 ${(cfg.durationLimit / 60).toFixed(0)} 分钟限制，不发送文件。`);
            }
            if (cfg.maxSizeLimit > 0) {
                const estimatedSize = (videoInfo.dash?.video?.[0]?.bandwidth * videoInfo.duration) / 8 / 1024 / 1024;
                if (estimatedSize > cfg.maxSizeLimit) {
                    return e.reply(`视频预估大小(${estimatedSize.toFixed(2)}MB)超过 ${cfg.maxSizeLimit}MB 限制，放弃下载。`);
                }
            }
            if (videoInfo.pages.length > 1) {
                await this.handleMultiPageVideo(e, videoInfo);
            } else {
                await this.handleSinglePageVideo(e, videoInfo);
            }
        } catch (error) {
            logger.error(`[荷花插件][B站] 解析失败: ${error.message}`);
            return false;
        }
        return true;
    }

    async handleMultiPageVideo(e, videoInfo) {
        const cfg = this.pluginConfig.bilibili || {};
        const policy = cfg.multiPagePolicy || 'zip';
        const url = `https://www.bilibili.com/video/${videoInfo.bvid}`;
        const folderName = videoInfo.title;
        try {
            await e.reply(`检测到 ${videoInfo.pages.length} 个分P，处理策略: ${policy}。开始处理...`);
            let videoFolderPath = await this.checkCache(folderName);
            if (videoFolderPath) {
                await e.reply("命中缓存，直接从现有文件处理...");
            } else {
                await e.reply("开始下载所有分P，此过程可能较长，请耐心等待...");
                await this.runBBDown(url, dataDir);
                videoFolderPath = path.join(dataDir, folderName);
                if (!fs.existsSync(videoFolderPath)) {
                    throw new Error("BBDown执行完毕，但未找到预期的视频文件夹。请检查标题是否含特殊字符。");
                }
            }
            const videoFiles = fs.readdirSync(videoFolderPath).filter(f => f.endsWith('.mp4') || f.endsWith('.mkv')).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
            if (videoFiles.length === 0) throw new Error("视频文件夹为空。");
            switch (policy) {
                case 'zip':
                    const zipName = `${folderName}.zip`;
                    const cachedZip = await this.checkCache(zipName);
                    if(cachedZip) {
                        await e.reply("命中ZIP缓存，直接发送...");
                        await this.sendFile(e, cachedZip, zipName);
                    } else {
                        await this.sendFolderAsZip(e, videoFolderPath, zipName);
                    }
                    break;
                case 'all':
                    await e.reply(`将逐个发送 ${videoFiles.length} 个视频...`);
                    for (const [index, file] of videoFiles.entries()) {
                        await e.reply(`发送第 ${index + 1} / ${videoFiles.length}: ${file}`);
                        await this.sendVideo(e, path.join(videoFolderPath, file), file);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    break;
                case 'first':
                    const firstVideo = videoFiles.find(f => f.includes('[P1]'));
                    if (!firstVideo) throw new Error("未能找到P1视频文件 ([P1]格式)。");
                    await e.reply(`发送第1P: ${firstVideo}`);
                    await this.sendVideo(e, path.join(videoFolderPath, firstVideo), firstVideo);
                    break;
                default:
                    throw new Error(`未知的多P处理策略: ${policy}`);
            }
        } catch (error) {
            logger.error(`[荷花插件][B站][多P] 失败:`, error);
            await e.reply(`处理失败: ${error.message}`);
        }
    }
    
    async sendFolderAsZip(e, folderPath, zipName) {
        await e.reply("开始打包为 ZIP 文件...");
        const zip = new JSZip();
        for (const file of fs.readdirSync(folderPath)) {
            zip.file(file, fs.readFileSync(path.join(folderPath, file)));
        }
        const zipPath = path.join(dataDir, zipName);
        const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
        fs.writeFileSync(zipPath, buffer);
        await e.reply('打包完成，正在发送...');
        await this.sendFile(e, zipPath, zipName);
    }
    
    async handleSinglePageVideo(e, videoInfo) {
        const fileName = `${videoInfo.title}.mp4`;
        const url = `https://www.bilibili.com/video/${videoInfo.bvid}`;
        const cachedFile = await this.checkCache(fileName);
        if (cachedFile) {
            await e.reply("命中缓存，直接发送...");
            await this.sendVideo(e, cachedFile, fileName);
            return;
        }
        const tempWorkDir = path.join(dataDir, `${videoInfo.bvid}_temp`);
        try {
            const cfg = this.pluginConfig.bilibili || {};
            if (cfg.useBBDown) {
                if(fs.existsSync(tempWorkDir)) fs.rmSync(tempWorkDir, {recursive: true, force: true});
                fs.mkdirSync(tempWorkDir, { recursive: true });
                await this.runBBDown(url, tempWorkDir);
                const downloadedFile = fs.readdirSync(tempWorkDir).find(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.flv'));
                if (!downloadedFile) throw new Error("BBDown执行完毕，但未找到视频文件。");
                const finalPath = path.join(dataDir, fileName);
                fs.renameSync(path.join(tempWorkDir, downloadedFile), finalPath);
                await this.sendVideo(e, finalPath, fileName);
            } else {
                await this.downloadWithApi(e, videoInfo, tempWorkDir, fileName);
            }
        } catch (error) {
            logger.error(`[荷花插件][B站][单P] 失败:`, error);
            await e.reply(`解析失败: ${error.message}`);
        } finally {
            if (fs.existsSync(tempWorkDir)) fs.rmSync(tempWorkDir, { recursive: true, force: true });
        }
    }
    
    async downloadWithApi(e, videoInfo, tempPath, finalFileName) {
        try {
            await e.reply("(提示：启用BBDown可解析更高画质)");
            const { videoUrl, audioUrl } = await this.getDownloadUrl(videoInfo.bvid, videoInfo.cid);
            if (!videoUrl) throw new Error("未能获取到视频流链接");
            const videoFile = path.join(tempPath, 'video.m4s');
            const audioFile = path.join(tempPath, 'audio.m4s');
            const outputFile = path.join(tempPath, 'output.mp4');
            await this.downloadFile(videoFile, videoUrl);
            if (audioUrl) {
                await this.downloadFile(audioFile, audioUrl);
                await this.mergeFilesWithFfmpeg(outputFile, videoFile, audioFile);
            } else {
                fs.renameSync(videoFile, outputFile);
            }
            const finalPath = path.join(dataDir, finalFileName);
            fs.renameSync(outputFile, finalPath);
            await this.sendVideo(e, finalPath, finalFileName);
        } catch(error) {
            throw error;
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
            `${this.pluginConfig.general.identifyPrefix} B站直播: ${title}\n📺 独立播放器: https://www.bilibili.com/blackboard/live/live-activity-player.html?enterTheRoom=0&cid=${roomId}`
        ];
        await e.reply(liveMessage);
    }

    async login(e) {
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) {
            return e.reply("未找到BBDown.exe，请检查环境变量或在config.yaml中配置toolsPath。");
        }
        const qrcodePath = path.join(dataDir, 'qrcode.png');
        const logPath = path.join(dataDir, 'login-temp.log');
        if (fs.existsSync(qrcodePath)) try { fs.unlinkSync(qrcodePath); } catch {}
        if (fs.existsSync(logPath)) try { fs.unlinkSync(logPath); } catch {}
        await e.reply("正在启动BBDown登录进程，请稍候...");
        const command = `"${bbdownPath}" login > "${logPath}" 2>&1`;
        const bbdown = spawn(command, { cwd: dataDir, shell: true });
        let sent = false;
        const checkQRCode = setInterval(async () => {
            if (sent) { clearInterval(checkQRCode); return; }
            if (fs.existsSync(qrcodePath)) {
                sent = true;
                clearInterval(checkQRCode);
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await e.reply([segment.image(qrcodePath), "请使用Bilibili APP扫描二维码登录。"]);
                } catch (err) { e.reply("二维码发送失败，请检查后台。"); }
            }
        }, 1000);
        bbdown.on('close', async (code) => {
            sent = true;
            clearInterval(checkQRCode);
            const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
            if (logContent.includes("登录成功")) {
                await e.reply("BBDown登录成功！");
            } else {
                await e.reply("BBDown登录进程已结束，可能已成功，请尝试解析会员视频验证。");
            }
            setTimeout(() => {
                if (fs.existsSync(qrcodePath)) try { fs.unlinkSync(qrcodePath); } catch {}
                if (fs.existsSync(logPath)) try { fs.unlinkSync(logPath); } catch {}
            }, 2000);
        });
        bbdown.on('error', err => {
            sent = true;
            clearInterval(checkQRCode);
            e.reply(`启动BBDown登录进程失败: ${err.message}`);
        });
        return true;
    }
    
    async normalizeUrl(input) {
        if (String(input).toLowerCase().startsWith('av')) {
            return `https://www.bilibili.com/video/${input}`;
        }
        if (input.startsWith('https://www.bilibili.com/video/') || input.startsWith('https://live.bilibili.com/')) {
            return input.split("?")[0];
        }
        const idMatch = input.match(/(BV[1-9a-zA-Z]{10})/i);
        if (idMatch) return `https://www.bilibili.com/video/${idMatch[0]}`;
        const shortUrlMatch = input.match(/https?:\/\/b23\.tv\/[a-zA-Z0-9]+/);
        if (shortUrlMatch) {
            try {
                const resp = await fetch(shortUrlMatch[0], { method: 'HEAD', redirect: 'follow' });
                return resp.url.split("?")[0];
            } catch (err) { throw new Error("展开B站短链失败"); }
        }
        throw new Error("无法规范化链接格式");
    }
    
    async getVideoInfo(url) {
        const idMatch = url.match(/video\/(av|BV)([a-zA-Z0-9]+)/i);
        if (!idMatch) throw new Error("无法从URL中提取视频ID");
        const idType = idMatch[1].toLowerCase();
        const videoId = idMatch[2];
        const apiUrl = idType === 'av' 
            ? `${BILI_VIDEO_INFO_API}?aid=${videoId}` 
            : `${BILI_VIDEO_INFO_API}?bvid=BV${videoId}`;
        const resp = await fetch(apiUrl, { headers: COMMON_HEADER });
        const respJson = await resp.json();
        if (respJson.code !== 0) throw new Error(respJson.message || '请求错误');
        return respJson.data;
    }

    async getDownloadUrl(bvid, cid) {
        this._loadConfig();
        const cfg = this.pluginConfig.bilibili || {};
        const { sessdata } = await this.getSessData();
        const params = new URLSearchParams({ bvid, cid, qn: cfg.resolution, fnval: 16, fourk: 1 }).toString();
        const url = `${BILI_PLAY_STREAM_API}?${params}`;
        const headers = { ...COMMON_HEADER, Cookie: `SESSDATA=${sessdata}` };
        const resp = await fetch(url, { headers });
        const respJson = await resp.json();
        if (respJson.code !== 0) throw new Error(`获取播放地址失败: ${respJson.message}`);
        const dash = respJson.data.dash;
        return { videoUrl: dash.video[0]?.baseUrl, audioUrl: dash.audio[0]?.baseUrl };
    }
    
    constructInfoMessage(videoInfo) {
        this._loadConfig();
        const { pic, stat, owner, title } = videoInfo;
        let infoText = [
            `${(this.pluginConfig.general || {}).identifyPrefix || '[荷花解析]'} ${title}`,
            `UP: ${owner.name}`,
            `播放: ${stat.view} | 弹幕: ${stat.danmaku} | 点赞: ${stat.like}`,
        ];
        return [segment.image(pic), infoText.filter(Boolean).join('\n')];
    }

    async mergeFilesWithFfmpeg(outputFile, videoFile, audioFile) {
        const ffmpegPath = await this.findCommandPath('ffmpeg');
        if (!ffmpegPath) throw new Error("未找到ffmpeg");
        const args = ['-i', videoFile, '-i', audioFile, '-c', 'copy', outputFile];
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

    async sendFile(e, filePath, fileName) {
        try {
            if (e.isGroup) {
                 await e.group.sendFile(filePath, fileName);
            } else {
                 await e.friend.sendFile(filePath, fileName);
            }
        } catch (err) {
            logger.error(`[荷花插件][文件发送] 失败:`, err);
            await e.reply("发送文件失败，可能超出大小限制或机器人无权限。");
        }
    }

    async sendVideo(e, filePath, fileName) {
        try {
            this._loadConfig();
            const stats = fs.statSync(filePath);
            const videoSize = Math.floor(stats.size / (1024 * 1024));
            const cfg = this.pluginConfig.bilibili || {};
            if (videoSize > cfg.videoSizeLimit) {
                await e.reply(`视频大小(${videoSize}MB)超过${cfg.videoSizeLimit}MB限制，转为发送文件。`);
                await this.sendFile(e, filePath, fileName);
            } else {
                await e.reply(segment.video(filePath));
            }
        } catch (err) {
            throw err;
        }
    }
    
    async findCommandPath(command) {
        this._loadConfig();
        const cfg = this.pluginConfig.external_tools || {};
        const exe = process.platform === 'win32' ? `${command}.exe` : command;
        if (cfg.toolsPath) {
            const cmdPath = path.join(cfg.toolsPath, exe);
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
            child.on('error', () => resolve(null));
        });
    }

    async getSessData() {
        this._loadConfig();
        const cfg = this.pluginConfig.bilibili || {};
        if (cfg.sessData) {
            return { sessdata: cfg.sessData, source: 'config' };
        }
        const bbdownPath = await this.findCommandPath('BBDown');
        if (bbdownPath) {
            const bbdownDataPath = path.join(path.dirname(bbdownPath), 'BBDown.data');
            if (fs.existsSync(bbdownDataPath)) {
                try {
                    const cookieData = fs.readFileSync(bbdownDataPath, 'utf8');
                    const sessdataMatch = cookieData.match(/SESSDATA=([^;]+)/);
                    if (sessdataMatch?.[1]) {
                        return { sessdata: sessdataMatch[1], source: 'bbdown_data' };
                    }
                } catch (error) {}
            }
        }
        return { sessdata: "", source: 'none' };
    }

    async runBBDown(url, cwd, pageNum = null, extraArgsStr = '') {
        this._loadConfig();
        const cfg = this.pluginConfig.bilibili || {};
        const bbdownPath = await this.findCommandPath('BBDown');
        if (!bbdownPath) throw new Error("未找到BBDown，请检查环境或配置toolsPath");
        
        const args = [url, '--work-dir', cwd];
        if (cfg.useAria2) args.push('--use-aria2c');
        
        const { sessdata } = await this.getSessData();
        if (sessdata) args.push('-c', `SESSDATA=${sessdata}`);
        
        if (pageNum) args.push('-p', String(pageNum));
        
        args.push('--dfn-priority', String(cfg.resolution));
        if (extraArgsStr) args.push(...extraArgsStr.split(' '));
        
        return new Promise((resolve, reject) => {
            const bbdown = spawn(bbdownPath, args, { shell: false });
            bbdown.stdout.on('data', (data) => logger.debug(`[BBDown]: ${data}`) );
            bbdown.stderr.on('data', (data) => logger.error(`[BBDown]: ${data}`) );
            bbdown.on('close', (code) => code === 0 ? resolve() : reject(new Error(`BBDown进程退出，代码: ${code}`)));
            bbdown.on('error', (err) => reject(err));
        });
    }
}