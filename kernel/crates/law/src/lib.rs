//! The law reader (D27; docs/research/cel-check): the formal part of a statement (a law, a procedure) is a CEL
//! condition over an act, as a block-shaped object, the acting entity and the time. Integers only, and only the
//! allowlisted functions. Used by code-run institutions (a planning officer checking an application, an inspector
//! judging a site), by the translator's warnings and by measurement; never by the kernel: a law's formal condition has
//! no power, an institution chooses to apply it.
//!
//! The evaluator is ours, over `cel-parser`'s syntax tree (macros already expanded), and keeps CEL's semantics for the
//! allowed subset strictly: a missing field is an error, not null; `&&` and `||` absorb an error when the other side
//! decides (false, true); `!`, `?:` and the comparisons take only their own types; integer arithmetic stops on
//! overflow. A lax reader would let a missing field quietly make a prohibition not match.

use cel_parser::ast::{EntryExpr, Expr, IdedExpr};
use cel_parser::reference::Val;
use std::collections::BTreeMap;
use std::rc::Rc;

/// The build's source fingerprint (build.rs): lets the TypeScript side refuse a stale WebAssembly module.
pub const SOURCE: &str = env!("OIKOS_LAW_SOURCE");

/// The operators and functions a condition may use (the macros `has`, `all`, `exists`, `exists_one`, `map` and
/// `filter` arrive expanded, as selections and comprehensions).
const OPERATORS: &[&str] = &[
    "_&&_", "_||_", "!_", "_==_", "_!=_", "_<_", "_<=_", "_>_", "_>=_", "_+_", "_-_", "_*_", "_/_", "_%_", "-_",
    "_?_:_", "_[_]", "@in", "@not_strictly_false", "size", "int", "string", "startsWith", "endsWith", "contains",
];
const CUSTOM: &[&str] = &["holds_liberty", "holds_right"];

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    List(Vec<Value>),
    Map(BTreeMap<String, Value>),
}

/// A standing claim as the reader understands it: a position (liberty, right) held by someone, to an action, about an
/// object.
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub position: String,
    pub holder: String,
    pub action: String,
    pub object: String,
}

impl Claim {
    /// From a claim record (`{position, holder, about: {action, object}}`); None if it lacks any of them.
    pub fn from_record(r: &serde_json::Value) -> Option<Claim> {
        let s = |v: Option<&serde_json::Value>| v.and_then(|x| x.as_str()).map(str::to_string);
        Some(Claim {
            position: s(r.get("position"))?,
            holder: s(r.get("holder"))?,
            action: s(r.pointer("/about/action"))?,
            object: s(r.pointer("/about/object"))?,
        })
    }
}

/// The value of a JSON input: numbers must be integers.
pub fn from_json(v: &serde_json::Value) -> Result<Value, String> {
    Ok(match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => Value::Int(n.as_i64().ok_or_else(|| format!("{n} is not an integer"))?),
        serde_json::Value::String(s) => Value::Str(s.clone()),
        serde_json::Value::Array(xs) => Value::List(xs.iter().map(from_json).collect::<Result<_, _>>()?),
        serde_json::Value::Object(m) =>
            Value::Map(m.iter().map(|(k, x)| Ok((k.clone(), from_json(x)?))).collect::<Result<_, String>>()?)
        ,
    })
}

type R = Result<Value, String>;

thread_local! {
    static PARSED: std::cell::RefCell<BTreeMap<String, Result<Rc<IdedExpr>, String>>> = Default::default();
}

