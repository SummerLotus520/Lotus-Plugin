import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import chokidar from "chokidar";

const pluginName = "Lotus-Plugin";
const pluginRoot = path.resolve(process.cwd(), 'plugins', pluginName);

class PushConfigLoader {
  constructor() {
    this.configPath = path.join(process.cwd(), "data", pluginName, "push.yaml");
    this.examplePath = path.join(pluginRoot, "config", "push.yaml.example");

    this.config = {};
    this.init();

    this.watcher = chokidar.watch(this.configPath);
    this.watcher.on("change", () => {
      logger.mark(`[${pluginName}] 检测到 push.yaml 配置变化，重新加载...`);
      this.loadConfig();
    });
  }

  init() {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    if (!fs.existsSync(this.configPath)) {
      logger.mark(`[${pluginName}] 未找到 push.yaml 配置文件，将从模板创建...`);
      try {
        fs.copyFileSync(this.examplePath, this.configPath);
      } catch (err) {
        logger.error(`[${pluginName}] 创建配置文件失败: ${err}`);
        return;
      }
    }
    this.loadConfig();
  }

  loadConfig() {
    try {
      const fileContent = fs.readFileSync(this.configPath, "utf8");
      this.config = YAML.parse(fileContent);
      logger.debug(`[${pluginName}] push.yaml 配置加载成功`);
    } catch (err) {
      logger.error(`[${pluginName}] 加载 push.yaml 配置文件失败: ${err}`);
    }
  }

  /**
   * 获取所有配置
   * @returns {object}
   */
  getAll() {
    return this.config;
  }
  
  /**
   * 获取指定游戏的配置
   * @param {string} gameId - 游戏标识
   * @returns {object | undefined}
   */
  getGameConfig(gameId) {
    return this.config?.[gameId];
  }

  /**
   * 保存配置
   * @param {object} newConfig 
   * @returns {boolean}
   */
  saveConfig(newConfig) {
    try {
      fs.writeFileSync(this.configPath, YAML.stringify(newConfig), "utf8");
      this.config = newConfig; 
      return true;
    } catch(err) {
      logger.error(`[${pluginName}] 保存 push.yaml 失败: ${err}`);
      return false;
    }
  }
}
export default new PushConfigLoader();