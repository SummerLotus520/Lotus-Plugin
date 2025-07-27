import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import ConfigLoader from '../model/config_loader.js';
import axios from 'axios';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'qq_music');
const QQ_MUSIC_TEMP_API = "https://www.hhlqilongzhu.cn/api/dg_QQmusicflac.php?msg={}&n=1&type=json";

const COMMON_HEADER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
};

export class QQMusicParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] QQ音乐解析',
            dsc: '处理QQ音乐分享链接或卡片',
            event: 'message',
            priority: 4050, 
            rule: [
                { reg: '(y.qq.com)', fnc: 'parse' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }

    async parse(e) {
        try {
            let songInfoText;
            // 优先处理JSON卡片消息
            if (e.isjson) {
                try {
                    const json = JSON.parse(e.msg);
                    if (json.app?.includes("com.tencent.music")) {
                        const title = json.meta?.music?.title || '';
                        const artist = json.meta?.music?.desc || '';
                        songInfoText = `${title} ${artist}`;
                    }
                } catch (err) { /*忽略解析错误，继续按文本处理*/ }
            }
            
            // 如果不是卡片或卡片解析失败，则按纯文本处理
            if (!songInfoText) {
                const match = e.msg.match(/《([^》]+)》/); // 尝试匹配书名号内的内容
                if (match) {
                    songInfoText = match[1];
                } else {
                    // 作为最后的备用方案，移除URL部分
                    songInfoText = e.msg.replace(/https?:\/\/[^\s]+/, '').trim();
                }
            }

            if (!songInfoText) throw new Error("无法从消息中提取有效的歌曲信息");
            
            logger.info(`[荷花插件][QQ音乐] 识别到歌曲信息: ${songInfoText}`);

            const searchUrl = QQ_MUSIC_TEMP_API.replace('{}', encodeURIComponent(songInfoText));
            const resp = await axios.get(searchUrl);
            const data = resp.data?.data;

            if (!data || !data.music_url) {
                 // 尝试另一个接口
                const backupResp = await axios.get(`https://www.hhlqilongzhu.cn/api/dg_qqmusic.php?gm=${encodeURIComponent(songInfoText)}&n=1&type=json`);
                const backupData = backupResp.data;
                if (!backupData || !backupData.music_url) {
                    throw new Error("所有临时接口均未能获取到该QQ音乐的音源");
                }
                Object.assign(data, {
                    music_url: backupData.music_url,
                    song_name: backupData.title,
                    song_singer: backupData.singer,
                    cover: backupData.cover
                });
            }

            const songName = data.song_name || "未知歌曲";
            const artistName = data.song_singer || "未知艺术家";
            
            const info = [
                segment.image(data.cover),
                `${ConfigLoader.cfg.general.identifyPrefix} QQ音乐`,
                `歌曲: ${songName}`,
                `歌手: ${artistName}`
            ].join('\n');
            await e.reply(info);

            const safeTitle = `${artistName} - ${songName}`.replace(/[\\/:\*\?"<>\|]/g, '_');
            const tempFile = path.join(dataDir, `${safeTitle}.mp3`); // 接口通常返回mp3
            await this.downloadFile(tempFile, data.music_url);
            
            // QQ音乐解析只上传群文件
            await this.uploadFile(e, tempFile, `${safeTitle}.mp3`);

        } catch (error) {
            logger.error(`[荷花插件][QQ音乐] 失败:`, error);
            await e.reply(`QQ音乐解析失败: ${error.message}`);
        }
        return true;
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
            } else {
                // 兼容旧版或不同适配器
                await e.group.sendFile(filePath);
            }
        } finally {
            if (fs.existsSync(filePath)) fs.unlink(filePath, ()=>{});
        }
    }
}