import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const _path = process.cwd();
const pluginRoot = path.join(_path, 'plugins', 'Lotus-Plugin');
const tempDataDir = path.join(pluginRoot, 'data', 'temp');

export class fileSender extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 本地文件上传',
            dsc: '通过指令发送服务器本地的文件或文件夹',
            event: 'message',
            priority: 200,
            rule: [
                {
                    reg: '^#上传(.*)$',
                    fnc: 'upload',
                    permission: 'master'
                }
            ]
        });

        this.init();
    }

    init() {
        if (!fs.existsSync(tempDataDir)) {
            fs.mkdirSync(tempDataDir, { recursive: true });
        }
    }

    async upload(e) {
        const inputPath = e.msg.replace(/^#上传/, '').trim();
        if (!inputPath) {
            return e.reply('请输入要上传的文件或文件夹的绝对路径。');
        }

        if (!path.isAbsolute(inputPath)) {
            return e.reply('路径无效，请输入绝对路径。\nWin示例: D:\\folder\\file.txt\nLinux示例: /home/user/file.js');
        }

        try {
            if (!fs.existsSync(inputPath)) {
                return e.reply(`路径不存在: ${inputPath}`);
            }

            const stats = fs.statSync(inputPath);

            if (stats.isFile()) {
                await this.handleFileUpload(e, inputPath);
            } else if (stats.isDirectory()) {
                await this.handleDirectoryUpload(e, inputPath);
            } else {
                return e.reply('路径指向的不是一个有效的文件或文件夹。');
            }

        } catch (error) {
            logger.error(`[荷花插件][文件上传] 处理失败:`, error);
            await e.reply(`处理失败: ${error.message}`);
        }
        return true;
    }

    async handleFileUpload(e, filePath) {
        const fileName = path.basename(filePath);
        await e.reply(`正在准备发送文件: ${fileName}`);
        try {
            await this.sendFile(e, filePath, fileName);
        } catch (err) {
            await e.reply(`发送文件失败，可能是文件过大或机器人权限不足。`);
        }
    }

    async handleDirectoryUpload(e, dirPath) {
        const dirName = path.basename(dirPath);
        const zipName = `${dirName}.zip`;
        const tempZipPath = path.join(tempDataDir, zipName);

        await e.reply(`检测到文件夹: ${dirName}\n正在打包为 ${zipName}，请稍候...`);

        try {
            const zip = new JSZip();
            this.addFolderToZip(zip, dirPath, '');
            
            const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
            fs.writeFileSync(tempZipPath, buffer);

            await e.reply('打包完成，正在发送...');
            await this.sendFile(e, tempZipPath, zipName);

        } catch (err) {
            logger.error(`[荷花插件][文件夹打包] 失败:`, err);
            await e.reply(`打包或发送文件夹失败: ${err.message}`);
        } finally {
            if (fs.existsSync(tempZipPath)) {
                try { fs.unlinkSync(tempZipPath); } catch {}
            }
        }
    }

    addFolderToZip(zip, rootDir, currentPath) {
        const fullPath = path.join(rootDir, currentPath);
        const files = fs.readdirSync(fullPath);

        for (const file of files) {
            const filePath = path.join(fullPath, file);
            const relativePath = path.join(currentPath, file);
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                zip.file(relativePath, fs.readFileSync(filePath));
            } else if (stats.isDirectory()) {
                this.addFolderToZip(zip, rootDir, relativePath);
            }
        }
    }

    async sendFile(e, filePath, fileName) {
        try {
            if (e.isGroup) {
                await e.group.sendFile(filePath, fileName);
            } else {
                await e.friend.sendFile(filePath, fileName);
            }
        } catch (err) {
            logger.error(`[荷花插件][文件发送] 失败:`, err);
            throw err;
        }
    }
}