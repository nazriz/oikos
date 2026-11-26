// ⌘K (or Ctrl+K, or /): search the open run and jump. People, households, buildings, organisations, posts, records
// (by id or words), the seat's sittings, and the words of every sitting's transcript, indexed here in the browser from
// the run's bundle (the transcripts fetched in the background the first time the palette opens).
import { useEffect, useMemo, useRef, useState } from "react";
import type { LedgerJson } from "../../folds/ledger";
import type { PeopleBundle } from "../../folds/people";
import type { SeatJson } from "../../folds/seat";
import type { TownBundle } from "../../folds/town";
import { fetchFold, foldFile } from "../api";
import { clock, dayOf, words } from "../format";
import { Search } from "../icons";
import { useLens, type Selection } from "../state";
import "./palette.css";

type Group = "People" | "Households" | "Buildings" | "Organisations" | "Posts" | "Sittings" | "Records" | "Transcripts";
const ORDER: Group[] = ["People", "Households", "Posts", "Organisations", "Buildings", "Sittings", "Records", "Transcripts"];

interface Item {
  group: Group;
  title: string;
  sub?: string;
  /** Lower-cased text searched. */
  hay: string;
  /** Lower-cased name, ranked first on a prefix. */
  name: string;
  t?: number;
  sel?: Selection;
}
interface Hit extends Item {
  score: number;
  snippet?: string;
}

const lc = (s: string) => s.toLowerCase();

function strings(x: unknown, out: string[], depth = 0) {
  if (depth > 6 || x == null) return;
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) for (const v of x) strings(v, out, depth + 1);
  else if (typeof x === "object") for (const v of Object.values(x as object)) strings(v, out, depth + 1);
}

function useIndex(run: string, open: boolean) {
  const [items, setItems] = useState<Item[]>([]);
  const [transcripts, setTranscripts] = useState<{ done: number; total: number; items: Item[] }>({ done: 0, total: 0, items: [] });
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!open || started.current === run) return;
    started.current = run;
    let live = true;
    const out: Item[] = [];
    const push = (xs: Item[]) => live && setItems((cur) => [...cur, ...xs]);
    setItems([]);
    fetchFold<PeopleBundle>(run, "people").then((p) => {
      const ps: Item[] = p.people.map(([id, name, , , hh]) => ({ group: "People", title: name, sub: id, name: lc(name), hay: lc(`${name} ${id} ${hh >= 0 ? p.households[hh] : ""}`), sel: { kind: "person", id } }));
      const byHh = new Map<number, string[]>();
      p.people.forEach(([id, , , , hh]) => hh >= 0 && byHh.set(hh, [...(byHh.get(hh) ?? []), id]));
      const hs: Item[] = p.households.map((h, i) => {
        const members = (byHh.get(i) ?? []).map((id) => p.people.find((q) => q[0] === id)?.[1] ?? id);
        return { group: "Households", title: h, sub: members.slice(0, 4).join(", ") + (members.length > 4 ? "…" : ""), name: lc(h), hay: lc(`${h} ${members.join(" ")}`), sel: { kind: "person", id: byHh.get(i)?.[0] ?? "" } };
      });
      push([...ps, ...hs]);
    }, () => {});
    fetchFold<TownBundle>(run, "town").then((tw) => {
      const xs: Item[] = [];
      for (const s of tw.structures) {
        const org = s.houses ? tw.entities[s.houses]?.name : undefined;
        xs.push({ group: "Buildings", title: org ?? s.id, sub: `${words(s.type)}${org ? ` · ${s.id}` : ""}`, name: lc(org ?? s.id), hay: lc(`${s.id} ${s.type} ${s.category} ${org ?? ""} ${s.owner ?? ""}`), sel: { kind: "structure", id: s.id } });
      }
      for (const [id, e] of Object.entries(tw.entities)) if (e.kind !== "person") xs.push({ group: "Organisations", title: e.name, sub: `${words(e.kind)} · ${id}`, name: lc(e.name), hay: lc(`${e.name} ${id} ${e.kind}`), sel: { kind: "entity", id } });
      for (const [id, p] of Object.entries(tw.positions)) {
        const holder = p.holder?.replace(/-self$/, "");
        xs.push({ group: "Posts", title: p.title, sub: `${id}${p.holder ? ` · held by ${p.holder}` : " · vacant"}`, name: lc(p.title), hay: lc(`${p.title} ${id} ${p.entity} ${p.holder ?? ""}`), sel: holder && !holder.endsWith("-system") ? { kind: "person", id: holder } : { kind: "entity", id: p.entity } });
      }
      push(xs);
    }, () => {});
    fetchFold<LedgerJson>(run, "ledger").then((l) => {
      push(l.records.map(([id, kind, t, author, text]) => ({ group: "Records", title: `${words(kind)} · ${id}`, sub: text, name: lc(id), hay: lc(`${id} ${kind} ${author} ${text}`), t })));
    }, () => {});
    fetchFold<SeatJson>(run, "seat").then(async (seat) => {
      push(seat.sittings.map((s) => ({ group: "Sittings", title: `Day ${s.day} · ${s.gist}`, sub: s.words, name: lc(`day ${s.day}`), hay: lc(`day ${s.day} ${s.gist} ${s.words ?? ""} ${s.woke_for ?? ""}`), t: s.t, sel: { kind: "sitting", index: s.i } })));
      // The transcripts: fetched a few at a time, each sitting's words joined into one searchable text.
      const todo = seat.sittings.filter((s) => s.kind === "model");
      setTranscripts({ done: 0, total: todo.length, items: [] });
      let next = 0;
      const got: Item[] = [];
      const worker = async () => {
        while (live && next < todo.length) {
          const s = todo[next++]!;
          try {
            const d = JSON.parse(new TextDecoder().decode(await foldFile(run, "seat", `sitting-${s.i}`)));
            const ws: string[] = [];
            for (const turn of d.turns ?? []) {
              strings(turn.output, ws);
              if (turn.purpose === "participant") strings(turn.input, ws);
            }
            const text = ws.join("\n");
            got.push({ group: "Transcripts", title: `Day ${s.day} · sitting ${s.i}`, name: "", hay: lc(text), t: s.t, sel: { kind: "sitting", index: s.i }, sub: text });
          } catch {}
          if (live) setTranscripts({ done: got.length, total: todo.length, items: [...got] });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    }, () => {});
    return () => {
      live = false;
      started.current = null;
    };
  }, [run, open]);
  return { items, transcripts };
}

