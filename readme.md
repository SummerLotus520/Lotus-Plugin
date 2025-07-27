
# Lotus-Plugin

本插件为 [Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/) 设计，集成了基于 `MihoyoBBSTools` 的米哈游社区自动签到和体力查询功能，同时支持 Bilibili 和网易云音乐的音视频解析。

---

## 安装与配置（必读）

### 环境要求

请确保服务器已正确安装以下工具（添加至系统环境变量 `PATH`，或在插件配置文件中指定 `toolsPath`）：

- **BBDown**：B站视频解析核心 - [https://github.com/nilaoda/BBDown](https://github.com/nilaoda/BBDown)
- **FFmpeg**：音视频处理工具 - [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)
- **NeteaseCloudMusicApi**：网易云解析核心（请自行部署，可加群咨询）

### 插件安装

#### 步骤 1：安装依赖插件

```bash
cd plugins
git clone https://github.com/SummerLotus520/xiaoyao-cvs-plugin.git
```

#### 步骤 2：安装本插件

```bash
cd plugins
git clone --recurse-submodules https://github.com/SummerLotus520/Lotus-Plugin.git
yarn install
```

#### 步骤 3：初始化环境（主人权限）

```bash
#初始化签到环境
```

#### 步骤 4：配置文件修改

插件首次运行后将在 `plugins/Lotus-Plugin/config/` 生成 `config.yaml` 和 `parser.yaml`，请根据注释内容完成配置后重启 Yunzai：

```bash
yarn stop
yarn app
```

---

## 指令总览

### 用户指令

| 指令                     | 说明                      |
|------------------------|-------------------------|
| `#注册自动签到`              | 创建签到配置                  |
| `#刷新自动签到`              | 更新 Cookie                |
| `#全部体力` / `!体力`        | 查询所有账号体力信息              |
| `#点歌 <关键词>`            | 搜索歌曲并返回列表               |
| `#播放 <关键词>`            | 播放匹配度最高的歌曲              |
| `#听[序号]`               | 播放点歌返回的某首歌曲             |
| 发送 B站视频或直播间链接       | 自动解析，支持卡片和小程序           |

### 主人指令

| 指令                      | 说明                         |
|-------------------------|----------------------------|
| `#初始化签到环境`              | 安装 Python 依赖               |
| `#测试签到` / `#开始签到`       | 手动触发签到任务                 |
| `#批量刷新签到`               | 强制刷新所有用户的 Cookie         |
| `#自动签到日志`               | 查看签到日志                   |
| `#execute`                | 自定义批量执行任意指令             |
| `#B站登录`                 | 登录 B 站账号以解锁高清/会员视频内容 |
| `#网易云登录`                | 登录网易云音乐账号                |

---

## Bilibili 解析模块

### 自动解析

- 支持发送 B 站视频链接或直播间链接
- 单 P 视频：自动发送信息卡片和视频文件
- 多 P 视频：发送合集卡片，引导使用 `#p` 指令操作
- 直播：自动提取推流源并提供播放链接（部分平台受限）

### 分 P 指令

- `#p[序号]`：下载指定序号视频（如 `#p5`）
- `#p all`：下载并合并所有分 P（较耗资源）
- 有效期：合集提示发出后 5 分钟内

### B站登录

- 指令：`#B站登录`
- 功能：扫码登录 B 站账号以解析高清或会员专属视频
- Cookie 由 BBDown 维护，插件不存储隐私数据

---

## 网易云音乐解析模块

### 登录说明（可选）

- 指令：`#网易云登录`
- 插件提供扫码登录引导，需在部署的 NeteaseCloudMusicApi 服务端完成
- 登录后可解析 VIP/高音质歌曲

### 自动解析

- 发送网易云歌曲或 MV 链接后自动解析并发送音频文件

### 搜索与播放

- `#点歌 <关键词>`：返回搜索列表
- `#听[序号]`：播放指定歌曲（如 `#听1`）
- `#播放 <关键词>`：直接播放匹配度最高的歌曲

---

## 自定义执行

### 权限

仅限配置文件中指定的 **主人（Master）** 使用

### 格式

```bash
#execute [参数1] [参数2] ... run:[要执行的指令]
```

### 参数

- `in:`：在哪执行（群号、@s、@e、here）
- `as:`：谁执行（QQ号、@昵称、@a）
- `run:`：要执行的指令（必填）
- `gap:`：执行间隔（默认5秒）
- `hold:`：是否拦截输出（默认 false）

---

## 技术支持

- 签到工具：[MihoyoBBSTools](https://github.com/Womsxd/MihoyoBBSTools)
- Cookie 获取：[xiaoyao-cvs-plugin](https://github.com/SummerLotus520/xiaoyao-cvs-plugin)
- Yunzai Fork：[Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/)

## 交流与讨论

如有问题，请加入 QQ 群 `702211431` 交流反馈。
