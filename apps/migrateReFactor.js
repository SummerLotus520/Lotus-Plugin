import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const BasePlugin = globalThis.plugin

const REFACTOR_REPO = "https://github.com/MOPELotus/Lotus-ReFactor.git"
const OLD_PLUGIN_NAME = "Lotus-Plugin"
const STAGING_NAME = ".Lotus-ReFactor-migration-staging"
const BACKUP_DIR_NAME = "backup"
const FIRST_CONFIRM = "#确认荷花迁移"
const FINAL_CONFIRM = "#最终确认荷花迁移"
const DELETE_CONFIRM = "#确认删除荷花旧库"
const pending = new Map()
const migrated = new Map()

export class LotusReFactorMigration extends BasePlugin {
  constructor() {
    super({
      name: "[荷花插件] 重构迁移",
      dsc: "Migrate old Lotus-Plugin to Lotus-ReFactor",
      event: "message",
      priority: -Infinity,
      rule: [
        { reg: "^#荷花迁移重构$", fnc: "startMigration", permission: "master" },
        { reg: "^#确认荷花迁移$", fnc: "firstConfirm", permission: "master" },
        { reg: "^#最终确认荷花迁移$", fnc: "finalConfirm", permission: "master" },
        { reg: "^#确认删除荷花旧库$", fnc: "deleteOldBackup", permission: "master" },
      ],
    })
  }

  async startMigration() {
    if (!this.ensureMaster()) return true
    const key = String(this.e.user_id || "master")
    pending.set(key, { step: 1, time: Date.now() })
    await this.e.reply([
      "警告：使用本插件会禁用或替代部分插件的部分功能，安装即同意此条款！",
      "",
      "迁移会执行以下操作：",
      "1. 拉取 Lotus-ReFactor 到临时目录并初始化子模块。",
      "2. 执行 pnpm install，并初始化 Python venv、MihoyoBBSTools、test_nine、BBDown/ffmpeg/aria2。",
      "3. 将旧签到配置迁移到新插件 data/users/*.yaml，将旧全局配置迁移到 config/global.yaml。",
      "4. 把旧 Lotus-Plugin 移动到 plugins/backup/，让旧插件下次启动不再加载。",
      "",
      `第一次确认请输入：${FIRST_CONFIRM}`,
    ].join("\n"))
    return true
  }

  async firstConfirm() {
    if (!this.ensureMaster()) return true
    const key = String(this.e.user_id || "master")
    const state = pending.get(key)
    if (!state || state.step !== 1) {
      await this.e.reply(`[荷花插件] 请先发送 #荷花迁移重构 阅读迁移警告。`)
      return true
    }
    pending.set(key, { step: 2, time: Date.now() })
    await this.e.reply([
      "二次确认：迁移开始后会替换当前插件目录，并把旧插件移动到 backup 避免加载。",
      "警告：使用本插件会禁用或替代部分插件的部分功能，安装即同意此条款！",
      "",
      "确认服务器网络、Git、Corepack、pnpm、Python 均可用后，再输入最终确认。",
      `最终确认请输入：${FINAL_CONFIRM}`,
    ].join("\n"))
    return true
  }

  async finalConfirm() {
    if (!this.ensureMaster()) return true
    const key = String(this.e.user_id || "master")
    const state = pending.get(key)
    if (!state || state.step !== 2) {
      await this.e.reply(`[荷花插件] 请先完成两次确认：#荷花迁移重构 -> ${FIRST_CONFIRM}`)
      return true
    }
    pending.delete(key)
    await this.e.reply("[荷花插件] 已收到最终确认，开始迁移。首次初始化可能很久，请不要关闭机器人进程。")

    try {
      const result = await migrateToReFactor({
        oldRoot: resolveOldRoot(),
        onStep: async message => this.e.reply(`[荷花迁移] ${message}`).catch(() => null),
      })
      migrated.set(key, result)
      await this.e.reply([
        "[荷花插件] 重构迁移完成。",
        `新插件目录：${result.newRoot}`,
        `旧插件备份：${result.backupRoot}`,
        `迁移 profile：${result.profileCount}`,
        `初始化警告：${result.warnings.length ? result.warnings.join("；") : "无"}`,
        "",
        `旧插件已移动到 backup，重启后不会继续加载旧插件。确认新插件可用后，可在当前进程退出前发送 ${DELETE_CONFIRM} 删除旧库备份。`,
      ].join("\n"))
    } catch (error) {
      logger?.error?.(`[荷花迁移] 失败：${error.stack || error.message}`)
      await this.e.reply(`[荷花插件] 迁移失败：${error.message}`)
    }
    return true
  }

  async deleteOldBackup() {
    if (!this.ensureMaster()) return true
    const key = String(this.e.user_id || "master")
    const state = migrated.get(key)
    if (!state?.backupRoot) {
      await this.e.reply("[荷花插件] 没有找到本次迁移的旧库备份记录。为避免误删，请手动检查 backup 目录。")
      return true
    }
    try {
      await deleteBackupDirectory(state.backupRoot, state.pluginsRoot)
      migrated.delete(key)
      await this.e.reply(`[荷花插件] 已删除旧库备份：${state.backupRoot}`)
    } catch (error) {
      await this.e.reply(`[荷花插件] 删除旧库备份失败：${error.message}`)
    }
    return true
  }

