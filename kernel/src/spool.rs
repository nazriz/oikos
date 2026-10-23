//! A file written on a thread of its own: the run's thread hands over whole buffers and goes on, and the writing (the
//! system call and the copy into the file) is done beside it. The bytes, and their order, are exactly those written;
//! `flush` waits until they are all in the file, and the first failure to write is given back to the next write or
//! flush (or at the end). (A run's log is gigabytes: written from the run's own thread, its writes were 6% of it at
//! 10,000 people; docs/design/performance.md.)

use std::fs::File;
use std::io::{self, Write};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::JoinHandle;

/// How much is handed over at once.
const CHUNK: usize = 1 << 20;
/// How many chunks may wait to be written before the run waits for the writer (memory held: this many megabytes).
const WAITING: usize = 8;

enum Msg {
    Data(Vec<u8>),
    /// Everything before this is in the file: say so, or how writing failed.
    Flush(SyncSender<io::Result<()>>),
}

pub struct Spool {
    buf: Vec<u8>,
    tx: Option<SyncSender<Msg>>,
    /// Emptied buffers coming back, to be filled again.
    spare: Receiver<Vec<u8>>,
    writer: Option<JoinHandle<io::Result<()>>>,
}

impl Spool {
    pub fn new(mut file: File) -> io::Result<Spool> {
        let (tx, rx) = sync_channel::<Msg>(WAITING);
        let (back, spare) = sync_channel::<Vec<u8>>(WAITING + 2);
        let writer = std::thread::Builder::new().name("log writer".into()).spawn(move || -> io::Result<()> {
            let mut failed: Option<io::Error> = None;
            for msg in rx {
                match msg {
                    Msg::Data(mut b) => {
                        if failed.is_none() {
                            if let Err(e) = file.write_all(&b) {
                                failed = Some(e);
                            }
                        }
                        b.clear();
                        let _ = back.try_send(b);
                    }
                    Msg::Flush(done) => {
                        let r = match failed.take() {
                            Some(e) => {
                                let r = Err(io::Error::new(e.kind(), e.to_string()));
                                failed = Some(e);
                                r
                            }
                            None => file.flush(),
                        };
                        let _ = done.send(r);
                    }
                }
            }
            match failed {
                Some(e) => Err(e),
                None => file.flush(),
            }
        })?;
        Ok(Spool { buf: Vec::with_capacity(CHUNK), tx: Some(tx), spare, writer: Some(writer) })
    }

    fn gone() -> io::Error {
        io::Error::new(io::ErrorKind::BrokenPipe, "the log's writer stopped")
    }

    /// Hand the buffer over (if anything is in it).
    fn hand_over(&mut self) -> io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let next = self.spare.try_recv().unwrap_or_else(|_| Vec::with_capacity(CHUNK));
        let full = std::mem::replace(&mut self.buf, next);
        self.tx.as_ref().ok_or_else(Self::gone)?.send(Msg::Data(full)).map_err(|_| Self::gone())
    }

    /// Everything written is in the file, and the writer has stopped: how it went.
    pub fn close(mut self) -> io::Result<()> {
        self.finish()
    }

    fn finish(&mut self) -> io::Result<()> {
        let handed = self.hand_over();
        self.tx = None;
        let wrote = match self.writer.take() {
            Some(w) => w.join().unwrap_or_else(|_| Err(Self::gone())),
            None => Ok(()),
        };
        handed.and(wrote)
    }
}

impl Write for Spool {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(b);
        if self.buf.len() >= CHUNK {
            self.hand_over()?;
        }
        Ok(b.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.hand_over()?;
        let (done, wait) = sync_channel(1);
        self.tx.as_ref().ok_or_else(Self::gone)?.send(Msg::Flush(done)).map_err(|_| Self::gone())?;
        wait.recv().map_err(|_| Self::gone())?
    }
}

impl Drop for Spool {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_exactly_what_it_is_given_in_order() {
        let dir = std::env::temp_dir().join(format!("oikos-spool-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("log");
        let mut want = vec![];
        {
            let mut s = Spool::new(File::create(&p).unwrap()).unwrap();
            for i in 0..300_000u32 {
                let line = format!("{{\"seq\":{i}}}\n");
                s.write_all(line.as_bytes()).unwrap();
                want.extend_from_slice(line.as_bytes());
                if i == 1000 {
                    s.flush().unwrap();
                    assert_eq!(std::fs::read(&p).unwrap(), want, "a flush puts everything so far in the file");
                }
            }
            s.close().unwrap();
        }
        assert_eq!(std::fs::read(&p).unwrap(), want);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
