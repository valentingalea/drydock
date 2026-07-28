---
name: claude-review
description: Invoke the locally installed Claude Code CLI non-interactively for an independent, read-only review of plans, architecture documents, code changes, or other repository artifacts. Use when the user asks Claude to review work, requests a second-model critique, or wants counterpoints before implementation.
---

# Claude Review

Use Claude as a second reviewer, not as the primary author or an automatic authority.

## Workflow

1. Read the target artifact and relevant repository instructions yourself.
2. Make the artifact complete enough to review before invoking Claude.
3. Run the bundled script from the repository root:

   ```sh
   tools/skills/claude-review/scripts/review.sh REFACTOR.md \
     "Challenge repository ownership, migration ordering, and operational assumptions."
   ```

4. Give Claude raw artifacts and a neutral review focus. Do not include the expected
   answer or seed it with suspected findings.
5. Read the entire response and verify every factual claim against the repository.
6. Separate actionable findings from preferences and misunderstandings.
7. Report Claude's counterpoints to the user. Do not silently change the reviewed
   artifact unless the user asked for review-and-revise.

## Invocation Contract

The script uses the locally installed CLI's non-interactive `--print` mode, disables
session persistence, selects plan permission mode, and exposes only `Read`, `Glob`, and
`Grep`. It defaults to the CLI's `opus` alias at medium effort so architectural reviews
use the current Opus model family while remaining bounded to a practical depth. This
keeps an architectural or code review read-only.

The target must exist and be readable from the current repository. Pass an optional
second argument describing the review focus. The script returns Claude's text on stdout
and propagates CLI failures.

For a custom prompt that needs several artifacts, invoke the CLI directly:

```sh
printf '%s\n' \
  "Review FILE_A and FILE_B. Identify correctness risks and counterarguments." |
  claude --print \
  --no-session-persistence \
  --permission-mode plan \
  --tools "Read,Glob,Grep" \
  --model opus \
  --effort medium
```

Do not enable edit tools or bypass permissions for a review.

Set `CLAUDE_REVIEW_MODEL` to a full model identifier when an exact Opus release must be
pinned. Set `CLAUDE_REVIEW_EFFORT` only when the task warrants a different review depth.
