# dsh-credentials-keychain

[中文](#中文) | English

macOS Keychain credentials provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

The stock file-backed provider (`dsh-credentials-local`) stores secrets in `~/.dsh/.credentials.yaml` with `0600` permissions. As its own README states frankly: that file is protected from other OS users, **but not from the model** — tool processes (bash, filesystem tools) run as the same user and can read it like any other file.

This provider moves secrets into the macOS login keychain, which the agent's child processes cannot enumerate or read without an interactive unlock. It answers the extension point the Harness README explicitly reserves: *"the OS keychain provider … is the deferred answer."*

## Requirements

- macOS (`/usr/bin/security`)
- DeepSeek Harness ≥ 0.1.0-rc.6
- Node `^22.19 || >=24`

## Install

```sh
dsh plugin --profile headless add github:SummerXaa-Z/dsh-credentials-keychain
```

(npm package coming once registry 2FA bootstrap is sorted — the CLI publish flow currently requires TOTP, and npm no longer enrolls new TOTP devices.)

Then swap the credentials provider in your patch layer (`~/.dsh/cordis.patch.yml` or `--patch <file>`):

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-keychain
      name: dsh-credentials-keychain
      # optional config:
      # config:
      #   service: dsh-credentials   # keychain service name
```

## Usage

Store a secret (account = credential reference name):

```sh
security add-generic-password -U -s dsh-credentials -a ARK_API_KEY -w 'sk-…'
```

The LLM adapter resolves the reference per request — no restart needed after rotation.

Semantics kept from the seam contract:

- Process environment shadows the keychain (per-run operator intent wins).
- An empty stored value counts as absent.
- `set` rejects while a read-only source (the environment) shadows the ref.
- `describe` checks existence **without reading the value** — a status query never pulls plaintext into the agent process.
- Errors from the `security` CLI are sanitized: exit code and stderr only, never the command line (which would carry the secret on a failed `set`).

## Known limitations

- **`set` passes the secret via `argv`.** The `security` CLI has no stdin channel for `add-generic-password`, so the value is briefly visible to same-user processes running `ps` during the write (milliseconds). This is a macOS tooling constraint, not a design choice — the same is true of the manual `security add-generic-password -w` workflow. Secrets at rest are never in argv; only writes are.
- A locked keychain surfaces as an interactive unlock prompt to the GUI user; headless runs time out after 10s with a sanitized error.

## Verified behavior (0.1.0-rc.6)

- Positive: with the file credential removed, model requests authenticate via the keychain entry alone.
- Negative: deleting the keychain entry produces `MISSING_CREDENTIAL` naming the correct reference — no silent degradation.
- Seam semantics: env shadowing wins and blocks `set`; empty values rejected; `unset` on an absent ref is a silent no-op (no change event).

## Roadmap

- Linux (libsecret) and Windows (Credential Manager) backends — PRs welcome.
- The plugin currently works as a plain profile dependency; a `dsh.bundle` manifest for zero-patch activation is planned.

## License

MIT

---

## 中文

DeepSeek Harness（dsh）的 macOS 钥匙串凭据 provider。

自带的文件型 provider 把机密存在 `~/.dsh/.credentials.yaml`（0600）。其 README 自己承认：这个文件防得住其他 OS 用户，**防不住模型**——工具进程（bash、文件系统工具）以同一用户身份运行，读它与读任何用户文件没有区别。

本插件把机密移进 macOS 登录钥匙串，agent 的子进程无法在非交互情况下枚举或读取。它回应的正是 Harness README 明示预留的扩展点："OS 钥匙串提供方是延后的答案"。

### 安装

```sh
dsh plugin --profile headless add github:SummerXaa-Z/dsh-credentials-keychain
```

（npm 包待发：registry 发布流程强制 TOTP，而 npm 已停止新 TOTP 设备绑定。）

然后在补丁层（`~/.dsh/cordis.patch.yml` 或 `--patch <文件>`）替换凭据 provider：

```yaml
- id: credentials
  disabled: true
- insert:
    - id: credentials-keychain
      name: dsh-credentials-keychain
```

### 使用

存入机密（account = 凭据引用名）：

```sh
security add-generic-password -U -s dsh-credentials -a ARK_API_KEY -w 'sk-…'
```

LLM 适配器每次请求解析一次引用，轮换后无需重启。

保留 seam 原生语义：进程环境遮蔽钥匙串（按次操作意图优先）；空值等于不存在；只读源遮蔽时 `set` 拒绝。

补充两条实现保证：`describe` 只查存在性**不读取值**，状态查询不会把明文拉进 agent 进程；`security` CLI 报错经过脱敏，只带退出码和 stderr，绝不带命令行（否则 `set` 失败会把密钥带进错误消息）。

### 已知限制

- **`set` 的密钥走 argv。** `security` CLI 没有 stdin 传密码的通道，写入瞬间（毫秒级）同用户进程 `ps` 可见。这是 macOS 工具本身的限制，手工 `security add-generic-password -w` 同样如此；静态存储的密钥从不上 argv，只有写入操作。
- 钥匙串锁定会向 GUI 用户弹解锁框；无头运行 10 秒超时，报脱敏错误。

### 已验证行为（0.1.0-rc.6）

- 正向：移除文件凭据后，模型请求仅经钥匙串条目完成认证。
- 负向：删除钥匙串条目后报 `MISSING_CREDENTIAL` 且引用名正确，无静默降级。
- seam 语义：环境遮蔽生效且拒绝 `set`；空值拒绝；对不存在的条目 `unset` 是静默无操作（不发变更事件）。

### 许可

MIT
