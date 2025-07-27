import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import axios from 'axios';
import ConfigLoader from '../model/config_loader.js';

const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'netease');
const redisSongKey = "lotus:parser:netease_song_list:";

const COMMON_HEADER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
};

export class NeteaseParser extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 网易云音乐',
            dsc: '解析网易云音乐链接、点歌',
            event: 'message',
            priority: 4000,
            rule: [
                { reg: '(music.163.com|163cn.tv)', fnc: 'parse' },
                { reg: '^#点歌(.*)', fnc: 'requestSong' },
                { reg: '^#听[1-9]\\d*$', fnc: 'playSongFromList' },
                { reg: '^#?播放(.*)', fnc: 'playSongNow' },
                { reg: '^#网易云登录$', fnc: 'login', permission: 'master' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        
        this.neteaseApi = ConfigLoader.cfg.netease.localApiUrl;
        if (!this.neteaseApi) {
            logger.warn('[荷花插件][网易云] 警告：未在 config/parser.yaml 中配置自建API地址 (localApiUrl)，相关功能将无法使用。');
        }
    }

    getNeteaseApi() {
        const apiUrl = ConfigLoader.cfg.netease.localApiUrl;
        if (!apiUrl) {
            throw new Error("功能未启用：请联系机器人管理员配置自建网易云API。");
        }
        return apiUrl;
    }

    async parse(e) {
        try {
            const url = await this.normalizeUrl(e.msg.trim());
            const idMatch = url.match(/id=(\d+)/);
            if (!idMatch) throw new Error("无法获取网易云ID");
            const id = idMatch[1];

            if (url.includes('/mv?')) {
                await this.handleMv(e, id);
            } else {
                await this.handleSong(e, id, false);
            }
        } catch (error) {
            logger.error(`[荷花插件][网易云] 失败:`, error);
            await e.reply(`网易云解析失败: ${error.message}`);
        }
        return true;
    }
    
    async requestSong(e) {
        const keyword = e.msg.replace(/^#点歌/, '').trim();
        if (!keyword) return e.reply("请输入歌曲或歌手名~");

        try {
            const searchUrl = `${this.getNeteaseApi()}/search?keywords=${encodeURIComponent(keyword)}&limit=${ConfigLoader.cfg.netease.songRequestMaxList}`;
            const resp = await axios.get(searchUrl);
            const songs = resp.data.result?.songs;

            if (!songs || songs.length === 0) return e.reply(`未能找到与“${keyword}”相关的歌曲。`);
            
            const songList = songs.map((s, index) => ({
                index: index + 1,
                id: s.id,
                name: s.name,
                artist: s.ar?.map(a => a.name).join('/') || '未知艺术家'
            }));

            await redis.set(redisSongKey + e.group_id, JSON.stringify(songList), { EX: 300 });

            let replyMsg = "请发送 `#听[序号]` 来播放歌曲：\n";
            replyMsg += songList.map(s => `${s.index}. ${s.name} - ${s.artist}`).join('\n');
            await e.reply(replyMsg);

        } catch (error) {
            logger.error(`[荷花插件][点歌] 失败:`, error);
            await e.reply(`点歌失败: ${error.message}`);
        }
        return true;
    }

    async playSongFromList(e) {
        const index = parseInt(e.msg.replace('#听', '').trim()) - 1;
        const songListJson = await redis.get(redisSongKey + e.group_id);
        if (!songListJson) return e.reply("点歌列表已过期，请重新 #点歌");
        
        const songList = JSON.parse(songListJson);
        if (index < 0 || index >= songList.length) return e.reply("序号选择无效。");
        
        const song = songList[index];
        await this.handleSong(e, song.id, true);
        return true;
    }

    async playSongNow(e) {
        const keyword = e.msg.replace(/^#?播放/, '').trim();
        try {
            const searchUrl = `${this.getNeteaseApi()}/search?keywords=${encodeURIComponent(keyword)}&limit=1`;
            const resp = await axios.get(searchUrl);
            const song = resp.data.result?.songs?.[0];
            if (!song) return e.reply(`未能找到与“${keyword}”相关的歌曲。`);
            await this.handleSong(e, song.id, true);
        } catch (error) {
             logger.error(`[荷花插件][播放] 失败:`, error);
             await e.reply(`播放失败: ${error.message}`);
        }
        return true;
    }
    
    async handleSong(e, id, isFromRequest = false) {
        const cfg = ConfigLoader.cfg;
        const api = this.getNeteaseApi();
        const detailUrl = `${api}/song/detail?ids=${id}`;
        const songUrlUrl = `${api}/song/url/v1?id=${id}&level=${cfg.netease.quality}`;
        
        const [detailRes, songUrlRes] = await Promise.all([
            axios.get(detailUrl),
            axios.get(songUrlUrl)
        ]);

        const songData = detailRes.data.songs[0];
        const songUrlData = songUrlRes.data.data[0];

        if (!songUrlData || !songUrlData.url) throw new Error("获取歌曲链接失败，可能是VIP或无版权歌曲。\n请确保您的API服务已登录账号。");
        
        const songName = songData.name;
        const artistName = songData.ar.map(a => a.name).join('/');
        
        const textInfo = [
            `${cfg.general.identifyPrefix} 网易云音乐`,
            `歌曲: ${songName}`,
            `歌手: ${artistName}`,
            `音质: ${songUrlData.level}`,
            `大小: ${(songUrlData.size / 1024 / 1024).toFixed(2)} MB`
        ].join('\n');
        
        if (cfg.netease.sendAlbumArt) {
            await e.reply([
                segment.image(songData.al.picUrl),
                textInfo
            ]);
        } else {
            await e.reply(textInfo);
        }

        const safeTitle = `${artistName} - ${songName}`.replace(/[\\/:\*\?"<>\|]/g, '_');
        const tempFile = path.join(dataDir, `${safeTitle}.${songUrlData.type || 'mp3'}`);
        await this.downloadFile(tempFile, songUrlData.url);
        
        if (isFromRequest && cfg.netease.sendAsVoice) {
            const amrFile = tempFile.replace(/\.\w+$/, '.amr');
            await this.convertToAmr(tempFile, amrFile);
            await e.reply(segment.record(amrFile));
            if (fs.existsSync(amrFile)) fs.unlink(amrFile, () => {});
            if (fs.existsSync(tempFile)) fs.unlink(tempFile, () => {});
        } else {
            await this.uploadFile(e, tempFile, `${safeTitle}.${songUrlData.type || 'mp3'}`);
        }
    }
    
    async handleMv(e, id) {
        const api = this.getNeteaseApi();
        const mvDetailUrl = `${api}/mv/detail?mvid=${id}`;
        const mvUrlUrl = `${api}/mv/url?id=${id}`;
        const [detailRes, urlRes] = await Promise.all([
            axios.get(mvDetailUrl),
            axios.get(mvUrlUrl)
        ]);
        const mvData = detailRes.data.data;
        const mvUrl = urlRes.data.data.url;
        await e.reply([segment.image(mvData.cover), `${ConfigLoader.cfg.general.identifyPrefix} 网易云MV: ${mvData.name} - ${mvData.artistName}`]);
        const tempFile = path.join(dataDir, `netease_mv_${Date.now()}.mp4`);
        await this.downloadFile(tempFile, mvUrl);
        await this.sendVideo(e, tempFile, `netease_mv_${id}.mp4`);
    }

    async login(e) {
        await e.reply("请访问您自行部署的 NeteaseCloudMusicApi 服务，并在API服务上完成扫码登录。\n参考文档：https://neteasecloudmusicapi.js.org/#/?id=%e7%99%bb%e5%bd%95");
        return true;
    }

    async normalizeUrl(input) {
        const match = input.match(/https?:\/\/[^\s]+/);
        if (!match) {
            throw new Error("无法识别的链接格式");
        }
        return match[0];
    }
    
    async downloadFile(dest, url, headers = COMMON_HEADER) {
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
                await e.group.fs.upload(filePath, e.group.cwd, fileName);
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
            if (videoSize > ConfigLoader.cfg.general.videoSizeLimit) {
                await e.reply(`视频大小(${videoSize}MB)超过${ConfigLoader.cfg.general.videoSizeLimit}MB限制，转为上传群文件。`);
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
    
    async convertToAmr(inputFile, outputFile) {
        return new Promise((resolve, reject) => {
            const command = `ffmpeg -i "${inputFile}" -ar 8000 -ab 12.2k -ac 1 "${outputFile}"`;
            exec(command, (error, stdout, stderr) => {
                if (error) { 
                    logger.error(`[荷花插件][FFmpeg] 转码AMR失败: ${stderr}`); 
                    return reject(new Error("FFmpeg转码AMR失败"));
                }
                resolve();
            });
        });
    }
}