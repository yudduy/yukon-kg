# Version 31 Preregistration: First-Model Representation Pilot

Version 31 is the first paid representation experiment. It freezes six complete
blocks before any treatment result exists: two ECDSA histories, two Toy ISA
histories, and two VLIW histories. Each block contains one clean-verified start
and three content-addressed views whose canonical atom bytes are equal within
the block. Only the deterministic `index.md` organization differs.

The SHA-256 randomizer assigns all six permutations of R0/R1/R2 exactly once
across the six blocks. Run IDs are opaque. Treatment names remain only in the
host assignment manifest and do not appear in prompts, task metadata, paths, or
run labels. All cells use the pinned `openai/gpt-5.6-sol` OpenRouter route, high
reasoning effort, the same Codex harness, three fresh sessions, and fixed round
caps of `$3`, 200,000 model tokens, 30 minutes, and four evaluations. The chain
caps are `$9`, 600,000 model tokens, 90 minutes, and 12 evaluations.

The first-model allocation is at most `$162` beyond the already committed
`$25.227542`. Therefore the experiment's cumulative stop is `$187.227542`,
while the unchanged atomic study ledger independently retains the hard `$500`
ceiling. A chain may stop early on any cap. No missing treatment outcome may be
dropped; agent crashes, invalid candidates, treatment-induced timeouts, or no
evaluation remain real outcomes. Provider/host/verifier-service failures must
be classified before unblinding and may receive only one explicitly linked
whole-block administrative replacement.

After each round, only the best clean-reverified development candidate advances.
That arm's events are appended and rendered with the same representation; no
post-fork evidence crosses arms. The sealed outer verifier scores the candidate
held at 0%, 25%, 50%, 75%, and 100% of cumulative budget. Outer scores never
enter later views.

The primary outcome is task-equal paired progress-AUC in meaningful-gain units.
One meaningful gain is 10% of the frozen official-baseline-to-reference gap.
Report all six blocks, pairwise arm differences, hierarchical bootstrap
intervals, probability of improvement, final-score noninferiority, valid
evaluation rate, reading cost, and candidate diversity. These six blocks are a
pilot, not confirmatory evidence.

Run the Kimi replication only if one structured arm improves paired mean AUC by
at least 0.25 units, wins at least four of six blocks, remains final-score
noninferior within 0.25 units, all integrity gates pass, and a separately frozen
exact Kimi route is available. Confirmation remains user-gated regardless of
pilot outcome.

Known risk: AutoLab tasks: no declared license as of commit 7aff5fe71dfbe152fb0b8e8ac8087210b4bc27d5; used for internal evaluation only, not redistributed
