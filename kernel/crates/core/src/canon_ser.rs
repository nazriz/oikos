//! Canonical JSON written straight from a value's own shape, with no `serde_json::Value` made of it on the way: the
//! same bytes as `canon::canonical_value(&serde_json::to_value(x))`, for everything this writes. A state of tens of
//! megabytes is hashed at every checkpoint, and as a `Value` it took ten times its size to hold.
//!
//! It is serde_json's own serializer, with this as its formatter: the formatter is told of each object, key, string
//! and integer as it comes, writes them as `canon` does, and puts each object's members in order when the object ends.
//! What it doesn't write (a number that isn't a safe integer, anything it isn't told of in a way it knows) fails,
//! saying nothing more: `canon::canonical` then goes the long way, which gives the right bytes or the right error.

use crate::canon::{write_escaped, write_string, MAX_SAFE};
use serde::Serialize;
use serde_json::ser::{CharEscape, Formatter};
use std::io;

/// It can't be written this way (the long way says why, or does it).
#[derive(Debug)]
pub(crate) struct Unwritten;

fn unwritten<T>() -> io::Result<T> {
    Err(io::Error::other("not written directly"))
}

/// A member of an object being written: its key (where it is in `Writer::keys`), and where it starts in the output
/// (a comma, its key, a colon) and where its value does.
struct Member {
    key: (usize, usize),
    at: usize,
    value: usize,
}

/// An object being written: where its members, their keys and its bytes start.
struct Open {
    members: usize,
    keys: usize,
    start: usize,
}

#[derive(Default)]
struct Writer {
    out: Vec<u8>,
    /// The objects being written, outermost first.
    open: Vec<Open>,
    /// Their keys as given (not yet escaped), one after another: an object's are dropped when it's done.
    keys: String,
    /// Their members, likewise.
    members: Vec<Member>,
    /// A key is being given: where it starts in `keys`.
    key: Option<usize>,
    /// For putting an object's members in order.
    scratch: Vec<u8>,
    /// Asked for the outermost object's members one by one (`members_of`): they're put here, in order.
    apart: Option<Vec<(String, Vec<u8>)>>,
}

/// What serde_json's serializer is given to write to: nothing. Everything this formatter knows it writes itself, so
/// whatever arrives here came by a way it doesn't know (a number with a fraction, written by serde_json's own rule).
struct Nowhere;

impl io::Write for Nowhere {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        unwritten()
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn write<T: Serialize + ?Sized>(x: &T, w: &mut Writer) -> Result<(), Unwritten> {
    x.serialize(&mut serde_json::Serializer::with_formatter(Nowhere, w)).map_err(|_| Unwritten)
}

/// The canonical bytes of `x`.
pub(crate) fn bytes_of<T: Serialize + ?Sized>(x: &T) -> Result<Vec<u8>, Unwritten> {
    let mut w = Writer { out: Vec::with_capacity(256), ..Writer::default() };
    write(x, &mut w)?;
    Ok(w.out)
}

/// The members of `x`, which must be an object, in canonical order: each key, and its value's canonical bytes.
pub(crate) fn members_of<T: Serialize + ?Sized>(x: &T) -> Result<Vec<(String, Vec<u8>)>, Unwritten> {
    let mut w = Writer { apart: Some(vec![]), ..Writer::default() };
    write(x, &mut w)?;
    // (Anything but an object left its bytes in the output.)
    if !w.out.is_empty() {
        return Err(Unwritten);
    }
    w.apart.ok_or(Unwritten)
}

impl Writer {
    /// An integer: in a key, its digits; else itself, if it's a safe one.
    fn integer(&mut self, i: Option<i64>) -> io::Result<()> {
        let Some(i) = i else { return unwritten() };
        if self.key.is_some() {
            self.keys.push_str(&i.to_string());
            return Ok(());
        }
        if !(-MAX_SAFE..=MAX_SAFE).contains(&i) {
            return unwritten();
        }
        use std::io::Write;
        write!(self.out, "{i}")
    }

