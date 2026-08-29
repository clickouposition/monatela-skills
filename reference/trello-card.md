# Steps 4-6: Trello card, locate, attach, position

## When to run this

After the upload is confirmed (`upload.md`).

## Procedure: locate the correct card

1. On the board confirmed in Step 0, list the cards in the "CONTENT/PLANNING" list.
2. Match the card whose text/theme corresponds to the content that was sent (compare the cover image, caption, or description, never just a file name).
3. Ambiguity between two or more similar cards triggers **the Never Guess Rule**. Ask the user which one is correct.

## Procedure: attach the folder link

**The Browser for API Gaps Rule** applies here: the available Trello API tool has no working attachment or comment action.

1. Open the card in Trello through the browser.
2. Click "Attachment" using an element reference. **The Reference, Not Coordinates Rule** applies here without exception: scale differences between a screenshot and the real viewport can make a click land on the wrong field (this has already caused text to be inserted into a card's title by mistake).
3. Fill the link field with the Drive folder URL and the display text field with the folder name.
4. Confirm/insert the attachment.
5. Verify with a screenshot that the attachment appears with the correct name and that **the card's title and description did not change** (the Don't Touch What Wasn't Asked Rule). If they did change, fix it before moving to the next step. Never leave it "for later."

## Procedure: move the card into "With Client," in the right position

The available API does not expose a card's numeric position. It only accepts moving to "top," "bottom," or an absolute number.

1. Move the target card to the destination list at position "bottom."
2. Move the card that should end up right below it (e.g. "CHANGES") also to "bottom" of the same list. This pushes the target card into the middle, between the two reference cards.
3. Check the final order by listing the cards in the destination list.

## Pitfalls

- Reading "action not recognized" from the API tool as a transient bug and retrying. It is a known limitation of the tool. Using the browser is the fix, not repeating the call.
- Clicking by raw screenshot coordinates instead of an element reference. It can hit the card's title instead of the intended button.
- Moving only the target card without also moving the reference card below it. The target ends up at the wrong end of the list, not in the middle.
- Leaving an accidental change (e.g. to the title) to fix "later." Fix it immediately, before continuing.
