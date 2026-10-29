#!/usr/bin/env node
// 从上游 skill 仓库（bilibili-douyin-notes）同步 skill 文件到 skill/<name>/，并写 skill.lock.json 记录来源版本
// 用法：node tools/sync-skill.mjs [--source <git 地址或本地仓库路径>] [--ref <分支 / tag / commit>]
import { execFileSync } from 'node:child_process' // 调用 git 拉取上游指定版本
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs' // 复制、清理与写锁文件
import { tmpdir } from 'node:os' // 临时克隆目录放在系统临时区
import { dirname, join, relative, resolve, sep } from 'node:path' // 路径拼接与相对路径计算
import { fileURLToPath } from 'node:url' // 定位本仓库根目录
import { loadSkill } from '../index.js' // 复用插件自身的 SKILL.md 解析，保证同步结果插件一定能加载

/** 本仓库根目录（tools/ 的上一级） */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..') // 与执行目录无关
/** 默认上游仓库 */
export const DEFAULT_SOURCE = 'https://github.com/lucky-Luor/bilibili-douyin-notes.git' // skill 的唯一真源
/** 默认同步的上游版本 */
export const DEFAULT_REF = 'main' // 跟随上游稳定分支

/**
 * 判断上游仓库中的某个相对路径是否属于 skill 运行所需文件（白名单）。
 * 只带走运行时需要的内容；测试、示例、文档图片、CI 配置与任何本地产物都不进插件包。
 * @param {string} rel - 以 / 分隔的相对路径
 * @returns {boolean} 是否需要同步
 */
export function isSkillFile(rel) {
  if (['SKILL.md', 'LICENSE', 'requirements.txt', 'config.example.json'].includes(rel)) return true // 根目录下的必需文件
  if (rel === 'scripts/abogus.py') return false // GPLv3 第三方签名代码，由 ensure_abogus.py 运行时按需下载，不随包分发
  if (/^scripts\/[^/]+\.py$/.test(rel)) return true // scripts/ 顶层的 Python 脚本
  if (/^references\/[^/]+\.(md|json)$/.test(rel)) return true // references/ 下的模板、锚点与词表
  return false // 其余一律不同步（含 config.json、*.env、notes/、work/、uploads/、tests/ 等）
}

/**
 * 递归列出目录下全部文件的相对路径（统一用 / 分隔，跳过 .git）。
 * @param {string} root - 起始目录
 * @returns {string[]} 排序后的相对路径列表
 */
export function listFiles(root) {
  const out = [] // 收集结果
  const walk = dir => { // 深度优先遍历
    for (const entry of readdirSync(dir, { withFileTypes: true })) { // 逐个查看目录项
      if (entry.name === '.git') continue // 跳过 git 元数据
      const full = join(dir, entry.name) // 目录项绝对路径
      if (entry.isDirectory()) walk(full) // 子目录继续向下
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/')) // 文件记录为 / 分隔的相对路径
    }
  }
  walk(root) // 从根目录开始
  return out.sort() // 排序保证锁文件内容稳定
}

/**
 * 把上游指定版本拉到临时目录。
 * 用 init + fetch 而不是 clone，这样 ref 既可以是分支 / tag，也可以是完整 commit。
 * @param {string} source - git 地址或本地仓库路径
 * @param {string} ref - 分支、tag 或 commit
 * @returns {{ dir: string, commit: string }} 临时目录与实际检出的 commit
 */
export function fetchUpstream(source, ref) {
  const remote = existsSync(source) ? resolve(source) : source // 本地路径先转绝对路径，否则 git -C 会按临时目录解析相对路径
  const dir = mkdtempSync(join(tmpdir(), 'dsh-video-notes-sync-')) // 每次同步使用独立临时目录
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim() // 在临时目录执行 git 并返回输出
  try {
    git('init', '-q') // 初始化空仓库
    git('fetch', '-q', '--depth', '1', remote, ref) // 只拉目标版本的一层历史
    git('checkout', '-q', 'FETCH_HEAD') // 检出拉到的版本
    return { dir, commit: git('rev-parse', 'HEAD') } // 返回目录与 commit，供锁文件记录
  } catch (error) {
    rmSync(dir, { recursive: true, force: true }) // 拉取失败时立即清理临时目录，避免残留
    throw error // 继续向上抛出，由命令行入口报错退出
  }
}

