
# Lotus-Plugin

# **【重要】老用户请重新生成配置文件！！！**

本插件为 [Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/) 设计，集成了基于 `MihoyoBBSTools` 的米哈游社区自动签到功能，并提供强大的 Bilibili 视频解析服务。

---

## 安装与配置（必读）

### 环境要求

请确保服务器已正确安装以下工具（添加至系统环境变量 `PATH`，或在插件配置文件中指定 `toolsPath`）：

- **BBDown**：B站视频解析核心 - [https://github.com/nilaoda/BBDown](https://github.com/nilaoda/BBDown)
- **FFmpeg**：音视频处理工具（API模式下载或合并时需要） - [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html)
- **Python3 & Pip3**：签到功能核心环境

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
cd Lotus-Plugin
yarn install # 或 npm install / pnpm install
```

#### 步骤 3：初始化环境（主人权限）

```bash
#初始化签到环境
```

#### 步骤 4：配置文件修改

插件首次运行后将在 `plugins/Lotus-Plugin/config/` 生成 `config.yaml`，请删除旧的配置文件，根据新模板的注释内容完成配置后重启 Yunzai。

```bash
yarn stop
yarn app
```

---

## 指令总览

### 用户指令

| 指令 | 说明 |
|---|---|
| `#注册自动签到` | 创建签到配置 |
| `#刷新自动签到` | 更新 Cookie |
| `#签到名单列表` | 查看当前群聊的签到注册情况 |
| 发送 B站视频或直播间链接 | 自动解析，支持卡片和小程序 |

### 主人指令

| 指令 | 说明 |
|---|---|
| `#初始化签到环境` | 安装 Python 依赖 |
| `#测试签到` / `#开始签到` | 手动触发签到任务 |
| `#批量刷新签到` | 强制刷新所有用户的 Cookie |
| `#自动签到日志` | 查看签到日志 |
| `#注册本群签到` | 为当前群所有成员批量注册/刷新 |
| `#启用社区签到` | 切换为需要验证码的BBS签到模式 |
| `#自动签到黑名单` | 切换至黑名单模式 |
| `#自动签到白名单` | 切换至白名单模式 |
| `#添加黑名单 <QQ/@用户>` | 添加用户到黑名单 |
| `#删除黑名单 <QQ/@用户>` | 从黑名单移除用户 |
| `#添加白名单 <QQ/@用户>` | 添加用户到白名单 |
| `#删除白名单 <QQ/@用户>` | 从白名单移除用户 |
| `#签到黑名单列表` | 查看全局黑名单 |
| `#签到白名单列表` | 查看全局白名单 |
| `#群成员 [群号]` | 导出指定群（或当前群）的成员列表 |
| `#execute` | 自定义批量执行任意指令 |
| `#B站登录` | 登录 B 站账号以解锁高清/会员视频内容 |

---

## 自动签到模块

### 核心功能
- **自动签到**：基于 `MihoyoBBSTools`，每日定时自动完成米哈游社区签到任务。
- **Cookie 自动刷新**：用户只需登录一次，插件即可在后台自动维护 Cookie 有效性。
- **社区签到支持**：可通过指令切换，支持需要滑块验证的社区（BBS）签到模式。

### 权限管理
- **黑白名单**：主人可通过指令设置黑名单或白名单模式，灵活控制插件使用权限。
- **自动清理**：当机器人退群或群员离开所有共同群聊后，插件会自动删除其对应的签到配置，保持数据整洁。

---

## Bilibili 解析模块

### 自动解析
- **全面支持**：支持 BV/av 号、小程序、卡片、b23.tv 短链等多种格式。
- **智能处理**：自动区分单 P、多 P 和直播间链接，并根据配置执行相应操作。
- **缓存系统**：已下载的视频和压缩包会自动缓存，重复请求将直接发送文件，极大提升响应速度。

### 多 P 视频处理
插件检测到多 P 视频后，会根据 `config.yaml` 中的 `multiPagePolicy` 配置自动处理，无需用户二次操作。
- **`zip` (默认)**：下载所有分 P，打包成一个 `.zip` 压缩文件发送。
- **`all`**：下载所有分P，并逐个发送视频文件。
- **`first`**：下载所有分P，但只发送 P1 视频。

### B站登录
- **指令**：`#B站登录`
- **功能**：扫码登录 B 站账号以解析高清或会员专属视频。
- **安全**：Cookie 由 BBDown 自身维护，插件不存储任何隐私数据。

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