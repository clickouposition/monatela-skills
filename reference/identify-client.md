# Step 0: Identify and confirm the client

Always the first thing to run when the client has not yet been confirmed in this session (see Mode, in `SKILL.md`).

## When to run this

- Every time the target client has not yet been confirmed in this session.
- Again, from scratch, if any later step fails in a way that suggests the mapping was wrong (folder not found, permission denied, wrong board).

## Procedure

1. Extract the client identifier from the name of the local project folder where the skill is running.
2. Search Google Drive for a folder whose name contains that identifier (accept suffix/prefix variations, e.g. "NAME - EXPERT").
3. Search Trello for a board called "EDITORIAL LINE | \<CLIENT\>" using the same identifier.
4. If the Drive or Trello search does not return exactly one plausible result (zero or more than one), apply **the Never Guess Rule** (see `SKILL.md`) and stop. Ask the user to disambiguate.
5. Show the resolved mapping (local folder to Drive folder to Trello board) and ask for explicit confirmation before moving on to `month-folder.md`.

## Pitfalls

- Accepting a match that is too loose (e.g. a similar last name matching two different clients). Require the full identifier, not a fragment.
- Reusing a mapping already confirmed for a different client in the same session. Each client needs its own confirmation, every time.
- Proceeding on "this one is probably it" when two similar boards or folders exist. That is exactly the case the Never Guess Rule covers.
