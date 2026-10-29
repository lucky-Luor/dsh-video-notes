// 同步脚本测试：白名单筛选、目录同步与锁文件、参数解析、随包副本与锁文件一致性
import { test } from 'node:test' // Node 内置测试框架
import assert from 'node:assert/strict' // 严格断言
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs' // 构造临时上游目录
import { tmpdir } from 'node:os' // 临时目录位置
import { dirname, join } from 'node:path' // 路径拼接
import { DEFAULT_REF, DEFAULT_SOURCE, REPO_ROOT, isSkillFile, listFiles, parseArgs, syncFromDirectory } from '../tools/sync-skill.mjs' // 被测函数

test('isSkillFile：只放行 skill 运行所需文件', () => {
  for (const rel of ['SKILL.md', 'LICENSE', 'requirements.txt', 'config.example.json', 'scripts/bili_fetch.py', 'references/note-template.md', 'references/anchors.json']) {
    assert.ok(isSkillFile(rel), rel) // 运行所需文件全部放行
  }
  for (const rel of ['config.json', 'scripts/abogus.py', '个人.env', '.env.local', 'notes/a.md', 'work/x.py', 'uploads/a.png', 'tests/test_a.py', 'README.md', 'scripts/__pycache__/a.pyc', 'scripts/sub/a.py', 'docs/images/a.png']) {
    assert.ok(!isSkillFile(rel), rel) // 凭据、第三方 GPL 代码、个人产物与开发文件全部拦截
  }
})

/**
 * 在目录下写一个文件（自动创建父目录）。
 * @param {string} root - 根目录
 * @param {string} rel - 以 / 分隔的相对路径
 * @param {string} content - 文件内容
 */
function put(root, rel, content) {
  const target = join(root, ...rel.split('/')) // 目标路径
  mkdirSync(dirname(target), { recursive: true }) // 创建父目录
  writeFileSync(target, content, 'utf8') // 写入内容
}

test('syncFromDirectory：按白名单复制、替换旧目录并写锁文件', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-video-notes-sync-test-')) // 测试用临时根
  try {
    const upstream = join(base, 'upstream') // 模拟上游工作树
    put(upstream, 'SKILL.md', '---\nname: demo-skill\ndescription: d\n---\n# 正文\n') // skill 指令
    put(upstream, 'scripts/run.py', 'print(1)\n') // 需要同步的脚本
    put(upstream, 'scripts/abogus.py', '# GPL\n') // 不应同步的第三方代码
    put(upstream, 'config.json', '{"SESSDATA":"secret"}') // 不应同步的凭据
    put(upstream, 'tests/test_run.py', 'pass\n') // 不应同步的测试
    put(upstream, '.git/HEAD', 'ref\n') // git 元数据应被跳过
    const skillRoot = join(base, 'skill') // 插件包内 skill 根目录
    put(skillRoot, 'old-name/SKILL.md', '旧目录') // 模拟改名前遗留的旧目录
    const lockPath = join(base, 'skill.lock.json') // 锁文件
    const result = syncFromDirectory({ upstreamDir: upstream, skillRoot, lockPath, lock: { source: 's', ref: 'r', commit: 'c' } }) // 执行同步
    assert.equal(result.name, 'demo-skill') // 按 SKILL.md 名称命名目录
    assert.deepEqual(listFiles(join(skillRoot, 'demo-skill')), ['SKILL.md', 'scripts/run.py']) // 只有白名单文件
    assert.ok(!existsSync(join(skillRoot, 'old-name'))) // 旧目录被清理
    assert.ok(!existsSync(join(skillRoot, '.staging'))) // 暂存目录被删除
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) // 读取锁文件
    assert.deepEqual(lock, { source: 's', ref: 'r', commit: 'c', skill: 'demo-skill', files: ['SKILL.md', 'scripts/run.py'] }) // 来源与清单完整
  } finally {
    rmSync(base, { recursive: true, force: true }) // 清理
  }
})

test('syncFromDirectory：上游缺少 SKILL.md 时报错且不改动目标目录', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-video-notes-sync-test-')) // 测试用临时根
  try {
    put(base, 'upstream/scripts/run.py', 'print(1)\n') // 上游没有 SKILL.md
    put(base, 'skill/keep-me/SKILL.md', '保留') // 已有的 skill 目录
    assert.throws(() => syncFromDirectory({ upstreamDir: join(base, 'upstream'), skillRoot: join(base, 'skill'), lockPath: join(base, 'lock.json'), lock: {} }), /SKILL\.md/) // 明确报错
    assert.ok(existsSync(join(base, 'skill', 'keep-me', 'SKILL.md'))) // 已有内容不受影响
    assert.ok(!existsSync(join(base, 'lock.json'))) // 不写锁文件
  } finally {
    rmSync(base, { recursive: true, force: true }) // 清理
  }
})

test('parseArgs：默认值、覆盖与非法参数', () => {
  assert.deepEqual(parseArgs([]), { source: DEFAULT_SOURCE, ref: DEFAULT_REF }) // 默认同步上游 main
  assert.deepEqual(parseArgs(['--source', '../up', '--ref', 'v1.0.0']), { source: '../up', ref: 'v1.0.0' }) // 两个参数都可覆盖
  assert.throws(() => parseArgs(['--ref']), /需要一个值/) // 缺值报错
  assert.throws(() => parseArgs(['--branch', 'x']), /未知参数/) // 未知参数报错
})

test('随包 skill 副本与 skill.lock.json 完全一致（防止手改副本）', () => {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'skill.lock.json'), 'utf8')) // 读取锁文件
  assert.match(lock.commit, /^[0-9a-f]{40}$/) // 记录了完整 commit
  const actual = listFiles(join(REPO_ROOT, 'skill', lock.skill)).filter(rel => !rel.includes('__pycache__') && rel !== 'config.json' && rel !== 'scripts/abogus.py') // 忽略运行时可能生成的本地文件
  assert.deepEqual(actual, lock.files) // 文件清单与锁文件一致
})
