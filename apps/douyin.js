import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'child_process';
import ConfigLoader from '../model/config_loader.js';
import axios from 'axios';

// --- 路径和常量 ---
const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const dataDir = path.join(pluginRoot, 'data', 'douyin');

const DY_API_URL = "https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id={}&pc_client_type=1&version_code=190500&version_name=19.5.0&cookie_enabled=true&msToken={}";
const COMMON_HEADER = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://www.douyin.com/',
};

// ########## a-bogus 签名算法 (直接整合) ##########
// 为了代码简洁，实际的算法函数体已内置，此处仅为标记
function generate_a_bogus(url_search_params, user_agent) {
    // 完整的 a-bogus 算法实现
    function rc4_encrypt(plaintext, key) {
        let s = [], j = 0, cipher = [];
        for (var i = 0; i < 256; i++) s[i] = i;
        for (i = 0; i < 256; i++) {
            j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
            [s[i], s[j]] = [s[j], s[i]];
        }
        i = j = 0;
        for (let k = 0; k < plaintext.length; k++) {
            i = (i + 1) % 256;
            j = (j + s[i]) % 256;
            [s[i], s[j]] = [s[j], s[i]];
            let t = (s[i] + s[j]) % 256;
            cipher.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)));
        }
        return cipher.join('');
    }
    function le(e, r) { return ((e << (r %= 32)) | (e >>> (32 - r))) >>> 0 }
    function de(e) { return 0 <= e && e < 16 ? 2043430169 : 2055708042 }
    function pe(e, r, t, n) { return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : ((r & t) | (r & n) | (t & n)) >>> 0 }
    function he(e, r, t, n) { return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : ((r & t) | (~r & n)) >>> 0 }
    class SM3 {
        constructor() { this.reg = []; this.chunk = []; this.size = 0; this.reset(); }
        reset() { this.reg = [1937774191, 1226093241, 388252375, 3666478592, 2842636476, 372324522, 3817729613, 2969243214]; this.chunk = []; this.size = 0; }
        write(e) {
            const aBytes = typeof e === 'string' ? new TextEncoder().encode(e) : e;
            const a = Array.from(aBytes);
            this.size += a.length;
            let f = 64 - this.chunk.length;
            this.chunk = this.chunk.concat(a.slice(0, f));
            while (this.chunk.length >= 64) {
                this._compress(this.chunk.slice(0, 64));
                this.chunk = this.chunk.slice(64);
                if (a.length > f) {
                    this.chunk = this.chunk.concat(a.slice(f, Math.min(f + 64, a.length)));
                }
                f += 64;
            }
        }
        sum(e) {
            if(e) { this.reset(); this.write(e); }
            this._fill();
            for (let f = 0; f < this.chunk.length; f += 64) this._compress(this.chunk.slice(f, f + 64));
            const i = new Array(32);
            for (let f = 0; f < 8; f++) {
                let c = this.reg[f];
                i[4 * f + 3] = (255 & c) >>> 0; c >>>= 8;
                i[4 * f + 2] = (255 & c) >>> 0; c >>>= 8;
                i[4 * f + 1] = (255 & c) >>> 0; c >>>= 8;
                i[4 * f] = (255 & c) >>> 0;
            }
            this.reset();
            return i;
        }
        _compress(t) {
            const f = (e => {
                const r = new Array(132);
                for (let t = 0; t < 16; t++) r[t] = e[4 * t] << 24 | e[4 * t + 1] << 16 | e[4 * t + 2] << 8 | e[4 * t + 3], r[t] >>>= 0;
                for (let n = 16; n < 68; n++) { let a = r[n - 16] ^ r[n - 9] ^ le(r[n - 3], 15); a = a ^ le(a, 15) ^ le(a, 23); r[n] = (a ^ le(r[n - 13], 7) ^ r[n - 6]) >>> 0; }
                for (let n = 0; n < 64; n++) r[n + 68] = (r[n] ^ r[n + 4]) >>> 0;
                return r;
            })(t);
            const i = this.reg.slice(0);
            for (let c = 0; c < 64; c++) {
                let o = le(i[0], 12) + i[4] + le(de(c), c); o = (4294967295 & o) >>> 0; o = le(o, 7);
                const s = (o ^ le(i[0], 12)) >>> 0;
                let u = pe(c, i[0], i[1], i[2]); u = (4294967295 & (u + i[3] + s + f[c + 68])) >>> 0;
                let b = he(c, i[4], i[5], i[6]); b = (4294967295 & (b + i[7] + o + f[c])) >>> 0;
                i[3] = i[2]; i[2] = le(i[1], 9); i[1] = i[0]; i[0] = u;
                i[7] = i[6]; i[6] = le(i[5], 19); i[5] = i[4]; i[4] = (b ^ le(b, 9) ^ le(b, 17)) >>> 0;
            }
            for (let l = 0; l < 8; l++) this.reg[l] = (this.reg[l] ^ i[l]) >>> 0;
        }
        _fill() {
            const a = 8 * this.size;
            this.chunk.push(128);
            while (this.chunk.length % 64 !== 56) this.chunk.push(0);
            for (let i = 0; i < 4; i++) this.chunk.push((Math.floor(a / 4294967296) >>> (8 * (3 - i))) & 255);
            for (let i = 0; i < 4; i++) this.chunk.push((a >>> (8 * (3 - i))) & 255);
        }
    }
    function result_encrypt(long_str, num = null) {
        const s_obj = { s3: 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe', s4: 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe' };
        const constant = { '0': 16515072, '1': 258048, '2': 4032, str: s_obj[num] };
        let result = '', lound = 0;
        const get_long_int = (round, str) => (str.charCodeAt(round * 3) << 16) | (str.charCodeAt(round * 3 + 1) << 8) | str.charCodeAt(round * 3 + 2);
        if (long_str.length < 3) return "";
        let long_int = get_long_int(lound, long_str);
        for (let i = 0; i < (long_str.length / 3) * 4; i++) {
            if (Math.floor(i / 4) !== lound) { lound += 1; long_int = get_long_int(lound, long_str); }
            const key = i % 4;
            let temp_int = 0;
            if (key === 0) temp_int = (long_int & constant[0]) >> 18;
            else if (key === 1) temp_int = (long_int & constant[1]) >> 12;
            else if (key === 2) temp_int = (long_int & constant[2]) >> 6;
            else temp_int = long_int & 63;
            result += constant.str.charAt(temp_int);
        }
        return result;
    }
    const gener_random = (random, option) => [(random & 255 & 170) | (option[0] & 85), (random & 255 & 85) | (option[0] & 170), ((random >> 8) & 255 & 170) | (option[1] & 85), ((random >> 8) & 255 & 85) | (option[1] & 170)];
    const sm3 = new SM3();
    const start_time = Date.now();
    const url_search_params_list = sm3.sum(sm3.sum(url_search_params + 'cus'));
    const cus = sm3.sum(sm3.sum('cus'));
    const ua = sm3.sum(result_encrypt(rc4_encrypt(user_agent, String.fromCharCode.apply(null, [1, 14])), 's3'));
    const end_time = Date.now();
    const b = {};
    b[10] = end_time; b[16] = start_time;
    [b[20], b[21], b[22], b[23]] = [(b[16] >> 24) & 255, (b[16] >> 16) & 255, (b[16] >> 8) & 255, b[16] & 255];
    const args = [0, 1, 14];
    [b[26], b[27], b[28], b[29]] = [(args[0] >> 24) & 255, (args[0] >> 16) & 255, (args[0] >> 8) & 255, args[0] & 255];
    [b[30], b[31]] = [Math.floor(args[1] / 256) & 255, args[1] % 256 & 255];
    [b[34], b[35], b[36], b[37]] = [(args[2] >> 24) & 255, (args[2] >> 16) & 255, (args[2] >> 8) & 255, args[2] & 255];
    [b[38], b[39]] = [url_search_params_list[21], url_search_params_list[22]];
    [b[40], b[41]] = [cus[21], cus[22]];
    [b[42], b[43]] = [ua[23], ua[24]];
    [b[44], b[45], b[46], b[47]] = [(b[10] >> 24) & 255, (b[10] >> 16) & 255, (b[10] >> 8) & 255, b[10] & 255];
    const window_env_str = '1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32';
    const window_env_list = Array.from(window_env_str).map(c => c.charCodeAt(0));
    const checksum_fields = [44, b[20], 6241 & 255, b[26], b[30], b[34], 6383 & 255, b[38], b[40], (6241 >> 16) & 255, b[42], b[21], b[27], (6241 >> 8) & 255, 6241 & 255, b[31], b[35], 6383 & 255, b[39], b[41], b[43], b[22], b[28], b[32], (6383 >> 24) & 255, b[36], b[23], b[29], b[33], b[37], b[44], b[45], (6383 >> 16) & 255, b[46], b[47], 3, (b[10] / 4294967296) >>> 0, Math.floor(b[10] / 1099511627776) >>> 0, b[24], b[25], 6241 >>> 24 & 255, (6241 >> 16) & 255, (6241 >> 8) & 255, 6241 & 255, 6383 & 255, (6383 >> 8) & 255, (6383 >> 16) & 255, (6383 >> 24) & 255, window_env_list.length & 255, (window_env_list.length >> 8) & 255, 0 & 255, (0 >> 8) & 255];
    const checksum = checksum_fields.reduce((a, b) => a ^ b, 0);
    const bb = checksum_fields.concat(window_env_list).concat(checksum);
    const random_str = [].concat(gener_random(Math.random() * 10000, [3, 45]), gener_random(Math.random() * 10000, [1, 0]), gener_random(Math.random() * 10000, [1, 5])).map(c => String.fromCharCode(c)).join('');
    const result_str = random_str + rc4_encrypt(String.fromCharCode.apply(null, bb), String.fromCharCode.apply(null, [121]));
    return result_encrypt(result_str, 's4') + '=';
}

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
        const cfg = ConfigLoader.cfg;
        if (!cfg.douyin.cookie) {
            return e.reply("抖音解析失败：请主人在parser.yaml中配置Cookie。");
        }

        try {
            const { longUrl, msToken } = await this.normalizeUrl(e.msg.trim());
            const videoIdMatch = longUrl.match(/video\/(\d+)/);
            if (!videoIdMatch) throw new Error("无法从链接中获取抖音视频ID");
            const videoId = videoIdMatch[1];
            
            let apiUrl = DY_API_URL.replace('{}', videoId).replace('{}', msToken || ""); // 传入msToken
            const params = new URL(apiUrl).search.substring(1);
            const bogus = generate_a_bogus(params, COMMON_HEADER['User-Agent']);
            const finalUrl = `${apiUrl}&a_bogus=${bogus}`;
            
            const headers = { ...COMMON_HEADER, Cookie: cfg.douyin.cookie };
            const resp = await axios.get(finalUrl, { headers });
            
            if (resp.data.status_code !== 0) throw new Error(resp.data.status_msg || "请求抖音API失败");
            
            const videoData = resp.data.aweme_detail;
            const title = videoData.desc || '无标题';
            
            await e.reply(`${cfg.general.identifyPrefix} 抖音: ${title}\n作者: ${videoData.author.nickname}`);

            if (videoData.aweme_type === 68 || (videoData.images && videoData.images.length > 0)) { // 图集
                const images = videoData.images.map(img => ({
                    message: segment.image(img.url_list[0]),
                    nickname: e.sender.card || e.user_id,
                    user_id: e.user_id
                }));
                if (images.length > 0) await e.reply(await Bot.makeForwardMsg(images));
            } else { // 视频
                const videoUrl = videoData.video.play_addr.url_list[0];
                const tempFile = path.join(dataDir, `douyin_${videoId}.mp4`);
                await this.downloadFile(tempFile, videoUrl, headers);
                await this.sendVideo(e, tempFile, `douyin_${videoId}.mp4`);
            }

        } catch (error) {
            logger.error(`[荷花插件][抖音] 失败:`, error);
            await e.reply(`抖音解析失败: ${error.message}`);
        }
        return true;
    }

    async normalizeUrl(input) {
        const match = input.match(/https?:\/\/[^\s]+/);
        if (!match) throw new Error("无法识别的链接格式");
        let url = match[0];

        if (url.includes("v.douyin.com")) {
            try {
                // 关键：请求短链以获取长链和msToken
                const resp = await axios.get(url, { 
                    headers: COMMON_HEADER,
                    // 不自动跳转，以便我们捕获302重定向
                    maxRedirects: 0,
                    validateStatus: status => status === 302 || status === 200
                });
                const longUrl = resp.headers.location || url;
                const setCookie = resp.headers['set-cookie'] || [];
                const msTokenMatch = setCookie.join(';').match(/msToken=([^;]+)/);
                const msToken = msTokenMatch ? msTokenMatch[1] : null;
                
                logger.info(`[荷花插件][抖音] 短链跳转成功, 长链: ${longUrl}, msToken: ${msToken}`);
                return { longUrl, msToken };
            } catch (err) {
                if (err.response?.headers?.location) {
                    const longUrl = err.response.headers.location;
                    const setCookie = err.response.headers['set-cookie'] || [];
                    const msTokenMatch = setCookie.join(';').match(/msToken=([^;]+)/);
                    const msToken = msTokenMatch ? msTokenMatch[1] : null;
                    return { longUrl, msToken };
                }
                return { longUrl: url, msToken: null };
            }
        }
        // 如果是长链接，我们没有好的办法获取msToken，只能依赖Cookie
        return { longUrl: url, msToken: null };
    }

    downloadFile(dest, url, headers) {
        return new Promise((resolve, reject) => {
            axios.get(url, { headers, responseType: 'stream' }).then(res => {
                const fileStream = fs.createWriteStream(dest);
                res.data.pipe(fileStream);
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