  ensureMaster() {
    if (this.e?.isMaster === false) {
      this.e.reply("[荷花插件] 只有 bot 主人可以执行迁移。")
      return false
    }
    return true
  }
}

export async function migrateToReFactor(options = {}) {
  const oldRoot = path.resolve(options.oldRoot || resolveOldRoot())
  const pluginsRoot = path.resolve(options.pluginsRoot || path.dirname(oldRoot))
  const stagingRoot = path.resolve(options.stagingRoot || path.join(pluginsRoot, STAGING_NAME))
  const newRoot = path.resolve(options.newRoot || path.join(pluginsRoot, OLD_PLUGIN_NAME))
  const backupRoot = path.resolve(options.backupRoot || path.join(pluginsRoot, BACKUP_DIR_NAME, `${OLD_PLUGIN_NAME}-${timestamp()}`))
  const run = options.runCommand || runCommand
  const onStep = options.onStep || (async () => {})
  const repo = options.repo || REFACTOR_REPO

  assertInside(pluginsRoot, oldRoot, "oldRoot")
  assertInside(pluginsRoot, stagingRoot, "stagingRoot")
  assertInside(pluginsRoot, backupRoot, "backupRoot")
  if (oldRoot !== newRoot) assertInside(pluginsRoot, newRoot, "newRoot")

  const oldIndex = path.join(oldRoot, "index.js")
  await fs.access(oldIndex)

  await onStep("准备新插件临时目录。")
  await safeRm(stagingRoot, pluginsRoot)
  await fs.mkdir(path.dirname(stagingRoot), { recursive: true })

  await onStep("拉取 Lotus-ReFactor。")
  await run(gitBin(), ["clone", "--recurse-submodules", repo, stagingRoot], { cwd: pluginsRoot })
  await run(gitBin(), ["-C", stagingRoot, "submodule", "update", "--init", "--recursive"], { cwd: pluginsRoot })

  await onStep("安装 Node 依赖。")
  await run(corepackBin(), ["pnpm", "install", "--frozen-lockfile"], { cwd: stagingRoot, timeoutMs: 15 * 60 * 1000 })

  await onStep("迁移旧配置。")
  const runtimeMigrator = options.runtimeMigrator || runNewRuntimeMigration
  const migration = await runtimeMigrator({
    run,
    newRoot: stagingRoot,
    oldRoot,
    heavyInit: options.heavyInit !== false,
  })

  await onStep("备份旧插件并启用新插件。")
  await fs.mkdir(path.dirname(backupRoot), { recursive: true })
  if (await exists(newRoot) && newRoot !== oldRoot) {
    throw new Error(`newRoot already exists: ${newRoot}`)
  }
  await fs.rename(oldRoot, backupRoot)
  await fs.rename(stagingRoot, newRoot)

  return {
    ok: true,
    oldRoot,
    pluginsRoot,
    newRoot,
    backupRoot,
    profileCount: migration.profileCount || 0,
    warnings: migration.warnings || [],
  }
}

