# 荷花插件 (Lotus-Plugin)

这是一款为 [Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/) 设计的多功能插件，旨在提供稳定、便捷的自动化服务。目前集成了两大核心功能：

1.  **米哈游社区自动签到**：通过 `MihoyoBBSTools`和 `xiaoyao-cvs-plugin` 实现全自动的米游社和游戏签到。
2.  **全部体力指令**：一次性查询所有已绑定角色的体力信息。

使用帮助可以加入荷花的小群(702211431)交流咨询，有问题也可以加群反馈。

## 安装流程

请务必严格按照以下步骤进行安装，以确保所有功能正常运行。

### 步骤 0：环境准备

1.  您已经拥有一个正常运行的 Yunzai。
2.  您的服务器或电脑已安装 **Python 3** 环境。签到核心工具需要Python来运行。

### 步骤 1：安装依赖插件

本插件的核心Cookie获取逻辑依赖于特定版本的 `xiaoyao-cvs-plugin`。请先安装它。

```bash
# 进入你的 Yunzai-Bot 插件目录
cd /path/to/your/Yunzai-Bot/plugins/

# 克隆插件仓库
git clone https://github.com/SummerLotus520/xiaoyao-cvs-plugin.git
```

### 步骤 2：安装本插件 (荷花插件)

在安装完依赖后，回到 `plugins` 目录，克隆本插件。

> **警告：** 请务必使用下面提供的、带有 `--recurse-submodules` 参数的命令。这个参数会自动下载本插件正常运行所必需的签到工具 `MihoyoBBSTools`。如果使用了普通的 `git clone`，签到功能将无法使用！

```bash
# 确保你仍然在 Yunzai-Bot 的 plugins 目录下

# 使用 --recurse-submodules 克隆本插件
git clone --recurse-submodules https://github.com/SummerLotus520/Lotus-Plugin.git
# 安装依赖
pnpm install -P
#荷花Fork版使用Yarn4
yarn install
```

### 步骤 3：配置插件

## 配置说明

首次加载插件后，会自动生成默认配置文件。
您可以根据需要进行修改，也可以先写好配置文件。

1.  进入插件配置目录：`plugins/Lotus-Plugin/config/`。
2.  您会看到一个 `config.yaml.example` 文件，这是默认的模板文件。
3.  **将 `config.yaml.example` 复制一份，并重命名为 `config.yaml`**。
4.  根据您的需求，修改 `config.yaml` 文件中的内容。

执行 `yarn stop` `yarn app`完整重启一次 Yunzai。

### 步骤 4：初始化插件环境 (主人权限)

重启成功后，请向机器人发送以下指令，以安装签到工具所需的 Python 依赖库。

```
#初始化签到环境
```
看到“依赖库安装成功”的回复后，插件便已准备就绪。

## 使用方法

### 普通用户指令

*   `#注册自动签到`
    首次使用时，根据您在 `xiaoyao-cvs-plugin` 中绑定的 `stoken`，为您创建签到配置文件。

*   `#刷新自动签到`
    当您签到配置文件的 `stoken` 或 `cookie` 失效时，使用此指令更新您的签到配置。

*   `#全部体力` 或 `!体力`
    获取所有已绑定账号的体力信息。

### 主人指令

*   `#初始化签到环境`
    安装或更新签到工具的 Python 依赖。

*   `#测试签到` 或 `#开始签到`
    手动触发一次所有用户的签到任务，方便调试。执行结果将输出至机器人后台控制台。

## 致谢

一个功能强大的插件离不开社区的卓越贡献，在此向以下项目和作者表示诚挚的感谢：

*   **签到核心工具**: 本插件的签到功能由 `Womsxd` 大佬的 [**MihoyoBBSTools**](https://github.com/Womsxd/MihoyoBBSTools) 项目提供。其强大的功能是本插件实现自动签到的基石。
*   **核心Cookie依赖**: Cookie及Stoken的获取逻辑依赖于 [**xiaoyao-cvs-plugin**](https://github.com/SummerLotus520/xiaoyao-cvs-plugin) (基于原版修改)，感谢原作者的维护。
*   **机器人框架**: 本插件基于 [**Yunzai**](https://github.com/SummerLotus520/Miao-Yunzai/) 及其衍生版开发。