// Loaded before the tests of every `bun test` started in the repo's root (bunfig.toml): the process takes one of the
// machine's slots (scripts/slots.ts) and holds it until it ends, so a test file run by hand counts like one the suite
// runner starts. Under the runner, or inside any other slot, it takes nothing. It changes when tests start, no more.
import { insideSlot, take } from "./slots";

// (It borrows, as the runner does: a test file holds its token for seconds, and goes past its checkout's cap only while
// no other checkout waits.)
const slot = await take(1, `bun test ${process.argv.slice(2).join(" ")}`.slice(0, 100), { borrow: true });
// (What this process starts is inside its slot; a child given its own environment is known by its ancestry.)
if (slot?.weight) process.env.OIKOS_SLOT_HELD = insideSlot(1).OIKOS_SLOT_HELD;
