// MIRROR — deletion authorization policy
//
// Evaluated by decide.py via the real Cedar engine (cedarpy), not a
// hand-rolled if/else. This is genuine authorization-as-policy: the
// rules below are the actual source of truth for what's allowed.
//
// Policy order matters for decide.py's reason-mapping (see decide.py's
// POLICY_ID_MEANING dict) — don't reorder without updating it there too.

// policy0 — hard block. A resource with real dependents is NEVER safe
// to delete automatically, no matter how low its activity score is.
// This is what catches archive-2023 and user-sessions in the demo.
forbid(
    principal,
    action == Mirror::Action::"delete",
    resource
) when {
    context.dependents_count > 0
};

// policy1 — explicit safe path. Zero dependents AND low risk score
// means auto-execute is allowed.
permit(
    principal,
    action == Mirror::Action::"delete",
    resource
) when {
    context.dependents_count == 0 &&
    context.risk_score < 50
};

// Anything else (zero dependents but risk_score >= 50 — e.g. a resource
// nobody references, but one whose recency signal is ambiguous or whose
// blast-radius estimate is otherwise uncertain) falls through to Cedar's
// implicit deny. decide.py treats "denied with no forbid reason" as
// NEEDS_REVIEW rather than BLOCKED — a human should look, not that it's
// definitely unsafe.
