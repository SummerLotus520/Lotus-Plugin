import fetch from "node-fetch";
import pushCfg from "./PushConfigLoader.js";
import { GAME_CONFIG, getGameApiUrl, getRedisKeys, getGameName } from "./pushUtil.js";

const versionCompare = new Intl.Collator(undefined, { numeric: true }).compare;

class PushApi {

  /**
   * 检查单个游戏是否有版本更新
   * @param {string} gameId 游戏ID
   */
  async checkGameVersion(gameId) {
    const apiUrl = getGameApiUrl(gameId);
    if (!apiUrl) return;

    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        logger.warn(`[Lotus-Push] 请求 ${getGameName(gameId)} API失败: ${res.status}`);
        return;
      }

      const data = await res.json();
      const gameData = data?.data?.game_branches?.[0];
      if (!gameData) {
        logger.warn(`[Lotus-Push] 解析 ${getGameName(gameId)} 数据失败`);
        return;
      }

      // 检查正式版
      await this.checkVersionType('main', gameId, gameData.main?.tag);
      // 检查预下载
      await this.checkVersionType('pre', gameId, gameData.pre_download?.tag);

    } catch (error) {
      logger.error(`[Lotus-Push] 检查 ${getGameName(gameId)} 版本时出错:`, error);
    }
  }

  /**
   * 对比并处理版本更新
   * @param {'main' | 'pre'} type 版本类型 'main' 或 'pre'
   * @param {string} gameId 游戏ID
   * @param {string} newVersion 从API获取的新版本号
   */
  async checkVersionType(type, gameId, newVersion) {
    const keys = getRedisKeys(gameId);
    const versionKey = keys[type];
    const dateKey = keys[`${type}Date`];
    
    // 从Redis获取旧版本信息
    const oldVersion = await redis.get(versionKey);

    // 场景1：API有新版本信息
    if (newVersion) {
      // 版本号发生了变化(新版本 > 旧版本), 或者之前根本没记录
      if (!oldVersion || versionCompare(newVersion, oldVersion) > 0) {
        const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
        await redis.set(versionKey, newVersion);
        await redis.set(dateKey, today);
        logger.mark(`[Lotus-Push] ${getGameName(gameId)} ${type === 'main' ? '正式版' : '预下载'}更新: ${oldVersion || '无'} -> ${newVersion}`);
        this.sendPushMessage(type, gameId, oldVersion || "旧版本", newVersion);
      }
    // 场景2：API没有版本信息，但我们之前有记录 (说明预下载关闭了)
    } else if (oldVersion && type === 'pre') {
      await redis.del(versionKey);
      await redis.del(dateKey);
      logger.mark(`[Lotus-Push] ${getGameName(gameId)} 预下载关闭，旧版本: ${oldVersion}`);
      this.sendPushMessage('pre-remove', gameId, oldVersion, null);
    }
  }

  /**
   * 发送推送消息
   */
  sendPushMessage(type, gameId, oldVer, newVer) {
    const gameCfg = pushCfg.getGameConfig(gameId);
    if (!gameCfg?.pushGroups || gameCfg.pushGroups.length === 0) {
      return; // 没有配推送群，溜了
    }
    
    const gameName = getGameName(gameId);
    let msg;

    switch (type) {
      case 'main':
        msg = `[荷花版本推送]\n${gameName} 版本更新 \n从 ${oldVer} 更新到 ${newVer}，开门！`;
        break;
      case 'pre':
        msg = `[荷花版本推送]\n${gameName} 预下载开启 \n新版本 ${newVer} 已开放预下载，记得及时下载！`;
        break;
      case 'pre-remove':
        msg = `[荷花版本推送]\n${gameName} 预下载关闭 \n正式版本 ${oldVer} 即将上线！`;
        break;
      default:
        return;
    }

    // 给所有配置的群发消息
    for (const groupId of gameCfg.pushGroups) {
      Bot.pickGroup(groupId).sendMsg(msg).catch((err) => {
        logger.warn(`[Lotus-Push] 发送群消息到 ${groupId} 失败:`, err);
      });
    }
  }

  /**
   * 获取用于查询的版本信息
   * @returns {object} 查询所需的数据
   */
  async getVersionInfo(gameId) {
    const keys = getRedisKeys(gameId);
    const gameCfg = pushCfg.getGameConfig(gameId);

    const currentVersion = await redis.get(keys.main);
    if (!currentVersion) {
      return { message: `${getGameName(gameId)} 当前版本信息不存在，可能需要等待一次版本更新。` };
    }
    
    const updateDateStr = await redis.get(keys.mainDate);
    const updateDate = new Date(updateDateStr);
    const today = new Date();
    
    // 把时间都设置为0点，避免跨时区和小时影响天数计算
    updateDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const daysPassed = Math.round((today - updateDate) / (1000 * 60 * 60 * 24));

    // 查找版本周期
    let cycleDays = gameCfg.defaultCycleDays;
    const special = gameCfg.specialCycles?.find(c => c.version === currentVersion);
    if (special) {
      cycleDays = special.days;
    }

    const daysLeft = cycleDays - daysPassed;
    const nextUpdateDate = new Date(today);
    nextUpdateDate.setDate(today.getDate() + daysLeft);
    
    return {
      gameName: getGameName(gameId),
      version: currentVersion,
      daysPassed: daysPassed,
      daysLeft: Math.max(0, daysLeft), // 剩余天数不显示负数
      cycleDays: cycleDays,
      nextUpdate: nextUpdateDate.toLocaleDateString('zh-CN'),
    };
  }
}

export default new PushApi();