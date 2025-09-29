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
const updateLogPath = path.join(dataDir, 'update.log');

export class lotusCheckin extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 自动签到',
            dsc: '集成MihoyoBBSTools，提供自动签到服务',
            event: 'message',
            priority: 0,
            rule: [
                { reg: '^#注册自动签到$', fnc: 'register', permission: 'default' },
                { reg: '^#刷新自动签到$', fnc: 'refresh', permission: 'default' },
                { reg: '^#自动签到帮助$', fnc: 'help', permission: 'default' },
                { reg: '^#初始化签到环境$', fnc: 'initialize', permission: 'master' },
                { reg: '^#(测试|开始)签到$', fnc: 'runCheckin', permission: 'master' },
                { reg: '^#批量刷新签到$', fnc: 'batchRefresh', permission: 'master' },
                { reg: '^#注册本群签到$', fnc: 'registerGroup', permission: 'master' },
                { reg: '^#自动签到日志$', fnc: 'getLatestLog', permission: 'master' },
                { reg: '^#启用社区签到$', fnc: 'enableCommunitySignIn', permission: 'master' },
                { reg: '^#自动签到(黑|白)名单$', fnc: 'switchPermissionMode', permission: 'master' },
                { reg: '^#(添加|删除)(黑|白)名单(.*)$', fnc: 'updatePermissionList', permission: 'master' },
                { reg: '^#签到(黑|白)名单列表$', fnc: 'viewPermissionLists', permission: 'master' },
                { reg: '^#签到名单列表$', fnc: 'viewGroupCheckinList', permission: 'default' },
                { reg: '^#荷花插件更新$', fnc: 'checkPluginUpdate', permission: 'master' }
            ]
        });

        if (global.lotusPluginLoaded) return;
        
        this.task = null;
        this.refreshTask = null;
        this.commandsAndEnv = null;
        this.pluginConfig = {};
        
        this.checkAndCreateConfig();
        this._loadPluginConfig();
        this.runStartupSequence();

        global.lotusPluginLoaded = true;
    }
    
    _loadPluginConfig() {
        try {
            const configContent = fs.readFileSync(pluginConfigPath, 'utf8');
            this.pluginConfig = YAML.parse(configContent);
        } catch (error) {
            logger.error('[荷花插件] 加载 config.yaml 失败:', error);
            this.pluginConfig = {};
        }
        if (!this.pluginConfig.permissionControl) {
            this.pluginConfig.permissionControl = { mode: 'blacklist', whitelist: [], blacklist: [] };
        }
    }

    _savePluginConfig() {
        try {
            fs.writeFileSync(pluginConfigPath, YAML.stringify(this.pluginConfig), 'utf8');
            return true;
        } catch (error) {
            logger.error('[荷花插件] 保存 config.yaml 失败:', error);
            return false;
        }
    }
    
    checkPermission(userId) {
        this._loadPluginConfig();
        const pc = this.pluginConfig.permissionControl;
        if (!pc || !pc.mode) return true;
        const userIdStr = String(userId);
        if (pc.mode === 'whitelist') {
            return (pc.whitelist || []).map(String).includes(userIdStr);
        } else {
            return !(pc.blacklist || []).map(String).includes(userIdStr);
        }
    }
    
    async switchPermissionMode(e) {
        this._loadPluginConfig();
        const mode = e.msg.includes('白') ? 'whitelist' : 'blacklist';
        this.pluginConfig.permissionControl.mode = mode;
        if (this._savePluginConfig()) {
            await e.reply(`[荷花插件] 签到模式已切换为: ${mode === 'whitelist' ? '白名单模式' : '黑名单模式'}`);
        } else {
            await e.reply('[荷花插件] 切换模式失败，请查看日志。');
        }
        return true;
    }

    async updatePermissionList(e) {
        this._loadPluginConfig();
        const action = e.msg.includes('添加') ? 'add' : 'remove';
        const listType = e.msg.includes('白') ? 'whitelist' : 'blacklist';
        const userId = (e.at || String(e.msg).match(/\d{5,12}/)?.[0] || '').trim();
        if (!userId) {
            return e.reply('[荷花插件] 未能识别到有效的QQ号。');
        }
        if (!this.pluginConfig.permissionControl[listType]) {
            this.pluginConfig.permissionControl[listType] = [];
        }
        const list = this.pluginConfig.permissionControl[listType].map(String);
        const userExists = list.includes(userId);
        let replyMsg = '';
        if (action === 'add') {
            if (userExists) {
                replyMsg = `用户 ${userId} 已存在于${listType === 'whitelist' ? '白' : '黑'}名单中。`;
            } else {
                this.pluginConfig.permissionControl[listType].push(Number(userId));
                replyMsg = `已将用户 ${userId} 添加到${listType === 'whitelist' ? '白' : '黑'}名单。`;
            }
        } else {
            if (!userExists) {
                replyMsg = `用户 ${userId} 不在${listType === 'whitelist' ? '白' : '黑'}名单中。`;
            } else {
                this.pluginConfig.permissionControl[listType] = this.pluginConfig.permissionControl[listType].filter(id => String(id) !== userId);
                replyMsg = `已从${listType === 'whitelist' ? '白' : '黑'}名单中删除用户 ${userId}。`;
            }
        }
        if (this._savePluginConfig()) {
            await e.reply(`[荷花插件] ${replyMsg}`);
        } else {
            await e.reply('[荷花插件] 更新名单失败，请查看日志。');
        }
        return true;
    }
    
    async viewPermissionLists(e) {
        this._loadPluginConfig();
        const listType = e.msg.includes('白') ? 'whitelist' : 'blacklist';
        const pc = this.pluginConfig.permissionControl;
        const list = pc[listType] || [];
        const listName = listType === 'whitelist' ? '白名单' : '黑名单';
        const listText = list.length > 0 ? list.join('\n') : '无';
        const replyMsg = `--- 签到${listName} ---\n${listText}`;
        await e.reply(replyMsg);
        return true;
    }
    
    async viewGroupCheckinList(e) {
        if (!e.isGroup) {
            return e.reply('此指令只能在群聊中使用。');
        }
        await e.reply('正在统计本群签到情况，请稍候...');
        try {
            const memberMap = await e.group.getMemberMap();
            if (!fs.existsSync(bbsConfigPath)) {
                fs.mkdirSync(bbsConfigPath, { recursive: true });
            }
            const registeredFiles = fs.readdirSync(bbsConfigPath).filter(f => f.endsWith('.yaml')).map(f => path.parse(f).name);
            const registeredSet = new Set(registeredFiles);
            let registeredCount = 0;
            const registeredMembers = [];
            for (const [userId, member] of memberMap) {
                if (registeredSet.has(String(userId))) {
                    registeredCount++;
                    registeredMembers.push(`- ${member.card || member.nickname} (${userId})`);
                }
            }
            const totalMembers = memberMap.size;
            let replyMsg = `--- 本群签到统计 ---\n已注册: ${registeredCount} / ${totalMembers}\n\n`;
            if (registeredCount > 0) {
                replyMsg += "已注册成员列表:\n" + registeredMembers.join('\n');
            } else {
                replyMsg += "暂无成员注册自动签到。";
            }
            await e.reply(replyMsg);
        } catch (error) {
            logger.error(`[荷花插件] 统计群签到列表失败:`, error);
            await e.reply('统计失败，无法获取群成员列表或读取配置文件。');
        }
        return true;
    }

    async enableCommunitySignIn (e) {
        await e.reply('[荷花插件] 开始启用社区BBS签到模式...');
        try {
            const captchaSrcPath = path.join(lotusPluginRoot, 'config', 'captcha.py');
            const captchaDestPath = path.join(bbsToolsPath, 'captcha.py');
            if (!fs.existsSync(captchaSrcPath)) {
                await e.reply('[荷花插件] 错误: 未在 config 目录下找到 captcha.py 文件。'); return true;
            }
            fs.copyFileSync(captchaSrcPath, captchaDestPath);
            const currentTemplatePath = path.join(lotusPluginRoot, 'config', 'template.yaml');
            const bbsTemplatePath = path.join(lotusPluginRoot, 'config', 'template-bbs.yaml');
            const backupTemplatePath = path.join(lotusPluginRoot, 'config', 'template-nonbbs.yaml');
            if (!fs.existsSync(bbsTemplatePath)) {
                await e.reply('[荷花插件] 错误: 未在 config 目录下找到 template-bbs.yaml 预设文件。'); return true;
            }
            if (fs.existsSync(currentTemplatePath)) {
                fs.renameSync(currentTemplatePath, backupTemplatePath);
            }
            fs.renameSync(bbsTemplatePath, currentTemplatePath);
            await e.reply('[荷花插件] 文件切换成功！\n • captcha.py 已覆盖\n • template.yaml 已切换为BBS模式');
        } catch (error) {
            logger.error('[荷花插件] 启用社区签到文件操作失败:', error);
            await e.reply('[荷花插件] 文件操作失败，请检查文件是否存在或权限是否正确。'); return true;
        }
        await e.reply('[荷花插件] 正在基于新模板批量刷新所有用户配置...');
        await this.batchRefresh(e);
        return true;
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
    
    runStartupCleanup(logBlock) {
        if (!fs.existsSync(bbsConfigPath)) {
            logBlock.push('[清理] 签到配置目录不存在，跳过权限清理。'); return;
        }
        const files = fs.readdirSync(bbsConfigPath);
        const userIds = files.filter(f => f.endsWith('.yaml')).map(f => path.parse(f).name).filter(name => /^\d+$/.test(name));
        let deletedCount = 0;
        for (const userId of userIds) {
            if (!this.checkPermission(userId)) {
                try {
                    fs.unlinkSync(path.join(bbsConfigPath, `${userId}.yaml`));
                    deletedCount++;
                } catch (error) {
                    logger.error(`[荷花插件] 删除用户[${userId}]的无效配置时出错:`, error);
                }
            }
        }
        logBlock.push(`[清理] 权限清理完成, 共删除 ${deletedCount} 个不符合规则的用户配置。`);
    }

    runStartupSequence() {
        const logBlock = ['--- 荷花插件 Lotus-Plugin ---'];
        try {
            this.setupScheduler();
            this.setupRefreshScheduler();
            this.cleanupOldLogs();
            this.runStartupCleanup(logBlock);
            this.checkXiaoyaoCvsSourceOnStart(logBlock);
            if (this.pluginConfig.autoCatchUp !== true) {
                logBlock.push('[补签] 功能已禁用 (可在config.yaml中开启)');
            } else {
                const today = new Date().toLocaleDateString('sv-SE');
                const lastRunDate = fs.existsSync(lastRunLogPath) ? fs.readFileSync(lastRunLogPath, 'utf8').trim() : null;
                if (lastRunDate === today) {
                    logBlock.push('[补签] 今日任务已执行，无需补签。');
                } else {
                    const scheduleParts = this.pluginConfig.schedule.split(' ');
                    const scheduledHour = parseInt(scheduleParts[2], 10);
                    const scheduledMinute = parseInt(scheduleParts[1], 10);
                    const now = new Date();
                    const scheduledTimeToday = new Date();
                    scheduledTimeToday.setHours(scheduledHour, scheduledMinute, 0, 0);
                    if (now > scheduledTimeToday) {
                        logBlock.push('[补签] 检测到错过任务，将在1分钟后执行。');
                        setTimeout(() => this.executeCheckinScript('补签任务'), 60 * 1000);
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

    setupScheduler() {
        if (this.task) this.task.cancel();
        const taskCallback = () => {
            logger.info('[荷花插件] 开始执行定时签到任务...');
            this.executeCheckinScript('定时任务');
        };
        this.task = schedule.scheduleJob(this.pluginConfig.schedule, taskCallback);
    }

    setupRefreshScheduler() {
        if (!this.pluginConfig.autoRefresh || !this.pluginConfig.autoRefresh.enabled) return;
        if (this.refreshTask) this.refreshTask.cancel();
        const taskCallback = () => {
            logger.info('[荷花插件] 开始执行定时批量刷新任务...');
            this.batchRefresh(null);
        };
        this.refreshTask = schedule.scheduleJob(this.pluginConfig.autoRefresh.schedule, taskCallback);
    }
    
    checkXiaoyaoCvsSourceOnStart(logBlock) {
        logBlock.push('[任务] 依赖插件源检查已执行。');
        const cvsPluginPath = path.join(_path, 'plugins', 'xiaoyao-cvs-plugin');
        const gitConfigPath = path.join(cvsPluginPath, '.git', 'config');
        if (!fs.existsSync(gitConfigPath)) return;
        try {
            const configContent = fs.readFileSync(gitConfigPath, 'utf8');
            const lines = configContent.split('\n');
            let url = '';
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('url =')) {
                    url = trimmedLine.substring(6).trim(); break;
                }
            }
            if (url && !url.includes('SummerLotus520')) {
                logger.warn('[荷花插件]检测到这个插件 (xiaoyao-cvs-plugin) 未换源！请执行换源操作');
            }
        } catch (error) {
            logger.warn(`[荷花插件] 检查 xiaoyao-cvs-plugin 源时发生错误: ${error.message}`);
        }
    }

    async checkPluginUpdate(e) {
        if (!e) return;
        await e.reply('正在检查插件更新，请稍候...');
    
        const runGitCommand = (command, args) => {
            return new Promise((resolve, reject) => {
                const fullCommand = `${command} ${args.join(' ')} > "${updateLogPath}" 2>&1`;
                const gitProcess = spawn(fullCommand, { cwd: lotusPluginRoot, shell: true });
                
                gitProcess.on('close', (code) => {
                    const output = fs.existsSync(updateLogPath) ? fs.readFileSync(updateLogPath, 'utf8') : '';
                    if (code === 0) {
                        resolve(output);
                    } else {
                        reject(new Error(output));
                    }
                });
                gitProcess.on('error', (err) => reject(err));
            });
        };
    
        try {
            await runGitCommand('git', ['remote', 'update']);
            const statusOutput = await runGitCommand('git', ['status', '-uno']);
            
            if (statusOutput.includes('Your branch is up to date')) {
                await e.reply('插件已是最新版本，无需更新。');
                return true;
            }
    
            if (statusOutput.includes('Your branch is behind')) {
                const pullOutput = await runGitCommand('git', ['pull']);
                const logOutput = await runGitCommand('git', ['log', '-1', '--pretty=%B']);
                const latestCommit = logOutput.trim();
                
                const updateMsg = `[荷花插件] 检测到更新！\n\n--- 更新日志 ---\n${latestCommit}\n\n请主人发送 #重启 指令以应用更新。`;
                await e.reply(updateMsg);
                
                this._loadPluginConfig();
                const masterQQs = cfg.masterQQ || [];
                for (const id of masterQQs) {
                    try {
                        await Bot.pickFriend(id).sendMsg(updateMsg);
                    } catch (err) {
                        logger.error(`[荷花插件] 推送更新通知给主人[${id}]失败: ${err}`);
                    }
                }
            } else {
                 await e.reply(`Git 状态未知。\n输出:\n${statusOutput}`);
            }
    
        } catch (gitError) {
            const errorMsg = `[荷花插件] Git 操作失败！\n可能是因为存在本地修改或合并冲突。\n请登录服务器手动解决后重启。\n\n错误信息:\n${gitError.message}`;
            logger.error(errorMsg);
            await e.reply(errorMsg);
        } finally {
            if (fs.existsSync(updateLogPath)) {
                try { fs.unlinkSync(updateLogPath); } catch {}
            }
        }
        return true;
    }

    cleanupOldLogs() {
        const days = this.pluginConfig.logRetentionDays || 7;
        if (days <= 0) return;
        try {
            const files = fs.readdirSync(logArchiveDir);
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            for (const file of files) {
                if (!file.endsWith('.log')) continue;
                try {
                    const dateStr = file.slice(0, -4).replace('_', 'T').replace(/-/g, ':').replace(':', '-').replace(':', '-');
                    const fileTimestamp = new Date(dateStr).getTime();
                    if (!isNaN(fileTimestamp) && fileTimestamp < cutoff) {
                        fs.unlinkSync(path.join(logArchiveDir, file));
                    }
                } catch (e) { continue; }
            }
        } catch (error) {
            logger.error(`[荷花插件] 清理旧日志时发生错误:`, error);
        }
    }
    
    async _getCommandsAndEnv() {
        if (this.commandsAndEnv) {
            return this.commandsAndEnv;
        }
        const osType = process.platform;
        let pythonCandidates, pipCandidates, env;
        if (osType === 'win32') {
            pythonCandidates = ['python', 'python3'];
            pipCandidates = ['pip', 'pip3'];
            env = process.env;
        } else {
            pythonCandidates = ['python3', 'python'];
            pipCandidates = ['pip3', 'pip'];
            env = { ...process.env };
            const standardPaths = ['/usr/local/bin', '/usr/bin', '/bin', '/opt/bin', '/usr/sbin', '/sbin', process.env.HOME ? path.join(process.env.HOME, '.local', 'bin') : null].filter(Boolean);
            env.PATH = [...new Set([...standardPaths, ...(env.PATH || '').split(':')])].join(':');
        }
        const findCommand = (commands) => {
            return new Promise(resolve => {
                let found = false;
                const tryNext = (index) => {
                    if (found || index >= commands.length) {
                        resolve(found ? commands[index-1] : null); return;
                    }
                    const cmd = commands[index];
                    const probe = spawn(cmd, ['--version'], { env, shell: osType === 'win32' });
                    probe.on('error', () => tryNext(index + 1));
                    probe.on('close', (code) => {
                        if (code === 0) found = true;
                        tryNext(index + 1);
                    });
                };
                tryNext(0);
            });
        };
        const pythonCmd = await findCommand(pythonCandidates);
        const pipCmd = await findCommand(pipCandidates);
        logger.info(`[荷花插件] 环境检查完成。Python: ${pythonCmd || '未找到'}, Pip: ${pipCmd || '未找到'}`);
        this.commandsAndEnv = { pythonCmd, pipCmd, env };
        return this.commandsAndEnv;
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
        const { pipCmd, env } = await this._getCommandsAndEnv();
        if (!pipCmd) {
            logger.error('[荷花插件] 初始化失败，系统中未找到 "pip" 或 "pip3" 命令。');
            return e.reply('初始化失败，未找到可用的 pip 命令，请检查Python环境或PATH配置。');
        }
        const pipArgs = ['install', '-r', 'requirements.txt'];
        if (process.platform !== 'win32') {
            pipArgs.push('--break-system-packages');
            logger.info('[荷花插件] 检测到非Windows环境，为pip自动添加 --break-system-packages 参数以兼容系统包管理策略。');
        }
        logger.info(`[荷花插件] 使用 "${pipCmd}" 开始初始化，参数: ${pipArgs.join(' ')}`);
        const pip = spawn(pipCmd, pipArgs, { cwd: bbsToolsPath, env });
        pip.stdout.on('data', (data) => logger.info(`[荷花插件][${pipCmd}]: ${data}`));
        pip.stderr.on('data', (data) => logger.error(`[荷花插件][${pipCmd}]: ${data}`));
        pip.on('error', (err) => {
            logger.error(`[荷花插件] 初始化进程启动失败: ${err.message}`);
            return e.reply(`初始化进程启动失败: ${err.message}`);
        });
        pip.on('close', (code) => {
            if (code === 0) {
                e.reply("依赖库安装成功！");
                logger.info('[荷花插件] 初始化成功。');
            } else {
                e.reply(`初始化失败，请查看控制台错误日志。`);
                logger.error(`[荷花插件] 初始化失败，${pipCmd}进程退出，代码: ${code}`);
            }
        });
        return true;
    }

    async register(e) {
        if (!this.checkPermission(e.user_id)) {
            return e.reply('[荷花插件] 抱歉，您没有权限注册自动签到。');
        }
        const userConfigFile = path.join(bbsConfigPath, `${e.user_id}.yaml`);
        if (fs.existsSync(userConfigFile)) {
            return e.reply("您已注册过，如需更新Cookie，请发送 #刷新自动签到");
        }
        await this.updateUserData(e);
    }

    async refresh(e) {
        if (!this.checkPermission(e.user_id)) {
            return e.reply('[荷花插件] 抱歉，您没有权限刷新自动签到。');
        }
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
            logger.warn(`[荷花插件] 核心依赖加载失败，无法为用户[${userId}]刷新。`); return false;
        }
        const data = await getRefreshedCookieAndStoken(userId);
        if (!data || !data.stoken) {
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
            logger.warn(`[荷花插件] ${msg}`); return;
        }
        const files = fs.readdirSync(bbsConfigPath);
        const userIds = files.filter(f => f.endsWith('.yaml')).map(f => path.parse(f).name).filter(name => /^\d+$/.test(name));
        if (userIds.length === 0) {
            const msg = "未找到任何用户配置文件。";
            if (e) return e.reply(msg);
            logger.info(`[荷花插件] ${msg}`); return;
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
            this._loadPluginConfig();
            const masterQQs = cfg.masterQQ || [];
            masterQQs.forEach(id => {
                Bot.pickFriend(id).sendMsg(reportMessage).catch(err => {
                    logger.error(`[荷花插件] 推送自动刷新报告给主人[${id}]失败: ${err}`);
                });
            });
        }
        return true;
    }
    
    async registerGroup(e) {
        if (!e.isGroup) {
            await e.reply('[荷花插件] 此指令只能在群聊中使用。'); return true;
        }
        const memberMap = await e.group.getMemberMap();
        const memberIds = Array.from(memberMap.keys()).filter(id => id != e.self_id);
        const totalMembersToProcess = memberIds.length;
        if (totalMembersToProcess === 0) {
            await e.reply('[荷花插件] 群里除了我没有其他人了...'); return true;
        }
        await e.reply(`[荷花插件] 开始为本群 ${totalMembersToProcess} 位成员批量注册/刷新签到...\n请耐心等待，这可能需要一些时间。`);
        logger.info(`[荷花插件] 开始为群[${e.group_id}]的 ${totalMembersToProcess} 位成员批量注册/刷新签到...`);
        let successCount = 0;
        let failureCount = 0;
        for (const userId of memberIds) {
            if (!this.checkPermission(userId)) continue;
            const success = await this._updateSingleUser(userId);
            if (success) successCount++;
            else failureCount++;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        const summary = `[荷花插件] 本群签到批量处理完成！\n总人数: ${totalMembersToProcess}\n符合权限人数: ${successCount + failureCount}\n成功: ${successCount}\n失败: ${failureCount}`;
        await e.reply(summary);
        logger.info(`[荷花插件] 群[${e.group_id}]签到批量处理完成！总: ${totalMembersToProcess}, 成功: ${successCount}, 失败: ${failureCount}`);
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

    async executeCheckinScript(triggerSource, e = null) {
        this.recordRun();
        if (!fs.existsSync(bbsToolsPath)) {
            const errorMsg = `[荷花插件] 执行失败: 未找到 MihoyoBBSTools 文件夹。`;
            logger.error(errorMsg);
            if (cfg.masterQQ && cfg.masterQQ[0]) {
                Bot.pickFriend(cfg.masterQQ[0]).sendMsg(errorMsg).catch(() => {});
            }
            return;
        }
        const { pythonCmd, env } = await this._getCommandsAndEnv();
        if (!pythonCmd) {
            const errorMsg = `[荷花插件] 执行失败: 未找到 "python" 或 "python3" 命令。`;
            logger.error(errorMsg);
            const pushTargets = (e && e.user_id) ? [e.user_id] : (cfg.masterQQ || []);
            pushTargets.forEach(targetId => Bot.pickFriend(targetId).sendMsg(errorMsg).catch(() => {}));
            return;
        }
        const tempLogfile = path.join(bbsToolsPath, `temp_run_${Date.now()}.log`);
        const command = `${pythonCmd} -u main_multi.py autorun > "${tempLogfile}" 2>&1`;
        const py = spawn(command, { cwd: bbsToolsPath, shell: true, env });
        py.on('error', (err) => {
            logger.error(`[荷花插件] 签到进程启动失败: ${err.message}`);
            const pushTargets = (e && e.user_id) ? [e.user_id] : (cfg.masterQQ || []);
            pushTargets.forEach(targetId => Bot.pickFriend(targetId).sendMsg(`[荷花插件] 签到进程启动失败，可能为 Shell 错误。`).catch(() => {}));
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
                this._loadPluginConfig();
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