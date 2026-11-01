# Staff Management: M365 profile flow (Power Automate)

When you add someone by email in Staff Management, the app asks Microsoft 365 for their
profile (name, level, OP, home office city, phone, picture) through a **cloud flow** and
a **OneDrive folder**. A cloud flow cannot call this app directly (the app only listens on
`127.0.0.1`), so the two talk through files, the same way the PMO inbox works.

```
Staff Management  --writes-->  OneDrive\AI-OS\Staff-Exchange\requests\<email>~<stamp>.json
                                         |  (OneDrive sync)
                                  Power Automate flow: Get user profile + photo
                                         |
Staff Management  <--reads---  OneDrive\AI-OS\Staff-Exchange\profiles\<email>.json
```

Files that arrive while the app is closed are applied soon after it starts, and while it runs
they are applied about once a minute with no Staff window open (every 20 seconds while one
is). The app deletes each profile file after applying it.

## Before you build the flow

1. OneDrive (work account) is signed in on this computer. The installer creates
   `AI-OS\Staff-Exchange\requests`, `profiles` and `rejected` in your OneDrive folder (the app
   creates whatever is missing the first time it syncs). An older install that kept
   `Staff-Exchange` directly in OneDrive keeps using it for as long as it is there (the flow
   watches that exact folder). To tidy up, **move** it into `AI-OS` in File Explorer; OneDrive
   keeps the folder's identity, so the flow keeps running.
   To use another folder, set the environment variable `AI_OS_STAFF_EXCHANGE_DIR`.
2. Open Staff Management, choose **Add employee**: the dialog shows the exact folder in use.
   Add yourself (your own Deloitte email) as the first test person; a request file appears in
   `requests` and syncs to OneDrive on the web.

## The flow

Create an **Automated cloud flow** named `AI OS - Staff M365 profile`.

**Trigger: OneDrive for Business - When a file is created**

- Folder: **click the folder icon at the right of the field and browse to**
  `AI-OS` > `Staff-Exchange` > `requests`. Do **not** type or paste the path. The trigger needs the
  folder's ID, and a typed path produces the error `400 Invalid fileId` before the flow even
  starts. (If you see that error already, re-pick the folder this way and save.)
- Include subfolders: No. Infer content type: No.
- Settings (the `...` menu) > **Concurrency control**: leave it **Off**. With it on, requests
  that arrive together (adding several people at once) are skipped with a "Trigger concurrency
  throttling detected" warning, and those people never get a profile. Each run writes its own
  file, so runs do not interfere with each other.

**1. Compose** (rename it `Email`)

```
first(split(triggerOutputs()?['headers/x-ms-file-name'], '~'))
```

The request file is named `<email>~<stamp>.json`; everything before the `~` is the address.

**2. Office 365 Users - Get user profile (V2)**

- User (UPN): the `Outputs` of `Email`.

**3. Office 365 Users - Get user photo (V2)**

- User (UPN): the `Outputs` of `Email`.
- Not everyone has a picture. In the **next** step's `...` > **Configure run after**, tick both
  **is successful** and **has failed** on this action (step 4 below).

**4. Compose** (rename it `Photo`)

```
if(equals(actions('Get_user_photo_(V2)')?['status'], 'Succeeded'), body('Get_user_photo_(V2)'), null)
```

Also set this action's **Configure run after** to run after step 3 **is successful** and
**has failed**.

**5. Compose** (rename it `Profile`). Paste this as the Inputs. Paste **only** the JSON between
the braces, inclusive: do not copy the word `json` that labels the code block, or the file the
flow writes will not be valid JSON and the app will reject it. If the designer shows it as
plain text, use the action's **Code view** so each `"@..."` value is read as an expression:

```json
{
  "email": "@outputs('Email')",
  "firstName": "@body('Get_user_profile_(V2)')?['givenName']",
  "lastName": "@body('Get_user_profile_(V2)')?['surname']",
  "level": "@body('Get_user_profile_(V2)')?['jobTitle']",
  "op": "@body('Get_user_profile_(V2)')?['department']",
  "homeOffice": "@coalesce(body('Get_user_profile_(V2)')?['city'], body('Get_user_profile_(V2)')?['officeLocation'])",
  "phone": "@coalesce(body('Get_user_profile_(V2)')?['mobilePhone'], body('Get_user_profile_(V2)')?['businessPhones']?[0])",
  "photoBase64": "@outputs('Photo')"
}
```

