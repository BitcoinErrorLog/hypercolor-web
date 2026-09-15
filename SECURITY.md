# Security

Hypercolor web speaks the same Encrypted Links protocol as mobile Hypercolor
(`6185a6a8e6bf3a52831515cb85131a7020704396`). The threat model is not the same.

## Web key custody is weaker

Receiver Noise secrets, link snapshots, and any session material that enters
this runtime live in **JavaScript and wasm memory**. There is no OS keychain
and no secure enclave. A memory dump, a malicious extension, or a debugger
on an unlocked browser profile can read them.

The identity secret must stay in Pubky Ring. This app must never call
`signinWithSecret` / `signupWithSecret` in production.

## XSS is the kill shot

If an attacker can run script in this origin, they can read wasm memory,
exfiltrate snapshots, and send on the user's Encrypted Links. Treat XSS as
full account compromise for messaging — not as a cosmetic bug.

**P8** will add a strict Content-Security-Policy and a ban on third-party
scripts. Until then, do not add analytics, widgets, or CDNs that execute
script. `vercel.json` does not set COOP/COEP (paykit-wasm does not need
SharedArrayBuffer; COEP breaks many CDNs).

## What this file does not claim

- No independent security review of paykit-rs, pubky-noise, or paykit-wasm.
- Homeserver ciphertext is not a confidentiality boundary if the receiver
  key leaks.
- BLE mesh is omitted; do not assume mobile mesh threat coverage applies.

Report vulnerabilities privately to the repository owner. Do not file public
issues that include secrets, snapshots, or session cookies.
