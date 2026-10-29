// 插件入口测试：SKILL.md 解析、随包 skill 加载、apply() 向 ctx.skills 注册
import { test } from 'node:test' // Node 内置测试框架，无需额外依赖
import assert from 'node:assert/strict' // 严格断言
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs' // 构造临时 skill 目录
import { tmpdir } from 'node:os' // 临时目录位置
import { join } from 'node:path' // 路径拼接
import * as plugin from '../index.js' // 被测插件模块

test('插件元信息：名称与依赖服务', () => {
  assert.equal(plugin.name, 'dsh-video-notes') // 插件名与包名一致
  assert.deepEqual(plugin.inject, ['skills']) // 只依赖 skill 注册表
})

test('随包 skill 可加载，字段满足 DSH 注册要求', () => {
  const skills = plugin.loadSkills() // 加载 skill/ 下全部 skill
  assert.equal(skills.length, 1) // 当前只附带一个 skill
  const [skill] = skills // 取出该 skill
  assert.equal(skill.name, 'bilibili-douyin-notes') // 名称与上游 SKILL.md 一致
  assert.match(skill.description, /小红书/) // 描述覆盖四个平台（以小红书为代表抽查）
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true }) // 默认允许模型与用户调用
  assert.equal(skill.source, 'bundled') // 来源标签
  assert.equal(skill.provider, undefined) // 不自定义 provider，交给注册表的 runtime 提供方
  assert.equal(skill.resourceBase.kind, 'directory') // 资源基准是目录
  assert.ok(existsSync(join(skill.resourceBase.path, 'scripts', 'bili_fetch.py'))) // 模型据此能找到脚本
  assert.ok(existsSync(skill.path)) // 指令文件路径真实存在
  assert.ok(!skill.content.startsWith('---')) // 正文已去掉 frontmatter
  assert.match(skill.content, /^# /) // 正文以一级标题开头
})

test('apply() 把每个 skill 注册到 ctx.skills 并写日志', () => {
  const registered = [] // 记录注册调用
  const logs = [] // 记录日志
  const ctx = { // 模拟 Cordis 上下文，只提供用到的成员
    skills: { register: skill => { registered.push(skill); return () => {} } }, // 模拟注册表，返回空释放函数
    logger: { info: message => logs.push(message) }, // 模拟日志
  }
  plugin.apply(ctx) // 执行插件入口
  assert.deepEqual(registered.map(skill => skill.name), ['bilibili-douyin-notes']) // 注册了随包 skill
  assert.equal(logs.length, 1) // 每个 skill 一条日志
})

test('apply() 在没有 logger 时也能正常注册', () => {
  let count = 0 // 注册次数
  plugin.apply({ skills: { register: () => { count += 1 } } }) // 不提供 logger
  assert.equal(count, 1) // 仍然完成注册
})

test('parseSkillFile：兼容 BOM、CRLF 与引号', () => {
  const text = '﻿---\r\nname: demo-skill\r\ndescription: "带: 冒号的描述"\r\n---\r\n\r\n# 标题\r\n正文\r\n' // 构造 Windows 风格文件
  const { meta, content } = plugin.parseSkillFile(text) // 解析
  assert.equal(meta.name, 'demo-skill') // 名称正确
  assert.equal(meta.description, '带: 冒号的描述') // 引号被剥离，冒号保留
  assert.equal(content, '# 标题\n正文\n') // 正文换行统一为 LF
})

test('parseSkillFile：缺少 frontmatter 时报错', () => {
  assert.throws(() => plugin.parseSkillFile('# 没有 frontmatter'), /frontmatter/) // 明确提示缺 frontmatter
})

/**
 * 在临时目录写一个 SKILL.md 并加载。
 * @param {string} frontmatter - frontmatter 内容（不含 --- 分隔线）
 * @returns {object} loadSkill 的结果
 */
function loadFixture(frontmatter) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-video-notes-test-')) // 独立临时目录
  try {
    writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n# 正文\n`, 'utf8') // 写入测试用 SKILL.md
    return plugin.loadSkill(dir) // 加载
  } finally {
    rmSync(dir, { recursive: true, force: true }) // 清理临时目录
  }
}

test('loadSkill：调用策略字段按 DSH 口径解析', () => {
  const skill = loadFixture('name: demo-skill\ndescription: d\ndisable-model-invocation: yes\nuser-invocable: off') // 两个开关都关闭
  assert.deepEqual(skill.invocation, { modelInvocable: false, userInvocable: false }) // 两个入口都被排除
})

test('loadSkill：非法名称、缺描述、非法布尔值都会报错', () => {
  assert.throws(() => loadFixture('name: Bad_Name\ndescription: d'), /kebab-case/) // 名称不合法
  assert.throws(() => loadFixture('name: demo-skill'), /description/) // 缺少描述
  assert.throws(() => loadFixture('name: demo-skill\ndescription: d\nuser-invocable: maybe'), /取值无效/) // 布尔值拼写非法
})

test('loadSkills：忽略不含 SKILL.md 的目录与普通文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-video-notes-root-')) // 临时 skill 根目录
  try {
    mkdirSync(join(root, 'empty-dir')) // 不含 SKILL.md 的目录
    writeFileSync(join(root, 'README.md'), '说明', 'utf8') // 普通文件
    mkdirSync(join(root, 'b-skill')) // 第二个 skill（按名称排序应排在后面）
    writeFileSync(join(root, 'b-skill', 'SKILL.md'), '---\nname: b-skill\ndescription: b\n---\n# b\n', 'utf8') // 写入 b-skill
    mkdirSync(join(root, 'a-skill')) // 第一个 skill
    writeFileSync(join(root, 'a-skill', 'SKILL.md'), '---\nname: a-skill\ndescription: a\n---\n# a\n', 'utf8') // 写入 a-skill
    assert.deepEqual(plugin.loadSkills(root).map(skill => skill.name), ['a-skill', 'b-skill']) // 只加载两个 skill，且顺序稳定
  } finally {
    rmSync(root, { recursive: true, force: true }) // 清理
  }
})
