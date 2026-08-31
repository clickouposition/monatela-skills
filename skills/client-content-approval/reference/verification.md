# Final verification

## Fixed verdict vocabulary

Always end the run with one of these four words. Never another one, never a variation:

- `ok`: everything checked, nothing to fix.
- `needs-correction`: something was checked and is wrong. List objectively what.
- `blocked-ambiguity`: stopped at an ambiguous choice (the Never Guess Rule) and is waiting on the user's answer.
- `blocked-permission`: stopped due to a missing permission (e.g. a folder without Editor access) and is waiting on someone else's action.

The word comes first, alone. Details come after it, never mixed in before it.

## Checklist

- File count and size in the Drive destination folder match the local source.
- Card: title and description unchanged from their state before the run.
- Card: exactly one new attachment present, with the expected display name.
- Card: in the correct list and position (between the two reference cards).
- Report to the user: the Drive folder link plus the Trello card link, together with the verdict word.

## Pitfalls

- Reporting `ok` without actually checking. Trusting that "it worked" without reconfirming via the API or a screenshot is the most common cause of a silent failure.
- Mixing the verdict with a long explanation before the word. The word alone always comes first.
- Using a verdict word outside the fixed vocabulary (e.g. "partially ok," "probably fine"). That breaks the whole point of a fixed vocabulary, which is to be unambiguous.
