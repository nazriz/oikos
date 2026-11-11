//! What a body that receives a paper requires before it acts on it (docs/design/obstacles.md, O1 and O4): the items its
//! own form asks for, and, for a paper sent for someone by someone else, that person's authority on file. A body
//! publishes what it requires, so anyone can read it first; its clerk reads each paper against it and sends back one that
//! falls short, saying what is missing. Pure: the requirements are config data (the body's published notice), the paper
//! is its data, and the authorities are what the body has recorded.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// What a body requires of the papers it receives, by kind (its published notice's `requires`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Requirements {
    /// For each kind, the items (fields of the paper's data) its form asks for.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub items: BTreeMap<String, Vec<Item>>,
    /// The kinds it acts on for a person only on that person's own word, or on the word of someone they have authorised
    /// with it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authority: Vec<String>,
    /// Why, in words, with the form or rule it follows (the profile's source).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<String>,
}

/// One item a form asks for: the field, and what it is called on the form.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub field: String,
    pub says: String,
}

impl Requirements {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty() && self.authority.is_empty()
    }
}

/// The items a paper of a kind lacks: a field absent, null, or empty words. In the order the form lists them.
pub fn missing<'a>(req: &'a Requirements, kind: &str, data: &Value) -> Vec<&'a Item> {
    req.items.get(kind).into_iter().flatten().filter(|i| match data.get(&i.field) {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }).collect()
}

/// An authority on file: who gave it, the posts it names, the kinds it covers (none: every kind the body requires one
/// for), and from when it stands (when the body recorded it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authority {
    pub by: String,
    pub posts: Vec<String>,
    pub kinds: Vec<String>,
}

/// Whether a paper of `kind` sent for `for_` from the post `post` is on someone's word the body takes: the kind needs no
/// authority; or it is sent by `for_` themselves (no post, or a post of their own: `own`); or an authority `for_` gave
/// names the post for the kind.
pub fn authorised(req: &Requirements, kind: &str, for_: &str, post: Option<&str>, own: bool, on_file: &[Authority]) -> bool {
    if !req.authority.iter().any(|k| k == kind) || own {
        return true;
    }
    let Some(post) = post else { return true };
    on_file.iter().any(|a| a.by == for_ && a.posts.iter().any(|p| p == post) && (a.kinds.is_empty() || a.kinds.iter().any(|k| k == kind)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req() -> Requirements {
        Requirements {
            items: [("loan_application".to_string(), vec![Item { field: "account".into(), says: "the account to pay it into".into() }, Item { field: "purpose".into(), says: "what it is for".into() }])].into(),
            authority: vec!["loan_application".into()],
            basis: None,
        }
    }

    #[test]
    fn a_paper_lacks_what_its_form_asks_for_and_a_paper_sent_for_someone_needs_their_authority() {
        let r = req();
        let lacks: Vec<&str> = missing(&r, "loan_application", &json!({ "account": "acc-1", "purpose": " " })).iter().map(|i| i.field.as_str()).collect();
        assert_eq!(lacks, ["purpose"]);
        assert!(missing(&r, "complaint", &json!({})).is_empty(), "a kind it lists nothing for");
        let a = Authority { by: "ann".into(), posts: vec!["desk".into()], kinds: vec![] };
        assert!(authorised(&r, "loan_application", "ann", None, false, &[]), "her own");
        assert!(authorised(&r, "loan_application", "ann", Some("ann-shop"), true, &[]), "from a post of her own");
        assert!(!authorised(&r, "loan_application", "ann", Some("desk"), false, &[]), "from someone else's post, no authority");
        assert!(authorised(&r, "loan_application", "ann", Some("desk"), false, std::slice::from_ref(&a)));
        assert!(!authorised(&r, "loan_application", "bob", Some("desk"), false, &[a]), "hers covers nobody else");
        assert!(authorised(&r, "complaint", "ann", Some("desk"), false, &[]), "a kind needing none");
    }
}
