import fetch from "node-fetch";
import versionCfg from "./VersionConfigLoader.js";
import { getGameApiUrl, getRedisKeys, getGameName } from "./versionUtil.js";

class VersionApi {
  async getVersionInfo(gameId) {
    const keys = getRedisKeys(gameId);
    
    let version = await redis.get(keys.main);
    let updateDateStr = await redis.get(keys.mainDate);

    if (!version || !updateDateStr) {
      logger.debug(`[荷花查询][版本查询] Redis缓存未命中，将从基准文件重建 ${getGameName(gameId)} ...`);
      const baseInfo = versionCfg.getGameBaseConfig(gameId);
      if (!baseInfo?.baseVersion || !baseInfo?.baseDate) {
        return { message: `${getGameName(gameId)} 的基准信息未配置。` };
      }

      version = baseInfo.baseVersion;
      updateDateStr = baseInfo.baseDate;

      const apiUrl = getGameApiUrl(gameId);
      if (apiUrl) {
        try {
          const res = await fetch(apiUrl);
          const data = await res.json();
          const apiVersion = data?.data?.game_branches?.[0]?.main?.tag;
          if (apiVersion && apiVersion !== version) {
            logger.warn(`[荷花查询][版本查询] 警告：API实时版本(${apiVersion})与您的基准文件版本(${version})不一致。查询结果将基于基准文件，请及时更新versionBase.yaml！`);
          }
        } catch (e) {
          logger.warn(`[荷花查询][版本查询] 请求API获取实时版本号失败: ${e}`);
        }
      }
      
      await redis.set(keys.main, version);
      await redis.set(keys.mainDate, updateDateStr);
    }
    
    const updateDate = new Date(updateDateStr);
    const today = new Date();
    updateDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const daysPassed = Math.round((today - updateDate) / (1000 * 60 * 60 * 24));
    
    const gameCfg = versionCfg.getGameConfig(gameId);
    if (!gameCfg) {
      return { message: `${getGameName(gameId)} 的版本周期信息未配置。` };
    }
    
    let cycleDays = gameCfg.defaultCycleDays;
    
    const special = gameCfg.specialCycles?.find(c => c.version === version);
    if (special) {
      cycleDays = special.days;
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

export default new VersionApi();