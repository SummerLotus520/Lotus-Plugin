import plugin from '../../../lib/plugins/plugin.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { GeetestSolver } from '../model/GeetestSolver.js';
import MysApi from '../model/MysApi.js';

const lotusPluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');

export class autoVerify extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 自动过码服务',
            dsc: '拦截需要验证的米游社请求并自动处理',
            event: 'message',
            priority: 100,
        });

        this.handler = [
          {
            dsc: '米游社请求错误拦截',
            key: 'mys.req.err',
            fn: 'mysReqErrHandler'
          }
        ];

        this.rule = [
            {
                reg: '^#注册过码环境$',
                fnc: 'installEnv',
                permission: 'master'
            }
        ];

        this.solver = null;
        this.pythonCmd = null;
        this.isInstalling = false;
    }

    async init() {
        if (!fs.existsSync(path.join(lotusPluginRoot, 'node_modules', 'playwright'))) {
            logger.warn('[荷花插件] 检测到依赖未完全安装，请主人发送 #注册过码环境 进行初始化。');
        }
    }

    async installEnv(e) {
        if (this.isInstalling) {
            return e.reply('[荷花插件] 正在安装中，请勿重复执行...');
        }
        this.isInstalling = true;
        await e.reply('[荷花插件] 开始注册过码环境，过程可能需要几分钟，请耐心等待...');

        try {
            const pythonCmd = await this.getPythonCommand();
            if (!pythonCmd) {
                throw new Error('未找到Python环境，请先安装Python并配置好环境变量。');
            }

            await e.reply('[荷花插件] 步骤 1/2: 正在安装Python依赖 (ddddocr)...');
            await new Promise((resolve, reject) => {
                const pip = spawn(pythonCmd, ['-m', 'pip', 'install', '-U', 'ddddocr']);
                pip.stderr.on('data', (data) => logger.error(`[荷花插件][pip install]: ${data.toString()}`));
                pip.on('error', reject);
                pip.on('close', code => code === 0 ? resolve() : reject(new Error(`Pip进程退出，代码: ${code}`)));
            });
            await e.reply('[荷花插件] Python依赖安装成功！');

            await e.reply('[荷花插件] 步骤 2/2: 正在安装浏览器核心 (Playwright & Chromium)...');
            const playwrightCli = path.join(lotusPluginRoot, 'node_modules', 'playwright', 'lib', 'cli', 'cli.js');
            if (!fs.existsSync(playwrightCli)) {
                 throw new Error("Playwright CLI 未找到，请先在Lotus-Plugin目录下执行 npm install");
            }
            await new Promise((resolve, reject) => {
                const playwright = spawn('node', [playwrightCli, 'install', 'chromium'], { shell: false });
                playwright.stderr.on('data', (data) => logger.error(`[荷花插件][Playwright]: ${data.toString()}`));
                playwright.on('error', reject);
                playwright.on('close', code => code === 0 ? resolve() : reject(new Error(`Playwright进程退出，代码: ${code}`)));
            });
            await e.reply('[荷花插件] 过码环境全部注册成功！本插件将自动工作。');

        } catch (error) {
            logger.error(`[荷花插件] 环境注册失败:`, error);
            await e.reply(`[荷花插件] 环境注册失败: ${error.message}`);
        } finally {
            this.isInstalling = false;
        }
        return true;
    }
    
    async mysReqErrHandler(e, options, reject) {
        const { mysApi, type, data } = options;
        const retcode = options.res?.retcode;

        if (retcode !== 1034) {
            return reject();
        }

        if (e.isVerifying) {
            logger.warn(`[荷花插件][自动过码] [uid:${mysApi.uid}] 检测到重复验证请求，已终止。`);
            return reject();
        }
        e.isVerifying = true;

        logger.info(`[荷花插件][自动过码] 拦截到[uid:${mysApi.uid}]的验证请求 (retcode: 1034)，开始自动处理...`);
        await e.reply('[荷花插件] 检测到需要安全验证，正在尝试自动处理...', true);

        if (!this.solver) {
             const pythonCmd = await this.getPythonCommand();
             if (!pythonCmd) {
                await e.reply('[荷花插件] 自动验证失败：Python环境未就绪，请联系管理员。');
                delete e.isVerifying;
                return reject();
             }
             this.solver = new GeetestSolver({ pythonCmd });
        }
        
        const create = await mysApi.getData('createVerification');
        if (create?.retcode !== 0) {
            await e.reply(`[荷花插件] 自动验证失败：无法获取验证码凭证(${create?.message})`);
            delete e.isVerifying;
            return reject();
        }

        const { gt, challenge } = create.data;
        const result = await this.solver.solve(gt, challenge, mysApi.uid);
        
        if (!result.success) {
            await e.reply(`[荷花插件] 自动验证失败: ${result.message}\n请联系管理员。`);
            delete e.isVerifying;
            return reject();
        }

        await e.reply('[荷花插件] 验证成功！正在重新提交请求...', true);
        
        const finalRes = await mysApi.getData(type, { ...data, headers: { 'x-rpc-validate': result.validate.geetest_validate, 'x-rpc-challenge': result.validate.geetest_challenge, 'x-rpc-seccode': `${result.validate.geetest_validate}|jordan` } });
        
        delete e.isVerifying;
        
        if (finalRes.retcode !== 0) {
            logger.error(`[荷花插件][自动过码] [uid:${mysApi.uid}] 使用 validate 重新请求失败: ${finalRes.message}`);
            await e.reply(`[荷花插件] 自动验证已通过，但后续请求失败: ${finalRes.message}`);
            return reject();
        }
        
        logger.mark(`[荷花插件][自动过码] [uid:${mysApi.uid}] 验证流程成功，请求已放行。`);
        return finalRes;
    }
    
    async getPythonCommand() {
        if (this.pythonCmd) return this.pythonCmd;
        const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
        for (const cmd of candidates) {
            try {
                await new Promise((resolve, reject) => {
                    const probe = spawn(cmd, ['--version']);
                    probe.on('error', reject);
                    probe.on('close', code => code === 0 ? resolve(cmd) : reject());
                });
                this.pythonCmd = cmd;
                return cmd;
            } catch (error) { continue; }
        }
        return null;
    }
}