/// A condition's syntax tree (parsed once per condition).
fn parse(condition: &str) -> Result<Rc<IdedExpr>, String> {
    if let Some(p) = PARSED.with(|c| c.borrow().get(condition).cloned()) {
        return p;
    }
    // (The generated parser panics on some malformed input instead of saying so: that's a parse error too. Built to
    // WebAssembly a panic traps, and the host treats the trap the same way.)
    let p = match std::panic::catch_unwind(|| cel_parser::Parser::new().parse(condition)) {
        Ok(r) => r.map(Rc::new).map_err(|e| format!("parse: {e}")),
        Err(_) => Err("parse: malformed condition".to_string()),
    };
    PARSED.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= 1024 {
            c.clear();
        }
        c.insert(condition.to_string(), p.clone());
    });
    p
}

/// Why a condition may not be used, or none if it may.
pub fn violations(condition: &str) -> Result<Vec<String>, String> {
    let e = parse(condition)?;
    let mut out = vec![];
    walk(&e, &mut out);
    Ok(out)
}

fn walk(e: &IdedExpr, out: &mut Vec<String>) {
    match &e.expr {
        Expr::Literal(Val::Double(_)) => out.push("literal doubleValue".into()),
        Expr::Literal(Val::UInt(_)) => out.push("literal uint64Value".into()),
        Expr::Literal(Val::Bytes(_)) => out.push("literal bytesValue".into()),
        Expr::Literal(_) | Expr::Ident(_) | Expr::Unspecified => {}
        Expr::Call(c) => {
            if !OPERATORS.contains(&c.func_name.as_str()) && !CUSTOM.contains(&c.func_name.as_str()) {
                out.push(format!("function {}", c.func_name));
            }
            c.target.iter().for_each(|t| walk(t, out));
            c.args.iter().for_each(|a| walk(a, out));
        }
        Expr::Comprehension(c) => {
            for x in [&c.iter_range, &c.accu_init, &c.loop_cond, &c.loop_step, &c.result] {
                walk(x, out);
            }
        }
        Expr::List(l) => l.elements.iter().for_each(|x| walk(x, out)),
        Expr::Map(m) => m.entries.iter().for_each(|x| match &x.expr {
            EntryExpr::MapEntry(me) => {
                walk(&me.key, out);
                walk(&me.value, out);
            }
            EntryExpr::StructField(f) => walk(&f.value, out),
        }),
        Expr::Select(s) => walk(&s.operand, out),
        Expr::Struct(s) => out.push(format!("message {}", s.type_name)),
    }
}

/// Evaluate a formal condition against an act (a block-shaped object), the acting entity and the claims the reader
/// knows of. True means "this act matches the condition" (for a prohibition: it would be a breach). An error is a
/// verdict too (the condition can't be read of this act), never a panic.
pub fn evaluate(condition: &str, block: &serde_json::Value, actor: &str, now: i64, claims: &[Claim]) -> Result<bool, String> {
    let bad = violations(condition)?;
    if !bad.is_empty() {
        return Err(format!("condition not allowed: {}", bad.join(", ")));
    }
    let e = parse(condition)?;
    let env = Env { claims };
    let mut scope = vec![
        ("block".to_string(), from_json(block)),
        ("actor".to_string(), Ok(Value::Str(actor.to_string()))),
        ("now".to_string(), Ok(Value::Int(now))),
    ];
    match env.eval(&e, &mut scope)? {
        Value::Bool(b) => Ok(b),
        _ => Err("condition did not produce true or false".into()),
    }
}

struct Env<'a> {
    claims: &'a [Claim],
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Int(_) => "int",
        Value::Str(_) => "string",
        Value::List(_) => "list",
        Value::Map(_) => "map",
    }
}

fn no_overload(f: &str, args: &[&Value]) -> String {
    format!("no such overload: {f}({})", args.iter().map(|a| kind(a)).collect::<Vec<_>>().join(", "))
}

/// CEL equality: values of different kinds are unequal.
fn equal(a: &Value, b: &Value) -> bool {
    a == b
}

