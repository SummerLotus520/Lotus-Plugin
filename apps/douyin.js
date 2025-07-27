import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'child_process';
import ConfigLoader from '../model/config_loader.js';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'douyin');

export class DouyinParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 抖音解析',
            dsc: '处理抖音视频、图集等链接 (依赖yt-dlp)',
            event: 'message',
            priority: 4200,
            rule: [
                { reg: '(douyin.com)', fnc: 'parse' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async parse(e) {
        const cfg = ConfigLoader.cfg;
        if (!cfg.douyin.cookie) {
            return e.reply("抖音解析失败：请主人在parser.yaml中配置抖音Cookie。");
        }
        
        const ytDlpPath = await this.findCommandPath('yt-dlp');
        if (!ytDlpPath) {
            return e.reply("抖音解析失败：未在环境中找到yt-dlp，请主人安装并配置好外部工具。");
        }
        
        const tempPath = path.join(dataDir, `download_${Date.now()}`);
        fs.mkdirSync(tempPath, { recursive: true });

        try {
            const url = await this.normalizeUrl(e.msg.trim());
            
            await e.reply("正在解析抖音链接，请稍候...");
            const jsonOutput = await this.runYtDlp(url, tempPath, ['--print-json', '--skip-download']);
            const videoInfo = JSON.parse(jsonOutput);

            const title = videoInfo.title || videoInfo.description || '无标题';
            await e.reply(`${cfg.general.identifyPrefix} 抖音: ${title}`);
            
            await this.runYtDlp(url, tempPath, ['-o', 'output.%(ext)s']);
            
            const files = fs.readdirSync(tempPath);
            const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
            const videoFile = files.find(f => /\.(mp4|mov|mkv|webm)$/i.test(f));

            if (imageFiles.length > 0) {
                const imageMsgs = imageFiles.map(file => ({
                    message: segment.image(path.join(tempPath, file)),
                    nickname: e.sender.card || e.user_id,
                    user_id: e.user_id
                }));
                await e.reply(await Bot.makeForwardMsg(imageMsgs));
            } else if (videoFile) {
                await this.sendVideo(e, path.join(tempPath, videoFile), `douyin_${videoInfo.id}.mp4`);
            } else {
                throw new Error("yt-dlp未能成功下载媒体文件，可能是链接已失效或Cookie无效。");
            }
        } catch (error) {
            logger.error(`[荷花插件][抖音] 失败:`, error);
            await e.reply(`抖音解析失败: ${error.message.split('\n')[0]}\n(小提示: 请主人尝试运行 'yt-dlp -U' 更新，并检查Cookie是否有效)`);
        } finally {
            if (fs.existsSync(tempPath)) fs.rm(tempPath, { recursive: true, force: true }, () => {});
        }
    }

    async normalizeUrl(input) {
        const match = input.match(/https?:\/\/[^\s]+/);
        if (!match) throw new Error("无法识别的链接格式");
        return match[0];
    }

    runYtDlp(url, cwd, args = []) {
        return new Promise(async (resolve, reject) => {
            const ytDlpPath = await this.findCommandPath('yt-dlp');
            if (!ytDlpPath) return reject(new Error("未找到yt-dlp"));
            
            const cfg = ConfigLoader.cfg;
            const commandArgs = [url, ...args];
            
            let tempCookieFile = null;
            if (cfg.douyin.cookie) {
                try {
                    tempCookieFile = path.join(dataDir, `douyin_cookie_${Date.now()}.txt`);
                    const cookiePairs = cfg.douyin.cookie.split(';');
                    let netscapeCookies = "# Netscape HTTP Cookie File\n";
                    cookiePairs.forEach(pair => {
                        const [name, ...valueParts] = pair.split('=');
                        const value = valueParts.join('=');
                        if (name && value) {
                            netscapeCookies += `.douyin.com\tTRUE\t/\tFALSE\t0\t${name.trim()}\t${value.trim()}\n`;
                        }
                    });
                    
                    fs.writeFileSync(tempCookieFile, netscapeCookies);
                    commandArgs.push('--cookies', tempCookieFile);
                } catch (cookieError) {
                    logger.error(`[荷花插件][抖音] 创建Cookie文件失败:`, cookieError);
                }
            }
            
            execFile(ytDlpPath, commandArgs, { cwd, timeout: 300000 }, (error, stdout, stderr) => {
                if (tempCookieFile && fs.existsSync(tempCookieFile)) {
                    fs.unlinkSync(tempCookieFile);
                }
                if (error) {
                    return reject(new Error(stderr || stdout || error.message));
                }
                resolve(stdout.trim());
            });
        });
    }

    async findCommandPath(command) {
        const cfg = ConfigLoader.cfg;
        const exe = process.platform === 'win32' ? `${command}.exe` : command;
        if (cfg.external_tools.toolsPath) {
            const cmdPath = path.join(cfg.external_tools.toolsPath, exe);
            if (fs.existsSync(cmdPath)) return cmdPath;
        }
        return new Promise((resolve) => {
            const check = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
            exec(check, (error, stdout) => resolve(error ? null : stdout.trim().split('\n')[0]));
        });
    }

    async uploadFile(e, filePath, fileName) {
        try {
            if (e.isGroup && e.group.fs.upload) {
                await e.group.fs.upload(filePath, { name: fileName });
            } else {
                await e.group.sendFile(filePath);
            }
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
}