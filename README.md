<div align="center">

# dsh-video-notes

**DeepSeek Harness（DSH）插件：把 B站 / 抖音 / YouTube / 小红书视频整理成 Markdown 课堂笔记**

字幕抓取 · 本地语音识别 · 重点截图 · 笔记模板 · 质量门禁 —— 免登录可用，不调任何付费 API

简体中文 | [English](README_EN.md)

</div>

本插件把 skill [bilibili-douyin-notes](https://github.com/lucky-Luor/bilibili-douyin-notes) 打包成 DSH 组合包。装好后，在 DSH 里对 Agent 说一句：

> 帮我把这个视频做成课堂笔记：https://www.bilibili.com/video/BVxxxx

Agent 就会按 skill 的流程抓字幕或做语音识别、截取重点画面，生成课堂笔记 `.md`。功能细节、笔记效果和各平台说明见[上游仓库](https://github.com/lucky-Luor/bilibili-douyin-notes)。

## 工作原理

- 插件启动时读取包内的 `skill/bilibili-douyin-notes/SKILL.md`，通过 DSH 官方的 `ctx.skills.register()` 注册成 skill。
- 注册时带上 skill 目录（`resourceBase`）。模型加载 skill 时会看到 `Base directory for this skill: …`，据此拼出 `scripts/*.py` 的真实路径，SKILL.md 里的 `<skill安装目录>` 就是这个目录。
- 插件只用 Node 内置模块，不依赖任何 `@deepseek-ai/*` 包，也没有构建步骤：不会触发 DSH 的 peer 版本校验，从 GitHub 安装也不需要给 `allowBuilds` 授权。

## 安装

前置条件：Node.js ≥ 20、Python ≥ 3.10、已能运行 DSH（`npx @deepseek-ai/dsh`）。

```bash
# 1. 安装插件到 DSH 的 web profile（其他 profile 把 web 换成对应名称）
npx -y @deepseek-ai/dsh plugin --profile web add github:lucky-Luor/dsh-video-notes

# 2. 安装 Python 依赖（按需：各平台所需依赖见文件内注释）
pip install -r https://raw.githubusercontent.com/lucky-Luor/dsh-video-notes/main/skill/bilibili-douyin-notes/requirements.txt

# 3. 重启 profile，使插件生效
npx -y @deepseek-ai/dsh web
```

- YouTube 链接建议另外安装 [deno](https://deno.com)（yt-dlp 解 JS 挑战需要）。
- 锁定版本安装：`add github:lucky-Luor/dsh-video-notes#<tag 或 commit>`。
- 确认插件已加载：`npx -y @deepseek-ai/dsh --profile web --dump-config` 的输出里能看到 `dsh-video-notes` 这一层。
- 卸载：`npx -y @deepseek-ai/dsh plugin --profile web remove dsh-video-notes`。

## 配置与凭据（升级前必读）

skill 的配置文件 `config.json`（B站 SESSDATA、小红书 cookie、ASR 参数等，字段见 `config.example.json`）位于 **skill 目录**下，也就是 Agent 加载 skill 时给出的 Base directory，一般是：

```
$DSH_HOME/profiles/<profile>/node_modules/dsh-video-notes/skill/bilibili-douyin-notes/
```

（`$DSH_HOME` 默认为 `~/.dsh`。）B站扫码登录同样写入这里：

```bash
python "<skill目录>/scripts/bili_fetch.py" --login
```

> ⚠️ **已知限制**：这个目录在 DSH profile 的 `node_modules` 里，**插件升级、重装或卸载后 `config.json` 会丢失**。升级前请先备份 `config.json`，升级后放回原处；或者升级后重新执行一次 `--login` 扫码登录、重新填写配置。`config.json` 含登录凭据，请勿分享。

## 与上游 skill 的关系

| 仓库 | 内容 |
|---|---|
| [bilibili-douyin-notes](https://github.com/lucky-Luor/bilibili-douyin-notes) | skill 的唯一真源：SKILL.md、Python 脚本、模板、测试。Claude Code、ZCode、Codex 等直接克隆它使用 |
| dsh-video-notes（本仓库） | DSH 插件外壳 + 从上游同步来的 skill 副本，`skill.lock.json` 记录副本对应的上游 commit |

请不要直接修改 `skill/` 下的文件，改动应提交到上游仓库，再同步过来。

## 维护

```bash
# 从上游同步 skill（默认 main，可指定 tag 或 commit；--source 也可以是本地仓库路径）
npm run sync-skill -- --ref main

# 运行测试（同时校验 skill/ 副本与 skill.lock.json 一致）
npm test

# 检查发布清单（不应包含 config.json、*.env、abogus.py）
npm pack --dry-run
```

`scripts/abogus.py`（抖音签名算法，GPLv3）不随包分发，由 `ensure_abogus.py` 首次使用时按需下载。

## 许可

[MIT](LICENSE)