impl Env<'_> {
    fn eval(&self, e: &IdedExpr, scope: &mut Vec<(String, R)>) -> R {
        match &e.expr {
            Expr::Literal(v) => match v {
                Val::Int(i) => Ok(Value::Int(*i)),
                Val::String(s) => Ok(Value::Str(s.clone())),
                Val::Boolean(b) => Ok(Value::Bool(*b)),
                Val::Null => Ok(Value::Null),
                other => Err(format!("literal {other:?} not allowed")),
            },
            Expr::Ident(name) => match scope.iter().rev().find(|(n, _)| n == name) {
                Some((_, v)) => v.clone(),
                None => Err(format!("undeclared reference to '{name}'")),
            },
            Expr::Select(s) => match self.eval(&s.operand, scope)? {
                Value::Map(m) if s.test => Ok(Value::Bool(m.contains_key(&s.field))),
                Value::Map(m) => m.get(&s.field).cloned().ok_or_else(|| format!("no such key: {}", s.field)),
                other => Err(format!("cannot select '{}' of {}", s.field, kind(&other))),
            },
            Expr::List(l) => Ok(Value::List(l.elements.iter().map(|x| self.eval(x, scope)).collect::<Result<_, _>>()?)),
            Expr::Map(m) => {
                let mut out = BTreeMap::new();
                for entry in &m.entries {
                    let EntryExpr::MapEntry(me) = &entry.expr else { return Err("struct field in a map".into()) };
                    match self.eval(&me.key, scope)? {
                        Value::Str(k) => {
                            out.insert(k, self.eval(&me.value, scope)?);
                        }
                        other => return Err(format!("map keys must be strings here, not {}", kind(&other))),
                    }
                }
                Ok(Value::Map(out))
            }
            Expr::Comprehension(c) => {
                let items = match self.eval(&c.iter_range, scope)? {
                    Value::List(xs) => xs,
                    Value::Map(m) => m.into_keys().map(Value::Str).collect(),
                    other => return Err(format!("cannot range over {}", kind(&other))),
                };
                let mut accu = self.eval(&c.accu_init, scope);
                for item in items {
                    scope.push((c.iter_var.clone(), Ok(item)));
                    scope.push((c.accu_var.clone(), accu.clone()));
                    let go = self.eval(&c.loop_cond, scope);
                    if go != Ok(Value::Bool(false)) {
                        accu = self.eval(&c.loop_step, scope);
                    }
                    scope.truncate(scope.len() - 2);
                    if go == Ok(Value::Bool(false)) {
                        break;
                    }
                }
                scope.push((c.accu_var.clone(), accu));
                let out = self.eval(&c.result, scope);
                scope.pop();
                out
            }
            Expr::Call(call) => self.call(call, scope),
            Expr::Struct(s) => Err(format!("message {} not allowed", s.type_name)),
            Expr::Unspecified => Err("empty expression".into()),
        }
    }

    fn call(&self, call: &cel_parser::ast::CallExpr, scope: &mut Vec<(String, R)>) -> R {
        let f = call.func_name.as_str();
        match f {
            // Logic, where an error is absorbed when the other side decides.
            "_&&_" | "_||_" => {
                let decides = f == "_||_";
                let a = self.eval(&call.args[0], scope);
                if a == Ok(Value::Bool(decides)) {
                    return a;
                }
                let b = self.eval(&call.args[1], scope);
                return match (a, b) {
                    (_, Ok(Value::Bool(x))) if x == decides => Ok(Value::Bool(x)),
                    (Ok(Value::Bool(_)), Ok(Value::Bool(y))) => Ok(Value::Bool(y)),
                    (Err(e), _) | (_, Err(e)) => Err(e),
                    (Ok(x), Ok(y)) => Err(no_overload(f, &[&x, &y])),
                };
            }
            "_?_:_" => {
                return match self.eval(&call.args[0], scope)? {
                    Value::Bool(true) => self.eval(&call.args[1], scope),
                    Value::Bool(false) => self.eval(&call.args[2], scope),
                    other => Err(no_overload(f, &[&other])),
                };
            }
            "@not_strictly_false" => {
                return Ok(match self.eval(&call.args[0], scope) {
                    Ok(Value::Bool(b)) => Value::Bool(b),
                    _ => Value::Bool(true),
                });
            }
            _ => {}
        }
        let target = match &call.target {
            Some(t) => Some(self.eval(t, scope)?),
            None => None,
        };
        let args = call.args.iter().map(|a| self.eval(a, scope)).collect::<Result<Vec<_>, _>>()?;
        // (A method's receiver comes first, as in a global call: `s.size()` is `size(s)`.)
        let all: Vec<&Value> = target.iter().chain(args.iter()).collect();
        let bool_ = |b: bool| Ok(Value::Bool(b));
        match (f, all.as_slice()) {
            ("!_", [Value::Bool(b)]) => bool_(!b),
            ("-_", [Value::Int(i)]) => i.checked_neg().map(Value::Int).ok_or_else(|| "integer overflow".into()),
            ("_==_", [a, b]) => bool_(equal(a, b)),
            ("_!=_", [a, b]) => bool_(!equal(a, b)),
            ("_<_" | "_<=_" | "_>_" | "_>=_", [a, b]) => {
                let o = match (a, b) {
                    (Value::Int(x), Value::Int(y)) => x.cmp(y),
                    (Value::Str(x), Value::Str(y)) => x.cmp(y),
                    (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
                    _ => return Err(no_overload(f, &all)),
                };
                bool_(match f {
                    "_<_" => o.is_lt(),
                    "_<=_" => o.is_le(),
                    "_>_" => o.is_gt(),
                    _ => o.is_ge(),
                })
            }
            ("_+_", [Value::Str(x), Value::Str(y)]) => Ok(Value::Str(format!("{x}{y}"))),
            ("_+_", [Value::List(x), Value::List(y)]) => Ok(Value::List(x.iter().chain(y).cloned().collect())),
            ("_+_" | "_-_" | "_*_" | "_/_" | "_%_", [Value::Int(x), Value::Int(y)]) => {
                if (f == "_/_" || f == "_%_") && *y == 0 {
                    return Err(if f == "_/_" { "divide by zero" } else { "modulus by zero" }.into());
                }
                match f {
                    "_+_" => x.checked_add(*y),
                    "_-_" => x.checked_sub(*y),
                    "_*_" => x.checked_mul(*y),
                    "_/_" => x.checked_div(*y),
                    _ => x.checked_rem(*y),
                }
                .map(Value::Int)
                .ok_or_else(|| "integer overflow".into())
            }
            ("@in", [x, Value::List(xs)]) => bool_(xs.iter().any(|y| equal(x, y))),
            ("@in", [Value::Str(k), Value::Map(m)]) => bool_(m.contains_key(k)),
            ("@in", [_, Value::Map(_)]) => bool_(false),
            ("_[_]", [Value::List(xs), Value::Int(i)]) => {
                usize::try_from(*i).ok().and_then(|i| xs.get(i)).cloned().ok_or_else(|| format!("index out of range: {i}"))
            }
            ("_[_]", [Value::Map(m), Value::Str(k)]) => m.get(k).cloned().ok_or_else(|| format!("no such key: {k}")),
            ("size", [Value::Str(s)]) => Ok(Value::Int(s.chars().count() as i64)),
            ("size", [Value::List(xs)]) => Ok(Value::Int(xs.len() as i64)),
            ("size", [Value::Map(m)]) => Ok(Value::Int(m.len() as i64)),
            ("int", [Value::Int(i)]) => Ok(Value::Int(*i)),
            ("int", [Value::Str(s)]) => s.parse().map(Value::Int).map_err(|_| format!("cannot convert '{s}' to int")),
            ("string", [Value::Str(s)]) => Ok(Value::Str(s.clone())),
            ("string", [Value::Int(i)]) => Ok(Value::Str(i.to_string())),
            ("string", [Value::Bool(b)]) => Ok(Value::Str(b.to_string())),
            ("startsWith", [Value::Str(s), Value::Str(p)]) => bool_(s.starts_with(p.as_str())),
            ("endsWith", [Value::Str(s), Value::Str(p)]) => bool_(s.ends_with(p.as_str())),
            ("contains", [Value::Str(s), Value::Str(p)]) => bool_(s.contains(p.as_str())),
            // holds_liberty(who, action, object): a standing claim of that position, to that action, about that object.
            ("holds_liberty" | "holds_right", [Value::Str(who), Value::Str(action), Value::Str(object)]) if call.target.is_none() => {
                let position = if f == "holds_liberty" { "liberty" } else { "right" };
                bool_(self.claims.iter().any(|c| c.position == position && &c.holder == who && &c.action == action && &c.object == object))
            }
            _ if OPERATORS.contains(&f) || CUSTOM.contains(&f) => Err(no_overload(f, &all)),
            _ => Err(format!("function {f} not allowed")),
        }
    }
}

