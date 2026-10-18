// Test doubles that wrap a real kind, for the two worlds: the TS world takes a BehaviourModule through `modules`, the
// Rust world (OIKOS_WORLD=rust) has the same-named kinds in kernel/crates/actors/src/testkinds.rs, driven by params.
export const onRust = process.env.OIKOS_WORLD === "rust";
