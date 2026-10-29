<div align="center">

# dsh-video-notes

**A DeepSeek Harness (DSH) plugin that turns Bilibili / Douyin / YouTube / Xiaohongshu videos into Markdown class notes**

Subtitles · local ASR · key-frame screenshots · note template · quality gates — no login required, no paid API

[简体中文](README.md) | English

</div>

This plugin packages the skill [bilibili-douyin-notes](https://github.com/lucky-Luor/bilibili-douyin-notes) as a DSH bundle. Once installed, just tell the agent in DSH:

> Turn this video into class notes: https://www.bilibili.com/video/BVxxxx

The agent then follows the skill workflow (fetch subtitles or run ASR, capture key frames) and writes a Markdown note. See the [upstream repository](https://github.com/lucky-Luor/bilibili-douyin-notes) for features and per-platform details.

## How it works

- On startup the plugin reads `skill/bilibili-douyin-notes/SKILL.md` from the package and registers it through DSH's `ctx.skills.register()`.
- The registration carries the skill directory as `resourceBase`. When the model loads the skill it sees `Base directory for this skill: …` and resolves `scripts/*.py` against it — that directory is the `<skill安装目录>` placeholder used in SKILL.md.
- The plugin uses Node built-ins only: no `@deepseek-ai/*` dependency (so no DSH peer-version gate) and no build step (so GitHub installs need no `allowBuilds` approval).

## Install

Requirements: Node.js ≥ 20, Python ≥ 3.10, a working DSH (`npx @deepseek-ai/dsh`).

```bash
# 1. Install the plugin into the DSH web profile (replace "web" for other profiles)
npx -y @deepseek-ai/dsh plugin --profile web add github:lucky-Luor/dsh-video-notes

# 2. Install Python dependencies (pick what you need; see comments in the file)
pip install -r https://raw.githubusercontent.com/lucky-Luor/dsh-video-notes/main/skill/bilibili-douyin-notes/requirements.txt

# 3. Restart the profile so the plugin is loaded
npx -y @deepseek-ai/dsh web
```

- For YouTube links, also install [deno](https://deno.com) (needed by yt-dlp for JS challenges).
- Pin a version: `add github:lucky-Luor/dsh-video-notes#<tag or commit>`.
- Verify: `npx -y @deepseek-ai/dsh --profile web --dump-config` shows a `dsh-video-notes` layer.
- Uninstall: `npx -y @deepseek-ai/dsh plugin --profile web remove dsh-video-notes`.

## Configuration and credentials (read before upgrading)

The skill's `config.json` (Bilibili SESSDATA, Xiaohongshu cookie, ASR options; see `config.example.json`) lives in the **skill directory** — the Base directory shown when the skill loads, usually:

```
$DSH_HOME/profiles/<profile>/node_modules/dsh-video-notes/skill/bilibili-douyin-notes/
```

(`$DSH_HOME` defaults to `~/.dsh`.) Bilibili QR login writes there too:

```bash
python "<skill dir>/scripts/bili_fetch.py" --login
```

> ⚠️ **Known limitation**: this directory is inside the profile's `node_modules`, so **`config.json` is lost when the plugin is upgraded, reinstalled or removed**. Back it up before upgrading and put it back afterwards, or simply log in again with `--login` / re-fill the config. `config.json` holds login credentials — never share it.

## Relationship with the upstream skill

| Repository | Contents |
|---|---|
| [bilibili-douyin-notes](https://github.com/lucky-Luor/bilibili-douyin-notes) | Single source of truth: SKILL.md, Python scripts, templates, tests. Used directly by Claude Code, ZCode, Codex, … |
| dsh-video-notes (this repo) | DSH plugin shell + a synced copy of the skill; `skill.lock.json` records the upstream commit |

Do not edit files under `skill/` directly — change them upstream and sync.

## Maintenance

```bash
# Sync the skill from upstream (defaults to main; tags/commits and local paths via --source also work)
npm run sync-skill -- --ref main

# Run tests (also checks that skill/ matches skill.lock.json)
npm test

# Inspect the publish manifest (must not contain config.json, *.env, abogus.py)
npm pack --dry-run
```

`scripts/abogus.py` (Douyin signing, GPLv3) is not shipped; `ensure_abogus.py` downloads it on first use.

## License

[MIT](LICENSE)
