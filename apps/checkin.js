import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { exec } from 'child_process';
import schedule from 'node-schedule';
import cfg from '../../../lib/config/config.js';

let getRefreshedCookieAndStoken;
try {
    const userModule = await import('../../xiaoyao-cvs-plugin/apps/user.js');
    getRefreshedCookieAndStoken = userModule.getRefreshedCookieAndStoken;
} catch (error) {
    logger.error('Lotus-Plugin无法加载依赖函数[getRefreshedCookieAndStoken]，请确保xiaoyao-cvs-plugin存在且已正确修改！');
    getRefreshedCookieAndStoken = null;
}

const _path = process.cwd();
const lotusPluginRoot = path.join(_path, 'plugins', 'Lotus-Plugin');
const bbsToolsPath = path.join(lotusPluginRoot, 'MihoyoBBSTools');
const bbsConfigPath = path.join(bbsToolsPath, 'config');
const templatePath = path.join(lotusPluginRoot, 'config', 'template.yaml');
const pluginConfigPath = path.join(lotusPluginRoot, 'config', 'config.yaml');
const dataDir = path.join(lotusPluginRoot, 'data');
const logFilePath = path.join(dataDir, 'lastRun.log');


export class lotusCheckin extends plugin {
    constructor() {
        super({
            name: '荷花自动签到',
            dsc: '集成MihoyoBBSTools，提供自动签到服务',
            event: 'message',
            priority: 500,
            rule: [
                { reg: '^#注册自动签到$', fnc: 'register', permission: 'default' },
                { reg: '^#刷新自动签到$', fnc: 'refresh', permission: 'default' },
                { reg: '^#自动签到帮助$', fnc: 'help', permission: 'default' },
                { reg: '^#初始化签到环境$', fnc: 'initialize', permission: 'master' },
                { reg: '^#(测试|开始)签到$', fnc: 'runCheckin', permission: 'master' }
            ]
        });

        if (global.lotusPluginLoaded) return;
        
        this.runStartupSequence();

        global.lotusPluginLoaded = true;
    }

    runStartupSequence() {
        const logBlock = ['--- 荷花插件 Lotus-Plugin ---'];
        
        const pluginConfig = YAML.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
        this.setupScheduler(pluginConfig);
        logBlock.push(`[任务] 定时签到已安排, 执行时间: ${pluginConfig.schedule}`);

        if (pluginConfig.autoCatchUp !== true) {
            logBlock.push('[补签] 功能已禁用 (可在config.yaml中开启)');
        } else {
            const today = new Date().toLocaleDateString('sv-SE');
            const lastRunDate = fs.existsSync(logFilePath) ? fs.readFileSync(logFilePath, 'utf8').trim() : null;

            if (lastRunDate === today) {
                logBlock.push('[补签] 今日任务已执行，无需补签。');
            } else {
                const scheduleParts = pluginConfig.schedule.split(' ');
                const scheduledHour = parseInt(scheduleParts[1], 10);
                const scheduledMinute = parseInt(scheduleParts[0], 10);
                
                const now = new Date();
                const scheduledTimeToday = new Date();
                scheduledTimeToday.setHours(scheduledHour, scheduledMinute, 0, 0);

                if (now > scheduledTimeToday) {
                    logBlock.push('[补签] 检测到错过任务，将在1分钟后执行。');

                    setTimeout(() => {
                        this.executeCheckinScript('补签任务');
                    }, 60 * 1000);
                } else {
                    logBlock.push('[补签] 今日任务尚未到执行时间。');
                }
            }
        }
        
        logBlock.push('-----------------------------');
        

        logger.info(`\n${logBlock.join('\n')}`);
    }


    setupScheduler(pluginConfig) {
        if (this.task) {
            this.task.cancel();
        }
        this.task = schedule.scheduleJob(pluginConfig.schedule, () => {
            logger.info('[荷花插件] 开始执行定时签到任务...');
            this.executeCheckinScript('定时任务');
        });
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
            return e.reply("获取Cookie和Stoken失败！\n请先扫码登录。");
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