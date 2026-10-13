# An offer taken back before it is signed

**Source:** `Book.takenBack` (`participants/src/behaviour/common.ts`); the signers in `citizen.ts`, `credit.ts` and `institutions.ts`; both resolvers' `agreement(sign=...)`; the preview of a withdrawal and of an offer (`translator/src/preview.ts`). Decision: docs/decisions.md, "An offer can be taken back" (2026-10-12).

## The fault

Nothing in the world could take back an offer once it was made. A firm directed not to hire (docs/behaviour/directions.md) had offers made already; the person offered signed them after the direction came and was hired.

## What a real offerer does

An offer of a job, a lease or a loan is open to be accepted until it is accepted or withdrawn. Whoever made it can withdraw it before then, in writing, to the person it was made to; after it is accepted it is a contract, and withdrawing the paper ends nothing (an agreement is ended by notice, under its terms).

## How it works

- **Withdrawal is the existing withdrawal of a paper.** An offer is an agreement the maker has signed on its side and the other party has not. The maker withdraws it as it would any paper of its own: `statement(withdraw=<the offer>)`. Anyone who could see the offer sees the withdrawal (a withdrawal is seen by those who saw what it withdraws). Only the offer's maker ends its standing: anyone may write that they withdraw anything.
- **Then it cannot be signed.** A resolver asks back to anyone who tries: "rec.N has been withdrawn: if it was an offer, whoever made it has taken it back, and there is nothing to sign." A person or office run by code that reads the offer after the withdrawal does not sign it (a worker, a tenant, a borrower, a union's member, a builder). A signature made all the same, before the signer saw the withdrawal, is on the record and concludes nothing: every reader of the books (`Book.concluded`, `inForce`) counts an agreement as concluded only if every party signed it before its paper was withdrawn.
- **An agreement every party had signed when its paper was withdrawn is concluded all the same.** Withdrawing it ends nothing, and its preview says so.
- **The offerer's preview** of an offer says: "Until they sign it you can take it back: withdraw it, and it can no longer be signed." The preview of withdrawing an agreement says whether, as far as the seat has been shown, the other party has signed: an offer taken back, or an agreement in force that the withdrawal leaves standing.

## The kernel refuses a late signature (2026-10-13)

An offer that no longer stands cannot be accepted, so this is physics and the kernel turns it away. `sign_agreement` on an agreement its owner has withdrawn (the same test as everywhere: the withdrawal is by the paper's own author's entity or whoever it speaks for) is refused with `offer_withdrawn` unless every party had already signed (an agreement all had signed is concluded; withdrawing the paper ends nothing, and signing it again is harmless). A refused signature leaves no record. The signer is told, in the world's words: "the offer has been taken back by whoever made it, so there is nothing to sign".

- **Same instant.** The kernel takes commands in its one order; whichever of the withdrawal and the signature it stores first decides. A signature stored before the withdrawal stands, whatever the clock says; a withdrawal not yet stored stops nothing. (The books' reading, `Book.takenBack`, compares times, so a signature and a withdrawal of the same second count as concluded there; the kernel's order is the stricter and the one that decides what reaches the record.)
- **`State::marks`** (derived, never serialised, so no state hash moves) now also keeps `withdrawn_at` for an agreement its owner withdrew.
- **The books' reading stays** as it was: logs written before this have such signatures on the record, and every reader still counts them as nothing.
- **Old logs.** A log that holds a signature this now refuses will not replay on the new build; logs replay on the build that wrote them (decisions D6). The one pilot log checked (lv-06: 170 agreements, none withdrawn) holds none.

Tests: `kernel/tests/physics.rs` (`an_offer_its_owner_has_taken_back_cannot_be_signed`: a stranger's withdrawal stops nothing; the owner's does, at once and a day later, leaving no record; a signature that came first stands, and signing again after the withdrawal is harmless); `orchestrator/test/offer-withdrawn-run.test.ts` (the real kernel on a generated town, the refusal in the signer's words).

**Revisit if** an offer should lapse by itself (a term on it), or a withdrawal should be able to be itself withdrawn (an offer put back).
