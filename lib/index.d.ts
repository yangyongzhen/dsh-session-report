import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
/** Stable Cordis plugin name. */
declare const name = "report";
/** Core services required before the reporter can run. */
declare const inject: string[];
/** Plugin configuration after schema validation. */
export interface ReportConfig {
    enabled: boolean;
    /** Report directory; defaults to $DSH_HOME/reports. */
    outDir?: string;
    /** Quiet time after turn/end before the report is written. */
    debounceMs: number;
    /** Optional per-million-token prices for cost estimation. */
    costPerMInput?: number;
    costPerMOutput?: number;
}
declare const Config: z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
    outDir: z<string, string>;
    debounceMs: z<number, number>;
    costPerMInput: z<number, number>;
    costPerMOutput: z<number, number>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
    outDir: z<string, string>;
    debounceMs: z<number, number>;
    costPerMInput: z<number, number>;
    costPerMOutput: z<number, number>;
}>>;
/**
 * Write one session report card to a Markdown file. Returns the written file
 * path, or undefined when the session has no model/tool activity.
 */
export declare function writeReport(session: Session, config: ReportConfig): string | undefined;
/**
 * Mount the reporter: subscribe to the event firehose and flush pending
 * reports on dispose.
 */
declare function apply(ctx: Context, config: ReportConfig): void;
export { Config, apply, inject, name };
export { aggregate, renderReport } from './report.js';
