import plugin from '../../../lib/plugins/plugin.js';
import fetch from 'node-fetch';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'child_process';
import YAML from 'yaml';
import axios from 'axios';
import qrcode from "qrcode";
import ConfigLoader from '../model/config_loader.js';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'netease');
const configDir = path.join(pluginRoot, 'config');
const configPath = path.join(configDir, 'parser.yaml');
const redisSongKey = "lotus:parser:netease_song_list:";
const NETEASE_PUBLIC_API = "https://neteasecloudmusicapi.vercel.app";

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
                { reg: '^#网易云登录$', fnc: 'login', permission: 'master' },
                { reg: '^#网易云状态$', fnc: 'getStatus', permission: 'master' }
            ]
        });

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        this.neteaseApi = ConfigLoader.cfg.netease.localApiUrl || NETEASE_PUBLIC_API;
    }

    getNeteaseApi() {
        return ConfigLoader.cfg.netease.localApiUrl || NETEASE_PUBLIC_API;
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
                await this.handleSong(e, id, false); // 直接发链接，isFromRequest=false
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
            const resp = await axios.get(searchUrl, { headers: { Cookie: ConfigLoader.cfg.netease.cookie } });
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
        await this.handleSong(e, song.id, true); // 点歌播放，isFromRequest=true
        return true;
    }

    async playSongNow(e) {
        const keyword = e.msg.replace(/^#?播放/, '').trim();
        try {
            const searchUrl = `${this.getNeteaseApi()}/search?keywords=${encodeURIComponent(keyword)}&limit=1`;
            const resp = await axios.get(searchUrl, { headers: { Cookie: ConfigLoader.cfg.netease.cookie } });
            const song = resp.data.result?.songs?.[0];
            if (!song) return e.reply(`未能找到与“${keyword}”相关的歌曲。`);
            await this.handleSong(e, song.id, true); // 点歌播放，isFromRequest=true
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
            axios.get(songUrlUrl, { headers: { Cookie: cfg.netease.cookie }})
        ]);

        const songData = detailRes.data.songs[0];
        const songUrlData = songUrlRes.data.data[0];

        if (!songUrlData.url) throw new Error("获取歌曲链接失败，可能是VIP或无版权歌曲，请尝试 #网易云登录");
        
        const songName = songData.name;
        const artistName = songData.ar.map(a => a.name).join('/');
        const info = [
            segment.image(songData.al.picUrl),
            `${cfg.general.identifyPrefix} 网易云音乐`,
            `歌曲: ${songName}`,
            `歌手: ${artistName}`,
            `音质: ${songUrlData.level}`,
            `大小: ${(songUrlData.size / 1024 / 1024).toFixed(2)} MB`
        ].join('\n');
        await e.reply(info);

        const safeTitle = `${artistName} - ${songName}`.replace(/[\\/:\*\?"<>\|]/g, '_');
        const tempFile = path.join(dataDir, `${safeTitle}.${songUrlData.type || 'mp3'}`);
        await this.downloadFile(tempFile, songUrlData.url);
        
        if (isFromRequest && cfg.netease.sendAsVoice) {
            // 转码为amr并发送语音
            const amrFile = tempFile.replace(/\.\w+$/, '.amr');
            await this.convertToAmr(tempFile, amrFile);
            await e.reply(segment.record(amrFile));
            if (fs.existsSync(amrFile)) fs.unlink(amrFile, () => {});
            if (fs.existsSync(tempFile)) fs.unlink(tempFile, () => {});
        } else {
            // 上传群文件
            await this.uploadFile(e, tempFile, `${safeTitle}.${songUrlData.type || 'mp3'}`);
        }
    }
    
    async handleMv(e, id) {
        const api = this.getNeteaseApi();
        const mvDetailUrl = `${api}/mv/detail?mvid=${id}`;
        const mvUrlUrl = `${api}/mv/url?id=${id}`;
        const [detailRes, urlRes] = await Promise.all([
            axios.get(mvDetailUrl, { headers: { Cookie: ConfigLoader.cfg.netease.cookie } }),
            axios.get(mvUrlUrl, { headers: { Cookie: ConfigLoader.cfg.netease.cookie } })
        ]);
        const mvData = detailRes.data.data;
        const mvUrl = urlRes.data.data.url;
        await e.reply([segment.image(mvData.cover), `${ConfigLoader.cfg.general.identifyPrefix} 网易云MV: ${mvData.name} - ${mvData.artistName}`]);
        const tempFile = path.join(dataDir, `netease_mv_${Date.now()}.mp4`);
        await this.downloadFile(tempFile, mvUrl);
        await this.sendVideo(e, tempFile, `netease_mv_${id}.mp4`);
    }

    async login(e) {
        const api = this.getNeteaseApi();
        try {
            const keyRes = await axios.get(`${api}/login/qr/key?timestamp=${Date.now()}`);
            const key = keyRes.data.data.unikey;

            const qrRes = await axios.get(`${api}/login/qr/create?key=${key}&qrimg=true×tamp=${Date.now()}`);
            const qrPath = path.join(dataDir, 'netease_qr.png');
            await qrcode.toFile(qrPath, qrRes.data.data.qrurl);
            await e.reply([segment.image(qrPath), "请使用网易云音乐APP扫描二维码登录。"]);
            if (fs.existsSync(qrPath)) fs.unlink(qrPath, ()=>{});

            let interval;
            const poll = async () => {
                const checkRes = await axios.get(`${api}/login/qr/check?key=${key}×tamp=${Date.now()}`);
                const { code, cookie, message } = checkRes.data;
                if (code === 803) {
                    clearInterval(interval);
                    const cfgToUpdate = YAML.parse(fs.readFileSync(configPath, 'utf8'));
                    cfgToUpdate.netease.cookie = cookie;
                    fs.writeFileSync(configPath, YAML.stringify(cfgToUpdate), 'utf8');
                    loadConfig(); // 重新加载配置到内存
                    e.reply("网易云登录成功！Cookie已自动保存到配置文件。");
                } else if (code === 800) {
                    clearInterval(interval);
                    e.reply("二维码已过期，请重试。");
                }
            };
            interval = setInterval(poll, 3000);
            setTimeout(() => { clearInterval(interval); }, 120000);

        } catch (error) {
            logger.error(`[荷花插件][网易云登录] 失败:`, error);
            await e.reply(`网易云登录失败: ${error.message}`);
        }
        return true;
    }

    async getStatus(e) {
        const cfg = ConfigLoader.cfg;
        if (!cfg.netease.cookie) return e.reply("请先使用 #网易云登录 登录。");
        try {
            const statusUrl = `${this.getNeteaseApi()}/login/status?timestamp=${Date.now()}`;
            const resp = await axios.get(statusUrl, { headers: { Cookie: cfg.netease.cookie } });
            const profile = resp.data.data?.profile;
            if (!profile) throw new Error("Cookie已失效，请重新登录");
            
            const statusText = [
                `昵称: ${profile.nickname}`,
                `用户ID: ${profile.userId}`,
                `等级: ${profile.level}`,
                `VIP类型: ${profile.vipType > 0 ? '是' : '否'}`,
            ].join('\n');
            await e.reply(statusText);

        } catch (error) {
            logger.error(`[荷花插件][网易云状态] 失败:`, error);
            await e.reply(`获取状态失败: ${error.message}`);
        }
        return true;
    }
    
    // --- 工具函数 ---
    async normalizeUrl(input) {
        const match = input.match(/https?:\/\/[^\s]+/);
        if (!match) {
            if (/(^BV[1-9a-zA-Z]{10}$)|(^av[0-9]+$)/.test(input)) return `https://www.bilibili.com/video/${input}`;
            throw new Error("无法识别的链接格式");
        }
        let url = match[0];
        if (url.includes("b23.tv")) {
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
            } else if (e.isGroup && e.group.sendFile) { // 兼容旧版
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
                if (error) { logger.error(`[荷花插件][FFmpeg] 转码AMR失败: ${stderr}`); return reject(new Error("FFmpeg转码AMR失败")); }
                resolve();
            });
        });
    }
}