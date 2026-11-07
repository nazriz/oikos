//! `oikos-explorer <run log> [--pilot pilot.json] [--at SECONDS]`: the Bevy explorer in a native window, reading the
//! run's log in this process through the explorer's data layer (kernel/crates/explore). It never writes to the run.

fn main() {
    oikos_explorer::native::main();
}