Empty and `null` values are fine: the app ignores them and never blanks what is already on file.

**6. OneDrive for Business - Create file**

- Folder Path: pick `AI-OS` > `Staff-Exchange` > `profiles` with the folder icon.
- File Name: `Email` outputs, then `.json` (for example `jane.doe@deloitte.com.json`).
- File Content: the `Outputs` of `Profile`.

Save the flow and turn it on.

### What goes where

| M365 (Get user profile V2)            | Staff Management field  |
| ------------------------------------- | ----------------------- |
| givenName / surname                   | First name / Last name  |
| jobTitle                              | Level                   |
| department                            | OP (offering portfolio) |
| city (else officeLocation)            | Home office             |
| mobilePhone (or first business phone) | Phone                   |
| Get user photo                        | Profile picture         |

**Offering** is not in M365, so the flow does not send it. It is set by hand for now; it will be
derived from the OP once you give me the OP-to-offering mapping.

> **If you built the flow earlier** with an `"offering"` line holding the `department` expression:
> it still works. AI OS reads `offering` (and `department`) in a profile file as the offering
> portfolio when there is no `"op"` key. Renaming the line to `"op"` is still the tidy way.

**Home office is the city** (Bengaluru, as Teams shows it), not the state (Karnataka). If your flow
still sends `state` as `homeOffice`, change that line to the `coalesce(... 'city' ..., ... 'officeLocation' ...)`
expression above, or add a `"city"` line: a `city` in the file wins over `homeOffice`. People already
synced keep the old value until you press **Refresh from M365** on their profile.

## Test it

1. In Staff Management: **Add employee**, type a Deloitte email, **Add** (or use **Enter all details**,
   or **Import from Excel**: every person added that way is looked up too). The person shows
   **Waiting for M365 profile**. Someone already on the roster can be looked up with **Get M365
   profile** in their details pane.
2. Within a minute or two the flow run appears in Power Automate > My flows > Run history.
3. A `profiles\<email>.json` file appears in OneDrive and syncs down; within 20 seconds the
   person's fields and picture fill in and the "Waiting" tag disappears.

### Test without the flow

Save this as `profiles\someone@deloitte.com.json` in the exchange folder (the person must
already be on the roster):

```json
{
  "email": "someone@deloitte.com",
  "firstName": "Some",
  "lastName": "One",
  "level": "Consultant",
  "op": "DF&O IN BEN",
  "homeOffice": "Bengaluru",
  "phone": "+1 555 0100",
  "photoBase64": null
}
```

You can also force a check with `POST http://localhost:<port>/api/staff/sync`.

### Many people at once (HTTP 429)

The M365 connector answers **429 Too Many Requests** when dozens of lookups arrive together; an
import of 70+ people used to hit it after about 50, and the rest never got a profile because the
app thought their request was still pending. The app now:

- writes only a few requests per scan (5 every 20 seconds, never more than 10 waiting for the
  flow at once), so a 72-person import takes a few minutes, not one burst;
- sends **again** a request nobody answered, after 4 minutes, then 8, 16, 32 and 60 (eight tries
  in all), with the try number inside the request file (`"attempt": 2`);
- has an **Ask again** link in the Directory footer ("N waiting for M365 profile") that starts
  every waiting person's request over.

Keep **Concurrency control** off on the trigger (see above). In the flow, open the _Get user
profile_ step > Settings > **Retry policy** and choose _Exponential interval_ (count 4) so a
429 that does get through is retried inside the flow before it fails.

### If it does not fill in

- **Still waiting**: look at the flow's run history. A failed _Get user profile_ means the
  email is not a valid user in your tenant, or it was throttled (429, see above: the app asks
  again by itself). Use **Request again** in the person's pane to send a new request file.
- **File moved to `Staff-Exchange\rejected`**: open the `.reason.txt` beside it. Typical
  reasons: the email is not on the roster, the file is over 3 MB, or the picture is not a
  JPEG/PNG/WebP under 1 MB.
- **Nothing in `profiles`**: the flow trigger folder must be `Staff-Exchange` > `requests`
  (picked with the folder browser)
  in the same OneDrive account that syncs to this computer.
