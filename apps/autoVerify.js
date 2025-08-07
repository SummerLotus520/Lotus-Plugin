import plugin from '../../../lib/plugins/plugin.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { PythonShell } from 'python-shell';

const botRoot = path.resolve(process.cwd());
const lotusPluginRoot = path.join(botRoot, 'plugins', 'Lotus-Plugin');

export class autoVerify extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 自动过码服务',
            dsc: '拦截需要验证的米游社请求并自动处理 (geetest-crack)',
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

        this.pythonCmd = null;
        this.isInstalling = false;
    }
    
    async installEnv(e) {
        if (this.isInstalling) {
            return e.reply('[荷花插件] 正在安装中，请勿重复执行...');
        }
        this.isInstalling = true;
        await e.reply('[荷花插件] 开始注册过码环境，将安装Python依赖，请稍候...');

        const tempDir = path.join(lotusPluginRoot, 'data', 'temp');
        const tempRequirementsPath = path.join(tempDir, 'requirements_modified.txt');

        try {
            const pythonCmd = await this.getPythonCommand();
            if (!pythonCmd) {
                throw new Error('未找到Python环境，请先安装Python并配置好环境变量。');
            }

            const requirementsPath = path.join(lotusPluginRoot, 'geetest-crack', 'requirements.txt');
            if (!fs.existsSync(requirementsPath)) {
                throw new Error("未找到 geetest-crack/requirements.txt，请确认已正确添加submodule。");
            }

            await e.reply('[荷花插件] 步骤 1/2: 正在准备定制化依赖文件...');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const originalContent = fs.readFileSync(requirementsPath, 'utf8');
            const modifiedContent = originalContent
                .replace(/Pillow==[\d.]+/, 'Pillow>=10.3.0')
                .replace(/PyExecJS==[\d.]+/, '');
            
            fs.writeFileSync(tempRequirementsPath, modifiedContent, 'utf8');
            logger.info(`[荷花插件] 已动态生成依赖文件，Pillow 版本已调整。`);
            
            await e.reply('[荷花插件] 步骤 2/2: 正在安装 geetest-crack 所需的Python库...');
            await new Promise((resolve, reject) => {
                const pip = spawn(pythonCmd, ['-m', 'pip', 'install', '-r', tempRequirementsPath]);
                pip.stdout.on('data', (data) => logger.info(`[荷花插件][pip install]: ${data.toString()}`));
                pip.stderr.on('data', (data) => logger.error(`[荷花插件][pip install]: ${data.toString()}`));
                pip.on('error', reject);
                pip.on('close', code => code === 0 ? resolve() : reject(new Error(`Pip进程退出，代码: ${code}`)));
            });
            await e.reply('[荷花插件] 过码环境依赖全部安装成功！本插件将自动工作。');

        } catch (error) {
            logger.error(`[荷花插件] 环境注册失败:`, error);
            await e.reply(`[荷花插件] 环境注册失败: ${error.message}`);
        } finally {
            if (fs.existsSync(tempRequirementsPath)) {
                fs.unlinkSync(tempRequirementsPath);
                logger.info(`[荷花插件] 已清理临时依赖文件。`);
            }
            this.isInstalling = false;
        }
        return true;
    }
    
    async mysReqErrHandler(e, options, reject) {
        const { mysApi, type, data, res } = options;

        if (res?.retcode !== 1034) {
            return reject();
        }

        if (e.isVerifying) {
            logger.warn(`[荷花插件][自动过码] [uid:${mysApi.uid}] 检测到重复验证请求，已终止。`);
            return reject();
        }
        e.isVerifying = true;

        logger.info(`[荷花插件][自动过码] [uid:${mysApi.uid}] 拦截到验证请求 (retcode: 1034)，开始使用 geetest-crack 处理...`);
        await e.reply('[荷花插件] 检测到需要安全验证，正在尝试自动处理...', true);

        const pythonCmd = await this.getPythonCommand();
        if (!pythonCmd) {
           await e.reply('[荷花插件] 自动验证失败：Python环境未就绪，请联系管理员。');
           delete e.isVerifying;
           return reject();
        }
        
        try {
            const geetestCrackPackagePath = path.join(lotusPluginRoot, 'geetest-crack', 'geetest_crack');
            
            const shellOptions = {
                mode: 'text',
                pythonPath: pythonCmd,
                pythonOptions: ['-u'],
                scriptPath: path.join(lotusPluginRoot, 'model'),
                args: [mysApi.uid, mysApi.cookie],
                cwd: geetestCrackPackagePath 
            };
            
            const results = await PythonShell.run('MysGeetestSession.py', shellOptions);
            const validate = JSON.parse(results[0]);

            await e.reply('[荷花插件] 验证成功！正在重新提交请求...', true);
            
            const finalRes = await mysApi.getData(type, { ...data, headers: { 'x-rpc-validate': validate.geetest_validate, 'x-rpc-challenge': validate.geetest_challenge, 'x-rpc-seccode': validate.geetest_seccode } });
            
            delete e.isVerifying;
            
            if (finalRes.retcode !== 0) {
                logger.error(`[荷花插件][自动过码] [uid:${mysApi.uid}] 使用 validate 重新请求失败: ${finalRes.message}`);
                await e.reply(`[荷花插件] 自动验证已通过，但后续请求失败: ${finalRes.message}`);
                return reject();
            }
            
            logger.mark(`[荷花插件][自动过码] [uid:${mysApi.uid}] 验证流程成功，请求已放行。`);
            return finalRes;

        } catch (error) {
            logger.error(`[荷花插件][自动过码] [uid:${mysApi.uid}] geetest-crack 破解失败:`, error);
            await e.reply(`[荷花插件] 自动验证失败: 破解脚本执行出错，请检查日志。\n${error.message}`);
            delete e.isVerifying;
            return reject();
        }
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