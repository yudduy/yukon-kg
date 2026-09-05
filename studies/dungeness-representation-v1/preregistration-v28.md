# Version 28 Preregistration: Context-Fit Executable Histories

Version 28 keeps the sealed ECDSA source, verifier, reference, and direct
lineages from v27 but replaces both histories with four-event windows. Four is
the study's frozen minimum valid-event count. The histories do not overlap:

- A: events 12–15, start `c5f59aaa…44db`, score `1,249,230,840`;
- B: events 17–20, start `dcdab70f…6ff5`, score `1,243,629,702`.

Against reference `1,182,644,586`, they retain 2.23 and 2.04 meaningful gains
of sealed headroom. A read-only diagnostic using excluded v27 candidates gives
R2 totals of 27,924 and 23,408 tokens.

Trusted research-event export v2 adds only the recorded intervention array
already sealed in Yukon. Version 1 remains supported. Version 2 must preserve
each change ID, title, site, phase, relation, Idea IDs, constraint IDs, and
review disposition without inference; `bundleSize` must equal the array length.

The new plan `ee56a9e2747675f2a95b641e41ea152b3be2ea7d42eab01d9b33df7c4b988c47`
contains 11 required candidates: both bases, eight displayed events, and the
withheld reference. All 11 must be clean-verified again. Starts materialize in
`users/bx/v28`. Each window must compile twice with byte-identical results,
equal atom bytes across R0/R1/R2, no post-cutoff event, total tokens at most
32,000, and index tokens at most 4,000. Any failure stops v28. Model spending
and treatment remain unauthorized.
