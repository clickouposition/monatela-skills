# Workflow: framework-agnostic logic

This file describes the algorithm itself, independent of which framework/language runs it. Use it together with `API_REFERENCE.md` (the concrete endpoints) and `SETUP.md` (credentials/environment). `SKILL.md` is the version of this same algorithm written as instructions for an AI agent (Claude/Cowork specifically).

## Inputs

- `local_folder`: path of the finished content folder ready to upload (e.g. `.../CAROUSEL/`), whose parent project is named after the client.
- `content_type`: CAROUSEL | REEL | STATIC (can be inferred from the local folder name).

## Step 0: resolve and confirm the client

```
client_id = extract_client_name(local_folder.parent.name)

drive_folders = drive.search_folders(name contains client_id)
trello_boards = trello.search_boards(name contains "EDITORIAL LINE | " + client_id)

IF len(drive_folders) != 1 OR len(trello_boards) != 1:
    STOP and ask the user to disambiguate
    (never automatically pick between multiple results)

client_folder = drive_folders[0]
client_board = trello_boards[0]

confirm_with_user(local_folder, client_folder, client_board)
IF not confirmed: STOP
```

## Step 1: resolve the month folder

```
month_year = uppercase_month_name(today()) + "-" + year(today())   # e.g. "AUGUST-2026"
legacy_month = uppercase_month_name(today())                        # e.g. "AUGUST" (no year, for compat.)

month_folder = drive.find_subfolder(client_folder, name == month_year)
IF not found:
    month_folder = drive.find_subfolder(client_folder, name == legacy_month)
    # treats an old yearless folder as valid for the current year

IF still not found:
    month_folder = drive.create_folder(name=month_year, parent=client_folder)
```

## Step 2: create the content subfolder

```
existing = drive.list_subfolders(month_folder)
next_n = max([n for each folder "TYPE-n-*" in existing where TYPE == content_type], default=0) + 1

content_folder_name = f"{content_type}-{next_n}-{client_id}"
destination_folder = drive.create_folder(name=content_folder_name, parent=month_folder)
```

## Step 3: upload the files

```
FOR EACH file in local_folder:
    drive.upload(file, destination=destination_folder)   # direct multipart/resumable upload, no workaround

# Verification
drive_files = drive.list_files(destination_folder)
ASSERT len(drive_files) == len(local_files)
ASSERT sizes_match(drive_files, local_files)

folder_link = f"https://drive.google.com/drive/folders/{destination_folder.id}"
```

## Step 4: locate the correct card in Trello

```
planning_list = trello.find_list(client_board, name == "CONTENT/PLANNING")
cards = trello.list_cards(planning_list)

target_card = match_by_theme(cards, post_content)
# compare the card's cover/caption/description with the theme of the artwork sent,
# not just a file name

IF ambiguous (more than one plausible card): ask the user which one is correct
```

## Step 5: attach the link to the card

```
trello.add_attachment(target_card, url=folder_link, name=content_folder_name)
```

## Step 6: move the card to the "With Client" list, at the right position

```
destination_list = trello.find_list(client_board, name == "WITH CLIENT")
card_above = trello.find_card(destination_list, name == "APPROVAL")   # configurable reference
card_below = trello.find_card(destination_list, name == "CHANGES")    # configurable reference

new_pos = (card_above.pos + card_below.pos) / 2
trello.move_card(target_card, destination_list=destination_list, pos=new_pos)
```

## Final verification

```
ASSERT drive.count_files(destination_folder) == expected_count
confirmed_card = trello.find_card(target_card.id)
ASSERT confirmed_card.name == original_name           # must not have changed
ASSERT confirmed_card.description == original_description  # must not have changed
ASSERT len(confirmed_card.attachments) >= 1
ASSERT confirmed_card.list == "WITH CLIENT"
ASSERT position_between(confirmed_card, card_above, card_below)

report_to_user(folder_link, confirmed_card.url)
```

## Difference from the original `SKILL.md`

`SKILL.md` documents the version that ran inside an agent session with limited tools (no direct binary upload, no attachment/comment endpoint, no `pos` exposed), so it uses browser automation and the "move twice to the bottom" trick to position the card. This `WORKFLOW.md` already assumes the direct REST APIs (see `API_REFERENCE.md`), which resolve all of that natively. It is the recommended version for implementing on a new machine/framework.
