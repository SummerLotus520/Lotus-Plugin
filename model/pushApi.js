import fetch from "node-fetch";
import pushCfg from "./PushConfigLoader.js";
import { getGameApiUrl, getRedisKeys, getGameName } from "./pushUtil.js";

const versionCompare = new Intl.Collator(undefined, { numeric: true }).compare;

class PushApi {
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
      await this.checkVersionType('main', gameId, gameData.main?.tag);
      await this.checkVersionType('pre', gameId, gameData.pre_download?.tag);
    } catch (error) {
      logger.error(`[Lotus-Push] 检查 ${getGameName(gameId)} 版本时出错:`, error);
    }
  }

  async checkVersionType(type, gameId, newVersion) {
    const keys = getRedisKeys(gameId);
    const versionKey = keys[type];
    const dateKey = keys[`${type}Date`];
    const oldVersion = await redis.get(versionKey);
    if (newVersion) {
      if (!oldVersion || versionCompare(newVersion, oldVersion) > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await redis.set(versionKey, newVersion);
        await redis.set(dateKey, today);
        logger.mark(`[Lotus-Push] ${getGameName(gameId)} ${type === 'main' ? '正式版' : '预下载'}更新: ${oldVersion || '无'} -> ${newVersion}`);
        this.sendPushMessage(type, gameId, oldVersion || "旧版本", newVersion);
      }
    } else if (oldVersion && type === 'pre') {
      await redis.del(versionKey);
      await redis.del(dateKey);
      logger.mark(`[Lotus-Push] ${getGameName(gameId)} 预下载关闭，旧版本: ${oldVersion}`);
      this.sendPushMessage('pre-remove', gameId, oldVersion, null);
    }
  }

  sendPushMessage(type, gameId, oldVer, newVer) {
    const gameCfg = pushCfg.getGameConfig(gameId);
    if (!gameCfg?.pushGroups || gameCfg.pushGroups.length === 0) return;
    const gameName = getGameName(gameId);
    let msg;
    switch (type) {
      case 'main':
        msg = `[荷花版本推送]\n${gameName} 版本更新\n从 ${oldVer} 更新到 ${newVer}，开门！`;
        break;
      case 'pre':
        msg = `[荷花版本推送]\n${gameName} 预下载开启\n新版本 ${newVer} 已开放预下载，记得及时下载！`;
        break;
      case 'pre-remove':
        msg = `[荷花版本推送]\n${gameName} 预下载关闭\n正式版本 ${oldVer} 即将上线！`;
        break;
      default: return;
    }
    for (const groupId of gameCfg.pushGroups) {
      Bot.pickGroup(groupId).sendMsg(msg).catch((err) => {
        logger.warn(`[Lotus-Push] 发送群消息到 ${groupId} 失败:`, err);
      });
    }
  }

  async getVersionInfo(gameId) {
    const keys = getRedisKeys(gameId);
    
    let version = await redis.get(keys.main);
    let updateDateStr = await redis.get(keys.mainDate);

    if (!version || !updateDateStr) {
      logger.debug(`[Lotus-Push] Redis缓存未命中，开始重建 ${getGameName(gameId)} 的信息...`);
      const baseInfo = pushCfg.getGameBaseConfig(gameId);
      if (!baseInfo?.baseVersion || !baseInfo?.baseDate) {
        return { message: `${getGameName(gameId)} 的基准信息未配置。` };
      }

      let finalVersion = "Current";
      let finalDateStr = baseInfo.baseDate;

      const apiUrl = getGameApiUrl(gameId);
      let apiVersion;
      if (apiUrl) {
        try {
          const res = await fetch(apiUrl);
          const data = await res.json();
          apiVersion = data?.data?.game_branches?.[0]?.main?.tag;
        } catch (e) {}
      }

      if (apiVersion) {
        finalVersion = apiVersion;
        if (apiVersion === baseInfo.baseVersion) {
          finalDateStr = baseInfo.baseDate;
        } else {
          finalVersion = 'Current';
          finalDateStr = new Date().toISOString().slice(0, 10);
          logger.warn(`[Lotus-Push] API版本(${apiVersion})与基准版本(${baseInfo.baseVersion})不符，无法追溯历史。版本将显示为'Current'，日期从今天开始。`);
        }
      } else {
        finalVersion = baseInfo.baseVersion;
        finalDateStr = baseInfo.baseDate;
      }
      
      await redis.set(keys.main, finalVersion);
      await redis.set(keys.mainDate, finalDateStr);

      version = finalVersion;
      updateDateStr = finalDateStr;
    }
    
    const updateDate = new Date(updateDateStr);
    const today = new Date();
    updateDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const daysPassed = Math.round((today - updateDate) / (1000 * 60 * 60 * 24));
    
    const gameCfg = pushCfg.getGameConfig(gameId);
    let cycleDays = gameCfg.defaultCycleDays;
    
    if (version !== 'Current') {
        const special = gameCfg.specialCycles?.find(c => c.version === version);
        if (special) cycleDays = special.days;
    }

    const daysLeft = cycleDays - daysPassed;
    const nextUpdateDate = new Date(today);
    nextUpdateDate.setDate(today.getDate() + daysLeft);
    
    return {
      gameName: getGameName(gameId),
      version: version,
      daysPassed: daysPassed,
      daysLeft: Math.max(0, daysLeft),
      cycleDays: cycleDays,
      nextUpdate: nextUpdateDate.toLocaleDateString('zh-CN'),
    };
  }
}

export default new PushApi();