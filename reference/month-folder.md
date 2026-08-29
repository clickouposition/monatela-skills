# Step 1: Current month's folder

## When to run this

After Step 0 is confirmed (`identify-client.md`), every time new content is about to be uploaded.

## Procedure

1. Compute the current month, uppercase, in the `MONTH-YEAR` pattern (e.g. `AUGUST-2026`), using today's date. (Keep the month name in whatever language the client's existing folders use, for consistency.)
2. Look inside the client's folder (already confirmed in Step 0) for a subfolder with that name.
3. **Compatibility with older folders:** if a folder exists with just the month name and no year (e.g. `AUGUST`) and it plausibly matches the current year, treat it as the current month's folder. Do not create a duplicate just because the year is missing.
4. If no matching folder exists (neither the old pattern nor the new one with a year), create a new folder called `MONTH-YEAR` inside the client's folder.

## Pitfalls

- Creating the month folder too early, before there is actually content ready to upload.
- Creating a duplicate `AUGUST-2026` when a valid `AUGUST` already exists for the current year.
- Treating a yearless month folder from a previous year as if it were the current one. The equivalence only holds when it plausibly belongs to the current year.
