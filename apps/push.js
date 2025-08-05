import plugin from '../../../../../lib/plugins/plugin.js';
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
          reg: '^(#|/)(原神|星铁|绝区零|崩坏三|全部)版本查询$',
          fnc: 'queryVersion'
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
    logger.debug('[Lotus-Push] 开始执行版本检查任务...');
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
    
    if (queryKey === '全部') {
      const allInfo = [];
      const gameIds = getGameIds();
      for (const gameId of gameIds) {
        const info = await pushApi.getVersionInfo(gameId);
        allInfo.push(this.formatInfo(info));
      }
      const combinedMsg = allInfo.join('\n\n');
      return e.reply(combinedMsg, true);
    }
    
    const gameId = Object.keys(GAME_CONFIG).find(id => GAME_CONFIG[id].name.includes(queryKey));

    if (!gameId) return;

    const info = await pushApi.getVersionInfo(gameId);
    e.reply(this.formatInfo(info), true);
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
      await redis.del(keys.main);
      await redis.del(keys.mainDate);
      await redis.del(keys.pre);
      await redis.del(keys.preDate);
    }
    e.reply('已清空所有游戏的版本缓存。', true);
  }
}