/// One call as JSON, for the WebAssembly boundary (and tests): `{op: "evaluate", condition, block, actor, now, claims}`
/// gives `{value}` or `{error}`; `{op: "violations", condition}` gives `{violations}` or `{error}`; `{op: "source"}`
/// gives `{source}`.
pub fn call(input: &str) -> String {
    let out = (|| -> Result<serde_json::Value, String> {
        let q: serde_json::Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
        let s = |k: &str| q.get(k).and_then(|v| v.as_str()).ok_or_else(|| format!("missing {k}"));
        match s("op")? {
            "evaluate" => {
                let claims: Vec<Claim> = q.get("claims").and_then(|c| c.as_array()).map(|cs| cs.iter().filter_map(Claim::from_record).collect()).unwrap_or_default();
                let now = q.get("now").and_then(|n| n.as_i64()).ok_or("missing now")?;
                Ok(match evaluate(s("condition")?, q.get("block").unwrap_or(&serde_json::Value::Null), s("actor")?, now, &claims) {
                    Ok(v) => serde_json::json!({ "value": v }),
                    Err(e) => serde_json::json!({ "error": e }),
                })
            }
            "violations" => Ok(match violations(s("condition")?) {
                Ok(v) => serde_json::json!({ "violations": v }),
                Err(e) => serde_json::json!({ "error": e }),
            }),
            "source" => Ok(serde_json::json!({ "source": SOURCE })),
            other => Err(format!("unknown op {other}")),
        }
    })();
    out.unwrap_or_else(|e| serde_json::json!({ "error": e })).to_string()
}

/// The WebAssembly boundary: the host writes a JSON call into memory it asked for (`law_alloc`), calls `law_call`,
/// and reads the answer at the pointer and length packed in the result (pointer high, length low), then frees both.
#[cfg(target_arch = "wasm32")]
mod wasm {
    #[no_mangle]
    pub extern "C" fn law_alloc(len: usize) -> *mut u8 {
        let mut v = Vec::<u8>::with_capacity(len);
        let p = v.as_mut_ptr();
        std::mem::forget(v);
        p
    }

    /// # Safety
    /// `p` and `len` are as `law_alloc` or `law_call` gave them.
    #[no_mangle]
    pub unsafe extern "C" fn law_free(p: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(p, 0, len));
    }

    /// # Safety
    /// `p` points at `len` bytes of UTF-8 the host wrote.
    #[no_mangle]
    pub unsafe extern "C" fn law_call(p: *const u8, len: usize) -> u64 {
        let input = std::str::from_utf8(std::slice::from_raw_parts(p, len)).unwrap_or("");
        let out = Box::into_raw(super::call(input).into_bytes().into_boxed_slice());
        let (ptr, n) = (out as *mut u8, out.len());
        ((ptr as u64) << 32) | n as u64
    }
}

#[cfg(test)]
mod tests;
