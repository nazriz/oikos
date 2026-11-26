// A person's life in the run, for the inspector drawer: who they are and whose household, where they lived and spent
// their days, their money day by day, and everything that reached them (payments, papers, messages, illnesses), each
// with who decided it: the seat (amber), an institution (periwinkle), a person (teal). From the `ledger` fold's file
// for this person (fetched when the page opens) and the map's people data. Raw facts in order; it judges nothing.
import { useEffect, useMemo, useState } from "react";
import type { LedgerItem, LedgerJson, PersonLedger } from "../../folds/ledger";
import { fetchFold, foldFile } from "../api";
import { useCity, structureName } from "../city/CityView";
import { personRows, type CityData } from "../city/data";
import { DAY, clock, dayOf, words } from "../format";
import { useLens } from "../state";
import type { InspectorProps } from "../views";
import "./life.css";

const ledgerCache = new Map<string, Promise<PersonLedger>>();
function loadLedger(run: string, id: string): Promise<PersonLedger> {
  const k = `${run}\u0000${id}`;
  let p = ledgerCache.get(k);
  if (!p) {
    p = foldFile(run, "ledger", `p-${id}`).then((b) => JSON.parse(new TextDecoder().decode(b)) as PersonLedger);
    p.catch(() => ledgerCache.delete(k));
    ledgerCache.set(k, p);
  }
  return p;
}