/**
 * 把上游工作树中的 skill 文件复制到 skillRoot/<name>/，并写锁文件。
 * @param {{ upstreamDir: string, skillRoot: string, lockPath: string, lock: object }} options - 源目录、目标根目录、锁文件路径与来源信息
 * @returns {{ name: string, files: string[] }} skill 名称与同步的文件列表
 */
export function syncFromDirectory({ upstreamDir, skillRoot, lockPath, lock }) {
  const files = listFiles(upstreamDir).filter(isSkillFile) // 按白名单筛选需要同步的文件
  if (!files.includes('SKILL.md')) throw new Error(`上游目录缺少 SKILL.md：${upstreamDir}`) // 没有 SKILL.md 说明 source/ref 指错了
  const staging = join(skillRoot, '.staging') // 先复制到暂存目录，校验通过后再替换，避免留下半成品
  rmSync(staging, { recursive: true, force: true }) // 清掉上次失败可能残留的暂存目录
  for (const rel of files) { // 逐个复制白名单文件
    const target = join(staging, ...rel.split('/')) // 目标路径
    mkdirSync(dirname(target), { recursive: true }) // 确保父目录存在
    cpSync(join(upstreamDir, ...rel.split('/')), target) // 复制文件内容
  }
  const { name } = loadSkill(staging) // 用插件自身的解析逻辑校验 SKILL.md，失败则抛错中止
  const finalDir = join(skillRoot, name) // 正式目录按 skill 名称命名
  for (const entry of readdirSync(skillRoot)) { // 清理旧的 skill 目录（含改名前的旧目录）
    if (entry !== '.staging' && statSync(join(skillRoot, entry)).isDirectory()) rmSync(join(skillRoot, entry), { recursive: true, force: true }) // 只删目录，保留 skillRoot 下可能存在的说明文件
  }
  cpSync(staging, finalDir, { recursive: true }) // 暂存内容落到正式目录
  rmSync(staging, { recursive: true, force: true }) // 删除暂存目录
  writeFileSync(lockPath, `${JSON.stringify({ ...lock, skill: name, files }, null, 2)}\n`, 'utf8') // 记录来源版本与文件清单
  return { name, files } // 返回结果供调用方打印
}

/**
 * 解析命令行参数。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ source: string, ref: string }} 上游地址与版本
 */
export function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, ref: DEFAULT_REF } // 默认值
  for (let i = 0; i < argv.length; i += 1) { // 逐个读取参数
    const flag = argv[i] // 当前参数名
    if (flag === '--source' || flag === '--ref') { // 只支持这两个带值参数
      const value = argv[i + 1] // 参数值紧跟其后
      if (!value) throw new Error(`${flag} 需要一个值`) // 缺值直接报错
      options[flag.slice(2)] = value // 写回对应字段
      i += 1 // 跳过已消费的参数值
    } else {
      throw new Error(`未知参数：${flag}`) // 拒绝未知参数，避免拼错静默生效
    }
  }
  return options // 返回解析结果
}

/** 命令行入口：拉取上游 → 同步 → 清理临时目录 */
function main() {
  const { source, ref } = parseArgs(process.argv.slice(2)) // 读取参数
  const { dir, commit } = fetchUpstream(source, ref) // 拉取上游指定版本
  try {
    const skillRoot = join(REPO_ROOT, 'skill') // 插件包内的 skill 根目录
    mkdirSync(skillRoot, { recursive: true }) // 首次同步时创建
    const { name, files } = syncFromDirectory({ // 执行同步
      upstreamDir: dir, // 上游工作树
      skillRoot, // 目标根目录
      lockPath: join(REPO_ROOT, 'skill.lock.json'), // 锁文件位置
      lock: { source, ref, commit, syncedAt: new Date().toISOString() }, // 来源信息
    })
    console.log(`已同步 skill「${name}」：${files.length} 个文件，来源 ${source}@${ref}（${commit.slice(0, 7)}）`) // 打印结果摘要
  } finally {
    rmSync(dir, { recursive: true, force: true }) // 无论成功失败都清理临时克隆
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main() // 仅在直接执行时运行，被测试导入时不触发