export async function runNewRuntimeMigration({ run = runCommand, newRoot, oldRoot, heavyInit = true } = {}) {
  const code = `
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { loadGlobalConfig, migrateGlobalConfig, saveGlobalConfig } from "./core/config/global.js";
import { createDefaultProfile, saveProfile } from "./core/config/profile.js";
import { PythonEnvService } from "./services/python/env.js";
import { TestNineEnvService } from "./services/testNine/env.js";
import { ToolInstallerService } from "./services/tools/installer.js";

const oldRoot = process.argv[1];
const heavyInit = process.argv[2] === "true";
const warnings = [];
let profileCount = 0;

await migrateGlobal(oldRoot, warnings);
profileCount = await migrateProfiles(oldRoot, warnings);
if (heavyInit) await initializeRuntime(warnings);

console.log(JSON.stringify({ ok: true, profileCount, warnings }));

async function migrateGlobal(oldRoot, warnings) {
  const file = path.join(oldRoot, "config", "config.yaml");
  const raw = await readYamlMaybe(file);
  if (!raw) {
    await loadGlobalConfig({ createIfMissing: true });
    warnings.push("未找到旧 config/config.yaml，已创建默认全局配置");
    return;
  }
  await saveGlobalConfig(migrateGlobalConfig(raw));
}

async function migrateProfiles(oldRoot, warnings) {
  const dir = path.join(oldRoot, "MihoyoBBSTools", "config");
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      warnings.push("未找到旧 MihoyoBBSTools/config，未迁移 profile");
      return 0;
    }
    throw error;
  }

  let count = 0;
  for (const file of files.filter(name => /^\\d+(?:-\\d+)?\\.ya?ml$/i.test(name))) {
    const old = await readYamlMaybe(path.join(dir, file));
    if (!old) continue;
    const match = file.match(/^(\\d+)(?:-(\\d+))?\\.ya?ml$/i);
    const qq = match[1];
    const profileId = Number(match[2] || 1);
    const profile = createDefaultProfile({ qq, profileId });
    profile.enabled = old.enable !== false;
    profile.account.cookie = String(old.account?.cookie || "");
    profile.account.stuid = String(old.account?.stuid || "");
    profile.account.ltuid = String(old.account?.stuid || old.account?.ltuid || "");
    profile.account.stoken = String(old.account?.stoken || "");
    profile.account.mid = String(old.account?.mid || "");
    profile.device = {
      ...profile.device,
      name: String(old.device?.name || profile.device.name || ""),
      model: String(old.device?.model || profile.device.model || ""),
      id: String(old.device?.id || ""),
      fp: String(old.device?.fp || ""),
      bound: Boolean(old.device?.id || old.device?.fp),
      raw: old.device || null,
    };
    profile.mihoyobbs = mergePlain(profile.mihoyobbs, normalizeBbs(old.mihoyobbs));
    profile.games = mergePlain(profile.games, old.games || {});
    profile.cloud_games = mergePlain(profile.cloud_games, old.cloud_games || {});
    await saveProfile(profile);
    count += 1;
  }
  return count;
}

async function initializeRuntime(warnings) {
  await new PythonEnvService().ensureVenv({ installRequirements: true }).catch(error => {
    warnings.push("Python/MihoyoBBSTools 初始化失败：" + error.message);
  });
  await new TestNineEnvService().ensureEnv({ installRequirements: true, downloadModels: true }).catch(error => {
    warnings.push("test_nine 初始化失败：" + error.message);
  });
  await new ToolInstallerService().ensureAll().then(result => {
    if (!result.ok) warnings.push("工具链部分初始化失败");
  }).catch(error => {
    warnings.push("工具链初始化失败：" + error.message);
  });
}

async function readYamlMaybe(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return YAML.parse(text) || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeBbs(value = {}) {
  return {
    enable: value.enable !== false,
    tasks: {
      checkin: Boolean(value.checkin),
      read: value.read !== false,
      like: value.like !== false,
      cancel_like: value.cancel_like !== false,
      share: value.share !== false,
    },
    checkin_list: Array.isArray(value.checkin_list) ? value.checkin_list : [],
  };
}

function mergePlain(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (!isPlain(base) || !isPlain(patch)) return patch ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in base ? mergePlain(base[key], value) : value;
  }
  return result;
}

function isPlain(value) {
  return value && typeof value === "object" && value.constructor === Object;
}
`
  const result = await run(process.execPath, ["--input-type=module", "-e", code, oldRoot, String(heavyInit)], {
    cwd: newRoot,
    timeoutMs: heavyInit ? 30 * 60 * 1000 : 5 * 60 * 1000,
    redact: true,
  })
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop()
  return JSON.parse(line || "{}")
}

export async function deleteBackupDirectory(backupRoot, pluginsRoot = path.dirname(path.dirname(backupRoot))) {
  const backupDir = path.resolve(pluginsRoot, BACKUP_DIR_NAME)
  const target = path.resolve(backupRoot)
  assertInside(backupDir, target, "backupRoot")
  await fs.rm(target, { recursive: true, force: true })
  return target
}

function resolveOldRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

function gitBin() {
  return process.platform === "win32" ? "git.exe" : "git"
}

function corepackBin() {
  return process.platform === "win32" ? "corepack.cmd" : "corepack"
}

function timestamp() {
  const pad = value => String(value).padStart(2, "0")
  const now = new Date()
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("")
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, Number(options.timeoutMs || 10 * 60 * 1000))
    child.stdout?.on("data", chunk => { stdout += chunk.toString() })
    child.stderr?.on("data", chunk => { stderr += chunk.toString() })
    child.on("error", error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", code => {
      clearTimeout(timer)
      if (code === 0 && !timedOut) {
        resolve({ code, stdout, stderr })
        return
      }
      const error = new Error(`${command} exited with code ${code}${timedOut ? " (timeout)" : ""}: ${redact(stderr || stdout).slice(0, 500)}`)
      error.code = code
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })
  })
}

async function safeRm(target, root) {
  const full = path.resolve(target)
  assertInside(root, full, "target")
  await fs.rm(full, { recursive: true, force: true })
}

function assertInside(root, target, name) {
  const base = path.resolve(root)
  const full = path.resolve(target)
  const relative = path.relative(base, full)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${name} is outside allowed root: ${full}`)
  }
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function redact(value = "") {
  return String(value)
    .replace(/(stoken|cookie|mid|token|secret|SESSDATA)=([^;\s]+)/gi, "$1=***")
    .replace(/(stoken|cookie|mid|token|secret|SESSDATA):\s*([^\s,}]+)/gi, "$1:***")
}
