import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'child_process';
import ConfigLoader from '../model/config_loader.js';
import axios from 'axios';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'short_video');

export class ShortVideoParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 通用短视频解析',
            dsc: '处理AcFun、快手等短视频链接',
            event: 'message',
            priority: 4500,
            rule: [
                { reg: '(acfun.cn)', fnc: 'parse' },
                { reg: '(kuaishou.com)', fnc: 'parse' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async parse(e) {
        if (!ConfigLoader.cfg.short_video.enabled) return false;

        const platformMap = {
            acfun: 'AcFun',
            kuaishou: '快手'
        };
        const platformKey = Object.keys(platformMap).find(key => e.msg.includes(key));
        const platformName = platformMap[platformKey] || '短视频';

        const url = await this.normalizeUrl(e.msg.trim());
        const tempPath = path.join(dataDir, `download_${Date.now()}`);
        fs.mkdirSync(tempPath, { recursive: true });

        try {
            const jsonOutput = await this.runYtDlp(url, tempPath, ['--print-json']);
            const videoInfo = JSON.parse(jsonOutput);
            
            const title = videoInfo.title || '无标题';
            const author = videoInfo.uploader || '未知作者';
            
            await e.reply(`${ConfigLoader.cfg.general.identifyPrefix} ${platformName}: ${title}\n作者: ${author}\n正在下载，请稍候...`);

            // 下载视频文件
            await this.runYtDlp(url, tempPath, ['-o', 'output.%(ext)s', '-f', 'b']);
            
            const files = fs.readdirSync(tempPath);
            const videoFile = files.find(f => f.startsWith('output.'));
            
            if (videoFile) {
                await this.sendVideo(e, path.join(tempPath, videoFile), `${platformName}_${videoInfo.id}.mp4`);
            } else {
                throw new Error("yt-dlp未能成功下载媒体文件。");
            }

        } catch (error) {
            logger.error(`[荷花插件][${platformName}] 失败:`, error);
            await e.reply(`${platformName}解析失败: ${error.message.split('\n')[0]}`);
        } finally {
            if (fs.existsSync(tempPath)) fs.rm(tempPath, { recursive: true, force: true }, () => {});
        }
        return true;
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

            const commandArgs = [url, ...args];
            
            execFile(ytDlpPath, commandArgs, { cwd, timeout: 300000 }, (error, stdout, stderr) => {
                if (error) return reject(new Error(stderr || error.message));
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