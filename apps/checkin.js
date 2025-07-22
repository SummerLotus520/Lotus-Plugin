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
const logArchiveDir = path.join(dataDir, 'logs');
const lastRunLogPath = path.join(dataDir, 'lastRun.log');

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
                { reg: '^#(测试|开始)签到$', fnc: 'runCheckin', permission: 'master' },
                { reg: '^#批量刷新签到$', fnc: 'batchRefresh', permission: 'master' },
                { reg: '^#自动签到日志$', fnc: 'getLatestLog', permission: 'master' }
            ]
        });

        if (global.lotusPluginLoaded) return;
        
        this.task = null;
        this.refreshTask = null;
        
        this.checkAndCreateConfig();
        this.runStartupSequence();

        global.lotusPluginLoaded = true;
    }

    checkAndCreateConfig() {
        const exampleConfigPath = path.join(lotusPluginRoot, 'config', 'config.yaml.example');
        if (!fs.existsSync(pluginConfigPath) && fs.existsSync(exampleConfigPath)) {
            logger.warn('[荷花插件] 检测到 config.yaml 不存在，将从模板创建...');
            const templateContent = fs.readFileSync(exampleConfigPath, 'utf8');
            fs.writeFileSync(pluginConfigPath, templateContent, 'utf8');
        }
        if (!fs.existsSync(logArchiveDir)) {
            fs.mkdirSync(logArchiveDir, { recursive: true });
        }
    }

    runStartupSequence() {
        const logBlock = ['--- 荷花插件 Lotus-Plugin ---'];
        
        try {
            const pluginConfig = YAML.parse(fs.readFileSync(pluginConfigPath, 'utf8'));
            
            this.setupScheduler(pluginConfig, logBlock);
            this.setupRefreshScheduler(pluginConfig, logBlock);

            if (pluginConfig.autoCatchUp !== true) {
                logBlock.push('[补签] 功能已禁用 (可在config.yaml中开启)');
            } else {
                const today = new Date().toLocaleDateString('sv-SE');
                const lastRunDate = fs.existsSync(lastRunLogPath) ? fs.readFileSync(lastRunLogPath, 'utf8').trim() : null;

                if (lastRunDate === today) {
                    logBlock.push('[补签] 今日任务已执行，无需补签。');
                } else {
                    const scheduleParts = pluginConfig.schedule.split(' ');
                    const scheduledHour = parseInt(scheduleParts[2], 10);
                    const scheduledMinute = parseInt(scheduleParts[1], 10);
                    
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
        } catch (error) {
            logBlock.push(`[错误] 插件启动失败: ${error.message}`);
        }
        
        logBlock.push('-----------------------------');
        logger.info(`\n${logBlock.join('\n')}`);
    }

    setupScheduler(pluginConfig, logBlock) {
        if (this.task) this.task.cancel();
        
        this.task = schedule.scheduleJob(pluginConfig.schedule, () => {
            logger.info('[荷花插件] 开始执行定时签到任务...');
            this.executeCheckinScript('定时任务');
        });
        logBlock.push(`[任务] 定时签到已安排, 执行时间: ${pluginConfig.schedule}`);
    }

    setupRefreshScheduler(pluginConfig, logBlock) {
        if (!pluginConfig.autoRefresh || !pluginConfig.autoRefresh.enabled) {
            logBlock.push('[任务] 定时批量刷新已禁用 (可在config.yaml中开启)');
            return;
        }
        
        if (this.refreshTask) this.refreshTask.cancel();

        this.refreshTask = schedule.scheduleJob(pluginConfig.autoRefresh.schedule, () => {
            logger.info('[荷花插件] 开始执行定时批量刷新任务...');
            this.batchRefresh(null);
        });
        logBlock.push(`[任务] 定时批量刷新已安排, 执行时间: ${pluginConfig.autoRefresh.schedule}`);
    }

    async help(e) {
        await e.reply("【自动签到帮助】\n#注册自动签到 : 创建签到配置。\n#刷新自动签到 : 更新签到配置。\n\n---主人指令---\n#初始化签到环境 : 安装Python依赖。\n#测试签到 : 手动执行一次签到，并将结果私聊发给你。\n#批量刷新签到 : 为所有用户刷新CK。\n#自动签到日志 : 获取最近一次的完整签到日志。");
        return true;
    }

    async initialize(e) {
        await e.reply("正在开始初始化Python环境，将安装依赖库，请稍候...");
        if (!fs.existsSync(bbsToolsPath)) {
            return e.reply("错误：未找到 MihoyoBBSTools 文件夹，请确保同步了子模块。");
        }

        exec('pip install -r requirements.txt', { cwd: bbsToolsPath }, (error, stdout, stderr) => {
            if (error) {
                logger.error(`[荷花插件] 初始化失败: ${error.message}`);
                logger.error(`[荷花插件] Stderr: ${stderr}`);
                return e.reply(`初始化失败，请查看控制台错误日志。\n错误信息: ${error.message}`);
            }
            logger.info(`[荷花插件] 初始化成功: ${stdout}`);
            e.reply("依赖库安装成功！");
        });
        return true;
    }

    async register(e) {
        const userConfigFile = path.join(bbsConfigPath, `${e.user_id}.yaml`);
        if (fs.existsSync(userConfigFile)) {
            return e.reply("您已注册过，如需更新Cookie，请发送 #刷新自动签到");
        }
        await this.updateUserData(e);
    }

    async refresh(e) {
        await this.updateUserData(e);
    }
    
    async updateUserData(e) {
        const userConfigFile = path.join(bbsConfigPath, `${e.user_id}.yaml`);
        const isRefresh = fs.existsSync(userConfigFile);

        await e.reply(`正在为您${isRefresh ? '刷新' : '创建'}签到配置，请稍候...`);

        const success = await this._updateSingleUser(e.user_id);

        if (success) {
            await e.reply(`您的签到配置已${isRefresh ? '刷新' : '创建'}成功！`);
        } else {
            await e.reply(`操作失败！\n请先发送 #扫码登录 绑定CK，或联系管理员查看日志。`);
        }
    }

    async _updateSingleUser(userId) {
        if (!getRefreshedCookieAndStoken) {
            logger.warn(`[荷花插件] 核心依赖加载失败，无法为用户[${userId}]刷新。`);
            return false;
        }

        const data = await getRefreshedCookieAndStoken(userId);
        if (!data) {
            logger.warn(`[荷花插件] 为用户[${userId}]获取CK/Stoken失败。`);
            return false;
        }

        try {
            if (!fs.existsSync(bbsConfigPath)) fs.mkdirSync(bbsConfigPath, { recursive: true });

            const template = YAML.parse(fs.readFileSync(templatePath, 'utf8'));
            template.account.cookie = data.cookie;
            template.account.stuid = data.stuid;
            template.account.stoken = data.stoken;
            template.account.mid = data.mid;
            
            const userConfigFile = path.join(bbsConfigPath, `${userId}.yaml`);
            fs.writeFileSync(userConfigFile, YAML.stringify(template), 'utf8');
            logger.info(`[荷花插件] 已成功更新用户[${userId}]的签到配置。`);
            return true;
        } catch (error) {
            logger.error(`[荷花插件] 写入用户[${userId}]配置失败:`, error);
            return false;
        }
    }
    
    async batchRefresh(e = null) {
        logger.info('[荷花插件] 开始执行批量刷新任务...');
        if (e) await e.reply("开始执行批量刷新任务...");

        if (!fs.existsSync(bbsConfigPath)) {
            const msg = "签到配置目录不存在。";
            if (e) return e.reply(msg);
            logger.warn(`[荷花插件] ${msg}`);
            return;
        }

        const files = fs.readdirSync(bbsConfigPath);
        const userIds = files.filter(f => f.endsWith('.yaml')).map(f => path.parse(f).name).filter(name => /^\d+$/.test(name));

        if (userIds.length === 0) {
            const msg = "未找到任何用户配置文件。";
            if (e) return e.reply(msg);
            logger.info(`[荷花插件] ${msg}`);
            return;
        }

        if (e) await e.reply(`检测到 ${userIds.length} 个用户，开始刷新，请耐心等待...`);
        else logger.info(`[荷花插件] 检测到 ${userIds.length} 个用户，开始自动刷新...`);

        let successCount = 0;
        let failureCount = 0;
        const failedUsers = [];

        for (const userId of userIds) {
            if (await this._updateSingleUser(userId)) successCount++;
            else {
                failureCount++;
                failedUsers.push(userId);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        let summary = `总任务: ${userIds.length}\n成功: ${successCount}\n失败: ${failureCount}`;
        if (failureCount > 0) summary += `\n\n失败的用户ID:\n${failedUsers.join('\n')}`;

        if (e) {
            await e.reply(`--- 批量刷新报告 ---\n${summary}`);
        } else {
            const reportMessage = `--- 荷花自动批量刷新报告 ---\n${summary}`;
            logger.info(`[荷花插件] 自动批量刷新完成。\n${reportMessage}`);
            const masterQQs = cfg.masterQQ || [];
            masterQQs.forEach(id => {
                Bot.pickFriend(id).sendMsg(reportMessage).catch(err => {
                    logger.error(`[荷花插件] 推送自动刷新报告给主人[${id}]失败: ${err}`);
                });
            });
        }
        return true;
    }

    recordRun() {
        try {
            const today = new Date().toLocaleDateString('sv-SE');
            fs.writeFileSync(lastRunLogPath, today, 'utf8');
            logger.info(`[荷花插件] 已记录今日运行状态: ${today}`);
        } catch (error) {
            logger.error('[荷花插件] 写入 lastRun.log 文件失败:', error);
        }
    }

    async runCheckin(e) {
        await e.reply("开始手动执行签到任务，完成后结果将私聊发送给您。");
        this.executeCheckinScript(`主人[${e.user_id}]手动触发`, e);
    }
    
    async getLatestLog(e) {
        if (!fs.existsSync(logArchiveDir)) {
            return e.reply("日志目录不存在，似乎从未执行过签到任务。");
        }
        
        const files = fs.readdirSync(logArchiveDir);
        if (files.length === 0) {
            return e.reply("日志目录为空。");
        }
        
        files.sort((a, b) => b.localeCompare(a));
        const latestLogFile = files[0];
        const logPath = path.join(logArchiveDir, latestLogFile);
        
        try {
            const logContent = fs.readFileSync(logPath, 'utf8');
            const forwardMsg = await Bot.makeForwardMsg([{
                user_id: Bot.uin,
                nickname: '签到日志',
                message: logContent || '日志文件为空'
            }]);
            await e.reply(forwardMsg);
        } catch (error) {
            logger.error(`[荷花插件] 读取或转发日志失败: ${error}`);
            await e.reply("读取最新日志文件失败，请查看控制台。");
        }
        return true;
    }

    executeCheckinScript(triggerSource, e = null) {
        this.recordRun();

        if (!fs.existsSync(bbsToolsPath)) {
            const errorMsg = `[荷花插件] 执行失败: 未找到 MihoyoBBSTools 文件夹。`;
            logger.error(errorMsg);
            if (cfg.masterQQ && cfg.masterQQ[0]) {
                Bot.pickFriend(cfg.masterQQ[0]).sendMsg(errorMsg).catch(() => {});
            }
            return;
        }

        exec(`python main_multi.py autorun`, { cwd: bbsToolsPath, timeout: 300000 }, (error, stdout, stderr) => {
            const logPrefix = `[荷花插件][${triggerSource}]`;
            const fullLog = error ? `${logPrefix}\n${stdout}\n${stderr}\nError: ${error.message}` : `${logPrefix}\n${stdout}`;

            const logFileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
            const logFilePath = path.join(logArchiveDir, logFileName);
            fs.writeFileSync(logFilePath, fullLog, 'utf8');

            let pushTargets = [];
            if (e && e.user_id) {
                pushTargets.push(e.user_id);
            } else {
                pushTargets = cfg.masterQQ || [];
            }

            if (error) {
                logger.error(`${logPrefix} 签到任务执行失败，详情已存入日志: ${logFileName}`);
                const errorMessage = `${logPrefix} 签到任务执行失败，请发送 #自动签到日志 查看详情。`;
                pushTargets.forEach(targetId => Bot.pickFriend(targetId).sendMsg(errorMessage).catch(err => logger.error(`通知[${targetId}]失败`, err)));
                return;
            }
            
            logger.info(`${logPrefix} 签到任务执行完毕，详情已存入日志: ${logFileName}`);

            if (pushTargets.length === 0) return;

            const summaryMarker = "脚本执行完毕";
            const markerIndex = stdout.indexOf(summaryMarker);
            const summary = markerIndex !== -1 ? stdout.substring(markerIndex) : "未能截取到签到摘要，请使用 #自动签到日志 查看完整报告。";
            
            const resultMessage = `--- 荷花自动签到报告 ---\n触发方式: ${triggerSource}\n\n${summary}`;
            
            pushTargets.forEach(targetId => {
                Bot.pickFriend(targetId).sendMsg(resultMessage).catch(err => {
                    logger.error(`${logPrefix} 推送结果给[${targetId}]失败: ${err}`);
                });
            });
        });
    }
}