type Who = "seat" | "inst" | "person";
const money = (c: number) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PersonLife({ run, selection }: InspectorProps) {
  const id = selection.kind === "person" ? selection.id : "";
  const t = useLens((s) => s.t);
  const { city, error: cityError } = useCity(`/api/run/${encodeURIComponent(run)}`);
  const [ledger, setLedger] = useState<PersonLedger | null>(null);
  const [meta, setMeta] = useState<LedgerJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Who>("all");
  useEffect(() => {
    let live = true;
    setLedger(null);
    setErr(null);
    loadLedger(run, id).then((l) => live && setLedger(l), (e) => live && setErr(String(e.message ?? e)));
    fetchFold<LedgerJson>(run, "ledger").then((m) => live && setMeta(m), () => {});
    return () => {
      live = false;
    };
  }, [run, id]);

  const q = city?.pById.get(id);
  const person = q !== undefined ? city!.people.people[q] : undefined;
  const seat = meta?.seat;
  const whoOf = (x?: string): Who => (x && x === seat ? "seat" : x && (x.endsWith("-self") || city?.pById.has(x)) ? "person" : "inst");
  const nameOf = (x?: string): string => {
    if (!x) return "—";
    if (x === seat) return "the seat";
    const p = city?.pById.get(x.replace(/-self$/, ""));
    if (p !== undefined) return city!.people.people[p]![1];
    const e = city?.town.entities[x.replace(/-system$/, "")];
    return e?.name ?? words(x.replace(/-system$/, ""));
  };

  if (cityError || err) return <div className="life"><p className="life-err">{cityError ?? err}</p></div>;
  if (!city || !ledger) return <div className="life"><div className="life-skel" /><div className="life-skel short" /><div className="life-skel" /></div>;

  return (
    <div className="life">
      <Who_ c={city} q={q} id={id} t={t} />
      <Places c={city} q={q} t={t} />
      <Money ledger={ledger} t={t} nameOf={nameOf} whoOf={whoOf} />
      <Reached ledger={ledger} t={t} nameOf={nameOf} whoOf={whoOf} filter={filter} setFilter={setFilter} bulk={meta?.bulk ?? []} />
      {person === undefined && <p className="life-note">Not among the town's people at the start.</p>}
    </div>
  );
}

function Who_({ c, q, id, t }: { c: CityData; q: number | undefined; id: string; t: number }) {
  const select = useLens((s) => s.select);
  if (q === undefined) return <section className="life-sec"><div className="life-name serif">{id}</div></section>;
  const [, name, sex, born, hh, home] = c.people.people[q]!;
  const age = Math.floor((t - born) / (365 * DAY));
  const mates = hh >= 0 ? c.people.people.map((p, i) => [p, i] as const).filter(([p, i]) => p[4] === hh && i !== q) : [];
  const died = c.people.died[q], left = c.people.left[q];
  return (
    <section className="life-sec life-who">
      <div className="life-name serif">{name}</div>
      <div className="life-sub">
        <span className="mono">{id}</span>
        {age >= 0 && <span>{age} years old</span>}
        {sex && <span>{sex === "f" ? "female" : "male"}</span>}
        {home >= 0 && c.sMap[home]! >= 0 && (
          <button className="life-link" onClick={() => select({ kind: "structure", id: c.town.structures[c.sMap[home]!]!.id })}>
            first home: {structureName(c, c.sMap[home]!)}
          </button>
        )}
      </div>
      {(died !== undefined || left !== undefined) && (
        <div className="life-fate">{died !== undefined ? `Died on day ${dayOf(died)}` : `Left the town on day ${dayOf(left!)}`}</div>
      )}
      {mates.length > 0 && (
        <div className="life-house">
          <span className="eyebrow">Household</span>
          {mates.map(([p]) => (
            <button key={p[0]} className="life-chip" onClick={() => select({ kind: "person", id: p[0] })}>
              {p[1]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Where they were: homes in order, and the places their days were spent (by hours), from the people fold's rows. */
function Places({ c, q, t }: { c: CityData; q: number | undefined; t: number }) {
  const select = useLens((s) => s.select);
  const stays = useMemo(() => {
    if (q === undefined) return { homes: [] as { s: number; from: number; to: number }[], other: [] as { s: number; kind: string; hours: number; visits: number }[] };
    const rows = personRows(c)[q]!;
    const homes: { s: number; from: number; to: number }[] = [];
    const other = new Map<string, { s: number; kind: string; hours: number; visits: number }>();
    const open = new Map<string, number>();
    for (const r of rows) {
      const s = c.rows.s[r]!, k = c.rows.k[r]!, rt = c.rows.t[r]!;
      if (s < 0) continue;
      const kind = c.people.spaceKinds[Math.abs(k) - 1] ?? "?";
      const key = `${s}/${kind}`;
      if (k > 0) {
        open.set(key, rt);
        if (kind === "dwelling") {
          const last = homes.at(-1);
          if (!last || last.s !== s) homes.push({ s, from: rt, to: rt });
        } else {
          const o = other.get(key) ?? { s, kind, hours: 0, visits: 0 };
          o.visits++;
          other.set(key, o);
        }
      } else {
        const from = open.get(key);
        open.delete(key);
        if (kind === "dwelling") {
          const h = homes.findLast((x) => x.s === s);
          if (h) h.to = rt;
        } else if (from !== undefined) other.get(key)!.hours += (rt - from) / 3600;
      }
    }
    return { homes, other: [...other.values()].sort((a, b) => b.hours - a.hours).slice(0, 6) };
  }, [c, q]);
  if (!stays.homes.length && !stays.other.length) return null;
  return (
    <section className="life-sec">
      <div className="eyebrow">Where they lived and spent their days</div>
      <ul className="life-places">
        {stays.homes.map((h, i) => (
          <li key={`h${i}`}>
            <span className="life-dot citizen" />
            <button className="life-link" onClick={() => select({ kind: "structure", id: c.town.structures[h.s]!.id })}>
              {structureName(c, h.s)}
            </button>
            <span className="faint">home{stays.homes.length > 1 ? `, from day ${dayOf(h.from)}` : ""}</span>
          </li>
        ))}
        {stays.other.map((o) => (
          <li key={`${o.s}/${o.kind}`}>
            <span className="life-dot" />
            <button className="life-link" onClick={() => select({ kind: "structure", id: c.town.structures[o.s]!.id })}>
              {structureName(c, o.s)}
            </button>
            <span className="faint">
              {words(o.kind)} · {Math.round(o.hours).toLocaleString()} h over {o.visits} visit{o.visits === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Their money: the balance of their accounts day by day (opening balance plus every payment), in and out. */
function Money({ ledger, t, nameOf, whoOf }: { ledger: PersonLedger; t: number; nameOf: (x?: string) => string; whoOf: (x?: string) => Who }) {
  const setT = useLens((s) => s.setT);
  const span = useLens((s) => s.span);
  const { days, max, min, inc, out, top } = useMemo(() => {
    const last = Math.max(1, Math.ceil(span[1] / DAY));
    const delta = new Float64Array(last + 1);
    let inc = 0, out = 0;
    const by = new Map<string, number>();
    for (const [tt, c, other] of ledger.transfers) {
      delta[Math.min(last, Math.floor(tt / DAY))]! += c;
      if (c > 0) inc += c;
      else out -= c;
      by.set(other, (by.get(other) ?? 0) + c);
    }
    const days: number[] = [];
    let b = ledger.opening;
    for (let d = 0; d <= last; d++) days.push((b += delta[d]!));
    const top = [...by].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    return { days, max: Math.max(...days, 0), min: Math.min(...days, 0), inc, out, top };
  }, [ledger, span]);
  const d0 = Math.floor(span[0] / DAY), d1 = Math.min(days.length - 1, Math.ceil(span[1] / DAY));
  const view = days.slice(d0, d1 + 1);
  const W = 340, H = 64, range = Math.max(1, max - min);
  const y = (v: number) => H - 4 - ((v - min) / range) * (H - 8);
  const pts = view.map((v, i) => `${(i / Math.max(1, view.length - 1)) * W},${y(v)}`).join(" ");
  const cur = Math.min(view.length - 1, Math.max(0, dayOf(t) - d0));
  const cx = (cur / Math.max(1, view.length - 1)) * W;
  return (
    <section className="life-sec">
      <div className="eyebrow">Money</div>
      <div className="life-money">
        <div>
          <div className="life-big serif num">{money(days[Math.min(days.length - 1, dayOf(t))] ?? ledger.opening)}</div>
          <div className="faint life-small">on day {dayOf(t)} · {ledger.accounts.length} account{ledger.accounts.length === 1 ? "" : "s"}</div>
        </div>
        <div className="life-io num">
          <span className="good">+{money(inc)}</span>
          <span className="bad">−{money(out)}</span>
        </div>
      </div>
      <svg
        className="life-spark"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setT((d0 + Math.round(((e.clientX - r.left) / r.width) * (view.length - 1))) * DAY + 12 * 3600);
        }}
      >
        {min < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="life-zero" />}
        <polyline points={`0,${H} ${pts} ${W},${H}`} className="life-area" />
        <polyline points={pts} className="life-line" />
        <line x1={cx} x2={cx} y1={0} y2={H} className="life-cursor" />
      </svg>
      {top.length > 0 && (
        <div className="life-top">
          {top.map(([who, c]) => (
            <div key={who} className="life-top-row">
              <span className={`life-who ${whoOf(who)}`}>{nameOf(who)}</span>
              <span className={`num ${c >= 0 ? "good" : "bad"}`}>{money(c)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Everything that reached them, newest last, with who decided it. */
function Reached({ ledger, t, nameOf, whoOf, filter, setFilter, bulk }: { ledger: PersonLedger; t: number; nameOf: (x?: string) => string; whoOf: (x?: string) => Who; filter: "all" | Who; setFilter: (f: "all" | Who) => void; bulk: string[] }) {
  const s = useLens.getState();
  type Row = { t: number; who: Who; from?: string; kind: string; text: string; it?: LedgerItem; cents?: number };
  const rows = useMemo<Row[]>(() => {
    const r: Row[] = ledger.items.map((it) => ({ t: it.t, who: it.seat ? "seat" : whoOf(it.from), ...(it.from ? { from: it.from } : {}), kind: it.kind, text: it.text, it }));
    // (Payments: only those someone other than the person themselves decided, and not the everyday ones in bulk.)
    for (const [tt, c, other, reason, memo, decider] of ledger.transfers) {
      const w = whoOf(decider);
      if (w === "person" && decider.replace(/-self$/, "") === ledger.id) continue;
      if (reason === "payment" && w === "inst") continue;
      r.push({ t: tt, who: w, from: decider, kind: reason || "payment", text: `${c >= 0 ? "Received" : "Paid"} ${money(Math.abs(c))} ${c >= 0 ? "from" : "to"} ${nameOf(other)}${memo ? ` · ${memo}` : ""}`, cents: c });
    }
    for (const [tt, ev, kind, sev] of ledger.conditions) r.push({ t: tt, who: "inst", kind: `${kind} ${ev}`, text: `${words(kind)} ${ev}${sev ? ` (${sev})` : ""}` });
    for (const [tt, what] of ledger.events) r.push({ t: tt, who: "inst", kind: what.split(" ")[0]!, text: what });
    return r.sort((a, b) => a.t - b.t);
  }, [ledger]);
  const counts = { seat: 0, inst: 0, person: 0 };
  for (const r of rows) counts[r.who]++;
  const shown = rows.filter((r) => filter === "all" || r.who === filter);
  const nowIdx = shown.findIndex((r) => r.t > t);
  const bulkLine = Object.entries(ledger.counts);
  return (
    <section className="life-sec">
      <div className="life-reached-head">
        <div className="eyebrow">What reached them · {rows.length}</div>
        <div className="seg">
          {(["all", "seat", "inst", "person"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "seat" ? `Seat ${counts.seat}` : f === "inst" ? `Institutions ${counts.inst}` : `People ${counts.person}`}
            </button>
          ))}
        </div>
      </div>
      <ol className="life-list">
        {shown.map((r, i) => (
          <li key={i} className={`life-row ${r.who} ${nowIdx === i ? "now" : ""} ${r.t > t ? "later" : ""}`}>
            <button
              className="life-row-btn"
              onClick={() => {
                s.setT(r.t);
                if (r.it?.seat && r.it.seq !== undefined) s.select({ kind: "act", seq: r.it.seq });
              }}
            >
              <span className="life-when mono">
                d{dayOf(r.t)} <span className="faint">{clock(r.t)}</span>
              </span>
              <span className="life-what">
                <span className="life-kind">
                  {words(r.kind)}
                  {r.from && <span className={`life-who ${r.who}`}> · {r.it?.own ? "their own" : nameOf(r.from)}</span>}
                  {r.it?.refused && <span className="bad"> · refused ({words(r.it.refused)})</span>}
                </span>
                <span className="life-text">{r.text}</span>
              </span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="life-note">Nothing here.</li>}
      </ol>
      {bulkLine.length > 0 && (
        <p className="life-note">
          Also {bulkLine.map(([k, n]) => `${n} ${words(k)}${n === 1 ? "" : "s"}`).join(", ")}: everyday paperwork, counted, not listed{bulk.length ? "" : ""}.
        </p>
      )}
    </section>
  );
}
