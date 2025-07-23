# Lotus-Plugin

本插件为 [Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/) 设计，集成了基于 `MihoyoBBSTools` 的米哈游社区自动签到和体力查询功能。


---

## 安装与部署

### 环境要求

- 一个正常运行的 [Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/) 实例
- Python >= 3.8

### 安装流程

#### 步骤 1：安装依赖插件

本项目依赖 `xiaoyao-cvs-plugin` 获取 Cookie。请先安装该插件：

```bash
cd plugins

git clone https://github.com/SummerLotus520/xiaoyao-cvs-plugin.git
```

#### 步骤 2：安装本插件

使用 `--recurse-submodules` 参数克隆，以下载 MihoyoBBSTools 工具：

```bash
cd plugins

git clone --recurse-submodules https://github.com/SummerLotus520/Lotus-Plugin.git

#Yarn 4 Workspace (node-modules)

yarn install
```

#### 步骤 3：初始化环境（主人权限）

完成安装后，向机器人发送以下指令以自动安装 Python 依赖：

```
#初始化签到环境
```

#### 步骤 4：配置

首次加载插件后，会在 `plugins/Lotus-Plugin/config/` 生成配置文件。根据注释完成以下设置：

- 自动签到执行时间
- 自动补签设置
- 自动刷新配置
- 日志自动删除

配置完成后重启 Yunzai：

```bash
yarn stop 

yarn app
```

---

## 指令总览

### 用户指令

| 指令 | 说明 |
|------|------|
| `#注册自动签到` | 创建签到配置 |
| `#刷新自动签到` | 更新 Cookie |
| `#全部体力` / `!体力` | 查询所有账号体力信息 |

### 主人指令

| 指令 | 说明 |
|------|------|
| `#初始化签到环境` | 安装 Python 依赖 |
| `#测试签到` / `#开始签到` | 手动触发签到任务 |
| `#批量刷新签到` | 强制刷新所有用户的 Cookie |
| `#自动签到日志` | 查看签到日志 |

---

## 技术来源

- 签到工具：[MihoyoBBSTools](https://github.com/Womsxd/MihoyoBBSTools) by [@Womsxd](https://github.com/Womsxd)
- Cookie 获取：[xiaoyao-cvs-plugin](https://github.com/SummerLotus520/xiaoyao-cvs-plugin)
- Yunzai Fork：[Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/)

## 支持

如有问题，请加入 QQ 群 `702211431` 交流反馈。
