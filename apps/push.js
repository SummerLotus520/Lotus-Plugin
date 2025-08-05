import plugin from '../../../lib/plugins/plugin.js';
import pushCfg from '../model/PushConfigLoader.js';
import pushApi from '../model/pushApi.js';
import { getGameIds, getRedisKeys, GAME_CONFIG } from '../model/pushUtil.js';

export class push extends plugin {
  constructor() {
    super({
      name: '[荷花插件] 游戏版本推送',
      dsc: '自动监控游戏版本更新并推送，支持版本查询',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^(#|/)(原神|星铁|绝区零|崩坏三|常用|全部)版本查询$',
          fnc: 'queryVersion'
        },
        {
          reg: '^(#|/)荷花推送(添加|删除)(原神|星铁|绝区零|崩坏三|常用|全部)$',
          fnc: 'managePush',
          permission: 'master'
        },
        {
          reg: '^(#|/)手动检查版本$',
          fnc: 'manualCheck',
          permission: 'master'
        },
        {
          reg: '^(#|/)清空版本缓存$',
          fnc: 'clearCache',
          permission: 'master'
        }
      ]
    });

    this.task = {
      cron: '0 */5 * * * *',
      name: '游戏版本更新监控',
      fnc: () => this.runTask(false),
      log: false
    };
  }

  async runTask(isManual = false) {
    const allGameConfigs = pushCfg.getAll();
    const gameIds = getGameIds();
    for (const gameId of gameIds) {
      if (allGameConfigs[gameId]?.enable) {
        await pushApi.checkGameVersion(gameId, isManual);
      }
    }
  }

  async queryVersion(e) {
    const queryKey = e.msg.replace(/#|版本查询|\//g, '').trim();
    const gameIdsToQuery = this.resolveGameKeyword(queryKey);

    if (gameIdsToQuery.length > 1) {
      const allInfo = [];
      for (const gameId of gameIdsToQuery) {
        const info = await pushApi.getVersionInfo(gameId);
        allInfo.push(this.formatInfo(info));
      }
      const combinedMsg = allInfo.join('\n\n');
      return e.reply(combinedMsg, true);
    }
    
    const info = await pushApi.getVersionInfo(gameIdsToQuery[0]);
    e.reply(this.formatInfo(info), true);
  }

  async managePush(e) {
    if (!e.isGroup) {
      return e.reply('此命令仅限群聊中使用。', true);
    }

    const action = e.msg.includes('添加') ? 'add' : 'remove';
    const actionText = action === 'add' ? '添加' : '删除';
    const queryKey = e.msg.replace(/#|\/|荷花推送|添加|删除/g, '').trim();
    const gameIdsToManage = this.resolveGameKeyword(queryKey);
    const successGames = [];

    for (const gameId of gameIdsToManage) {
      const success = pushCfg.updatePushGroup(gameId, e.group_id, action === 'add');
      if (success) {
        successGames.push(GAME_CONFIG[gameId].name);
      }
    }

    if (successGames.length > 0) {
      e.reply(`操作成功！\n已为本群${actionText}以下游戏的推送：\n${successGames.join('、')}`, true);
    } else {
      e.reply(`操作失败，请检查游戏名称是否正确。`, true);
    }
  }
  
  resolveGameKeyword(keyword) {
    if (keyword === '全部') {
      return getGameIds();
    }
    if (keyword === '常用') {
      return getGameIds().filter(id => id !== 'bh3');
    }
    const gameId = Object.keys(GAME_CONFIG).find(id => GAME_CONFIG[id].name.includes(keyword));
    return gameId ? [gameId] : [];
  }

  formatInfo(info) {
    if (info.message) {
      return info.message;
    }
    return [
      `[荷花插件]`,
      `-- ${info.gameName} 版本查询 --`,
      `当前版本：${info.version}`,
      `已持续：${info.daysPassed} 天`,
      `版本周期：${info.cycleDays} 天`,
      `预计剩余：约 ${info.daysLeft} 天`,
      `下个版本：预计 ${info.nextUpdate} 前后`,
    ].join('\n');
  }

  async manualCheck(e) {
    e.reply('开始静默更新后台版本数据...');
    await this.runTask(true);
    e.reply('手动检查任务已执行完毕，数据已更新。');
  }

  async clearCache(e) {
    const gameIds = getGameIds();
    for (const gameId of gameIds) {
      const keys = getRedisKeys(gameId);
      await redis.del(keys.main, keys.mainDate, keys.pre, keys.preDate);
    }
    e.reply('已清空所有游戏的版本缓存。', true);
  }
}