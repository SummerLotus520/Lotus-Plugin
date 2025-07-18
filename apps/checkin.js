import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { exec } from 'child_process';
import schedule from 'node-schedule';
import cfg from '../../../../../lib/config/config.js';

// 动态导入 xiaoyao-cvs-plugin 的函数
let getRefreshedCookieAndStoken;
try {
    const userModule = await import('../../../xiaoyao-cvs-plugin/apps/user.js');
    getRefreshedCookieAndStoken = userModule.getRefreshedCookieAndStoken;
} catch (error) {
    logger.error('Lotus-Plugin无法加载依赖函数[getRefreshedCookieAndStoken]，请确保xiaoyao-cvs-plugin存在且已正确修改！');
    getRefreshedCookieAndStoken = null; // 标记为不可用
}

// =========================================================================
// 【核心修改】 重新定义所有路径，以适应新的自包含结构
// =========================================================================
const _path = process.cwd();
const lotusPluginRoot = path.join(_path, 'plugins', 'Lotus-Plugin'); // 插件根目录

const bbsToolsPath = path.join(lotusPluginRoot, 'MihoyoBBSTools'); // 依赖工具的路径
const bbsConfigPath = path.join(bbsToolsPath, 'config'); // 依赖工具的配置路径
const templatePath = path.join(lotusPluginRoot, 'config', 'template.yaml'); // 插件自己的模板路径
const pluginConfigPath = path.join(lotusPluginRoot, 'config', 'config.yaml'); // 插件自己的配置路径
const dataDir = path.join(lotusPluginRoot, 'data'); // 插件自己的数据路径
const logFilePath = path.join(dataDir, 'lastRun.log'); // 运行日志的路径
// =========================================================================


export class lotusCheckin extends plugin {
    constructor() {
        super({
            name: '荷花自动签到',
            dsc: '集成MihoyoBBSTools，提供自动签到服务',
            event: 'message',
            priority: 500,
            rule: [
                {
                    reg: '^#注册自动签到$',
                    fnc: 'register',
                    permission: 'default'
                },
                {
                    reg: '^#刷新自动签到$',
                    fnc: 'refresh',
                    permission: 'default'
                },
                {
                    reg: '^#自动签到帮助$',
                    fnc: 'help',
                    permission: 'default'
                },
                {
                    reg: '^#初始化签到环境$',
                    fnc: 'initialize',
                    permission: 'master'
                },
                {
                    reg: '^#(测试|开始)签到$',
                    fnc: 'runCheckin',
                    permission: 'master'
                }
            ]
        });

        this.task = null;
        this.setupScheduler();

        setTimeout(() => {
            this.checkMissedRun();
        }, 30 * 1000);
    }

    async help(e) {
        await e.reply("【自动签到帮助】\n#注册自动签到 : 使用你的stoken和ck创建签到配置。\n#刷新自动签到 : 当ck或stoken失效时，刷新配置。\n\n---主人指令---\n#初始化签到环境 : 安装python依赖。\n#测试签到 : 手动执行一次签到任务。");
        return true;
    }

