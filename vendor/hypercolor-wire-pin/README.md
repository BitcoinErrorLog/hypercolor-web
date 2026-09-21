# Hypercolor wire-contract pin

Drift oracle for `scripts/check-wire-drift.sh`. These files are not product
runtime.

Source: `BitcoinErrorLog/hypercolor` at
`6185a6a8e6bf3a52831515cb85131a7020704396`.

Oracle bodies match the current `src/` copies minus the 2-line header, including
later web-side wire additions such as DM unsend (`unsent` delivery state).

Do not import this tree from the Next.js app. Copied wire files under `src/`
remain the runtime copies (2-line header + pin body).
