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

// WeApi 常量
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const PUBKEY = '010001';
const NONCE = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';

export class neteasePartner extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 音乐合伙人',
            dsc: '合伙人自动评定任务(扫码登录版)',
            event: 'message',
            priority: 10,
            rule: [
                { reg: '^#合伙人测试$', fnc: 'manualTest', permission: 'master' },
                { reg: '^#合伙人登录$', fnc: 'partnerLogin', permission: 'master' },
                { reg: '^#合伙人日志$', fnc: 'getPartnerLog', permission: 'master' }
            ]
        });

        if (global.lotusNeteaseLoaded) return;
        
        this.task = null;
        this.init();

        global.lotusNeteaseLoaded = true;
    }

    async init() {
        if (!fs.existsSync(neteaseDataDir)) fs.mkdirSync(neteaseDataDir, { recursive: true });
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        this.setupScheduler();
        this.runStartupSequence();
    }

    // --- WeApi 加密实现 (修正版) ---
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
            
            // 必须使用循环模幂运算，直接 ** 会卡死
            let res = 1n;
            let base = kBig;
            let exp = eBig;
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
        try {
            return YAML.parse(fs.readFileSync(configPath, 'utf8')).neteasePartner || {};
        } catch (e) { return {}; }
    }

    _saveConfig(data) {
        let fullConfig = YAML.parse(fs.readFileSync(configPath, 'utf8'));
        fullConfig.neteasePartner = data;
        fs.writeFileSync(configPath, YAML.stringify(fullConfig), 'utf8');
    }

    // --- 二维码登录逻辑 ---
    async partnerLogin(e) {
        const config = this._loadConfig();
        const apiUrl = config.apiUrl || "http://127.0.0.1:3000";

        try {
            const keyRes = await axios.get(`${apiUrl}/login/qr/key?timestamp=${Date.now()}`);
            const key = keyRes.data.data.unikey;

            const qrRes = await axios.get(`${apiUrl}/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`);
            const qrimg = qrRes.data.data.qrimg; 

            await e.reply(["[荷花合伙人] 请使用网易云APP扫码登录：\n(如无法显示图片请检查API服务)", segment.image(qrimg)]);

            let timer = setInterval(async () => {
                const checkRes = await axios.get(`${apiUrl}/login/qr/check?key=${key}&timestamp=${Date.now()}`).catch(()=>null);
                if (!checkRes) return;
                const status = checkRes.data.code;

                if (status === 800) {
                    await e.reply("二维码已过期，请重新发送 #合伙人登录");
                    clearInterval(timer);
                } else if (status === 803) {
                    clearInterval(timer);
                    const cookie = checkRes.data.cookie;
                    
                    let currentConfig = this._loadConfig();
                    if (!currentConfig.accounts) currentConfig.accounts = [];
                    
                    // 查找是否已存在该 QQ 的账号，存在则更新，不存在则 push
                    const idx = currentConfig.accounts.findIndex(a => a.qq === e.user_id);
                    if (idx > -1) {
                        currentConfig.accounts[idx].cookie = cookie;
                    } else {
                        currentConfig.accounts.push({
                            name: `账号_${e.user_id}`,
                            qq: e.user_id,
                            extraCount: 9999,
                            comment: true,
                            cookie: cookie
                        });
                    }
                    this._saveConfig(currentConfig);
                    await e.reply(`[荷花合伙人] 登录成功！凭证已存入配置文件。`);
                }
            }, 3000);

            setTimeout(() => clearInterval(timer), 300000); 
        } catch (err) {
            await e.reply(`启动扫码失败，请确认API服务已开启: ${err.message}`);
        }
    }

    // --- 任务执行主体 ---
    async executeTask(triggerType = "定时任务") {
        // 先写运行记录
        fs.writeFileSync(lastRunLogPath, new Date().toLocaleDateString('sv-SE'), 'utf8');

        const config = this._loadConfig();
        const accounts = config.accounts || [];
        const comments = fs.existsSync(commentPath) ? fs.readFileSync(commentPath, 'utf8').split('\n').filter(l => l.trim()) : ["打卡支持！"];
        
        let stats = { total: 0, success: 0, skip: 0, fail: 0 };
        let detail = { success: [], skip: [], fail: [] };

        if (accounts.length === 0) return "--- 荷花音乐合伙人打卡报告 ---\n未配置任何账号，请先扫码登录。";

        for (const acc of accounts) {
            const cookie = acc.cookie;
            if (!cookie) {
                stats.fail++;
                detail.fail.push(`${acc.name} (未登录)`);
                continue;
            }

            try {
                const csrf = cookie.match(/__csrf=([^;]+)/)?.[1] || "";
                
                // 1. 获取任务
                const taskRes = await axios.get(`https://interface.music.163.com/api/music/partner/daily/task/get`, {
                    headers: { Cookie: cookie, Referer: "https://mp.music.163.com/" }
                });

                if (taskRes.data.code === 301) throw new Error("Cookie已失效");
                if (taskRes.data.code !== 200) throw new Error(taskRes.data.message || "接口异常");

                const works = [...(taskRes.data.data.works || [])];
                
                // 2. 获取额外任务
                const extraRes = await axios.get(`https://interface.music.163.com/api/music/partner/extra/wait/evaluate/work/list`, {
                    headers: { Cookie: cookie, Referer: "https://mp.music.163.com/" }
                }).catch(() => null);

                if (extraRes?.data?.code === 200) {
                    const undoneExtra = (extraRes.data.data || []).filter(x => !x.completed).slice(0, acc.extraCount || 0);
                    works.push(...undoneExtra.map(x => ({ ...x, isExtra: true })));
                }

                if (works.length === 0) {
                    detail.success.push(`${acc.name} (今日无评定待办)`);
                }

                // 3. 执行循环
                for (const item of works) {
                    stats.total++;
                    if (item.completed) {
                        stats.skip++;
                        detail.skip.push(item.work.name);
                        continue;
                    }

                    // 模拟听歌
                    await new Promise(r => setTimeout(r, (Math.floor(Math.random() * 3) + 8) * 1000));

                    const score = Math.floor(Math.random() * 3) + 2; 
                    const payload = {
                        taskId: taskRes.data.data.id,
                        workId: item.work.id,
                        score,
                        tags: `${score}-A-1`,
                        customTags: "[]",
                        comment: acc.comment ? comments[Math.floor(Math.random() * comments.length)] : "",
                        syncYunCircle: "true",
                        syncComment: acc.comment ? "true" : "false",
                        extraScore: JSON.stringify({ "1": score, "2": score, "3": score }),
                        source: "mp-music-partner",
                        csrf_token: csrf
                    };
                    if (item.isExtra) payload.extraResource = "true";

                    const cryptoData = this.weapi(payload);
                    const postRes = await axios.post(`https://interface.music.163.com/weapi/music/partner/work/evaluate?csrf_token=${csrf}`, 
                        new URLSearchParams(cryptoData).toString(), 
                        { headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://mp.music.163.com/" } }
                    );

                    if (postRes.data.code === 200) {
                        stats.success++;
                        detail.success.push(`${item.work.name} (${score}分)`);
                    } else {
                        stats.fail++;
                        detail.fail.push(`${item.work.name} (${postRes.data.message})`);
                    }
                }
            } catch (e) {
                stats.fail++;
                detail.fail.push(`${acc.name} (${e.message})`);
            }
        }

        const report = [
            `--- 荷花音乐合伙人打卡报告 ---`,
            `触发方式: ${triggerType}`,
            ``,
            `执行完毕，共执行评定${stats.total}首歌，成功${stats.success}个，跳过${stats.skip}个，失败${stats.fail}个`,
            ``,
            `评定成功：\n${detail.success.length ? detail.success.join('\n') : '无'}`,
            ``,
            `评定跳过：\n${detail.skip.length ? detail.skip.join('\n') : '无'}`,
            ``,
            `评定失败：\n${detail.fail.length ? detail.fail.join('\n') : '无'}`
        ].join('\n');

        const now = new Date();
        const dateStr = now.getFullYear() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0') + now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0') + now.getSeconds().toString().padStart(2, '0');
        fs.writeFileSync(path.join(logDir, `nep-${dateStr}.log`), report, 'utf8');

        return report;
    }

    runStartupSequence() {
        const config = this._loadConfig();
        if (config.autoCatchUp !== true) return;

        const today = new Date().toLocaleDateString('sv-SE');
        const lastRunDate = fs.existsSync(lastRunLogPath) ? fs.readFileSync(lastRunLogPath, 'utf8').trim() : null;

        if (lastRunDate !== today) {
            const cron = config.schedule || "0 5 0 * * *";
            const parts = cron.split(' ');
            const sHour = parseInt(parts[2], 10);
            const sMin = parseInt(parts[1], 10);
            const now = new Date();
            const scheduledToday = new Date();
            scheduledToday.setHours(sHour, sMin, 0, 0);

            if (now > scheduledToday) {
                logger.info('[网易云合伙人] 发现错过今日任务，正在补签...');
                this.executeTask("自动补签");
            }
        }
    }

    async manualTest(e) {
        await e.reply("合伙人手动测试开始...");
        const res = await this.executeTask("手动测试");
        await e.reply(res);
    }

    async getPartnerLog(e) {
        const files = fs.readdirSync(logDir).filter(f => f.startsWith('nep-')).sort().reverse();
        if (files.length === 0) return e.reply("暂无日志记录。");
        const content = fs.readFileSync(path.join(logDir, files[0]), 'utf8');
        await e.reply(`最新日志 [${files[0]}]:\n\n${content}`);
    }

    setupScheduler() {
        const config = this._loadConfig();
        if (this.task) this.task.cancel();
        if (config.enable && config.schedule) {
            this.task = schedule.scheduleJob(config.schedule, async () => {
                const report = await this.executeTask("定时任务");
                (cfg.masterQQ || []).forEach(m => Bot.pickFriend(m).sendMsg(report).catch(() => {}));
            });
        }
    }
}