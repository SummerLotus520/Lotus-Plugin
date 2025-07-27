import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import ConfigLoader from '../model/config_loader.js';
import axios from 'axios';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'xiaohongshu');
const XHS_API_PREFIX = "https://www.xiaohongshu.com/explore/";
const COMMON_HEADER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.xiaohongshu.com/',
};

export class XiaohongshuParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 小红书解析',
            dsc: '处理小红书图文、视频笔记链接',
            event: 'message',
            priority: 4300,
            rule: [
                { reg: '(xhslink.com|xiaohongshu.com)', fnc: 'parse' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async parse(e) {
        const cfg = ConfigLoader.cfg;
        if (!cfg.xiaohongshu.cookie) {
            return e.reply("小红书解析失败：请主人在parser.yaml中配置Cookie。");
        }

        try {
            const url = await this.normalizeUrl(e.msg.trim());
            const idMatch = url.match(/explore\/([a-f0-9]+)|discovery\/item\/([a-f0-9]+)/);
            if (!idMatch) throw new Error("无法获取小红书ID");
            
            const id = idMatch[1] || idMatch[2];
            
            const headers = { ...COMMON_HEADER, Cookie: cfg.xiaohongshu.cookie };
            const resp = await fetch(XHS_API_PREFIX + id, { headers });
            const html = await resp.text();

            const jsonMatch = html.match(/<script>window\.__INITIAL_STATE__=(.*?)<\/script>/);
            if (!jsonMatch) throw new Error("解析页面失败，可能是Cookie失效或已过期");

            const data = JSON.parse(jsonMatch[1].replace(/undefined/g, 'null'));
            const noteData = data.note.noteDetailMap[id].note;

            await e.reply(`${cfg.general.identifyPrefix} 小红书: ${noteData.title}\n${noteData.desc}`);

            if (noteData.type === 'video') {
                const videoUrl = noteData.video.media.stream.h264[0].masterUrl;
                const tempFile = path.join(dataDir, `xhs_${id}.mp4`);
                await this.downloadFile(tempFile, videoUrl);
                await this.sendVideo(e, tempFile, `xhs_${id}.mp4`);
            } else {
                const images = noteData.imageList.map(img => ({
                    message: segment.image(img.urlDefault),
                    nickname: e.sender.card || e.user_id,
                    user_id: e.user_id
                }));
                if (images.length > 0) {
                    await e.reply(await Bot.makeForwardMsg(images));
                }
            }
        } catch (error) { 
            logger.error(`[荷花插件][小红书] 失败:`, error); 
            await e.reply(`小红书解析失败: ${error.message}`); 
        }
        return true;
    }

    async normalizeUrl(input) {
        const match = input.match(/https?:\/\/[^\s]+/);
        if (!match) throw new Error("无法识别的链接格式");
        
        let url = match[0];
        if (url.includes("xhslink.com")) {
             try {
                const resp = await axios.head(url, { maxRedirects: 5 });
                return resp.request.res.responseUrl || url;
            } catch (err) {
                if (err.request?.res?.responseUrl) return err.request.res.responseUrl;
                return url;
            }
        }
        return url;
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