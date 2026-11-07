//! Every kind of actor the engine can run, by the name worlds give it (`controller.impl`, `role_module.code`). Each lane
//! lists its kinds in its own group's `KINDS` (boundary, citizen, mind, firms, market, finance, offices), so no two
//! lanes edit one list; the stand-ins are the frame's.

use crate::Kind;

static STAND_INS: &[&dyn Kind] = &[&crate::stub::Idle, &crate::stub::Script];

fn groups() -> [&'static [&'static dyn Kind]; 9] {
    [
        STAND_INS,
        crate::boundary::KINDS,
        crate::citizen::KINDS,
        crate::mind::KINDS,
        crate::firms::KINDS,
        crate::market::KINDS,
        crate::finance::KINDS,
        crate::offices::KINDS,
        crate::delegation::KINDS,
    ]
}

/// Every kind, in name order.
pub fn kinds() -> Vec<&'static dyn Kind> {
    let mut v: Vec<&'static dyn Kind> = groups().into_iter().flatten().copied().collect();
    v.sort_by_key(|k| k.name());
    v
}

/// The kind of this name, if the engine has it (the test doubles of `testkinds` too: they are found, never listed).
pub fn find(name: &str) -> Option<&'static dyn Kind> {
    groups().into_iter().flatten().chain(crate::testkinds::KINDS.iter()).copied().find(|k| k.name() == name)
}
