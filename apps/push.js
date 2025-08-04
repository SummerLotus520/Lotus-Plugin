import plugin from '../../../lib/plugins/plugin.js';
import pushCfg from '../model/PushConfigLoader.js';
import pushApi from '../model/pushApi.js';
import { getGameIds, GAME_CONFIG } from '../model/pushUtil.js';

export class push extends plugin {
  constructor() {
    super({
      name: '游戏版本推送',
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
        }
      ]
    });

    this.task = {
      cron: '0 */5 * * * *', // 每5分钟检查一次
      name: '游戏版本更新监控',
      fnc: () => this.runTask(),
      log: false
    };
  }

  async runTask() {
    logger.debug('[Lotus-Push] 开始执行版本检查定时任务...');
    const allGameConfigs = pushCfg.getAll();
    const gameIds = getGameIds();

    for (const gameId of gameIds) {
      // 只检查在配置文件中标记为启用的游戏
      if (allGameConfigs[gameId]?.enable) {
        await pushApi.checkGameVersion(gameId);
      }
    }
  }

  async queryVersion(e) {
    const queryKey = e.msg.replace(/#|版本查询|\//g, '').trim();
    
    // 如果是查询“全部”
    if (queryKey === '全部') {
      const allInfo = [];
      const gameIds = getGameIds();
      for (const gameId of gameIds) {
        const info = await pushApi.getVersionInfo(gameId);
        allInfo.push(this.formatInfo(info)); // 调用格式化函数
      }
      // 将所有游戏的信息合并成一条消息发送
      const combinedMsg = allInfo.join('\n\n'); // 每个游戏信息用两个换行隔开
      return e.reply(combinedMsg, true);
    }
    
    // 查询单个游戏
    const gameId = Object.keys(GAME_CONFIG).find(id => GAME_CONFIG[id].name.includes(queryKey));

    if (!gameId) return;

    const info = await pushApi.getVersionInfo(gameId);
    e.reply(this.formatInfo(info), true);
  }
  
  /**
   * 格式化版本信息为文本
   * @param {object} info - 从pushApi.getVersionInfo获取的对象
   * @returns {string} 格式化后的消息文本
   */
  formatInfo(info) {
    if (info.message) {
      return info.message;
    }
    
    return [
      `-- ${info.gameName} 版本查询 --`,
      `当前版本：${info.version}`,
      `已持续：${info.daysPassed} 天`,
      `版本周期：${info.cycleDays} 天`,
      `预计剩余：约 ${info.daysLeft} 天`,
      `下个版本：预计 ${info.nextUpdate} 前后`,
    ].join('\n');
  }

  async manualCheck(e) {
    e.reply('收到，开始手动检查所有已开启的游戏版本，请稍后...');
    await this.runTask();
    e.reply('手动检查任务已执行完毕。');
  }
}