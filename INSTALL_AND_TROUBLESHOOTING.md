---
audience: ai-agent
purpose: pre-flight-checklist-and-error-map
---

# Install and troubleshooting (for the agent to read before running)

This document is written to be read by an AI agent before executing the automation. It is not the human user's manual (that is `SETUP.md`). Goal: the agent should be able to check on its own what is missing, guide the setup of whatever is missing, and recognize/fix the most common errors without getting stuck.

## 1. Pre-flight checklist (always run at the start of any execution)

Check each item in this order. Do not move to the next step while the current one is unresolved.

### 1.1 Google Drive connector
- **Check:** are the Drive tools (search/list/create file) available and authenticated?
- **If not:** look for the Google Drive connector in the available catalog, offer/guide the authorization, and only then continue. Do not try to work around this by reading files some other way.
- **If authenticated on the wrong account:** ask the user to disconnect and reconnect, choosing the right account on Google's login screen (this opens in the browser, outside the agent's control; just guide the user and wait for confirmation).

### 1.2 Trello connector
- **Check:** are the Trello tools (search/read/write boards, lists, cards) available and authenticated?
- **If not:** same pattern as 1.1. Look for the connector, guide the authorization, wait for confirmation before continuing.

### 1.3 Browser automation capability (only needed if the available API does not support binary upload, attachments, or exact positioning, see `API_REFERENCE.md`)
- **Check:** is there an *interactive* browser automation tool available (one that can click and type, not just read the screen)?
- **Note:** generic screen control ("computer use") usually grants **read-only** access to browser windows by policy. It does not work for clicking/typing inside web pages. To actually interact with Drive/Trello through the browser, a dedicated browser automation tool is needed (e.g. a specific extension, Playwright, Puppeteer).
- **If the browser automation tool is not connected:** guide the user to install/log into the corresponding extension using the same account as the agent, and restart the browser. Reconfirm the connection before continuing.
- **If even that is not possible:** prefer implementing through the direct REST API (see `API_REFERENCE.md`) instead of relying on the browser. That is the more robust approach and the recommended path for a new implementation.

### 1.4 Access to the local source folder
- **Check:** does the agent have read access to the local folder with the files to upload?
- **If not:** ask the user to share/grant access to that specific folder (never ask for access to broader folders than necessary).

### 1.5 Destination permissions
- **Check:** does the authenticated Drive account have **Editor** permission (not just read/comment) on the destination client folder?
- **If not:** stop and ask the folder owner to raise the permission level. There is no safe workaround for this. Folders with insufficient permission will not allow creating a subfolder or uploading a file, even if they appear "open" for viewing.

## 2. Error, cause, and fix map

Use this table to recognize specific symptoms and already know the root cause and the fix, without re-investigating from scratch every time.

| Symptom / observed error | Root cause | Fix |
|---|---|---|
| Uploading a file through the Drive API "hangs"/cuts off before finishing, even for a small file | The API tool requires embedding the file content (base64) directly in the call, and this exceeds the limit of a single agent response long before it hits any real Drive API limit | Never upload real content this way. Use browser automation (see 1.3) or, preferably, a direct binary upload through the REST API (`API_REFERENCE.md`) |
| The Trello attachment/comment tool returns "action not recognized" | The available wrapper tool does not implement that action, even though it appears in the schema | Use browser automation to click "Attach" in the interface, OR call the REST attachment endpoint directly (`POST /1/cards/{id}/attachments`) if direct HTTP calls are available |
| Uploading a file through the browser rejects the local file path ("only files this session is allowed to read") | Browser automation only accepts files that have already been formally shared/"staged" into the agent's session, not any path on the user's file system | Stage the file first (copy it into the session's upload area) and use that staged path in the upload call, not the original device path |
| A browser automation click hits the wrong element on the page (e.g. text pasted into a card's title instead of a form field) | Pixel coordinates taken from a screenshot do not necessarily map 1:1 to the real viewport coordinates (there can be a scale difference) | Never click by raw screenshot coordinates. Always locate the element through the page's accessibility tree (search by text/role) and click by the element's reference, not by (x,y) |
| The screen control tool (computer use) says it is not available/enabled | The feature is turned off in the user's settings, or not supported on the current plan/device | Do not keep retrying within the same attempt. Explain to the user how to enable it (usually in the app's settings, toggling a specific switch), wait for confirmation, and only then try again |
| Screen control works but can only "see" the browser, not click/type in it | Security policy grants read-only access to browser applications through generic screen control | Use a dedicated browser automation tool instead of generic screen control for any click/typing on web pages |
| Browser automation says the extension/tool is not connected | The browser automation extension is not installed, or is installed but not logged into the same account as the agent | Guide the user to install the extension, log in with the same account, restart the browser, and then try reconnecting |
| A connector's authorization fails with an "incompatible account" warning between the browser and the desktop app | The user is logged into different accounts in the browser and in the agent's desktop app | Guide the user to log out of the browser account and log back in with the same account used in the desktop app, then repeat the authorization |
| A Drive folder appears readable, but creating a subfolder or uploading a file fails silently or gets rejected | The account only has view/comment permission on the folder (not Editor) | Check the folder's write permission flag before attempting any creation/upload; if insufficient, ask the owner to raise the permission |
| Searching the content of a shared folder returns empty even though the folder exists and is accessible via the link | Sharing was done only as "anyone with the link," without adding the account as a direct collaborator. This can limit what the API can list, even if the web interface opens normally | Ask the owner to share the folder directly with the email of the account the agent uses (not just a "public link") |
| Need to position a card exactly between two others, but the API/tool does not expose the numeric position of existing cards | The limited wrapper tool does not return the position field when reading | If only "move to top/bottom" is available: move the target card to the bottom of the list, then move the card that should end up right below it also to the bottom. This positions the target between the two. If direct REST API access is available: read the numeric position of the two neighboring cards and move the target to their average |

## 3. General rule when encountering an error not listed here

1. Do not repeat the same action over and over without understanding the cause. That wastes attempts and can confuse the interface's state, as happened with mistaken clicks on form fields.
2. Read the error message literally before assuming the cause. Many of these tools return the exact reason (e.g. "incompatible account," "file not allowed," "action not recognized").
3. If the cause is not obvious, stop and describe the error to the user instead of guessing a risky fix, especially before any action that already has a side effect (creating a folder, uploading a file, or touching a card).
4. After any error fix that changed something unintentionally (e.g. a card's title, its description), explicitly correct that side effect before continuing. Do not leave it "for later."
