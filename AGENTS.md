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
