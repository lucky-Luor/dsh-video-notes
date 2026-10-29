// DeepSeek Harness 插件入口：把随包附带的视频笔记 skill 注册进 DSH 的 skill 注册表
// 只依赖 Node 内置模块，不引入任何 @deepseek-ai/* 包，避免触发 DSH 的 peer 版本硬校验
import { existsSync, readFileSync, readdirSync } from 'node:fs' // 同步读取 skill 目录与 SKILL.md
import { join } from 'node:path' // 拼接 skill 目录下的文件路径
import { fileURLToPath } from 'node:url' // 把 import.meta.url 转成本地文件系统路径

/** Cordis 插件名，DSH 日志与配置层里显示的就是它 */
export const name = 'dsh-video-notes' // 与 npm 包名保持一致，便于排查
/** 依赖 DSH 的 skill 注册表服务（由 @deepseek-ai/dsh-skill 提供，base profile 自带） */
export const inject = ['skills'] // 声明后 Cordis 会等 ctx.skills 就绪再调用 apply

/** 随包附带的 skill 根目录：每个子目录是一个 <name>/SKILL.md 形式的 skill bundle */
export const SKILL_ROOT = fileURLToPath(new URL('./skill/', import.meta.url)) // 以本文件位置定位，安装到哪都能找到

/** skill 名称语法：小写 kebab-case，与 DSH 注册表的校验规则一致 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // 提前校验，给出比注册表更直观的报错

/**
 * 解析布尔型 frontmatter 取值，口径与 DSH 文件系统提供方一致。
 * @param {string | undefined} raw - frontmatter 原始字符串；缺省表示未声明
 * @param {string} key - 字段名，仅用于报错信息
 * @returns {boolean | undefined} 解析结果；未声明返回 undefined
 */
function parseBoolean(raw, key) {
  if (raw === undefined) return undefined // 未声明时交给调用方使用默认值
  const value = raw.toLowerCase() // 不区分大小写
  if (['true', 'yes', 'on', '1'].includes(value)) return true // 真值的几种合法拼写
  if (['false', 'no', 'off', '0'].includes(value)) return false // 假值的几种合法拼写
  throw new Error(`frontmatter 字段 ${key} 的取值无效：${raw}`) // 非法拼写直接失败，不静默放行
}

/**
 * 去掉 YAML 标量两侧成对的引号。
 * @param {string} value - 已去除首尾空白的标量文本
 * @returns {string} 去引号后的文本
 */
function unquote(value) {
  const first = value[0] // 取首字符判断是否带引号
  if (value.length >= 2 && (first === '"' || first === "'") && value.at(-1) === first) {
    return value.slice(1, -1) // 成对引号才剥离，避免误伤正文里的引号
  }
  return value // 无引号原样返回
}

/**
 * 解析 SKILL.md：拆出顶层 `key: value` 形式的 frontmatter 与正文。
 * 本仓库的 SKILL.md 只用单行标量字段，不需要完整 YAML 解析器。
 * @param {string} text - SKILL.md 全文
 * @returns {{ meta: Record<string, string>, content: string }} frontmatter 字段与正文
 */
export function parseSkillFile(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') // 去 BOM 并统一换行符，兼容 Windows 编辑过的文件
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized) // 匹配文件开头的 frontmatter 块
  if (match === null) throw new Error('SKILL.md 缺少 YAML frontmatter') // 没有 frontmatter 无法得到名称与描述
  const meta = {} // 收集解析出的字段
  for (const line of match[1].split('\n')) { // 逐行处理 frontmatter
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line) // 只认顶层（无缩进）的 key: value 行
    if (field === null) continue // 空行、注释、嵌套结构一律跳过
    meta[field[1]] = unquote(field[2].trim()) // 记录去空白、去引号后的取值
  }
  return { meta, content: normalized.slice(match[0].length).replace(/^\n+/, '') } // 正文去掉 frontmatter 与开头空行
}

/**
 * 把一个 skill 目录转换成 ctx.skills.register() 接受的注册对象。
 * @param {string} dir - skill 目录绝对路径（目录内含 SKILL.md）
 * @returns {object} SkillRegistration：名称、描述、正文、资源目录等
 */
export function loadSkill(dir) {
  const path = join(dir, 'SKILL.md') // 指令文件的绝对路径，供 DSH 做文件预览
  const { meta, content } = parseSkillFile(readFileSync(path, 'utf8')) // 读取并拆分 SKILL.md
  if (!SKILL_NAME.test(meta.name ?? '')) throw new Error(`${path} 的 name 不是合法的 kebab-case：${meta.name}`) // 名称不合法时尽早报错
  if (!meta.description) throw new Error(`${path} 缺少 description`) // 描述是模型路由的依据，必须有
  const modelInvocable = parseBoolean(meta['disable-model-invocation'], 'disable-model-invocation') !== true // 未声明即允许模型调用
  const userInvocable = parseBoolean(meta['user-invocable'], 'user-invocable') !== false // 未声明即允许用户手动调用
  return {
    name: meta.name, // skill 标识，模型按它加载
    description: meta.description, // 路由描述，出现在会话的 skill 目录里
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}), // 可选的额外路由提示，有才带上
    invocation: { modelInvocable, userInvocable }, // 模型 / 用户两个入口的调用策略
    source: 'bundled', // 来源标签：随插件包附带
    path, // 指令文件路径
    resourceBase: { kind: 'directory', path: dir }, // 关键：模型加载时会看到 skill 目录，据此拼出 scripts/*.py 的真实路径
    content, // 指令正文；注册时读一次，插件升级后重启 profile 即生效
  }
}

/**
 * 扫描 skill 根目录，加载其中每个 <name>/SKILL.md。
 * @param {string} [root] - skill 根目录，默认随包附带的 skill/
 * @returns {object[]} 按目录名排序的注册对象列表
 */
export function loadSkills(root = SKILL_ROOT) {
  return readdirSync(root, { withFileTypes: true }) // 列出根目录下的条目
    .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md'))) // 只要含 SKILL.md 的子目录
    .map(entry => entry.name) // 取目录名
    .sort() // 排序保证注册顺序稳定
    .map(dirName => loadSkill(join(root, dirName))) // 逐个转换成注册对象
}

/**
 * Cordis 插件入口：把随包 skill 注册进 ctx.skills。
 * register() 返回的释放函数已绑定到当前插件生命周期，插件卸载时自动注销，无需手动处理。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文（类型仅用于注释，运行时不导入）
 */
export function apply(ctx) {
  for (const skill of loadSkills()) { // 遍历随包附带的全部 skill
    ctx.skills.register(skill) // 注册为运行时 skill（provider 省略，由注册表使用保留的 runtime 提供方）
    ctx.logger?.info?.(`已注册 skill：${skill.name}（目录 ${skill.resourceBase.path}）`) // 启动日志里留痕，方便确认插件生效
  }
}
