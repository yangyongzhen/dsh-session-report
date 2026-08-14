/**
 * dsh-session-report — session cost/usage report cards for DeepSeek Harness.
 *
 * Listens on the `session/event` firehose; when a `turn/end` event lands it
 * debounces `debounceMs` of quiet, then writes a Markdown report (token usage
 * with cache-hit ratio, per-turn breakdown, tool-call frequency, errors,
 * optional cost estimate) to `$DSH_HOME/reports/`. Pending reports flush
 * synchronously on dispose so one-shot (headless) runs never lose theirs.
 *
 * @module dsh-session-report
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';
import { aggregate, renderReport } from './report.js';
/** Stable Cordis plugin name. */
const name = 'report';
/** Core services required before the reporter can run. */
const inject = ['sessions'];
const Config = z.object({
    enabled: z.boolean().default(true),
    outDir: z.string(),
    debounceMs: z.number().default(1000),
    costPerMInput: z.number(),
    costPerMOutput: z.number()
});
function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
function sanitizeId(id) {
    return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function hasActivity(events) {
    return events.some((event) => event.type === 'assistant/message' || event.type === 'tool/call');
}
function metaFromHeader(header) {
    return {
        createdAt: header.createdAt,
        cwd: header.cwd,
        agentPreset: header.agentPreset
    };
}
/**
 * Write one session report card to a Markdown file. Returns the written file
 * path, or undefined when the session has no model/tool activity.
 */
export function writeReport(session, config) {
    const events = session.events;
    if (!hasActivity(events))
        return undefined;
    const prices = {
        costPerMInput: config.costPerMInput,
        costPerMOutput: config.costPerMOutput
    };
    const data = aggregate(events, prices);
    const markdown = renderReport(data, { sessionId: session.id, ...metaFromHeader(session.header) });
    const dir = config.outDir ?? join(dshHome(), 'reports');
    mkdirSync(dir, { recursive: true });
    const stem = sanitizeId(session.id).replace(/^session-/, '');
    const file = join(dir, `report-${stem}.md`);
    writeFileSync(file, markdown, 'utf8');
    return file;
}
/**
 * Mount the reporter: subscribe to the event firehose and flush pending
 * reports on dispose.
 */
function apply(ctx, config) {
    if (!config.enabled)
        return;
    const timers = new Map();
    const pending = new Map();
    ctx.on('session/event', (session, event) => {
        if (event.type !== 'turn/end')
            return;
        const id = session.id;
        pending.set(id, session);
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => {
            timers.delete(id);
            pending.delete(id);
            try {
                const file = writeReport(session, config);
                if (file !== undefined)
                    ctx.logger.info(`dsh-session-report: wrote ${file}`);
            }
            catch (error) {
                ctx.logger.warn(`dsh-session-report: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, config.debounceMs));
    });
    ctx.effect(() => () => {
        for (const timer of timers.values())
            clearTimeout(timer);
        timers.clear();
        for (const session of pending.values()) {
            try {
                writeReport(session, config);
            }
            catch {
                // best effort on shutdown; a failed write must not block dispose
            }
        }
        pending.clear();
    });
}
export { Config, apply, inject, name };
export { aggregate, renderReport } from './report.js';