function search(items: Item[], q: string): Hit[] {
  const needle = lc(q.trim());
  if (!needle) return [];
  const terms = needle.split(/\s+/);
  const hits: Hit[] = [];
  for (const it of items) {
    let ok = true;
    for (const term of terms) if (!it.hay.includes(term)) { ok = false; break; }
    if (!ok) continue;
    let score = 1;
    if (it.name === needle) score = 100;
    else if (it.name.startsWith(needle)) score = 50;
    else if (it.name.includes(needle)) score = 20;
    else if (it.hay.startsWith(needle) || it.hay.includes(` ${needle}`)) score = 8;
    let snippet: string | undefined;
    if (it.group === "Transcripts" || it.group === "Records") {
      const i = it.hay.indexOf(terms[0]!);
      const src = it.sub ?? "";
      if (i >= 0) snippet = `${i > 50 ? "…" : ""}${src.slice(Math.max(0, i - 50), i + 110).replace(/\s+/g, " ")}${i + 110 < src.length ? "…" : ""}`;
    }
    hits.push({ ...it, score, ...(snippet ? { snippet } : {}) });
  }
  return hits;
}

export function Palette({ run }: { run: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { items, transcripts } = useIndex(run, open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    const onOpen = () => setOpen(true);
    window.addEventListener("lens-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lens-palette", onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const all = useMemo(() => [...items, ...transcripts.items], [items, transcripts.items]);
  const groups = useMemo(() => {
    const hits = search(all, q);
    const by = new Map<Group, Hit[]>();
    for (const h of hits) by.set(h.group, [...(by.get(h.group) ?? []), h]);
    return ORDER.filter((g) => by.has(g)).map((g) => {
      const hs = by.get(g)!.sort((a, b) => b.score - a.score || (a.t ?? 0) - (b.t ?? 0));
      return { g, total: hs.length, hits: hs.slice(0, g === "Transcripts" || g === "Records" ? 6 : 5) };
    });
  }, [all, q]);
  const flat = groups.flatMap((g) => g.hits);
  useEffect(() => setCur(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  const choose = (h: Hit) => {
    const s = useLens.getState();
    if (h.t !== undefined) s.setT(h.t);
    if (h.sel) s.select(h.sel);
    setOpen(false);
  };

  if (!open) return null;
  let n = -1;
  return (
    <div className="pal-back" onMouseDown={() => setOpen(false)}>
      <div className="pal" role="dialog" aria-label="Search this run" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Search />
          <input
            ref={input}
            value={q}
            placeholder="Search people, buildings, posts, records, sittings, transcripts…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") (e.preventDefault(), setCur((c) => Math.min(flat.length - 1, c + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setCur((c) => Math.max(0, c - 1)));
              else if (e.key === "Enter" && flat[cur]) choose(flat[cur]!);
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="pal-list" ref={list}>
          {!q.trim() && (
            <div className="pal-hint">
              <p>Type a name, an id (c0018, house-198, rec.94835), a post, or any words the seat wrote or read.</p>
              <p className="faint">
                {items.length.toLocaleString()} things indexed
                {transcripts.total ? ` · transcripts ${transcripts.done} of ${transcripts.total}` : ""}
              </p>
            </div>
          )}
          {q.trim() && !flat.length && <div className="pal-hint">Nothing matches.</div>}
          {groups.map(({ g, hits, total }) => (
            <div key={g} className="pal-group">
              <div className="pal-group-head eyebrow">
                {g} <span className="faint">{total > hits.length ? `${hits.length} of ${total}` : total}</span>
              </div>
              {hits.map((h) => {
                n++;
                const i = n;
                return (
                  <button key={`${g}${i}`} data-i={i} className={`pal-item ${i === cur ? "cur" : ""}`} onMouseEnter={() => setCur(i)} onClick={() => choose(h)}>
                    <span className="pal-title">{h.title}</span>
                    {(h.snippet ?? h.sub) && <span className="pal-sub">{h.snippet ?? h.sub}</span>}
                    {h.t !== undefined && (
                      <span className="pal-t mono">
                        d{dayOf(h.t)} {clock(h.t)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pal-foot faint">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> move
          </span>
          <span>
            <span className="kbd">↵</span> go
          </span>
          <span>
            <span className="kbd">⌘</span>
            <span className="kbd">K</span> or <span className="kbd">/</span> open
          </span>
        </div>
      </div>
    </div>
  );
}
