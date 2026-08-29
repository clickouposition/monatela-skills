# Setup: from scratch, on any machine/framework

This guide assumes you are going to run the process outside Cowork/Claude, using another agent framework (or even your own script). It lists everything that needs to exist before the skill works.

## 1. Required accounts

- A Google account with Editor access to the client folders in Drive.
- A Trello account with access to the "EDITORIAL LINE | <CLIENT>" boards.

## 2. Google Drive credentials

Two options, depending on your framework:

**A) An agent framework with a ready-made Google Drive connector/plugin** (e.g. a Drive MCP, a LangChain plugin, etc.)
Just authorize the right account through the connector's own OAuth screen. There is nothing to create manually.

**B) Your own implementation (a script/bot calling the API directly)**
1. Create a project at https://console.cloud.google.com/
2. Enable the "Google Drive API" in that project.
3. Create OAuth2 credentials ("Desktop app" or "Web app" type, depending on your flow) under APIs & Services, Credentials.
4. Required scope: `https://www.googleapis.com/auth/drive` (or `drive.file` if you want to restrict it to files created by the app itself, but then it may not see folders that already exist, so for this flow the full `drive` scope is simpler).
5. Run the OAuth flow once to generate a **refresh token** and store it securely (never commit it as plain text in the repo).

## 3. Trello credentials

1. Get the API key at: https://trello.com/app-key (while logged into the right account).
2. Generate an access token with that key, using this URL (replace `YOUR_API_KEY`):
   `https://trello.com/1/authorize?key=YOUR_API_KEY&name=ContentApproval&scope=read,write&expiration=never&response_type=token`
3. Authorize it and store the generated token.
4. If your framework already has a ready-made Trello connector/plugin, you can use its authentication instead of managing the key/token manually. The end result (being able to call the Trello API on the account's behalf) is the same.

## 4. Browser automation (optional, only if you will NOT use the direct REST API)

The original process was implemented using browser automation for two steps (uploading a file to Drive and attaching a link in Trello), because the tool available in the original session had no direct API access to those two actions.

**If you are implementing this from scratch in a new framework, we do not recommend repeating that workaround.** Both the Google Drive API and the Trello REST API support these two actions natively, and much more simply and reliably (see `API_REFERENCE.md`). Browser automation (Playwright, Puppeteer, Selenium, or an extension like Claude in Chrome) is only needed if, for some reason, your framework has no access to direct HTTP calls.

## 5. Naming convention (required, this is what prevents mixing up clients)

For each client, define and document a **unique identifier** (the client's name) that must appear recognizably in three places:

| Where | Example |
|---|---|
| Local project folder | `CLIENT NAME/` |
| Google Drive folder | `CLIENT NAME - SERVICE TYPE` |
| Trello board name | `EDITORIAL LINE \| CLIENT NAME` |

Inside the client's Drive folder, the sublevels follow this pattern:

```
<CLIENT FOLDER>/
  AUGUST-2026/                        <- month folder (month name, uppercase, plus year)
    CAROUSEL-1-CLIENT-NAME/
    CAROUSEL-2-CLIENT-NAME/
    REEL-1-CLIENT-NAME/
    STATIC-1-CLIENT-NAME/
  SEPTEMBER-2026/
    ...
```

Note: month folders created before this convention may exist without a year (e.g. `AUGUST`). Treat these as equivalent to the current month/year if it is plausible, but every new month created from now on should already include the year in its name.

## 6. Suggested configuration (variables/secrets)

If implementing this as a script, a `.env` file (never committed) with something like:

```
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
TRELLO_API_KEY=...
TRELLO_TOKEN=...
TRELLO_BOARD_PREFIX="EDITORIAL LINE | "
MONTH_LOCALE=en-US
```

## 7. Checklist before the first run

- [ ] Google account authenticated and tested (can list Drive folders).
- [ ] Trello account authenticated and tested (can list boards).
- [ ] At least one client with all three standardized names (local folder, Drive folder, Trello board).
- [ ] The client's board has the lists: `CONTENT/PLANNING` and `WITH CLIENT` (with reference cards like `APPROVAL`/`CHANGES`, if you use that sub-marker pattern inside the list).
