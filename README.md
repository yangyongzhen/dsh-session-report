# dsh-session-report

DeepSeek Harness 会话成本与耗时复盘报表插件：turn 结束后生成 Markdown 报表卡——token 消耗（含缓存命中率）、按 turn 拆分、工具调用频率、错误记录、可选成本估算。

与 [dsh-session-export](https://github.com/yangyongzhen/dsh-session-export)（对话导出）互补：导出看**内容**，报表看**数字**。

- 监听 `session/event` 事件流，`turn/end` 后防抖 `debounceMs` 生成报表
- 输出 `$DSH_HOME/reports/report-<id>.md`（默认 `~/.dsh/reports/`）
- 缓存命中率按 DeepSeek 口径：`cacheRead / (未缓存输入 + 缓存读 + 缓存写)`
- 配置单价后自动估算成本（计费输入 = 三项之和）
- 进程退出时同步 flush（headless 一次性任务不丢报表）

## 安装

```sh
# 本地 checkout 安装
dsh plugin --profile <web|tui|headless> add file:/path/to/dsh-session-report

# 或从 Git 仓库安装
dsh plugin --profile <web|tui|headless> add https://gitcode.com/qq8864/dsh-session-report.git
```

## 配置

```yaml
- id: report
  config:
    enabled: true
    outDir: ~/reports        # 报表目录，默认 $DSH_HOME/reports
    debounceMs: 1000         # turn/end 后的静默等待
    costPerMInput: 1.2       # 可选：每百万输入 token 价格（元），配置后估算成本
    costPerMOutput: 4.0      # 可选：每百万输出 token 价格（元）
```

价格单位任意（元/美元/分），按"每百万 token"填写；不配置则不显示成本。

## 报表样例

```markdown
# 会话成本与耗时报表

- **会话 ID**：`session-29487994-...`  ·  **模型**：`deepseek-official/deepseek-v4-flash`
- **总耗时**：2s  ·  **估算成本**：0.0105

## Token 消耗
| 输入 tokens（未缓存） | 6322 |
| 缓存命中（读） | 1920 |
| 计费输入合计 | 8242 |
| 缓存命中率 | 23.3% |

## 按 Turn 拆分
| Turn | Step | 工具调用 | 输入 | 输出 | 缓存读 | 耗时 | 结果 |
| 1 | 1 | 0 | 6322 | 156 | 1920 | 2s | 完成 |

## 工具调用频率
| `pwsh` | 2 |
| `glob` | 1 |
```

## 口径说明

dsh 的 `TokenUsage` 计数是**不相交**的：`inputTokens` 只含未缓存输入，缓存命中/写入分开报。因此：

- 计费输入 = inputTokens + cacheReadTokens + cacheWriteTokens
- 缓存命中率 = cacheReadTokens / 计费输入（DeepSeek 口径，clamp 到 0–100%）
- 成本估算按计费输入计算

## 开发

```sh
pnpm install
pnpm run build        # tsc -> lib/
```

端到端验证：

```sh
dsh plugin --profile headless add file:./
dsh --profile headless --patch ./test/report-patch.yml "一句话介绍你自己"
cat ~/.dsh/reports/*.md
```
