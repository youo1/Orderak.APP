// Drained, not parsed. Nothing here depends on the payload any more, but the
// caller still writes one, and exiting without reading it can hand that writer
// an EPIPE instead of a clean exit.
for await (const _chunk of process.stdin) {
  // no-op
}

// The improvement audit is an optional, skill-driven final step rather than a
// mandatory lifecycle continuation. This Stop hook deliberately emits no
// decision, so it never forces an extra agent turn. The audit guidance remains
// authoritative in .github/copilot-instructions.md and the
// orderak-agent-improvement skill, which the agent consults before finishing.
process.stdout.write("{}");
