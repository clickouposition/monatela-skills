# Steps 2-3: Content subfolder and file upload

## When to run this

After the month folder is resolved (`month-folder.md`).

## Procedure: create the destination subfolder

1. List the subfolders that already exist inside the month folder to identify the content type (`CAROUSEL`, `REEL`, `STATIC`) and the next sequence number for that type.
2. Create the new subfolder following the `TYPE-N-CLIENT` pattern (e.g. `CAROUSEL-2-CLIENT-NAME`).

## Procedure: upload the files

**The Browser for API Gaps Rule** applies here (see `SKILL.md`): uploading directly through the API by embedding the file content in the call is not feasible, even for small files (images above roughly 80KB already exceed the limit of a single agent response).

1. Make sure the local source folder is shared/staged into the session.
2. Open the destination folder in Drive through the browser, click "New" then "File upload" (this dynamically creates a hidden file input).
3. Find that input by reading the page's accessibility tree. Never click it directly, since that would open a native file picker the agent cannot control.
4. Upload using the file paths already staged in the session, not the original local device path (that gets rejected).
5. Repeat per batch. The file input is discarded after each upload, so "File upload" needs to be reopened for every new batch.
6. Confirm via a Drive API search (by `parentId`) that the file count and sizes match the originals.

## Pitfalls

- Trying to "simplify" by uploading directly through the API even for small files. Even small ones exceed the limit of a single agent response.
- Using the original local device path instead of the path already staged in the session. The tool rejects it.
- Forgetting to reopen "File upload" between batches (the previous input has already been discarded).
- Not checking the final count/size. A partial upload that goes unnoticed is worse than a visible error at the time.
