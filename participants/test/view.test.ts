// What a seat works from (participants/src/view.ts, contracts.ts `slice`): its picture kept up with every change it is
// shown, and, for one capacity, that capacity's channels only. A person's own slice never takes in the channels of a
// post they hold: the office's accounts and papers are the office's, not theirs (no god's view; the mock's brain acts
// on its slice).

import { expect, test } from "bun:test";
import { slice, View, type Observation } from "../src";

const obs = (t: number, channels: Observation["channels"]): Observation => ({ participant: "p1", t, status: "active", entity: "alice", channels, outcomes: [], inbox: [], drafts: [] } as unknown as Observation);
const cell = (id: string, terrain: string) => ({ cell: id, x: 0, y: 0, terrain });

test("a view takes in every change it is shown: a street seen again is the street as it is now", () => {
  const v = new View();
  const first = v.apply(obs(1, { street: { kind: "sites", as_of: 1, cells: [cell("c1", "grass"), cell("c2", "road")] } }));
  expect((first.channels.street as any).cells.map((c: any) => c.terrain)).toEqual(["grass", "road"]);
  // The next look brings one changed cell and one new: the picture is both, with the unchanged one kept.
  const second = v.apply(obs(2, { street: { kind: "sites", as_of: 2, cells: [cell("c1", "built"), cell("c3", "water")] } }));
  expect((second.channels.street as any).cells.map((c: any) => `${c.cell}:${c.terrain}`)).toEqual(["c1:built", "c2:road", "c3:water"]);
  // A look that brings nothing new keeps the picture; a move (whole) replaces it.
  expect((v.apply(obs(3, {})).channels.street as any).cells.length).toBe(3);
  expect((v.apply(obs(4, { street: { kind: "sites", as_of: 4, whole: true, cells: [cell("c9", "road")] } })).channels.street as any).cells.map((c: any) => c.cell)).toEqual(["c9"]);
});

test("one capacity's slice: a person's own channels only, a post's channels by their own names and nothing of the person's", () => {
  const o = obs(1, {
    money: { kind: "accounts", accounts: [], transactions: [] },
    "finance/money": { kind: "accounts", accounts: [], transactions: [] },
    "finance/papers": { kind: "records", records: [] },
  } as any);
  const own = slice(o, "self", "alice");
  expect(Object.keys(own.channels)).toEqual(["money"]);
  expect(own.as).toBeUndefined();
  const office = slice(o, "finance", "city");
  expect(Object.keys(office.channels).sort()).toEqual(["money", "papers"]);
  expect([office.entity, office.as]).toEqual(["city", "finance"]);
});
