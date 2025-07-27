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
            dsc: '处理抖音视频、图集等链接',
            event: 'message',
            priority: 4200,
            rule: [
                { reg: '(douyin.com)', fnc: 'parse' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async parse(e) {
        try {
            await this.handleYtDlp(e, '抖音');
        } catch (error) {
            logger.error(`[荷花插件][抖音] 失败:`, error);
            await e.reply(`抖音解析失败: ${error.message.split('\n')[0]}`);
        }
        return true;
    }

    async handleYtDlp(e, platform) {
        const url = await this.normalizeUrl(e.msg.trim());
        const tempPath = path.join(dataDir, `download_${Date.now()}`);
        fs.mkdirSync(tempPath, { recursive: true });

        try {
            const jsonOutput = await this.runYtDlp(url, tempPath, ['--print-json']);
            const videoInfo = JSON.parse(jsonOutput);

            const title = videoInfo.title || videoInfo.description || '无标题';
            await e.reply(`${ConfigLoader.cfg.general.identifyPrefix} ${platform}: ${title}`);
            
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
                throw new Error("yt-dlp未能成功下载媒体文件。");
            }
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
            if (!ytDlpPath) return reject(new Error("未找到yt-dlp，请检查环境配置"));
            
            const cfg = ConfigLoader.cfg;
            const commandArgs = [url, ...args];
            let tempCookieFile = null;
            if (cfg.douyin.cookie) {
                try {
                    tempCookieFile = path.join(dataDir, `douyin_cookie_${Date.now()}.txt`);
                    
                    // 将标准的Cookie字符串转换为Netscape格式
                    const cookiePairs = cfg.douyin.cookie.split('; ');
                    let netscapeCookies = "# Netscape HTTP Cookie File\n";
                    cookiePairs.forEach(pair => {
                        const [name, value] = pair.split(/=(.*)/s); // 分割键和值
                        if (name && value) {
                            // 构造Netscape格式的7个字段
                            // .douyin.com | TRUE | / | FALSE | 0 | name | value
                            netscapeCookies += `.douyin.com\tTRUE\t/\tFALSE\t0\t${name}\t${value}\n`;
                        }
                    });
                    
                    fs.writeFileSync(tempCookieFile, netscapeCookies);
                    commandArgs.push('--cookies', tempCookieFile);
                } catch (cookieError) {
                    logger.error(`[荷花插件][抖音] 创建Cookie文件失败:`, cookieError);
                    // 如果创建失败，就不添加--cookies参数，继续尝试无cookie下载
                }
            }
            
            execFile(ytDlpPath, commandArgs, { cwd, timeout: 300000 }, (error, stdout, stderr) => {
                if (tempCookieFile && fs.existsSync(tempCookieFile)) {
                    fs.unlinkSync(tempCookieFile);
                }
                if (error) {
                    if (fs.readdirSync(cwd).length > 0 && !stdout) {
                         resolve(stderr.trim());
                    } else {
                         return reject(new Error(stderr || error.message));
                    }
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