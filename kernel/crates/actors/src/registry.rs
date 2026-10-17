//! Every kind of actor the engine can run, by the name worlds give it (`controller.impl`, `role_module.code`). A port
//! agent adds its kinds here, one line each, in name order.

use crate::Kind;

static KINDS: &[&dyn Kind] = &[&crate::stub::Idle, &crate::stub::Script, &crate::boundary::weather::Weather];

/// Every kind, in name order.
pub fn kinds() -> Vec<&'static dyn Kind> {
    let mut v: Vec<&'static dyn Kind> = KINDS.to_vec();
    v.sort_by_key(|k| k.name());
    v
}

/// The kind of this name, if the engine has it.
pub fn find(name: &str) -> Option<&'static dyn Kind> {
    KINDS.iter().copied().find(|k| k.name() == name)
}
