const CHECK_API_BASE = "https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGameBranches";
const LAUNCHER_ID = "jGHBHlcOq1";

export const GAME_CONFIG = {
  ys: {
    id: "1Z8W5NHUQb",
    name: "原神",
    redisPrefix: "YS",
    aliases: ["原神"]
  },
  sr: {
    id: "64kMb5iAWu",
    name: "崩坏:星穹铁道",
    redisPrefix: "SR",
    aliases: ["星铁", "星穹铁道", "崩坏星穹铁道"]
  },
  zzz: {
    id: "x6znKlJ0xK",
    name: "绝区零",
    redisPrefix: "ZZZ",
    aliases: ["绝区零"]
  },
  bh3: {
    id: "osvnlOc0S8",
    name: "崩坏3",
    redisPrefix: "BH3",
    aliases: ["崩坏三", "崩坏3", "崩三"]
  }
};

export const getGameIds = () => Object.keys(GAME_CONFIG);

export const getGameName = (gameId) => GAME_CONFIG[gameId]?.name || "未知游戏";

export const getGameApiUrl = (gameId) => {
  const gameApiId = GAME_CONFIG[gameId]?.id;
  if (!gameApiId) return null;
  return `${CHECK_API_BASE}?launcher_id=${LAUNCHER_ID}&game_ids[]=${gameApiId}`;
};

export const getRedisKeys = (gameId) => {
  const prefix = GAME_CONFIG[gameId]?.redisPrefix || "GAME";
  const baseKey = `Yz:Lotus:Push:${prefix}`;
  return {
    main: `${baseKey}:Main:Version`,
    pre: `${baseKey}:Pre:Version`,
    mainDate: `${baseKey}:Main:UpdateDate`,
    preDate: `${baseKey}:Pre:UpdateDate`
  };
};
