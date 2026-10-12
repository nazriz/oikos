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

## Leaves out

The kernel records a signature on a withdrawn offer as it records any signature; it does not refuse it. What the signature is worth is the books' reading (above): so a signature that reaches the record after the withdrawal, from a signer who had not seen it, is a mistake the world records and no one counts. **Revisit if** a kernel-level refusal (a signature on a withdrawn offer turned away at the act) is wanted: it is a generic contract mechanism, one more refusal code and a few lines in the kernel's signing; it was not done here because every reader already treats such a signature as nothing, and the kernel refusing it would change replays of older logs.
