// 米哈游API
const CHECK_API_BASE = "https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGameBranches";
const LAUNCHER_ID = "jGHBHlcOq1";

// 游戏配置信息
export const GAME_CONFIG = {
  ys: {
    id: "1Z8W5NHUQb",
    name: "原神",
    redisPrefix: "YS"
  },
  sr: {
    id: "64kMb5iAWu",
    name: "崩坏:星穹铁道",
    redisPrefix: "SR"
  },
  zzz: {
    id: "x6znKlJ0xK",
    name: "绝区零",
    redisPrefix: "ZZZ"
  },
  bh3: {
    id: "osvnlOc0S8",
    name: "崩坏3",
    redisPrefix: "BH3"
  }
};

/**
 * 获取所有支持的游戏ID列表
 * @returns {string[]}
 */
export const getGameIds = () => Object.keys(GAME_CONFIG);

/**
 * 获取游戏名称
 * @param {string} gameId - 游戏ID
 * @returns {string} 游戏中文名
 */
export const getGameName = (gameId) => GAME_CONFIG[gameId]?.name || "未知游戏";

/**
 * 获取游戏版本检查的API URL
 * @param {string} gameId - 游戏ID
 * @returns {string} API URL
 */
export const getGameApiUrl = (gameId) => {
  const gameApiId = GAME_CONFIG[gameId]?.id;
  if (!gameApiId) return null;
  return `${CHECK_API_BASE}?launcher_id=${LAUNCHER_ID}&game_ids[]=${gameApiId}`;
};

/**
 * 生成在Redis中存储数据所需的键名
 * @param {string} gameId - 游戏ID
 * @returns {{main: string, pre: string, mainDate: string, preDate: string}}
 */
export const getRedisKeys = (gameId) => {
  const prefix = GAME_CONFIG[gameId]?.redisPrefix || "GAME";
  const baseKey = `Yz:Lotus:Push:${prefix}`;
  return {
    main: `${baseKey}:Main:Version`,      // 存储正式服版本号
    pre: `${baseKey}:Pre:Version`,        // 存储预下载版本号
    mainDate: `${baseKey}:Main:UpdateDate`, // 存储正式服版本更新日期
    preDate: `${baseKey}:Pre:UpdateDate`   // 存储预下载版本更新日期
  };
};
