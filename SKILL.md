---
name: client-content-approval
description: Automates moving a finished content piece (carousel, reel, static post) from a client's local folder to the right folder in Google Drive and to the matching card in Trello, ready for client approval. Includes safety checks so files or cards from different clients are never mixed up.
version: 1.0.0
author: Monatela Communication
---

# client-content-approval

Created by Monatela Communication.

**Purpose:** take the manual, repetitive work out of getting finished content in front of a client for approval, without ever mixing up files or cards between different clients.

Uploads an approved content folder (carousel, reel, or static post) to the right client folder in Drive, and prepares the matching Trello card for client approval.

## Trigger

Use this when the user asks to upload or send a finished content folder to Drive and/or prepare Trello for client approval. Phrases like "upload this folder to Drive and send it to Trello", "take this carousel to approval", "get this content ready for the client to approve", while working inside a local project folder named after the client. Can also be called directly by typing `/client-content-approval`.

## Named rules (apply through the whole run, no exceptions)

- **The Never Guess Rule.** An ambiguous client, folder, or card means STOP and ask the user. Never pick between two plausible options on your own.
- **The Confirm Before Writing Rule.** No write action (creating a folder, uploading a file, touching a card) happens before the user confirms the mapping: client to Drive folder to Trello board.
- **The Browser for API Gaps Rule.** Real file upload and Trello attachments/comments have no direct support in the available API tools. Always do these through browser automation, never by trying to embed file content into an API call.
- **The Reference, Not Coordinates Rule.** Browser automation clicks always go through an element reference (found by searching or reading the page), never raw screenshot coordinates. Scale mismatches have already caused misclicks.
- **The Don't Touch What Wasn't Asked Rule.** A card's name, description, and labels in Trello never change during this process. Only the attachment and the list position do. Any accidental change gets fixed immediately, never left for later.

## Mode (decide once at the start, never switch mid-run without re-confirming)

- **Client already mapped this session:** the trio local folder / Drive folder / Trello board was already confirmed for this client. Skip straight to the step that's missing.
- **New or unconfirmed client:** run Step 0 from scratch before anything else.

If something doesn't match partway through (folder not found, permission denied, wrong board), go back to Step 0 instead of working around it. That's a sign the mapping was wrong.

## Steps, load only the reference for the step in progress

| Step | What it does | Reference |
|---|---|---|
| 0 | Identify and confirm the client (Drive + Trello) | [reference/identify-client.md](reference/identify-client.md) |
| 1 | Resolve or create the current month's folder | [reference/month-folder.md](reference/month-folder.md) |
| 2-3 | Create the content subfolder and upload the files | [reference/upload.md](reference/upload.md) |
| 4-6 | Find the card, attach the link, move it into position | [reference/trello-card.md](reference/trello-card.md) |
| Final | Verify everything before reporting to the user | [reference/verification.md](reference/verification.md) |

No need to read every reference at once. Load the one for the step currently running.
