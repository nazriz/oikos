// A pilot and its twin, with an office in a mock seat (the head of twin-draws.test.ts says why): the same requests get the same
// answers from those the seat did not deal with, and the world's prices are the same month by month over a year.
// (Split out of twin-draws.test.ts at the test pruning, 2026-10-24.)

import { expect, test } from "bun:test";
import { answers, DAY, run } from "./lib/twins";

test("with an office in a mock seat, the same requests still get the same answers from those the seat did not deal with", async () => {
  // (A seat is not its code twin: it sits in office hours and its acts land at other moments, so the two towns do
  // part, by what truly differs. What must not differ is the answer to a request that is the same in both.)
  // (450 citizens, where the other tests here have 300, 2026-10-18: the seat parts from its twin on the first day (the mayor files its permit application
  // on day 14 where the code does on day 1), so the requests the two towns share are those that nothing the seat did reached, and a town of 300 gave 7
  // of 12 and 16 in the two branches before their merge, and 5 of 20 after it, by the draws alone. The floor below is the same; the sample it is
  // taken from is larger: 16 of 27 in common at 450, all answered alike.)
  const [twin, pilot] = await Promise.all([run("twin-draws-code-2", { citizens: 450 }), run("twin-draws-seat", { mayor: "llm", citizens: 450 })]);
  const books = pilot.filter((r) => r.kind === "office_books");
  expect(books.length).toBeGreaterThan(0);
  expect(twin.some((r) => r.kind === "office_books")).toBe(false);
  // (The town's own offices answer for the seat's side: left out.)
  const dealt = new Set(["city"]);
  const a = answers(twin, dealt), b = answers(pilot, dealt);
  const common = [...a.keys()].filter((k) => b.has(k));
  console.log(`twin draws: ${a.size} requests and decisions in the twin, ${b.size} with the seat, ${common.length} the same request in both; ${books.length} papers of the seat's clerk`);
  if (process.env.TWIN_DEBUG) console.log([...a.keys()].filter((k) => !b.has(k)).sort().join("\n"), "\n--\n", [...b.keys()].filter((k) => !a.has(k)).sort().join("\n"));
  expect(common.length).toBeGreaterThan(5);
  const differ = common.filter((k) => a.get(k) !== b.get(k));
  expect(differ.map((k) => `${k}: ${a.get(k)} in the twin, ${b.get(k)} with the seat`)).toEqual([]);
}, 900_000);

test("the world's prices are the world's: a town and its twin with an office in a mock seat see the same prices month by month over a year", async () => {
  // (2026-10-12. A month's world price was drawn on the outside market's own stream, which is keyed on the hour it
  // wakes in: anything that moved its first look of a month gave the town another year of prices. Twelve runs of one
  // town before and after an unrelated change had input prices 16% and 21% up in the "same" run, and whether its
  // factories failed turned on it. A price is now named for the good and the month, from the seed.)
  const prev = process.env.TWIN_DAYS;
  process.env.TWIN_DAYS = "365";
  try {
    const [twin, pilot] = await Promise.all([run("twin-prices-code", { living: undefined }), run("twin-prices-seat", { living: undefined, mayor: "llm" })]);
    const prices = (rs: any[]) => rs.filter((r) => r.kind === "price_list" && /at world prices/.test(String(r.text))).map((r) => `${Math.floor(r.at / (30 * DAY))} ${String(r.text).replace(/rec\.[0-9]+/g, "rec")}`);
    const a = prices(twin), b = prices(pilot);
    console.log(`twin prices: ${a.length} lists of world prices in the twin's year, ${b.length} beside it; ${new Set(a.map((x) => x.replace(/^\d+ /, ""))).size} distinct`);
    expect(new Set(a.map((x) => x.replace(/^\d+ /, ""))).size).toBeGreaterThan(6); // (prices did move)
    expect(pilot.some((r) => r.kind === "office_books")).toBe(true); // (and the towns did differ: a seat sat)
    expect(b).toEqual(a);
  } finally { if (prev === undefined) delete process.env.TWIN_DAYS; else process.env.TWIN_DAYS = prev; }
}, 1_800_000);
