import plugin from '../../../lib/plugins/plugin.js';
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'csv-stringify/sync';

const _path = process.cwd();
const lotusPluginRoot = path.join(_path, 'plugins', 'Lotus-Plugin');
const dataDir = path.join(lotusPluginRoot, 'data', 'Groups');
const bbsConfigPath = path.join(lotusPluginRoot, 'MihoyoBBSTools', 'config');

export class groupManager extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 群组管理',
            dsc: '获取群成员列表，并处理退群事件',
            event: 'message', // 恢复为 message 以响应指令
            priority: 240,
            rule: [
                { reg: '^#(Lotus)?群成员 ?(\\d*)$', fnc: 'sendGroupMembersFile', permission: 'master' }
            ]
        });
        
        this.init();
    }
    
    async init() {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        logger.info('[荷花插件] 群组管理器已加载。');
    }
    
    async sendGroupMembersFile(e) {
        let groupId = e.msg.match(/\d+/)?.[0];

        if (!groupId) {
            if (e.isGroup) {
                groupId = String(e.group_id);
                await e.reply(`未指定群号，将默认使用当前群: ${groupId}`);
            } else {
                return e.reply('[荷花插件] 请输入群号，或在群聊中使用此指令以获取当前群成员列表。');
            }
        }
        
        await e.reply(`[荷花插件] 正在准备群 ${groupId} 的成员列表文件...`);
        if (await this.generateGroupMembersFile(groupId)) {
            const fileName = `${groupId}.csv`;
            const filePath = path.join(dataDir, fileName);
            await e.reply('【重要提示】请使用 VSCode、Notepad++ 或其他专业文本编辑器打开CSV文件，直接用Excel打开可能会因编码问题导致乱码！');
            await this.sendFile(e, filePath, fileName);
        } else {
            await e.reply(`[荷花插件] 生成群 ${groupId} 的成员列表失败，机器人可能不在该群或获取信息时出错。`);
        }
        return true;
    }

    async generateGroupMembersFile(groupId) {
        const group = Bot.pickGroup(Number(groupId));
        if (!group?.group_id) {
            logger.warn(`[荷花插件] 尝试生成一个不存在或机器人未加入的群 ${groupId} 的成员列表。`);
            return false;
        }

        try {
            const memberMap = await group.getMemberMap();
            const data = [['QQ号', '昵称/群名片', '性别', '头衔', '是否管理员', '是否群主']];
            for (const [id, member] of memberMap) {
                data.push([
                    String(member.user_id),
                    member.card || member.nickname,
                    member.sex === 'male' ? '男' : member.sex === 'female' ? '女' : '未知',
                    member.title || '无',
                    member.is_admin ? '是' : '否',
                    member.is_owner ? '是' : '否'
                ]);
            }
            
            const csvString = stringify(data);
            const fileName = `${groupId}.csv`;
            const filePath = path.join(dataDir, fileName);
            fs.writeFileSync(filePath, csvString, { encoding: 'utf-8' });
            return true;
        } catch (error) {
            logger.error(`[荷花插件] 生成群 ${groupId} 成员CSV时失败:`, error);
            return false;
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
            logger.error(`[荷花插件] 发送文件 ${fileName} 失败:`, err);
            await e.reply(`[荷花插件] 发送文件失败，机器人可能没有上传文件的权限。`);
        }
    }

    async notice_group_decrease(e) {
        const botId = String(Bot.uin);
        const leavingUserId = String(e.user_id);
        const operatorId = String(e.operator_id);
        const groupId = e.group_id;

        if (leavingUserId === botId) {
            if (e.sub_type === 'kick_me') {
                logger.info(`[荷花插件] 检测到被管理员 [${operatorId}] 踢出群: ${groupId}。`);
                await this.handleBotLeaveGroup(groupId);
            } else {
                logger.info(`[荷花插件] 检测到主动退出群: ${groupId}。`);
                await this.handleBotLeaveGroup(groupId);
            }
        } else {
            if (e.sub_type === 'leave') {
                 logger.info(`[荷花插件] 检测到群员 [${leavingUserId}] 主动退出群: ${groupId}。`);
                 await this.handleMemberLeave(leavingUserId);
            } else if (e.sub_type === 'kick') {
                 logger.info(`[荷花插件] 检测到群员 [${leavingUserId}] 被管理员 [${operatorId}] 踢出群: ${groupId}。`);
                 await this.handleMemberLeave(leavingUserId);
            }
        }
    }
    
    async handleBotLeaveGroup(groupId) {
        if (!fs.existsSync(bbsConfigPath)) {
            logger.warn(`[荷花插件] 签到配置目录不存在，无需为退群 ${groupId} 执行清理。`);
            return;
        }

        let groupMembersSnapshot = new Set();
        const groupCache = Bot.gml.get(groupId);
        if (groupCache) {
             groupMembersSnapshot = new Set(Array.from(groupCache.keys()).map(String));
        } else {
             logger.warn(`[荷花插件] 无法获取已退出群 ${groupId} 的成员缓存，清理的准确性可能下降。`);
             return;
        }
        
        const allUserConfigs = fs.readdirSync(bbsConfigPath).filter(f => f.endsWith('.yaml')).map(f => path.parse(f).name);
        
        let membersInOtherGroups = await this.getAllMembersInRemainingGroups();

        let deletedCount = 0;
        for (const userId of allUserConfigs) {
            if (groupMembersSnapshot.has(userId) && !membersInOtherGroups.has(userId)) {
                this.deleteUserConfig(userId, `退群 ${groupId} 清理`);
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            logger.info(`[荷花插件] 机器人退群 ${groupId} 的清理任务完成，共删除 ${deletedCount} 个用户的配置。`);
        } else {
            logger.info(`[荷花插件] 机器人退群 ${groupId} 无需清理任何独立用户的配置。`);
        }
    }

    async handleMemberLeave(userId) {
        const userConfigPath = path.join(bbsConfigPath, `${userId}.yaml`);
        if (!fs.existsSync(userConfigPath)) {
            return;
        }

        let membersInOtherGroups = await this.getAllMembersInRemainingGroups();

        if (!membersInOtherGroups.has(String(userId))) {
            this.deleteUserConfig(userId, '群员退群清理');
        }
    }
    
    async getAllMembersInRemainingGroups() {
        let members = new Set();
        const allGroups = Array.from(Bot.gl.values());

        for (const group of allGroups) {
            try {
                const memberMap = await group.getMemberMap();
                for (const memberId of memberMap.keys()) {
                    members.add(String(memberId));
                }
            } catch (err) {
                 logger.warn(`[荷花插件] (构建豁免名单时) 获取群 ${group.group_id} 成员列表失败，跳过。`)
            }
        }
        return members;
    }

    deleteUserConfig(userId, reason = '未知原因') {
        try {
            const userConfigPath = path.join(bbsConfigPath, `${userId}.yaml`);
            if (fs.existsSync(userConfigPath)) {
                fs.unlinkSync(userConfigPath);
                logger.info(`[荷花插件] [${reason}] 已删除用户 ${userId} 的签到配置。`);
            }
        } catch (error) {
            logger.error(`[荷花插件] [${reason}] 删除用户 ${userId} 的配置时出错:`, error);
        }
    }
}