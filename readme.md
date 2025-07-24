
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

# Yarn 4 Workspace (node-modules)
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

| 指令              | 说明         |
| --------------- | ---------- |
| `#注册自动签到`       | 创建签到配置     |
| `#刷新自动签到`       | 更新 Cookie  |
| `#全部体力` / `!体力` | 查询所有账号体力信息 |

### 主人指令

| 指令                | 说明               |
| ----------------- | ---------------- |
| `#初始化签到环境`        | 安装 Python 依赖     |
| `#测试签到` / `#开始签到` | 手动触发签到任务         |
| `#批量刷新签到`         | 强制刷新所有用户的 Cookie |
| `#自动签到日志`         | 查看签到日志           |
| `#execute`            | 自定义批量执行任意指令     |

---

## 自定义执行

### 权限

本插件所有功能，仅限在机器人配置文件中指定的 **主人（Master）** 可以使用。

### 指令格式

指令以 `#execute` 开头，由一系列参数和一个执行内容组成。

**基础结构：**

```
#execute [参数1] [参数2] ... run:[要执行的指令]
```

### 核心要点

- 所有参数（如 `in:`、`as:`）的顺序可以任意排列。
- `run:` 是一个强制的分界线，它后面的所有内容都会被视为要执行的命令。

### 参数详解

#### 1. `in:`（在哪执行）

说明：指定命令在哪个聊天场景中执行。

- **必填**：是
- **可选值**：
  - 群号：例如 `in:12345678`。
  - `@s`：代表在私聊（private/session）中执行。
  - `@e`：代表在机器人加入的所有群聊（everywhere）中执行（请极度谨慎使用）。
  - `here`：当前群聊（仅限在群聊中使用）。

#### 2. `as:`（谁来执行）

说明：指定由谁的身份来模拟执行命令。

- **必填**：是
- **可选值**：
  - `@a`：所有人（会自动排除机器人自身）。
  - 单个 QQ：如 `as:12345678`。
  - AT 昵称：如 `as:@张三`。
  - 多个目标（可混用）：如 `as:@张三 @李四`、`as:111,222 333`、`as:@张三, 123456 @李四`。

#### 3. `run:`（执行什么）

说明：指定具体要执行的指令内容。

- **必填**：是
- **格式**：`run:` 后跟要执行的完整指令，例如：`run:#天气 北京`

#### 4. `gap:`（执行间隔）

说明：多人执行时，设置每次执行之间的间隔时间。

- **必填**：否
- **默认值**：5 秒（最小值也是 5 秒）

#### 5. `hold:`（拦截输出）

说明：是否拦截被执行指令的返回结果。

- **必填**：否
- **默认值**：`false`
- **可选值**：
  - `hold:true`：拦截输出（用于静默执行，如更新面板）。
  - `hold:false`：不拦截，输出正常发送。

---

## 技术支持

- 签到工具：[MihoyoBBSTools](https://github.com/Womsxd/MihoyoBBSTools) by [@Womsxd](https://github.com/Womsxd)
- Cookie 获取：[xiaoyao-cvs-plugin](https://github.com/SummerLotus520/xiaoyao-cvs-plugin)
- Yunzai Fork：[Yunzai](https://github.com/SummerLotus520/Miao-Yunzai/)

## 交流与讨论

如有问题，请加入 QQ 群 `702211431` 交流反馈。
