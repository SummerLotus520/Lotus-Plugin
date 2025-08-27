import plugin from '../../../lib/plugins/plugin.js';
import versionCfg from '../model/VersionConfigLoader.js';
import versionApi from '../model/versionApi.js';
import { getGameIds, getRedisKeys, GAME_CONFIG } from '../model/versionUtil.js';

export class version extends plugin {
  constructor() {
    super({
      name: '[荷花插件] 游戏版本查询',
      dsc: '查询米哈游游戏当前版本及周期信息',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^(#|/)(原神|星铁|绝区零|崩坏三|常用|全部)版本查询$',
          fnc: 'queryVersion'
        },
        {
          reg: '^(#|/)清空版本缓存$',
          fnc: 'clearVersionCache',
          permission: 'master'
        }
      ]
    });
  }

  async queryVersion(e) {
    const queryKey = e.msg.replace(/#|版本查询|\//g, '').trim();
    const gameIdsToQuery = this.resolveGameKeyword(queryKey);

    if (gameIdsToQuery.length > 1) {
      const allInfo = [];
      for (const gameId of gameIdsToQuery) {
        const info = await versionApi.getVersionInfo(gameId);
        allInfo.push(this.formatInfo(info));
      }
      const combinedMsg = allInfo.filter(Boolean).join('\n\n');
      return e.reply(combinedMsg, true);
    } else if (gameIdsToQuery.length === 0) {
      return;
    }
    
    const info = await versionApi.getVersionInfo(gameIdsToQuery[0]);
    e.reply(this.formatInfo(info), true);
  }
  
  resolveGameKeyword(keyword) {
    if (keyword === '全部') {
      return getGameIds();
    }
    if (keyword === '常用') {
      return getGameIds().filter(id => id !== 'bh3');
    }
    const gameId = Object.keys(GAME_CONFIG).find(id => GAME_CONFIG[id].aliases.includes(keyword));
    return gameId ? [gameId] : [];
  }

  formatInfo(info) {
    if (!info || info.message) {
      return info ? info.message : null;
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

  async clearVersionCache(e) {
    const gameIds = getGameIds();
    for (const gameId of gameIds) {
      const keys = getRedisKeys(gameId);
      await redis.del(keys.main, keys.mainDate);
    }
    e.reply('已清空所有游戏的版本缓存。', true);
  }
}