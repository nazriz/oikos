//! The engine inside the participant host's process (docs/design/rebuild.md section 5.1): the kernel's session,
//! with the same requests and replies as the stdio protocol (kernel/src/protocol.rs), without a subprocess or a pipe.

use napi_derive::napi;
use terrarium_kernel::protocol::Session;

// The kernel allocates heavily (JSON values, canonical encoding): the same allocator as its binary. Results don't
// depend on it.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// One run's session, in-process.
#[napi]
pub struct KernelSession {
    session: Session,
}

#[napi]
impl KernelSession {
    #[napi(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { session: Session::new() }
    }

    /// One request as a line of JSON; its reply as one.
    #[napi]
    pub fn request(&mut self, line: String) -> String {
        self.session.request_line(&line)
    }

    /// The host is done with it: a run still open ends as aborted.
    #[napi]
    pub fn close(&mut self) {
        self.session.close();
    }

    /// The kernel's build, for the log header's provenance.
    #[napi]
    pub fn version() -> String {
        terrarium_kernel::run::KERNEL_VERSION.to_string()
    }

    /// The fingerprint of the sources it was built from (kernel/build.rs), to match against the binary's.
    #[napi]
    pub fn source() -> String {
        terrarium_kernel::run::KERNEL_SOURCE.to_string()
    }
}
