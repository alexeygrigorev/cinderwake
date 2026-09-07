# Contribution workflow

- Make focused commits regularly as soon as a coherent change is complete.
- Before committing, inspect `git status` and the complete diff. Stage explicit
  paths for one logical change; leave unrelated or pre-existing user changes
  unstaged.
- Keep behavior changes, test coverage, generated evidence, and documentation
  in separate commits when they can be reviewed independently.
- Run the narrowest relevant checks before a commit, then run the broader
  project gate when the related work is complete.
- Use a short imperative commit subject that names the change. Do not rewrite,
  squash, reset, or discard existing commits or worktree changes unless the
  user explicitly asks for it.

# Player experience and evidence

- Before building or changing a game, read `docs/player-experience-contract.md`
  and `docs/action-visual-review.md`. These preserve the user's design feedback
  across games and genres; carry them into each new game adapter.
- Automate measurable behavior, including real browser input, visible control
  readability, actual audio output, save restoration, and render direction.
  Add a failing mutation that demonstrates the detector catches the defect.
- For every new or changed action, register its required directions, devices,
  stages, and precise visual checks in the action review contract. Capture
  ordered frames from the actual game and dispatch the generated prompt to a
  separate visual agent, preferably `gpt-5.6-luna`. Follow the review workflow
  until every affected case is accepted; missing evidence and uncertainty need
  better captures. Do not substitute automatic coordinates for pixel inspection.
- A green unit suite or snapshot update is not visual acceptance. Retain the
  reviewed frames, source fingerprint, explicit frame-cited verdicts and any
  unresolved findings. Report scoped reviews as scoped, without claiming the
  entire game passed.