    async initialize(e) {
        await e.reply("正在开始初始化Python环境，将安装依赖库，请稍候...");
        if (!fs.existsSync(bbsToolsPath)) {
            return e.reply("错误：未找到 MihoyoBBSTools 文件夹，请确保它已放置在Lotus-Plugin插件目录下。");
        }

        exec('pip install -r requirements.txt', { cwd: bbsToolsPath }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`[荷花插件] 初始化失败: ${error.message}`);
                logger.error(`[荷花插件] Stderr: ${stderr}`);
                e.reply(`初始化失败，请查看控制台错误日志。\n错误信息: ${error.message}`);
                return;
            }
            logger.info(`[荷花插件] 初始化成功: ${stdout}`);
            e.reply("依赖库安装成功，您现在可以为用户注册签到服务了！");
        });
        return true;
    }

    async register(e) {
        const userConfigFile = path.join(bbsConfigPath, `${e.user_id}.yaml`);

        if (fs.existsSync(userConfigFile)) {
            return e.reply("您已注册过，如需更新Cookie，请发送 #刷新自动签到");
        }
        
        await e.reply("正在为您注册自动签到服务，请稍候...");
        await this.updateUserData(e);
    }

    async refresh(e) {
        await e.reply("正在为您刷新签到配置，请稍候...");
        await this.updateUserData(e);
    }

    async updateUserData(e) {
        if (!getRefreshedCookieAndStoken) {
            return e.reply("错误：核心依赖[xiaoyao-cvs-plugin]加载失败，无法执行操作，请联系机器人管理员。");
        }
        
        const data = await getRefreshedCookieAndStoken(e.user_id);
        
        if (!data) {
            return e.reply("获取Cookie和Stoken失败！\n请先在[逍遥CVS插件]中绑定有效的stoken，例如发送 stoken=... 指令。");
        }

        try {
            if (!fs.existsSync(bbsConfigPath)) {
                fs.mkdirSync(bbsConfigPath, { recursive: true });
            }

            const template = YAML.parse(fs.readFileSync(templatePath, 'utf8'));
            template.account.cookie = data.cookie;
            template.account.stuid = data.stuid;
            template.account.stoken = data.stoken;
            template.account.mid = data.mid;
            
            const userConfigFile = path.join(bbsConfigPath, `${e.user_id}.yaml`);
            const isRefresh = fs.existsSync(userConfigFile);

            fs.writeFileSync(userConfigFile, YAML.stringify(template), 'utf8');
            
            await e.reply(`用户[${e.user_id}]的签到配置已${isRefresh ? '刷新' : '创建'}成功！\n将会在每天凌晨自动为您签到。`);

        } catch (error) {
            logger.error(`[荷花插件] 写入用户[${e.user_id}]配置失败:`, error);
            await e.reply("处理您的签到配置时发生内部错误，请联系管理员查看日志。");
        }
    }

    setupScheduler() {
        if (this.task) {
            this.task.cancel();
        }
        const pluginConfig = YAML.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
        this.task = schedule.scheduleJob(pluginConfig.schedule, () => {
            logger.info('[荷花插件] 开始执行定时签到任务...');
            this.executeCheckinScript('定时任务');
        });
        logger.info(`[荷花插件] 自动签到任务已安排，执行时间: ${pluginConfig.schedule}`);
    }

    async checkMissedRun() {
        logger.info('[荷花插件] 检查是否有错过的每日签到任务...');

        const today = new Date().toLocaleDateString('sv-SE');
        let lastRunDate = '';
        try {
            if (fs.existsSync(logFilePath)) {
                lastRunDate = fs.readFileSync(logFilePath, 'utf8').trim();
            }
        } catch (error) {
            logger.error('[荷花插件] 读取 lastRun.log 文件失败:', error);
        }
        
        logger.info(`[荷花插件] 今天日期: ${today}, 上次运行日期: ${lastRunDate || '无记录'}`);

        if (lastRunDate === today) {
            logger.info('[荷花插件] 今日任务已执行，无需补签。');
            return;
        }

        const pluginConfig = YAML.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
        const scheduleParts = pluginConfig.schedule.split(' ');
        
        const scheduledMinute = parseInt(scheduleParts[0], 10);
        const scheduledHour = parseInt(scheduleParts[1], 10);

        if (isNaN(scheduledHour) || isNaN(scheduledMinute)) {
            logger.error('[荷花插件] 无法解析配置文件中的时间，跳过补签检查。');
            return;
        }

        const now = new Date();
        const scheduledTimeToday = new Date();
        scheduledTimeToday.setHours(scheduledHour, scheduledMinute, 0, 0);

        if (now > scheduledTimeToday) {
            logger.warn(`[荷花插件] 检测到今日任务未执行，且已错过计划时间(${scheduledHour}:${String(scheduledMinute).padStart(2, '0')})。`);
            logger.warn('[荷花插件] 将在1分钟后为您执行补签任务...');
            setTimeout(() => {
                this.executeCheckinScript('补签任务');
            }, 60 * 1000);
        } else {
            logger.info('[荷花插件] 今日任务尚未到执行时间，无需补签。');
        }
    }

    recordRun() {
        try {
            const today = new Date().toLocaleDateString('sv-SE');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(logFilePath, today, 'utf8');
            logger.info(`[荷花插件] 已记录今日运行状态: ${today}`);
        } catch (error) {
            logger.error('[荷花插件] 写入 lastRun.log 文件失败:', error);
        }
    }

    async runCheckin(e) {
        await e.reply("开始手动执行一次签到任务，结果将输出至控制台...");
        this.executeCheckinScript(`主人[${e.user_id}]手动触发`);
    }

    executeCheckinScript(triggerSource) {
        this.recordRun();

        if (!fs.existsSync(bbsToolsPath)) {
            logger.error(`[荷花插件] 执行失败: 未找到 MihoyoBBSTools 文件夹。`);
            if (cfg.masterQQ && cfg.masterQQ[0]) {
                Bot.pickFriend(cfg.masterQQ[0]).sendMsg(`[荷花插件] 执行失败: 未找到 MihoyoBBSTools 文件夹。`);
            }
            return;
        }

        exec(`python main_multi.py autorun`, { cwd: bbsToolsPath }, (error, stdout, stderr) => {
            const logPrefix = `[荷花插件][${triggerSource}]`;
            if (error) {
                logger.error(`${logPrefix} 签到任务执行失败: ${error.message}`);
                logger.error(`${logPrefix} Stderr: ${stderr}`);
                if (cfg.masterQQ && cfg.masterQQ[0]) {
                    Bot.pickFriend(cfg.masterQQ[0]).sendMsg(`${logPrefix} 签到任务执行失败，详情请查看日志。`);
                }
                return;
            }
            logger.info(`${logPrefix} 签到任务输出:\n${stdout}`);
            logger.info(`${logPrefix} 签到任务执行完毕。`);
             if (cfg.masterQQ && cfg.masterQQ[0] && triggerSource.includes('手动')) {
                Bot.pickFriend(cfg.masterQQ[0]).sendMsg(`${logPrefix} 签到任务执行完毕，详情请查看日志。`);
            }
        });
    }
}