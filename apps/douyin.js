import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'child_process';
import ConfigLoader from '../model/config_loader.js';
import axios from 'axios';

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
            // 使用 --print-json 获取所有信息的JSON输出，比多次调用更高效
            const jsonOutput = await this.runYtDlp(url, tempPath, ['--print-json', '-f', 'b']);
            const videoInfo = JSON.parse(jsonOutput);

            const title = videoInfo.title || videoInfo.description || '无标题';
            await e.reply(`${ConfigLoader.cfg.general.identifyPrefix} ${platform}: ${title}`);
            
            // yt-dlp 会自动将图集下载为图片序列
            const files = fs.readdirSync(tempPath);
            const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
            const videoFile = files.find(f => /\.(mp4|mov|mkv|webm)$/i.test(f));

            if (imageFiles.length > 0) {
                // 处理图集
                const imageMsgs = imageFiles.map(file => ({
                    message: segment.image(path.join(tempPath, file)),
                    nickname: e.sender.card || e.user_id,
                    user_id: e.user_id
                }));
                await e.reply(await Bot.makeForwardMsg(imageMsgs));
            } else if (videoFile) {
                // 处理视频
                await this.sendVideo(e, path.join(tempPath, videoFile), `douyin_${videoInfo.id}.mp4`);
            } else {
                // 如果没有视频和图片，可能是下载失败或yt-dlp未能提取
                throw new Error("yt-dlp未能成功下载媒体文件。");
            }
        } finally {
            if (fs.existsSync(tempPath)) fs.rm(tempPath, { recursive: true, force: true }, () => {});
        }
    }

    async normalizeUrl(input) {
        const match = input.match(/https?:\/\/[^\s]+/);
        if (!match) throw new Error("无法识别的链接格式");
        
        let url = match[0];
        // yt-dlp可以很好地处理短链，无需我们手动展开
        return url;
    }

    runYtDlp(url, cwd, args = []) {
        return new Promise(async (resolve, reject) => {
            const ytDlpPath = await this.findCommandPath('yt-dlp');
            if (!ytDlpPath) return reject(new Error("未找到yt-dlp，请检查环境配置"));
            
            const cfg = ConfigLoader.cfg;
            const commandArgs = [url, ...args];
            // 抖音解析通常不需要代理
            if (cfg.douyin.cookie) {
                commandArgs.push('--cookies-from-browser', 'chrome'); // 示例，让yt-dlp尝试从chrome读取cookie
                // 或者直接写入临时cookie文件
                // const tempCookieFile = path.join(dataDir, 'douyin_cookie.txt');
                // fs.writeFileSync(tempCookieFile, cfg.douyin.cookie);
                // commandArgs.push('--cookies', tempCookieFile);
            }

            // -o 参数指定输出模板，对于yt-dlp来说，它会根据模板自动命名
            // 如果是图集，它会自动加上序号
            commandArgs.push('-o', 'output.%(ext)s');

            execFile(ytDlpPath, commandArgs, { cwd, timeout: 300000 /*5分钟超时*/ }, (error, stdout, stderr) => {
                if (error) {
                    // yt-dlp下载图集时，即使成功也会在stderr输出一些信息，不能直接作为错误判断
                    if (fs.readdirSync(cwd).length > 0) {
                         resolve(stdout.trim());
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
            } else if (e.isGroup && e.group.sendFile) {
                await e.group.sendFile(filePath);
            } else {
                await e.reply("当前环境无法上传文件。");
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