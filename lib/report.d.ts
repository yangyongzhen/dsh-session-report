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
    toolFrequency: Array<{
        name: string;
        count: number;
    }>;
    errors: Array<{
        code: string;
        message: string;
    }>;
    estimatedCost?: number;
}
/**
 * Aggregate session events into report data: totals, per-turn breakdown,
 * tool-call frequency, cache-hit ratio, errors and optional cost estimate.
 */
export declare function aggregate(events: readonly SessionEvent[], prices?: PriceConfig): ReportData;
/** Render a report card to Markdown. */
export declare function renderReport(data: ReportData, meta: ReportMeta): string;
