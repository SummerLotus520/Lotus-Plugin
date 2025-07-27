import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const pluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const configPath = path.join(pluginRoot, 'config', 'parser.yaml');
const exampleConfigPath = path.join(pluginRoot, 'config', 'parser.yaml.example');

let config = {};

function loadConfig() {
    try {
        if (!fs.existsSync(configPath) && fs.existsSync(exampleConfigPath)) {
            logger.warn('[荷花插件] 检测到 parser.yaml 不存在，将从模板创建...');
            fs.copyFileSync(exampleConfigPath, configPath);
        }
        config = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        logger.error(`[荷花插件] 加载配置文件失败: ${error.message}`);
    }
}

// 首次加载
loadConfig();

export default {
    /**
     * 获取当前加载的配置
     */
    get cfg() {
        return config;
    },
    /**
     * 重新从文件加载配置
     */
    reload() {
        loadConfig();
    }
};