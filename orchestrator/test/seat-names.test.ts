// A name a seat has been shown is a name it can use (pilot lv-12, 2026-10-24): the energy retailer's own file said its
// orders went "to The outside world", and its order "from The outside world" was answered "You don't know of anyone or
// anything called "The outside world"", which it took to mean the town did not know its supplier.

import { expect, test } from "bun:test";
import { Knowledge } from "@oikos/translator";
import { namedFor } from "../src/seat-config";

const currency = { code: "MXN", symbol: "$", minor_units: 2 } as any;
const whoIs = (id: string) => (id === "outside" ? { id, name: "The outside world" } : id === "energy-operations" ? { id, name: "Retail manager", of: "energy-co" } : undefined);

test("a name a seat is shown, it can name in a request; one it was never shown, it cannot", () => {
  const k = new Knowledge(currency);
  const named = namedFor(k, whoIs);
  expect(k.byName("The outside world")).toEqual([]);
  // Its report names the supplier (as its office's file does: "order to The outside world").
  expect(named("outside")?.name).toBe("The outside world");
  expect(k.byName("The outside world")).toEqual(["outside"]);
  expect(k.byName("the outside world")).toEqual(["outside"]);
  // A post is named by its title, and is not taken for an organisation's name.
  named("energy-operations");
  expect(k.names.has("energy-operations")).toBe(false);
  // Nothing it was not shown is learnt.
  expect(k.byName("Somebody Else")).toEqual([]);
});
