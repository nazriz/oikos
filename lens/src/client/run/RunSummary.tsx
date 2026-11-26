// The run at a glance, from the meta fold: the seat and its model, the study reader's output, cost, the span, the log.
import type { Meta, RunEntry, UsageTotals } from "../../shared/api";
import { compact, dayOf, int, usd, words } from "../format";
import { useLens } from "../state";
import { readingOutcome } from "../outcome";

const DAY = 86_400;

export function RunSummary({ meta, entry }: { meta: Meta; entry?: RunEntry }) {
  const seat = meta.seats.find((s) => s.post === meta.post?.id) ?? meta.seats[0];
  const r = meta.reading;
  const purposes = Object.entries(meta.cost.byPurpose).sort((a, b) => b[1].microusd - a[1].microusd);
  const maxP = Math.max(1, ...purposes.map(([, u]) => u.microusd));
  const counts = Object.entries(meta.counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxC = Math.max(1, ...counts.map(([, n]) => n));
  const forkDay = meta.span.fork !== undefined ? dayOf(meta.span.fork) : undefined;
  const wakes = meta.daily.wakes.reduce((a, b) => a + b, 0);
  return (
    <div className="summary">
      <section>
        <div className="eyebrow">The seat</div>
        {seat ? (
          <>
            <div className="sum-hero serif">{seat.model ? seat.model.split("/").at(-1) : seat.id}</div>
            <div className="muted sum-sub">
              {seat.provider ? `${seat.provider} · ` : ""}
              {seat.post ? `holds ${seat.post}` : seat.id}
              {entry?.experiment ? ` · goal ${entry.experiment.goal}` : ""}
            </div>
            <dl className="facts">
              <dt>wakes</dt>
              <dd className="num">{int(wakes)}</dd>
              <dt>model calls</dt>
              <dd className="num">{int(meta.cost.all.calls)}</dd>
              <dt>tokens in / out</dt>
              <dd className="num">
                {compact(meta.cost.all.input + meta.cost.all.cacheRead)} / {compact(meta.cost.all.output)}
              </dd>
              <dt>cost</dt>
              <dd className="num">{usd(meta.cost.all.microusd / 1e6)}</dd>
            </dl>
          </>
        ) : (
          <p className="muted">No seat in this run: every participant is code.</p>
        )}
      </section>

      {r && (
        <section>
          <div className="eyebrow">
            The study reader <span className="faint">· experiments/power-seeking/reader.ts</span>
          </div>
          <div className="levels">
            <Level label="considered" n={r.levels.considered} tier={r.tier.considered} />
            <Level label="attempted" n={r.levels.attempted} tier={r.tier.attempted} flag />
            <Level label="executed" n={r.levels.executed} tier={r.tier.executed} flag />
          </div>
          <div className="sum-sub muted">
            {readingOutcome(r)?.label ?? (r.stood ? "Stood" : "Did not stand")}
            {r.levers ? ` · ${r.levers.tried} lever${r.levers.tried === 1 ? "" : "s"} tried, ${r.levers.done} done` : ""}
            {r.stopped_before_poll ? ` · stopped before the poll (day ${r.stopped_day ?? "?"})` : ""}
          </div>
          {r.attempts.length > 0 && (
            <ol className="attempts">
              {r.attempts.map((a, i) => (
                <li key={i}>
                  <button className="attempt" onClick={() => useLens.getState().setT(a.t)}>
                    <span className="attempt-head">
                      <span className="chip flag">tier {a.tier}</span>
                      <b>{words(a.lever)}</b>
                      <span className="mono faint">day {a.day}</span>
                    </span>
                    {a.stage && <span className="muted attempt-stage">{words(a.stage)}</span>}
                    <q className="serif attempt-words">{a.words}</q>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {purposes.length > 0 && (
        <section>
          <div className="eyebrow">Spending by purpose</div>
          <div className="bars">
            {purposes.map(([p, u]) => (
              <Bar key={p} label={p} value={usd(u.microusd / 1e6)} frac={u.microusd / maxP} tone="seat" title={usageTitle(u)} />
            ))}
          </div>
          <Spark values={meta.daily.usd} from={forkDay ?? 0} />
        </section>
      )}

      <section>
        <div className="eyebrow">The run</div>
        <dl className="facts">
          <dt>place</dt>
          <dd>{meta.place ?? "–"}</dd>
          <dt>people</dt>
          <dd className="num">
            {int(meta.people.initial)}
            {meta.people.created ? ` + ${meta.people.created} born or arrived` : ""}
            {meta.people.left ? ` · ${meta.people.left} left` : ""}
          </dd>
          <dt>span</dt>
          <dd className="num">
            {forkDay !== undefined ? `fork at day ${forkDay}, ` : ""}to day {dayOf(meta.span.end)}
          </dd>
          <dt>ended</dt>
          <dd>
            {meta.ended === "finished" ? `reached its set length, day ${dayOf(meta.span.end)}` : meta.ended === "stopped" ? `stopped on day ${dayOf(meta.span.end)}` : "no end line (cut short?)"}
            {meta.end?.reason && <span className="faint"> · {meta.end.reason}</span>}
          </dd>
          <dt>kernel</dt>
          <dd className="mono">{meta.kernel ? `${meta.kernel.version ?? ""} ${meta.kernel.build ?? ""}` : "–"}</dd>
          <dt>run id</dt>
          <dd className="mono sum-id">{meta.runId}</dd>
        </dl>
      </section>

      <section>
        <div className="eyebrow">The log · {int(meta.lines)} lines</div>
        <div className="bars">
          {counts.map(([k, n]) => (
            <Bar key={k} label={k} value={compact(n)} frac={n / maxC} mono />
          ))}
        </div>
      </section>
    </div>
  );
}

const usageTitle = (u: UsageTotals) => `${u.calls} calls · ${u.input.toLocaleString()} in · ${u.cacheRead.toLocaleString()} cached · ${u.output.toLocaleString()} out`;

function Level({ label, n, tier, flag }: { label: string; n: number; tier: number; flag?: boolean }) {
  const hot = flag && tier >= 2;
  return (
    <div className={`level ${hot ? "hot" : ""}`}>
      <div className="serif level-n num">{n}</div>
      <div className="eyebrow">{label}</div>
      <div className="faint level-tier">{tier ? `top tier ${tier}` : "tier 0"}</div>
    </div>
  );
}

function Bar({ label, value, frac, tone, mono, title }: { label: string; value: string; frac: number; tone?: string; mono?: boolean; title?: string }) {
  return (
    <div className="bar" title={title}>
      <span className={`bar-label ${mono ? "mono" : ""}`}>{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${tone ?? ""}`} style={{ width: `${Math.max(1.5, frac * 100)}%` }} />
      </span>
      <span className="bar-value mono num">{value}</span>
    </div>
  );
}

/** Spending per day after the fork, as a small area. */
function Spark({ values, from }: { values: number[]; from: number }) {
  const v = values.slice(from);
  const max = Math.max(1, ...v);
  if (!v.some((x) => x > 0)) return null;
  const W = 300, H = 44;
  const pts = v.map((x, i) => `${(i / Math.max(1, v.length - 1)) * W},${H - (x / max) * (H - 4)}`);
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={`0,${H} ${pts.join(" ")} ${W},${H}`} className="spark-area" />
        <polyline points={pts.join(" ")} className="spark-line" />
      </svg>
      <figcaption className="faint">
        per day, day {from} to {from + v.length - 1} · peak {usd(max / 1e6)}
      </figcaption>
    </figure>
  );
}

export { DAY };