    /// An object done: its members put in JCS order (by UTF-16 code units; for ASCII keys, byte order), the last of
    /// any written twice under one key kept (as a map keeps the last value put under a key).
    fn close(&mut self, open: &Open) {
        let members = &self.members[open.members..];
        let key = |m: &Member| &self.keys[m.key.0..m.key.1];
        let in_order = members.iter().all(|m| key(m).is_ascii()) && members.windows(2).all(|w| key(&w[0]).as_bytes() < key(&w[1]).as_bytes());
        let apart = self.open.is_empty() && open.start == 0 && self.apart.is_some();
        if apart || !in_order {
            let mut order: Vec<usize> = (0..members.len()).collect();
            if !in_order {
                // (Stable: of the members under one key, the last written stays last.)
                order.sort_by(|a, b| key(&members[*a]).encode_utf16().cmp(key(&members[*b]).encode_utf16()));
            }
            let end = |i: usize| members.get(i + 1).map_or(self.out.len(), |next| next.at);
            let kept: Vec<usize> = order.iter().enumerate().filter(|(n, i)| order.get(n + 1).is_none_or(|next| key(&members[*next]) != key(&members[**i]))).map(|(_, i)| *i).collect();
            if apart {
                self.apart = Some(kept.iter().map(|&i| (key(&members[i]).to_string(), self.out[members[i].value..end(i)].to_vec())).collect());
                self.out.clear();
                self.members.truncate(open.members);
                self.keys.truncate(open.keys);
                return;
            }
            self.scratch.clear();
            for &i in &kept {
                self.scratch.extend_from_slice(&self.out[members[i].at..end(i)]);
            }
            self.out.truncate(open.start);
            self.out.extend_from_slice(&self.scratch);
        }
        // (Every member starts with a comma; the first one's becomes the object's opening brace.)
        if self.out.len() == open.start {
            self.out.push(b'{');
        } else {
            self.out[open.start] = b'{';
        }
        self.out.push(b'}');
        self.members.truncate(open.members);
        self.keys.truncate(open.keys);
    }
}

impl Formatter for &mut Writer {
    fn write_null<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        if self.key.is_some() {
            return unwritten();
        }
        self.out.extend_from_slice(b"null");
        Ok(())
    }
    fn write_bool<W: ?Sized + io::Write>(&mut self, _: &mut W, v: bool) -> io::Result<()> {
        let word = if v { "true" } else { "false" };
        match self.key {
            Some(_) => self.keys.push_str(word),
            None => self.out.extend_from_slice(word.as_bytes()),
        }
        Ok(())
    }
    fn write_i8<W: ?Sized + io::Write>(&mut self, _: &mut W, v: i8) -> io::Result<()> {
        self.integer(Some(v.into()))
    }
    fn write_i16<W: ?Sized + io::Write>(&mut self, _: &mut W, v: i16) -> io::Result<()> {
        self.integer(Some(v.into()))
    }
    fn write_i32<W: ?Sized + io::Write>(&mut self, _: &mut W, v: i32) -> io::Result<()> {
        self.integer(Some(v.into()))
    }
    fn write_i64<W: ?Sized + io::Write>(&mut self, _: &mut W, v: i64) -> io::Result<()> {
        self.integer(Some(v))
    }
    fn write_i128<W: ?Sized + io::Write>(&mut self, _: &mut W, v: i128) -> io::Result<()> {
        self.integer(i64::try_from(v).ok())
    }
    fn write_u8<W: ?Sized + io::Write>(&mut self, _: &mut W, v: u8) -> io::Result<()> {
        self.integer(Some(v.into()))
    }
    fn write_u16<W: ?Sized + io::Write>(&mut self, _: &mut W, v: u16) -> io::Result<()> {
        self.integer(Some(v.into()))
    }
    fn write_u32<W: ?Sized + io::Write>(&mut self, _: &mut W, v: u32) -> io::Result<()> {
        self.integer(Some(v.into()))
    }
    fn write_u64<W: ?Sized + io::Write>(&mut self, _: &mut W, v: u64) -> io::Result<()> {
        self.integer(i64::try_from(v).ok())
    }
    fn write_u128<W: ?Sized + io::Write>(&mut self, _: &mut W, v: u128) -> io::Result<()> {
        self.integer(i64::try_from(v).ok())
    }
    // (A number given as its digits, or a piece of JSON given whole: not by any way this knows.)
    fn write_number_str<W: ?Sized + io::Write>(&mut self, _: &mut W, _: &str) -> io::Result<()> {
        unwritten()
    }
    fn write_raw_fragment<W: ?Sized + io::Write>(&mut self, _: &mut W, _: &str) -> io::Result<()> {
        unwritten()
    }
    fn begin_string<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        if self.key.is_none() {
            self.out.push(b'"');
        }
        Ok(())
    }
    fn end_string<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        if self.key.is_none() {
            self.out.push(b'"');
        }
        Ok(())
    }
    fn write_string_fragment<W: ?Sized + io::Write>(&mut self, _: &mut W, s: &str) -> io::Result<()> {
        match self.key {
            Some(_) => self.keys.push_str(s),
            None => write_escaped(s, &mut self.out),
        }
        Ok(())
    }
    /// A character serde_json would escape: the character it is, written by `canon`'s rule.
    fn write_char_escape<W: ?Sized + io::Write>(&mut self, _: &mut W, e: CharEscape) -> io::Result<()> {
        let c = match e {
            CharEscape::Quote => '"',
            CharEscape::ReverseSolidus => '\\',
            CharEscape::Solidus => '/',
            CharEscape::Backspace => '\u{08}',
            CharEscape::FormFeed => '\u{0C}',
            CharEscape::LineFeed => '\n',
            CharEscape::CarriageReturn => '\r',
            CharEscape::Tab => '\t',
            CharEscape::AsciiControl(b) => char::from(b),
        };
        match self.key {
            Some(_) => self.keys.push(c),
            None => write_escaped(c.encode_utf8(&mut [0u8; 4]), &mut self.out),
        }
        Ok(())
    }
    fn begin_array<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        self.out.push(b'[');
        Ok(())
    }
    fn end_array<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        self.out.push(b']');
        Ok(())
    }
    fn begin_array_value<W: ?Sized + io::Write>(&mut self, _: &mut W, first: bool) -> io::Result<()> {
        if !first {
            self.out.push(b',');
        }
        Ok(())
    }
    fn end_array_value<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        Ok(())
    }
    fn begin_object<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        if self.key.is_some() {
            return unwritten();
        }
        self.open.push(Open { members: self.members.len(), keys: self.keys.len(), start: self.out.len() });
        Ok(())
    }
    fn end_object<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        let Some(open) = self.open.pop() else { return unwritten() };
        self.close(&open);
        Ok(())
    }
    fn begin_object_key<W: ?Sized + io::Write>(&mut self, _: &mut W, _: bool) -> io::Result<()> {
        self.key = Some(self.keys.len());
        Ok(())
    }
    /// A member's key given whole: written, its value to follow.
    fn end_object_key<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        let Some(from) = self.key.take() else { return unwritten() };
        let at = self.out.len();
        self.out.push(b',');
        write_string(&self.keys[from..], &mut self.out);
        self.out.push(b':');
        self.members.push(Member { key: (from, self.keys.len()), at, value: self.out.len() });
        Ok(())
    }
    fn begin_object_value<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        Ok(())
    }
    fn end_object_value<W: ?Sized + io::Write>(&mut self, _: &mut W) -> io::Result<()> {
        Ok(())
    }
}
