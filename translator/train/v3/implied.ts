// Spans for what a form's call may leave unsaid in two passes (encode.ts `cards`): which form, the office it goes to,
// and a field's option. Read twice, each is pointed at where the form's line shows it, so a request need not say it.
// Added as `implied` where spansIn found no place for it (a value the request does say keeps its span).
// Moved into git from runs/translator-v3-2026-10-25/scripts/implied.ts on 2026-11-10.
import { calls } from "../../../participants/src/index.ts";

export function withImplied(spans: any[], program: string, forms: string[]): any[] {
  const p = calls.parseProgram(program);
  if ("none" in p) return spans;
  const out = [...spans];
  const several = p.lines.length > 1;
  const said = (v: any) => (v && "id" in v ? v.id : v && "text" in v ? v.text : undefined);
  const has = (arg: string, line: number, value: string) => out.some((s) => s.arg === arg && s.value === value && (!several || (s.line ?? 0) === line));
  const visit = (c: any, prefix: string, line: number) => {
    for (const [k, v] of Object.entries(c.args) as [string, any][]) if ("call" in v) visit(v.call, `${prefix}${k}.`, line);
    if (c.fn !== "form") return;
    const name = said(c.args.form);
    const shown = forms.find((l) => l.startsWith(`- ${name},`) || l.includes(`id ${name}:`));
    for (const [k, v] of Object.entries(c.args) as [string, any][]) {
      const value = said(v);
      if (value === undefined) continue;
      const option = shown && new RegExp(`(?:fields |, )${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(one of ([^)]*)\\)`).exec(shown);
      const isOption = option && option[1]!.replace(/, required$/, "").split(" | ").includes(value);
      if ((k === "form" || k === "to" || isOption) && !has(prefix + k, line, value)) out.push({ arg: prefix + k, value, how: "implied", ...(several ? { line } : {}) });
    }
  };
  p.lines.forEach((l: any, i: number) => visit(l.call, "", i));
  return out;
}
