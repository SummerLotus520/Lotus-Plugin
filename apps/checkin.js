import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { spawn } from 'child_process';
import schedule from 'node-schedule';
import cfg from '../../../lib/config/config.js';
import iconv from 'iconv-lite';

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
            name: '[荷花插件] 自动签到',
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
            this.cleanupOldLogs(pluginConfig, logBlock);

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

    cleanupOldLogs(pluginConfig, logBlock) {
        const days = pluginConfig.logRetentionDays || 7;
        if (days <= 0) {
            logBlock.push('[清理] 自动清理日志功能已禁用。');
            return;
        }

        try {
            const files = fs.readdirSync(logArchiveDir);
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            let deletedCount = 0;

            for (const file of files) {
                if (!file.endsWith('.log')) continue;
                
                try {
                    const dateStr = file.slice(0, -4).replace('_', 'T').replace(/-/g, ':').replace(':', '-').replace(':', '-');
                    const fileTimestamp = new Date(dateStr).getTime();
                    if (!isNaN(fileTimestamp) && fileTimestamp < cutoff) {
                        fs.unlinkSync(path.join(logArchiveDir, file));
                        deletedCount++;
                    }
                } catch (e) {
                    continue;
                }
            }
            logBlock.push(`[清理] 日志清理完成，共删除 ${deletedCount} 个超过 ${days} 天的旧日志。`);
        } catch (error) {
            logBlock.push(`[清理] 清理旧日志时发生错误: ${error.message}`);
            logger.error(`[荷花插件] 清理旧日志时发生错误:`, error);
        }
    }
    
    getLocalTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    }

    async help(e) {
        await e.reply("点击查看帮助：https://lotusshared.cn/2025/07/23/lotuspluginhelp/");
        return true;
    }

    async initialize(e) {
        await e.reply("正在开始初始化Python环境，将安装依赖库，请稍候...");
        if (!fs.existsSync(bbsToolsPath)) {
            return e.reply("错误：未找到 MihoyoBBSTools 文件夹，请确保它已放置在Lotus-Plugin插件目录下。");
        }
        
        const pip = spawn('pip', ['install', '-r', 'requirements.txt'], { cwd: bbsToolsPath });

        pip.stdout.on('data', (data) => logger.info(`[荷花插件][pip]: ${data}`));
        pip.stderr.on('data', (data) => logger.error(`[荷花插件][pip]: ${data}`));
        
        pip.on('error', (err) => {
            logger.error(`[荷花插件] 初始化进程启动失败: ${err.message}`);
            return e.reply(`初始化进程启动失败，请检查 "pip" 命令是否可用。`);
        });

        pip.on('close', (code) => {
            if (code === 0) {
                e.reply("依赖库安装成功！");
                logger.info('[荷花插件] 初始化成功。');
            } else {
                e.reply(`初始化失败，请查看控制台错误日志。`);
                logger.error(`[荷花插件] 初始化失败，pip进程退出，代码: ${code}`);
            }
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
            await e.reply(`用户[${e.user_id}]的签到配置已${isRefresh ? '刷新' : '创建'}成功！`);
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
        await e.reply("开始手动执行签到任务，完成后结果将私聊发送给您。由于用户量大，任务可能需要很长时间，请耐心等待。");
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
            await e.reply(`正在发送最近的签到日志文件: ${latestLogFile}`);
            if (e.isGroup) {
                await e.group.sendFile(logPath);
            } else {
                await e.friend.sendFile(logPath);
            }
        } catch (error) {
            logger.error(`[荷花插件] 发送日志文件失败: ${error}`);
            await e.reply("发送日志文件失败，请检查机器人文件上传权限或查看控制台日志。");
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
        
        const tempLogfile = path.join(bbsToolsPath, `temp_run_${Date.now()}.log`);
        const command = `python -u main_multi.py autorun > "${tempLogfile}" 2>&1`;

        const py = spawn(command, { cwd: bbsToolsPath, shell: true });
        
        py.on('error', (err) => {
            logger.error(`[荷花插件] 签到进程启动失败: ${err.message}`);
            const pushTargets = (e && e.user_id) ? [e.user_id] : (cfg.masterQQ || []);
            pushTargets.forEach(targetId => Bot.pickFriend(targetId).sendMsg(`[荷花插件] 签到进程启动失败，请检查 "python" 命令是否可用。`).catch(() => {}));
        });

        py.on('close', (code) => {
            let stdout = '';
            if (fs.existsSync(tempLogfile)) {
                const buffer = fs.readFileSync(tempLogfile);
                const encoding = process.platform === 'win32' ? 'gbk' : 'utf8';
                stdout = iconv.decode(buffer, encoding);
                fs.unlinkSync(tempLogfile);
            }

            const logPrefix = `[荷花插件][${triggerSource}]`;
            const fullLog = (code !== 0) ? `${logPrefix}\n${stdout}\nProcess exited with code: ${code}` : `${logPrefix}\n${stdout}`;

            const logFileName = `${this.getLocalTimestamp()}.log`;
            const logFilePath = path.join(logArchiveDir, logFileName);
            fs.writeFileSync(logFilePath, fullLog, 'utf8');

            let pushTargets = [];
            if (e && e.user_id) {
                pushTargets.push(e.user_id);
            } else {
                pushTargets = cfg.masterQQ || [];
            }
            
            if (code !== 0) {
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