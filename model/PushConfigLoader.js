import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import chokidar from "chokidar";

const pluginName = "Lotus-Plugin";
const pluginRoot = path.resolve(process.cwd(), 'plugins', pluginName);
const configDir = path.join(pluginRoot, "config"); 

class PushConfigLoader {
  constructor() {
    this.configPath = path.join(configDir, "push.yaml");
    this.examplePath = path.join(configDir, "push.yaml.example");
    this.baseConfigPath = path.join(configDir, "pushBase.yaml");
    this.baseExamplePath = path.join(configDir, "pushBase.yaml.example");

    this.config = {};
    this.baseConfig = {};
    
    this.init();

    this.watcher = chokidar.watch([this.configPath, this.baseConfigPath]);
    this.watcher.on("change", (path) => {
      logger.mark(`[${pluginName}] 检测到配置变化: ${path}，重新加载...`);
      if (path.includes('push.yaml')) this.loadConfig();
      if (path.includes('pushBase.yaml')) this.loadBaseConfig();
    });
  }

  init() {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(this.configPath)) {
      logger.mark(`[${pluginName}] 未找到 push.yaml，将从模板创建...`);
      try { fs.copyFileSync(this.examplePath, this.configPath); } 
      catch (err) { logger.error(`[${pluginName}] 创建 push.yaml 失败: ${err}`); }
    }
    
    if (!fs.existsSync(this.baseConfigPath)) {
      logger.mark(`[${pluginName}] 未找到 pushBase.yaml，将从模板创建...`);
      try { fs.copyFileSync(this.baseExamplePath, this.baseConfigPath); } 
      catch (err) { logger.error(`[${pluginName}] 创建 pushBase.yaml 失败: ${err}`); }
    }

    this.loadConfig();
    this.loadBaseConfig();
  }

  loadConfig() {
    try {
      this.config = YAML.parse(fs.readFileSync(this.configPath, "utf8"));
    } catch (err) { logger.error(`[${pluginName}] 加载 push.yaml 失败: ${err}`); }
  }

  loadBaseConfig() {
    try {
      this.baseConfig = YAML.parse(fs.readFileSync(this.baseConfigPath, "utf8"));
    } catch (err) { logger.error(`[${pluginName}] 加载 pushBase.yaml 失败: ${err}`); }
  }

  getAll() {
    return this.config;
  }

  getGameConfig(gameId) { return this.config?.[gameId]; }
  getGameBaseConfig(gameId) { return this.baseConfig?.[gameId]; }
}

export default new PushConfigLoader();