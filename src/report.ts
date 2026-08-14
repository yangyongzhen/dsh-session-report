/**
 * Pure session statistics aggregation and Markdown report rendering.
 * No dsh runtime dependency: feed any `SessionEvent[]` and get a cost/usage
 * report card.
 *
 * @module dsh-session-report/report
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';

/** Creation metadata surfaced in the report header. */
export interface ReportMeta {
	sessionId: string;
	createdAt?: number;
	cwd?: string;
	agentPreset?: string;
}

/** Optional per-million-token prices (any currency unit) for cost estimation. */
export interface PriceConfig {
	costPerMInput?: number;
	costPerMOutput?: number;
}

/** Token counters for one scope (whole session or one turn). */
export interface TokenTotals {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/** Per-turn statistics. */
export interface TurnStat {
	turn: number;
	steps: number;
	toolCalls: number;
	tokens: TokenTotals;
	durationMs: number;
	reason?: string;
}

/** The full report data model. */
export interface ReportData {
	model?: string;
	turns: number;
	steps: number;
	toolCalls: number;
	toolErrors: number;
	tokens: TokenTotals;
	durationMs: number;
	startTime?: number;
	endTime?: number;
	cacheHitRate: number;
	turnStats: TurnStat[];
	toolFrequency: Array<{ name: string; count: number }>;
	errors: Array<{ code: string; message: string }>;
	estimatedCost?: number;
}

const REASON_LABEL: Record<string, string> = {
	completed: '完成',
	'max-tokens': '达到输出上限',
	error: '出错',
	aborted: '被中断',
	blocked: '被阻塞',
	interrupted: '被中断（恢复）'
};

function zeroTokens(): TokenTotals {
	return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function addTokens(target: TokenTotals, usage: TokenTotals | undefined): void {
	if (usage === undefined) return;
	target.inputTokens += usage.inputTokens ?? 0;
	target.outputTokens += usage.outputTokens ?? 0;
	target.cacheReadTokens += usage.cacheReadTokens ?? 0;
	target.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
}

function fmtDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const rest = s % 60;
	return h > 0 ? `${h}h ${m}m ${rest}s` : m > 0 ? `${m}m ${rest}s` : `${rest}s`;
}

/**
 * Aggregate session events into report data: totals, per-turn breakdown,
 * tool-call frequency, cache-hit ratio, errors and optional cost estimate.
 */
export function aggregate(events: readonly SessionEvent[], prices?: PriceConfig): ReportData {
	const totals = zeroTokens();
	const toolFrequency = new Map<string, number>();
	const errors: Array<{ code: string; message: string }> = [];
	let turns = 0;
	let steps = 0;
	let toolCalls = 0;
	let toolErrors = 0;
	let model: string | undefined;
	let startTime: number | undefined;
	let endTime: number | undefined;

	let current: TurnStat | undefined;
	let turnStartTime: number | undefined;
	const turnStats: TurnStat[] = [];

	const closeTurn = () => {
		if (current === undefined || turnStartTime === undefined) return;
		current.durationMs = Math.max(0, endTime !== undefined ? endTime - turnStartTime : 0);
		turnStats.push(current);
		current = undefined;
		turnStartTime = undefined;
	};

	for (const event of events) {
		if (startTime === undefined) startTime = event.time;
		endTime = event.time;
		switch (event.type) {
			case 'turn/start': {
				closeTurn();
				turns += 1;
				current = { turn: event.data.turn, steps: 0, toolCalls: 0, tokens: zeroTokens(), durationMs: 0 };
				turnStartTime = event.time;
				break;
			}
			case 'turn/end': {
				if (current !== undefined) current.reason = event.data.reason.kind;
				if (event.data.reason.kind === 'error') {
					toolErrors += 1;
					errors.push({ code: event.data.reason.error.code, message: event.data.reason.error.message });
				}
				break;
			}
			case 'step/start': {
				steps += 1;
				if (current !== undefined) current.steps += 1;
				break;
			}
			case 'tool/call': {
				toolCalls += 1;
				if (current !== undefined) current.toolCalls += 1;
				toolFrequency.set(event.data.name, (toolFrequency.get(event.data.name) ?? 0) + 1);
				break;
			}
			case 'tool/result': {
				if (event.data.error !== undefined) toolErrors += 1;
				break;
			}
			case 'assistant/message': {
				const usage = event.data.usage;
				if (usage === undefined) break;
				const asTokens = {
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
					cacheReadTokens: usage.cacheReadTokens ?? 0,
					cacheWriteTokens: usage.cacheWriteTokens ?? 0
				};
				addTokens(totals, asTokens);
				if (current !== undefined) addTokens(current.tokens, asTokens);
				break;
			}
			case 'request/header': {
				const config = event.data.header.config;
				if (config !== undefined && model === undefined) model = `${config.provider}/${config.model}`;
				break;
			}
			default: break;
		}
	}
	closeTurn();

	// TokenUsage counts are DISJOINT (inputTokens = uncached input only);
	// billed input is the sum of the three, and DeepSeek's cache-hit rate is
	// cacheRead over that billed input.
	const billedInput = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
	const cacheHitRate = billedInput > 0 ? Math.min(1, totals.cacheReadTokens / billedInput) : 0;
	const estimatedCost =
		prices?.costPerMInput !== undefined || prices?.costPerMOutput !== undefined
			? (billedInput / 1_000_000) * (prices.costPerMInput ?? 0) +
				(totals.outputTokens / 1_000_000) * (prices.costPerMOutput ?? 0)
			: undefined;

	return {
		model,
		turns,
		steps,
		toolCalls,
		toolErrors,
		tokens: totals,
		durationMs: startTime !== undefined && endTime !== undefined ? Math.max(0, endTime - startTime) : 0,
		startTime,
		endTime,
		cacheHitRate,
		turnStats,
		toolFrequency: [...toolFrequency.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
		errors,
		estimatedCost
	};
}

function pct(rate: number): string {
	return `${(rate * 100).toFixed(1)}%`;
}

/** Render a report card to Markdown. */
export function renderReport(data: ReportData, meta: ReportMeta): string {
	const out: string[] = [];
	out.push('# 会话成本与耗时报表', '');
	out.push(`- **会话 ID**：\`${meta.sessionId}\``);
	out.push(`- **创建时间**：${meta.createdAt !== undefined ? new Date(meta.createdAt).toISOString() : '-'}`);
	if (meta.cwd !== undefined) out.push(`- **工作目录**：\`${meta.cwd}\``);
	if (meta.agentPreset !== undefined) out.push(`- **Agent 预设**：${meta.agentPreset}`);
	if (data.model !== undefined) out.push(`- **模型**：\`${data.model}\``);
	out.push(`- **总耗时**：${fmtDuration(data.durationMs)}`);
	if (data.estimatedCost !== undefined) out.push(`- **估算成本**：${data.estimatedCost.toFixed(4)}`);
	out.push('');

	out.push('## Token 消耗', '');
	out.push('| 指标 | 数值 |');
	out.push('| --- | --- |');
	out.push(`| 输入 tokens（未缓存） | ${data.tokens.inputTokens} |`);
	out.push(`| 缓存命中（读） | ${data.tokens.cacheReadTokens} |`);
	out.push(`| 缓存写入 | ${data.tokens.cacheWriteTokens} |`);
	out.push(`| 计费输入合计 | ${data.tokens.inputTokens + data.tokens.cacheReadTokens + data.tokens.cacheWriteTokens} |`);
	out.push(`| 输出 tokens | ${data.tokens.outputTokens} |`);
	out.push(`| 缓存命中率 | ${pct(data.cacheHitRate)} |`);
	out.push(`| Turn 数 | ${data.turns} |`);
	out.push(`| Step 数 | ${data.steps} |`);
	out.push(`| 工具调用 | ${data.toolCalls}（出错 ${data.toolErrors}） |`);
	out.push('');

	out.push('## 按 Turn 拆分', '');
	out.push('| Turn | Step | 工具调用 | 输入 | 输出 | 缓存读 | 耗时 | 结果 |');
	out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const turn of data.turnStats) {
		const t = turn.tokens;
		out.push(
			`| ${turn.turn} | ${turn.steps} | ${turn.toolCalls} | ${t.inputTokens} | ${t.outputTokens} | ${t.cacheReadTokens} | ${fmtDuration(turn.durationMs)} | ${turn.reason !== undefined ? (REASON_LABEL[turn.reason] ?? turn.reason) : '-'} |`
		);
	}
	out.push('');

	if (data.toolFrequency.length > 0) {
		out.push('## 工具调用频率', '');
		out.push('| 工具 | 次数 |');
		out.push('| --- | --- |');
		for (const { name, count } of data.toolFrequency) out.push(`| \`${name}\` | ${count} |`);
		out.push('');
	}

	if (data.errors.length > 0) {
		out.push('## 错误记录', '');
		for (const error of data.errors) out.push(`- \`${error.code}\`: ${error.message}`);
		out.push('');
	}

	return out.join('\n');
}
