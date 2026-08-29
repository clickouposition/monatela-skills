# API reference: direct implementation (no browser workaround)

These are the public, stable Google Drive and Trello endpoints that cover 100% of the flow, with no need for browser automation. Use this as a base for implementing in any language/framework. Always confirm against the current official documentation (the APIs rarely change, but check before going to production):

- Google Drive API v3: https://developers.google.com/drive/api/reference/rest/v3
- Trello REST API: https://developer.atlassian.com/cloud/trello/rest/

Every Trello call below takes `key=<TRELLO_API_KEY>&token=<TRELLO_TOKEN>` as query params (or as a header, depending on the library you use).

## Google Drive

**Search for a folder by name, inside a parent (or across all of Drive):**
```
GET https://www.googleapis.com/drive/v3/files
  ?q=name contains 'CLIENT NAME' and mimeType='application/vnd.google-apps.folder' and trashed=false
  &fields=files(id,name,parents)
```

**List subfolders/files inside a folder:**
```
GET https://www.googleapis.com/drive/v3/files
  ?q='<PARENT_FOLDER_ID>' in parents and trashed=false
  &fields=files(id,name,mimeType,size)
```

**Create a folder:**
```
POST https://www.googleapis.com/drive/v3/files
Content-Type: application/json

{
  "name": "CAROUSEL-2-CLIENT-NAME",
  "mimeType": "application/vnd.google-apps.folder",
  "parents": ["<PARENT_FOLDER_ID>"]
}
```

**Upload a file (multipart upload, sends the binary directly, with no practical size limit like the one an LLM context would impose):**
```
POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
Content-Type: multipart/related; boundary=BOUNDARY

--BOUNDARY
Content-Type: application/json; charset=UTF-8

{"name": "1.png", "parents": ["<DEST_FOLDER_ID>"]}

--BOUNDARY
Content-Type: image/png

<file bytes>
--BOUNDARY--
```
(For large files, use `uploadType=resumable` instead of `multipart`.)

**Build the folder link to paste into Trello:**
```
https://drive.google.com/drive/folders/<FOLDER_ID>
```

## Trello

**Search for a board by name:**
```
GET https://api.trello.com/1/search?query=EDITORIAL LINE | CLIENT NAME&modelTypes=boards&key=...&token=...
```

**List a board's lists:**
```
GET https://api.trello.com/1/boards/<BOARD_ID>/lists?key=...&token=...
```

**List a list's cards (already includes the `pos` field, useful for exact positioning):**
```
GET https://api.trello.com/1/lists/<LIST_ID>/cards?fields=name,desc,pos&key=...&token=...
```

**Update a card's description/name:**
```
PUT https://api.trello.com/1/cards/<CARD_ID>?key=...&token=...
Content-Type: application/json

{"desc": "new description text"}
```

**Add a comment (native, no browser needed):**
```
POST https://api.trello.com/1/cards/<CARD_ID>/actions/comments?key=...&token=...
Content-Type: application/json

{"text": "Folder with the artwork: https://drive.google.com/drive/folders/..."}
```

**Add an attachment with a display name (native, no browser needed):**
```
POST https://api.trello.com/1/cards/<CARD_ID>/attachments?key=...&token=...
Content-Type: application/json

{
  "url": "https://drive.google.com/drive/folders/<FOLDER_ID>",
  "name": "CAROUSEL-2-CLIENT-NAME"
}
```

**Move a card to another list, at an exact position (native, no need for the "push another card" trick):**

1. Get the `pos` of the two neighboring cards (e.g. `APPROVAL` and `CHANGES`) via "List a list's cards" above.
2. Calculate the midpoint position: `newPos = (posApproval + posChanges) / 2`.
3. Move the card:
```
PUT https://api.trello.com/1/cards/<CARD_ID>?key=...&token=...
Content-Type: application/json

{"idList": "<DESTINATION_LIST_ID>", "pos": <newPos>}
```

## Why this is simpler than the original process

The original process (documented in `SKILL.md`) was implemented inside an agent session whose available Drive/Trello API tools were limited wrappers (no direct binary upload, no attachment/comment endpoint, no `pos` exposed when reading cards). That is why it needed browser automation and tricks like "move to the bottom twice" to position the card. Implementing directly against the REST APIs above removes all of those workarounds: upload is a normal HTTP call, and attachments plus exact positioning are natively supported.
