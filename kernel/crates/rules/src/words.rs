//! World words for platform facts (participants/src/llm/words.ts; principle 14: the platform is invisible to
//! participants). A participant never reads a refusal code; it reads what stood in the way. The one list, for every
//! lane that reports a refusal to someone in the world's terms (a bank telling a customer why a payment was not made).

/// What stood in the way, in plain words, by the refusal's code (snake_case, as the log writes it).
pub fn refusal_text(code: Option<&str>) -> &'static str {
    match code.unwrap_or("") {
        "participant_inactive" => "you no longer act here",
        "not_in_position" => "you don't hold that post",
        "unknown_ref" => "it refers to something that doesn't exist yet",
        "duplicate_ref" => "it names two different things the same way",
        "not_custodian" => "only whoever keeps that account can move money from it",
        "not_holder" => "that account isn't yours",
        "insufficient_funds" => "the account doesn't have enough money",
        "overflow" => "the amount is too large",
        "unknown_account" => "there's no such account",
        "account_not_empty" => "the account still has money in it",
        "boundary_protected" => "that can't be closed",
        "unknown_cell" => "there's no such ground",
        "ground_occupied" => "there's already a building there",
        "unsuitable_terrain" => "that kind of building can't stand on that ground",
        "unknown_structure_type" => "that isn't a kind of building that can be built here",
        "unknown_structure" => "there's no such building",
        "structure_incomplete" => "the building isn't finished",
        "unknown_space" => "there's no such place in that building",
        "not_a_place" => "what was named as the place to be or to work is not a place: name a building, or a space in one",
        "capacity_exceeded" => "there isn't room",
        "not_present" => "they aren't there",
        "already_present" => "they're already here",
        "not_a_person" => "only a person can do that",
        "dead" => "they have died",
        "too_far" => "they're too far away",
        "not_fertile" => "that isn't possible at that age",
        "not_modelled" => "that doesn't happen here",
        "unknown_entity" => "there's no one by that name",
        "unknown_participant" => "there's no one by that name",
        "unknown_position" => "there's no such post",
        "unknown_template" => "there's no such kind of newcomer or system",
        "not_theirs" => "that isn't yours to fill or switch off",
        "reserved_kind" => "that isn't something that can be created",
        "unknown_record" => "there's no such record",
        "wrong_record_kind" => "that record isn't the right kind of thing",
        "cap_exceeded" => "the limit on that has been reached",
        "currency_mismatch" => "the two accounts are in different currencies, so money can't simply move between them (it would have to be exchanged)",
        "unknown_currency" => "there's no such currency here",
        "not_a_boundary" => "that isn't a way out of here",
        "unknown_resource" => "there's no such thing here",
        "insufficient_quantity" => "there isn't that much of it there",
        "unknown_place" => "that isn't somewhere things can be kept",
        "unknown_task" => "that isn't a kind of work anyone knows how to do here",
        "not_at_work" => "the people named aren't there to do it",
        "not_capable" => "that kind of system can't do that",
        "not_supplier" => "only whoever supplies that kind of system can put one to work",
        "no_time_left" => "there aren't enough working hours left today for that",
        "bad_survey" => "a survey has to say what it's counting and in which places, one unit of work for each place",
        "flooded" => "it's under water",
        "bad_investigation" => "an investigation has to say what was taken, from whom, and where (and the work has to be an investigation)",
        "field_exhausted" => "there isn't enough of it there to take (the river is too low, say)",
        "no_body_effect" => "that work isn't done to a person (or it is, and needs saying to whom: someone there, or a room of people)",
        "not_being_built" => "that isn't being built",
        "not_coming_down" => "that isn't being demolished",
        "coming_down" => "it's being demolished",
        "offer_withdrawn" => "the offer has been taken back by whoever made it, so there is nothing to sign",
        _ => "it isn't possible",
    }
}

/// As `refusal_text`, naming which item of several was refused (`item` counted from nought).
pub fn refusal_item_text(code: Option<&str>, item: Option<usize>, items: usize) -> String {
    let base = refusal_text(code);
    match item {
        Some(i) if items > 1 => format!("{base} (item {})", i + 1),
        _ => base.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_is_said_in_the_world_s_words_and_an_unknown_one_plainly() {
        assert_eq!(refusal_text(Some("unknown_account")), "there's no such account");
        assert_eq!(refusal_text(Some("insufficient_funds")), "the account doesn't have enough money");
        assert_eq!(refusal_text(Some("nonsense")), "it isn't possible");
        assert_eq!(refusal_text(None), "it isn't possible");
        assert_eq!(refusal_item_text(Some("dead"), Some(1), 3), "they have died (item 2)");
        assert_eq!(refusal_item_text(Some("dead"), Some(0), 1), "they have died");
    }
}
