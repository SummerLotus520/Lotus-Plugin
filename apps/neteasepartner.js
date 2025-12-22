import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import axios from 'axios';
import crypto from 'node:crypto';
import schedule from 'node-schedule';
import cfg from '../../../lib/config/config.js';

// 路径定义
const _path = process.cwd();
const lotusRoot = path.join(_path, 'plugins', 'Lotus-Plugin');
const configPath = path.join(lotusRoot, 'config', 'config.yaml');
const commentPath = path.join(lotusRoot, 'config', 'comment.example');
const logDir = path.join(lotusRoot, 'data', 'logs');
const neteaseDataDir = path.join(lotusRoot, 'data', 'netease'); // 修正：变量名统一
const lastRunLogPath = path.join(neteaseDataDir, 'lastRun-nep.log'); // 运行记录文件

// 网易云 WeApi 加密所需常量
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const PUBKEY = '010001';
const NONCE = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';

export class neteasePartner extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 音乐合伙人',
            dsc: '自研网易云合伙人自动打卡任务',
            event: 'message',
            priority: 10,
            rule: [
                { reg: '^#合伙人测试$', fnc: 'manualTest', permission: 'master' },
                { reg: '^#合伙人登录', fnc: 'partnerLogin', permission: 'master' },
                { reg: '^#合伙人日志$', fnc: 'getPartnerLog', permission: 'master' }
            ]
        });

        this.task = null;
        this.init();
    }

    async init() {
        // 创建必要目录
        if (!fs.existsSync(neteaseDataDir)) fs.mkdirSync(neteaseDataDir, { recursive: true });
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        this.setupScheduler();
        this.runStartupSequence();
    }

    // --- WeApi 加密实现 (JS版) ---
    weapi(obj) {
        const text = JSON.stringify(obj);
        const secretKey = crypto.randomBytes(16).map(n => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charCodeAt(n % 62));
        
        const aesEncrypt = (data, key, iv) => {
            const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
            return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
        };

        const params = aesEncrypt(aesEncrypt(text, NONCE, IV), secretKey, IV);
        
        const rsaEncrypt = (key, pubKey, mod) => {
            const keyBig = BigInt('0x' + Buffer.from(key).reverse().toString('hex'));
            const pubBig = BigInt('0x' + pubKey);
            const modBig = BigInt('0x' + mod);
            let res = 1n;
            let base = keyBig;
            let exp = pubBig;
            while (exp > 0n) {
                if (exp % 2n === 1n) res = (res * base) % modBig;
                base = (base * base) % modBig;
                exp = exp / 2n;
            }
            return res.toString(16).padStart(256, '0');
        };

        return { params, encSecKey: rsaEncrypt(secretKey, PUBKEY, MODULUS) };
    }

    // --- 配置与调度逻辑 ---
    getConfig() {
        if (!fs.existsSync(configPath)) return {};
        const fullConfig = YAML.parse(fs.readFileSync(configPath, 'utf8'));
        return fullConfig.neteasePartner || {};
    }

    runStartupSequence() {
        const config = this.getConfig();
        if (config.autoCatchUp !== true) return;

        const today = new Date().toLocaleDateString('sv-SE');
        const lastRunDate = fs.existsSync(lastRunLogPath) ? fs.readFileSync(lastRunLogPath, 'utf8').trim() : null;

        if (lastRunDate !== today) {
            const parts = config.schedule.split(' ');
            const sHour = parseInt(parts[2], 10);
            const sMin = parseInt(parts[1], 10);
            
            const now = new Date();
            const scheduledToday = new Date();
            scheduledToday.setHours(sHour, sMin, 0, 0);

            if (now > scheduledToday) {
                logger.info('[网易云合伙人] 检测到今日定时已过且未运行，启动开机补签...');
                setTimeout(() => this.executeTask("自动补签"), 5000);
            }
        }
    }

    recordRunDate() {
        const today = new Date().toLocaleDateString('sv-SE');
        fs.writeFileSync(lastRunLogPath, today, 'utf8');
    }

    // --- Cookie 管理 ---
    async getCookie(account) {
        const config = this.getConfig();
        const apiUrl = config.apiUrl || "http://127.0.0.1:3000";
        const cPath = path.join(neteaseDataDir, `p_${account.phone}.json`);
        let cookie = "";

        if (fs.existsSync(cPath)) {
            cookie = JSON.parse(fs.readFileSync(cPath, 'utf8')).cookie;
            try {
                // 尝试静默刷新
                const res = await axios.get(`${apiUrl}/login/refresh`, { params: { cookie, timestamp: Date.now() } });
                if (res.data.cookie) cookie = res.data.cookie;
            } catch (e) { 
                cookie = ""; 
            }
        }

        if (!cookie) {
            try {
                // 尝试账密重登
                const res = await axios.get(`${apiUrl}/login/cellphone`, {
                    params: { phone: account.phone, password: account.password, timestamp: Date.now() }
                });
                if (res.data.code === 200) cookie = res.data.cookie;
            } catch (e) { 
                return null; 
            }
        }

        if (cookie) fs.writeFileSync(cPath, JSON.stringify({ cookie, ts: Date.now() }));
        return cookie;
    }

    // --- 任务核心逻辑 ---
    async executeTask(triggerType = "定时任务") {
        this.recordRunDate(); // 记录今日已运行
        const config = this.getConfig();
        const accounts = config.accounts || [];
        const comments = fs.existsSync(commentPath) ? fs.readFileSync(commentPath, 'utf8').split('\n').filter(l => l.trim()) : ["打卡支持！"];
        
        let stats = { total: 0, success: 0, skip: 0, fail: 0 };
        let detail = { success: [], skip: [], fail: [] };

        for (const acc of accounts) {
            const cookie = await this.getCookie(acc);
            if (!cookie) {
                stats.fail++;
                detail.fail.push(`${acc.name} (登录失败)`);
                continue;
            }

            try {
                const csrf = cookie.match(/__csrf=([^;]+)/)?.[1] || "";
                
                // 1. 获取基础任务列表
                const taskRes = await axios.get(`https://interface.music.163.com/api/music/partner/daily/task/get`, {
                    headers: { Cookie: cookie, Referer: "https://mp.music.163.com/" }
                });
                if (taskRes.data.code !== 200) throw new Error(taskRes.data.message);

                const works = [...taskRes.data.data.works];
                
                // 2. 获取额外任务列表
                const extraRes = await axios.get(`https://interface.music.163.com/api/music/partner/extra/wait/evaluate/work/list`, {
                    headers: { Cookie: cookie, Referer: "https://mp.music.163.com/" }
                });
                if (extraRes.data.code === 200) {
                    const undoneExtra = extraRes.data.data.filter(x => !x.completed).slice(0, acc.extraCount || 0);
                    works.push(...undoneExtra.map(x => ({ ...x, isExtra: true })));
                }

                // 3. 执行评定循环
                for (const item of works) {
                    stats.total++;
                    if (item.completed) {
                        stats.skip++;
                        detail.skip.push(item.work.name);
                        continue;
                    }

                    // 随机等待 8-13 秒模拟听歌
                    await new Promise(r => setTimeout(r, (Math.floor(Math.random() * 5) + 8) * 1000));

                    const score = Math.floor(Math.random() * 3) + 2; // 2-4分
                    const payload = {
                        taskId: taskRes.data.data.id,
                        workId: item.work.id,
                        score: score,
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
                detail.fail.push(`${acc.name} (异常: ${e.message})`);
            }
        }

        // 构建打卡报告内容
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

        // 写入日志文件 nep-年月日时分秒.log
        const now = new Date();
        const dateStr = now.getFullYear() + 
            (now.getMonth() + 1).toString().padStart(2, '0') + 
            now.getDate().toString().padStart(2, '0') + 
            now.getHours().toString().padStart(2, '0') + 
            now.getMinutes().toString().padStart(2, '0') + 
            now.getSeconds().toString().padStart(2, '0');
        
        fs.writeFileSync(path.join(logDir, `nep-${dateStr}.log`), report, 'utf8');

        return report;
    }

    // --- 机器人指令交互 ---
    async manualTest(e) {
        await e.reply("网易云合伙人手动测试开始...");
        const res = await this.executeTask("手动测试");
        await e.reply(res);
    }

    async partnerLogin(e) {
        const msg = e.msg.match(/^#合伙人登录\s*(\d{11})\s+(.+)$/);
        if (!msg) return e.reply("格式：#合伙人登录 手机号 密码");

        const [_, phone, password] = msg;
        let fullConfig = YAML.parse(fs.readFileSync(configPath, 'utf8'));
        if (!fullConfig.neteasePartner) fullConfig.neteasePartner = { accounts: [] };
        
        const accounts = fullConfig.neteasePartner.accounts;
        const idx = accounts.findIndex(a => a.phone === phone);
        if (idx > -1) {
            accounts[idx].password = password;
        } else {
            accounts.push({ name: `账号_${phone.slice(-4)}`, phone, password, extraCount: 9999, comment: true });
        }

        fs.writeFileSync(configPath, YAML.stringify(fullConfig), 'utf8');
        await e.reply("配置已保存。正在尝试首次登录验证...");
        
        const cookie = await this.getCookie({ phone, password });
        if (cookie) await e.reply("登录验证通过，Cookie已缓存。");
        else await e.reply("验证失败，请确认手机号密码或本地API服务状态。");
    }

    async getPartnerLog(e) {
        const files = fs.readdirSync(logDir).filter(f => f.startsWith('nep-')).sort().reverse();
        if (files.length === 0) return e.reply("暂无合伙人日志记录。");
        
        const latestLog = fs.readFileSync(path.join(logDir, files[0]), 'utf8');
        await e.reply(`最新日志 [${files[0]}]:\n\n${latestLog}`);
    }

    setupScheduler() {
        const config = this.getConfig();
        if (this.task) this.task.cancel();
        if (config.enable && config.schedule) {
            this.task = schedule.scheduleJob(config.schedule, async () => {
                const report = await this.executeTask("定时任务");
                // 向所有 Master 推送报告
                const masters = cfg.masterQQ || [];
                for (const m of masters) {
                    Bot.pickFriend(m).sendMsg(report).catch(() => {});
                }
            });
        }
    }
}