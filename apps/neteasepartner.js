import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import axios from 'axios';
import crypto from 'node:crypto';
import schedule from 'node-schedule';
import cfg from '../../../lib/config/config.js';

const _path = process.cwd();
const lotusRoot = path.join(_path, 'plugins', 'Lotus-Plugin');
const configPath = path.join(lotusRoot, 'config', 'config.yaml');
const commentPath = path.join(lotusRoot, 'config', 'comment.example');
const logDir = path.join(lotusRoot, 'data', 'logs');
const neteaseDataDir = path.join(lotusRoot, 'data', 'netease');
const lastRunLogPath = path.join(neteaseDataDir, 'lastRun-nep.log');

const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const PUBKEY = '010001';
const NONCE = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';

export class neteasePartner extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 音乐合伙人',
            dsc: '音乐合伙人自动评定',
            event: 'message',
            priority: 10,
            rule: [
                { reg: '^#合伙人测试$', fnc: 'manualTest', permission: 'master' },
                { reg: '^#合伙人登录$', fnc: 'partnerLogin', permission: 'master' },
                { reg: '^#合伙人日志$', fnc: 'getPartnerLog', permission: 'master' }
            ]
        });

        for (let i in schedule.scheduledJobs) {
            if (i.startsWith('nep_')) {
                schedule.scheduledJobs[i].cancel();
            }
        }
        this.init();
    }

    async init() {
        if (!fs.existsSync(neteaseDataDir)) fs.mkdirSync(neteaseDataDir, { recursive: true });
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        this.setupScheduler();
        setTimeout(() => this.runStartupSequence(), 10000);
    }

    getWeightedScore() {
        const r = Math.floor(Math.random() * 100);
        if (r < 35) return 3;
        if (r < 70) return 4;
        if (r < 90) return 2;
        return 5;
    }

    weapi(obj) {
        const text = JSON.stringify(obj);
        const secretKey = crypto.randomBytes(16).map(n => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charCodeAt(n % 62));
        const aesEncrypt = (data, key, iv) => {
            const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
            return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
        };
        const params = aesEncrypt(aesEncrypt(text, NONCE, IV), secretKey, IV);
        const rsaEncrypt = (key, pubKey, mod) => {
            const mBig = BigInt('0x' + mod);
            const eBig = BigInt('0x' + pubKey);
            const kBig = BigInt('0x' + Buffer.from(key).reverse().toString('hex'));
            let res = 1n, base = kBig, exp = eBig;
            while (exp > 0n) {
                if (exp % 2n === 1n) res = (res * base) % mBig;
                base = (base * base) % mBig;
                exp /= 2n;
            }
            return res.toString(16).padStart(256, '0');
        };
        return { params, encSecKey: rsaEncrypt(secretKey, PUBKEY, MODULUS) };
    }

    _loadConfig() {
        if (!fs.existsSync(configPath)) return {};
        try { return YAML.parse(fs.readFileSync(configPath, 'utf8')).neteasePartner || {}; } catch (e) { return {}; }
    }

    _saveConfig(data) {
        let fullConfig = YAML.parse(fs.readFileSync(configPath, 'utf8'));
        fullConfig.neteasePartner = data;
        fs.writeFileSync(configPath, YAML.stringify(fullConfig), 'utf8');
    }

    async partnerLogin(e) {
        const config = this._loadConfig();
        const apiUrl = config.apiUrl || "http://127.0.0.1:3000";
        try {
            const keyRes = await axios.get(`${apiUrl}/login/qr/key?timestamp=${Date.now()}`);
            const key = keyRes.data.data.unikey;
            const qrRes = await axios.get(`${apiUrl}/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`);
            const qrimg = qrRes.data.data.qrimg; 
            await e.reply(["[荷花合伙人] 请使用网易云APP扫码登录：", segment.image(qrimg)]);
            let timer = setInterval(async () => {
                const checkRes = await axios.get(`${apiUrl}/login/qr/check?key=${key}&timestamp=${Date.now()}`).catch(()=>null);
                if (checkRes?.data?.code === 803) {
                    clearInterval(timer);
                    const rawCookie = checkRes.data.cookie || "";
                    const filterKeys = ['path', 'expires', 'max-age', 'domain', 'httponly', 'secure', 'samesite'];
                    const cookieMap = {};
                    rawCookie.split(';').forEach(item => {
                        const pair = item.trim().split('=');
                        if (pair.length > 1) {
                            const k = pair[0].trim();
                            const v = pair.slice(1).join('=');
                            if (k && !filterKeys.includes(k.toLowerCase())) cookieMap[k] = v;
                        }
                    });
                    const cleanCookie = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
                    let uid = "", nickname = "新账号";
                    try {
                        const userRes = await axios.get(`${apiUrl}/user/account?cookie=${encodeURIComponent(cleanCookie)}&timestamp=${Date.now()}`);
                        uid = userRes.data.profile.userId;
                        nickname = userRes.data.profile.nickname;
                    } catch (err) {}
                    let currentConfig = this._loadConfig();
                    if (!currentConfig.accounts) currentConfig.accounts = [];
                    const idx = currentConfig.accounts.findIndex(a => a.uid === uid);
                    const accountData = { uid, nickname, qq: e.user_id, extraCount: 9999, comment: true, cookie: cleanCookie };
                    if (idx > -1) currentConfig.accounts[idx] = { ...currentConfig.accounts[idx], ...accountData };
                    else currentConfig.accounts.push(accountData);
                    this._saveConfig(currentConfig);
                    await e.reply(`[荷花合伙人] 登录成功：${nickname}`);
                } else if (checkRes?.data?.code === 800) {
                    clearInterval(timer);
                    await e.reply("[荷花合伙人] 二维码已过期，请重新登录");
                }
            }, 3000);
            setTimeout(() => clearInterval(timer), 300000); 
        } catch (err) { await e.reply(`启动扫码失败: ${err.message}`); }
    }

    async executeTask(triggerType = "定时任务") {
        fs.writeFileSync(lastRunLogPath, new Date().toLocaleDateString('sv-SE'), 'utf8');
        const config = this._loadConfig();
        const accounts = config.accounts || [];
        const comments = fs.existsSync(commentPath) ? fs.readFileSync(commentPath, 'utf8').split('\n').filter(l => l.trim()) : ["打卡支持"];
        let reportBlocks = [`---荷花音乐合伙人打卡报告---`, `触发方式:${triggerType}`];
        
        if (accounts.length === 0) return "---荷花音乐合伙人打卡报告---\n未配置账号";

        for (const acc of accounts) {
            let songResults = new Map();
            const name = acc.nickname || `用户_${acc.uid}`;
            const headers = { Cookie: acc.cookie, Referer: "https://mp.music.163.com/" };

            for (let round = 1; round <= 2; round++) {
                try {
                    if (!acc.cookie) throw new Error("未登录");
                    const csrf = acc.cookie.match(/__csrf=([^;]+)/)?.[1] || "";
                    const taskRes = await axios.get(`https://interface.music.163.com/api/music/partner/daily/task/get`, { headers });
                    if (taskRes.data.code !== 200) throw new Error(taskRes.data.message || "接口异常");

                    let works = [...(taskRes.data.data.works || [])];
                    const extraRes = await axios.get(`https://interface.music.163.com/api/music/partner/extra/wait/evaluate/work/list`, { headers }).catch(() => null);
                    if (extraRes?.data?.code === 200) {
                        const undone = (extraRes.data.data || []).filter(x => !x.completed).slice(0, acc.extraCount || 0);
                        works.push(...undone.map(x => ({ ...x, isExtra: true })));
                    }

                    for (const item of works) {
                        const songId = item.work.id;
                        const songName = item.work.name;
                        if (songResults.has(songId) && songResults.get(songId).status === 'success') continue;
                        if (item.completed) {
                            songResults.set(songId, { name: songName, status: 'skip', msg: '已完成' });
                            continue;
                        }

                        await new Promise(r => setTimeout(r, (Math.floor(Math.random() * 3) + 8) * 1000));
                        const score = this.getWeightedScore();
                        let extraScoreObj = {};
                        if (item.work.dimensions) {
                            item.work.dimensions.forEach(d => {
                                extraScoreObj[d.id || d] = this.getWeightedScore();
                            });
                        }

                        const payload = {
                            taskId: taskRes.data.data.id, workId: songId, score,
                            tags: `${score}-A-1`, customTags: "[]",
                            comment: acc.comment ? comments[Math.floor(Math.random() * comments.length)] : "",
                            syncYunCircle: "true", syncComment: acc.comment ? "true" : "false",
                            extraScore: JSON.stringify(extraScoreObj),
                            source: "mp-music-partner", csrf_token: csrf
                        };
                        if (item.isExtra) payload.extraResource = "true";

                        const cryptoData = this.weapi(payload);
                        const postRes = await axios.post(`https://interface.music.163.com/weapi/music/partner/work/evaluate?csrf_token=${csrf}`, 
                            new URLSearchParams(cryptoData).toString(), 
                            { headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" } }
                        );

                        if (postRes.data.code === 200) {
                            songResults.set(songId, { name: songName, status: 'success', msg: `${score}分` });
                        } else {
                            songResults.set(songId, { name: songName, status: 'fail', msg: postRes.data.message });
                        }
                    }
                } catch (e) {
                    if (round === 2 && songResults.size === 0) songResults.set('err', { name: '流程错误', status: 'fail', msg: e.message });
                }
            }

            let stats = { total: 0, success: 0, skip: 0, fail: 0 };
            let detail = { success: [], skip: [], fail: [] };
            songResults.forEach(res => {
                if (res.name === '流程错误') return;
                stats.total++;
                if (res.status === 'success') { stats.success++; detail.success.push(`${res.name} (${res.msg})`); }
                else if (res.status === 'skip') { stats.skip++; detail.skip.push(`${res.name} (${res.msg})`); }
                else { stats.fail++; detail.fail.push(`${res.name} (${res.msg})`); }
            });

            if (stats.total === 0) detail.success.push("今日无评定待办");
            let block = [`---`, name, ``, `执行完毕，共执行评定${stats.total}首歌，成功${stats.success}个，跳过${stats.skip}个，失败${stats.fail}个`, ``, `评定成功：\n${detail.success.join('\n') || '无'}`, ``, `评定跳过：\n${detail.skip.join('\n') || '无'}`, ``, `评定失败：\n${detail.fail.join('\n') || '无'}`];
            reportBlocks.push(block.join('\n'));
        }

        const finalReport = reportBlocks.join('\n');
        const now = new Date();
        const dateStr = now.getFullYear() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0') + now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0');
        fs.writeFileSync(path.join(logDir, `nep-${dateStr}.log`), finalReport, 'utf8');
        return finalReport;
    }

    runStartupSequence() {
        const config = this._loadConfig();
        if (config.autoCatchUp !== true) return;
        const today = new Date().toLocaleDateString('sv-SE');
        if (fs.existsSync(lastRunLogPath) && fs.readFileSync(lastRunLogPath, 'utf8').trim() === today) return;
        const cron = config.schedule || "0 5 0 * * *";
        const parts = cron.split(' ');
        const sTime = new Date();
        sTime.setHours(parseInt(parts[2]), parseInt(parts[1]), 0, 0);
        if (new Date() > sTime) {
            this.executeTask("自动补签").then(report => {
                if (!global.Bot) return;
                (cfg.masterQQ || []).forEach(m => Bot.pickFriend(m).sendMsg(report).catch(() => {}));
            });
        }
    }

    async manualTest(e) {
        await e.reply("手动评定任务启动...");
        const res = await this.executeTask("手动测试");
        await e.reply(res);
    }

    async getPartnerLog(e) {
        const files = fs.readdirSync(logDir).filter(f => f.startsWith('nep-')).sort().reverse();
        if (files.length === 0) return e.reply("无日志记录");
        await e.reply(`最新日志 [${files[0]}]:\n\n${fs.readFileSync(path.join(logDir, files[0]), 'utf8')}`);
    }

    setupScheduler() {
        const config = this._loadConfig();
        if (config.enable && config.schedule) {
            schedule.scheduleJob('nep_auto_task', config.schedule, async () => {
                const report = await this.executeTask("定时任务");
                if (!global.Bot) return;
                (cfg.masterQQ || []).forEach(m => Bot.pickFriend(m).sendMsg(report).catch(() => {}));
            });
        }
    }
}