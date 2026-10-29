// What the first-time setup page shows for building each Power Automate flow: the cards
// of the flow in order, and in each card the fields to fill in. The values here are the
// ones in docs/pto-email-flow.md, docs/staff-m365-flow.md and pmo-intake/PA-FLOW-RECIPES.md;
// flowGuides.test.mjs checks the JSON bodies against what the app really reads, so the
// pictures cannot drift from the code.
import type { BrandId } from "./firstTimeSteps.ts";

export type ConnectorId =
  "make" | "outlook" | "onedrive" | "office365users" | "teams" | "compose" | "select";

/** How a field is filled in, which decides how the mock draws it. */
export type FieldHow =
  /** Choose from the folder picker (never typed). */
  | "pick"
  /** Plain text. */
  | "type"
  /** Dynamic content / expression (the `fx` tab). */
  | "expression"
  /** A switch. */
  | "toggle"
  /** A block of JSON or code. */
  | "code";

export interface FlowField {
  label: string;
  value: string;
  how: FieldHow;
  /** One short line of explanation under the field. */
  note?: string;
}

export interface FlowStep {
  id: string;
  connector: ConnectorId;
  trigger?: boolean;
  /** What the card is called after renaming (Compose cards), else the action's own name. */
  title: string;
  /** The action as Power Automate lists it. */
  action: string;
  fields: FlowField[];
  /** What to do, as short numbered steps. */
  doThis: string[];
  tip?: string;
}

export interface FlowGuide {
  id: "pto" | "staff" | "pmo" | "teams";
  name: string;
  brand: BrandId;
  /** One line: what the flow is for. */
  purpose: string;
  flowName: string;
  /** Which AI-OS folder it uses. */
  folder: string;
  steps: FlowStep[];
  /** How to check it works. */
  test: string[];
}

const CREATE = (
  flowName: string,
  search: string,
  picked: string,
  kind: "Automated" | "Instant" = "Automated",
): FlowStep => ({
  id: "create",
  connector: "make",
  title: "Create the flow",
  action: `Create > ${kind} cloud flow`,
  fields: [
    { label: "Flow name", value: flowName, how: "type" },
    {
      label: "Choose your flow's trigger",
      value: picked,
      how: "type",
      note: `Search for "${search}", then pick this one.`,
    },
  ],
  doThis: [
    "Open make.powerautomate.com and sign in with your Deloitte account.",
    `Choose Create, then ${kind} cloud flow.`,
    `Type the flow name, search for "${search}", pick "${picked}" and press Create.`,
  ],
});

const SAVE = (extra: string[]): FlowStep => ({
  id: "save",
  connector: "make",
  title: "Save and turn it on",
  action: "Save, Flow checker, Test",
  fields: [],
  doThis: [
    "Press Save (top right). Open the Flow checker: it should show no errors.",
    ...extra,
  ],
});

export const PTO_COMPOSE = `{
  "schema": "pto-mail/1",
  "sourceId": "@{triggerOutputs()?['body/id']}",
  "receivedAt": "@{triggerOutputs()?['body/receivedDateTime']}",
  "from": "@{triggerOutputs()?['body/from']}",
  "subject": "@{coalesce(triggerOutputs()?['body/subject'], '')}",
  "body": "@{coalesce(triggerOutputs()?['body/body'], '')}",
  "isHtml": "@{coalesce(triggerOutputs()?['body/isHtml'], false)}"
}`;

export const TEAMS_COMPOSE = `{
  "schema": "pmo-intake/1",
  "producer": "pa-cloud-flow",
  "source": "teams",
  "sourceId": "@{concat(triggerBody()?['teamsFlowRunContext']?['Conversation']?['Id'], '/', triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['Id'])}",
  "receivedAt": "@{formatDateTime(addSeconds('1970-01-01T00:00:00Z', div(int(triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['Id']), 1000)), 'yyyy-MM-ddTHH:mm:ssZ')}",
  "sender": {
    "name": "@{triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['From']?['User']?['DisplayName']}"
  },
  "subject": "@{coalesce(triggerBody()?['teamsFlowRunContext']?['Conversation']?['Name'], 'Teams message')}",
  "body": {
    "text": "@{coalesce(triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['Body']?['PlainText'], '')}",
    "format": "text"
  },
  "thread": {
    "conversationId": "@{triggerBody()?['teamsFlowRunContext']?['Conversation']?['Id']}",
    "parentId": "@triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['ReplyToId']"
  },
  "context": {
    "tenantId": "@{triggerBody()?['teamsFlowRunContext']?['ChannelData']?['Tenant']?['Id']}",
    "chatId": "@{triggerBody()?['teamsFlowRunContext']?['Conversation']?['Id']}",
    "chatType": "@{if(equals(triggerBody()?['teamsFlowRunContext']?['Conversation']?['IsGroup'], true), 'group', 'oneOnOne')}"
  },
  "attachments": [],
  "link": "@{triggerBody()?['teamsFlowRunContext']?['MessagePayload']?['LinkToMessage']}"
}`;

export const STAFF_COMPOSE = `{
  "email": "@outputs('Email')",
  "firstName": "@body('Get_user_profile_(V2)')?['givenName']",
  "lastName": "@body('Get_user_profile_(V2)')?['surname']",
  "level": "@body('Get_user_profile_(V2)')?['jobTitle']",
  "op": "@body('Get_user_profile_(V2)')?['department']",
  "homeOffice": "@coalesce(body('Get_user_profile_(V2)')?['city'], body('Get_user_profile_(V2)')?['officeLocation'])",
  "phone": "@coalesce(body('Get_user_profile_(V2)')?['mobilePhone'], body('Get_user_profile_(V2)')?['businessPhones']?[0])",
  "photoBase64": "@outputs('Photo')"
}`;

export const PMO_COMPOSE = `{
  "schema": "pmo-intake/1",
  "producer": "pa-cloud-flow",
  "source": "outlook",
  "sourceId": "@{triggerOutputs()?['body/id']}",
  "receivedAt": "@{triggerOutputs()?['body/receivedDateTime']}",
  "sender": {
    "name": "@{triggerOutputs()?['body/from']}",
    "address": "@{triggerOutputs()?['body/from']}"
  },
  "recipients": "@union(body('Select_To'), body('Select_Cc'))",
  "subject": "@{coalesce(triggerOutputs()?['body/subject'], '')}",
  "body": {
    "text": "@{outputs('BodyText')}",
    "format": "@{if(equals(triggerOutputs()?['body/isHtml'], true), 'html', 'text')}"
  },
  "thread": {
    "conversationId": "@{triggerOutputs()?['body/conversationId']}"
  },
  "context": {
    "mailbox": "@{triggerOutputs()?['body/toRecipients']}",
    "importance": "@{triggerOutputs()?['body/importance']}"
  },
  "attachments": [],
  "link": "@{concat('outlook:', triggerOutputs()?['body/id'])}"
}`;

const PASTE_JSON =
  'Paste only the braces and what is inside them. No word in front (a stray "json" makes a file the app cannot read).';

export const GUIDES: readonly FlowGuide[] = [
  {
    id: "pto",
    name: "PTO emails",
    brand: "outlook",
    purpose:
      "Copies each PTO email into OneDrive. The local AI reads it and marks PTO, comp off or sick leave in the shift roster.",
    flowName: "AI OS - PTO email",
    folder: "AI-OS \\ PTO-Inbox",
    steps: [
      CREATE("AI OS - PTO email", "new email", "When a new email arrives (V3)"),
      {
        id: "trigger",
        connector: "outlook",
        trigger: true,
        title: "When a new email arrives (V3)",
        action: "Office 365 Outlook",
        fields: [
          {
            label: "Folder",
            value: "Inbox > PTO",
            how: "pick",
            note: "Advanced parameters > tick Folder > click the folder icon. Never type the name.",
          },
          { label: "Include Attachments", value: "No", how: "toggle" },
          { label: "Only with Attachments", value: "No", how: "toggle" },
          {
            label: "Settings > Concurrency Control",
            value: "Off",
            how: "toggle",
            note: "With it on, runs are skipped when several emails arrive together.",
          },
        ],
        doThis: [
          "Open the trigger card, then Advanced parameters, and tick Folder.",
          "Click the folder icon and pick the Outlook folder your rule moves PTO emails to.",
          "Open the card's ... menu, then Settings, switch Concurrency Control Off and press Done.",
        ],
      },
      {
        id: "compose",
        connector: "compose",
        title: "PtoEmail",
        action: "Compose",
        fields: [{ label: "Inputs", value: PTO_COMPOSE, how: "code" }],
        doThis: [
          "Add a step: search Compose and pick Compose (Data operation).",
          "Rename it PtoEmail (the card's ... menu, then Rename).",
          `Click Inputs and paste the code. ${PASTE_JSON}`,
        ],
        tip: "If the designer shows the @{...} parts as plain text, use ... > Peek code and paste it into the inputs property.",
      },
      {
        id: "file",
        connector: "onedrive",
        title: "Create file",
        action: "OneDrive for Business",
        fields: [
          { label: "Folder Path", value: "/AI-OS/PTO-Inbox", how: "pick" },
          {
            label: "File Name",
            value: "concat('pto-', guid(), '.json')",
            how: "expression",
          },
          {
            label: "File Content",
            value: "string(outputs('PtoEmail'))",
            how: "expression",
          },
        ],
        doThis: [
          "Add a step: search Create file and pick OneDrive for Business.",
          "Folder Path: click the folder icon and choose AI-OS, then PTO-Inbox.",
          "File Name and File Content: open the Expression tab, type the value, press Add.",
        ],
      },
      SAVE([
        "Send yourself an email saying you are on leave on a few days, and move it to the PTO folder.",
        "Within a minute a file appears in AI-OS \\ PTO-Inbox. AI OS reads it and adds the leave to Time off as a pending request; approve it there and it shows on the roster.",
        "Try one that says you are taking a comp off: it is filed as Comp off.",
      ]),
    ],
    test: [
      "A pto-....json file appears in PTO-Inbox",
      "The leave shows in Staff Management > Time off as pending, with Approve and Reject",
    ],
  },
  {
    id: "staff",
    name: "M365 profiles",
    brand: "powerautomate",
    purpose:
      "When you add someone to the Directory by email, this fetches their name, title, location and photo from Microsoft 365.",
    flowName: "AI OS - Staff M365 profile",
    folder: "AI-OS \\ Staff-Exchange",
    steps: [
      CREATE("AI OS - Staff M365 profile", "file is created", "When a file is created"),
      {
        id: "trigger",
        connector: "onedrive",
        trigger: true,
        title: "When a file is created",
        action: "OneDrive for Business",
        fields: [
          {
            label: "Folder",
            value: "/AI-OS/Staff-Exchange/requests",
            how: "pick",
            note: "Use the folder icon. A typed path gives 400 Invalid fileId.",
          },
          { label: "Include subfolders", value: "No", how: "toggle" },
          { label: "Infer content type", value: "No", how: "toggle" },
          { label: "Settings > Concurrency Control", value: "Off", how: "toggle" },
        ],
        doThis: [
          "Click the folder icon next to Folder and browse to AI-OS, Staff-Exchange, requests.",
          "Leave Include subfolders and Infer content type on No.",
          "Open the ... menu, then Settings, and make sure Concurrency Control is Off.",
        ],
      },
      {
        id: "email",
        connector: "compose",
        title: "Email",
        action: "Compose",
        fields: [
          {
            label: "Inputs",
            value: "first(split(triggerOutputs()?['headers/x-ms-file-name'], '~'))",
            how: "expression",
            note: "The request file is named <email>~<stamp>.json.",
          },
        ],
        doThis: [
          "Add a Compose, rename it Email, and enter the expression on the Expression tab.",
        ],
      },
      {
        id: "profile",
        connector: "office365users",
        title: "Get user profile (V2)",
        action: "Office 365 Users",
        fields: [
          { label: "User (UPN)", value: "Outputs  (from Email)", how: "expression" },
        ],
        doThis: [
          "Add Get user profile (V2).",
          "Click User (UPN), choose Dynamic content and pick Outputs under the Email step.",
        ],
      },
      {
        id: "photo",
        connector: "office365users",
        title: "Get user photo (V2)",
        action: "Office 365 Users",
        fields: [
          { label: "User (UPN)", value: "Outputs  (from Email)", how: "expression" },
        ],
        doThis: ["Add Get user photo (V2) and set User (UPN) the same way."],
        tip: "Not everyone has a picture, so the next step must also run when this one fails.",
      },
      {
        id: "photo-compose",
        connector: "compose",
        title: "Photo",
        action: "Compose",
        fields: [
          {
            label: "Inputs",
            value:
              "if(equals(actions('Get_user_photo_(V2)')?['status'], 'Succeeded'), body('Get_user_photo_(V2)'), null)",
            how: "expression",
          },
          {
            label: "Configure run after",
            value: "is successful  +  has failed",
            how: "toggle",
            note: "The card's ... menu > Configure run after > tick both.",
          },
        ],
        doThis: [
          "Add a Compose and rename it Photo.",
          "Enter the expression, then open ... > Configure run after and tick both is successful and has failed.",
        ],
      },
      {
        id: "profile-compose",
        connector: "compose",
        title: "Profile",
        action: "Compose",
        fields: [{ label: "Inputs", value: STAFF_COMPOSE, how: "code" }],
        doThis: [
          "Add a Compose and rename it Profile.",
          `Paste the code as the Inputs. ${PASTE_JSON}`,
        ],
        tip: "Empty values are fine: AI OS never blanks what is already on file.",
      },
      {
        id: "file",
        connector: "onedrive",
        title: "Create file",
        action: "OneDrive for Business",
        fields: [
          { label: "Folder Path", value: "/AI-OS/Staff-Exchange/profiles", how: "pick" },
          {
            label: "File Name",
            value: "concat(outputs('Email'), '.json')",
            how: "expression",
          },
          { label: "File Content", value: "Outputs  (from Profile)", how: "expression" },
        ],
        doThis: [
          "Add Create file. Folder Path: AI-OS, Staff-Exchange, profiles (use the folder icon).",
          "File Name: the Email output followed by .json. File Content: the Outputs of Profile.",
        ],
      },
      SAVE([
        "In Staff Management add yourself with your Deloitte email.",
        "A request file appears in requests; within a minute or two the flow runs and your profile fills in.",
      ]),
    ],
    test: [
      "A request file appears in requests",
      "The person's fields and picture fill in",
    ],
  },
  {
    id: "pmo",
    name: "Flagged mail",
    brand: "outlook",
    purpose:
      "Turns an email you flag in Outlook into a to-do proposal in the PMO To-Do. Only mail you flag is picked up.",
    flowName: "PMO intake - flagged email",
    folder: "AI-OS \\ PMO-Inbox",
    steps: [
      CREATE("PMO intake - flagged email", "flagged", "When an email is flagged (V3)"),
      {
        id: "trigger",
        connector: "outlook",
        trigger: true,
        title: "When an email is flagged (V3)",
        action: "Office 365 Outlook",
        fields: [
          {
            label: "Folder",
            value: "(leave empty: the Inbox)",
            how: "pick",
            note: "Optional. Under Advanced parameters if you want a specific folder.",
          },
        ],
        doThis: [
          "Leave everything empty: only emails you flag in Outlook enter the system, so you decide what comes in.",
        ],
      },
      {
        id: "body",
        connector: "compose",
        title: "BodyText",
        action: "Compose",
        fields: [
          {
            label: "Inputs",
            value: "coalesce(triggerOutputs()?['body/body'], '')",
            how: "expression",
          },
        ],
        doThis: ["Add a Compose, rename it BodyText and enter the expression."],
      },
      {
        id: "to",
        connector: "select",
        title: "Select_To",
        action: "Select (Data operation)",
        fields: [
          {
            label: "From",
            value: "split(coalesce(triggerOutputs()?['body/toRecipients'], ''), ';')",
            how: "expression",
          },
          {
            label: "Map (text mode)",
            value: '{ "address": "@{trim(item())}", "role": "to" }',
            how: "code",
            note: "Switch the Map field to text mode with the T icon.",
          },
        ],
        doThis: [
          "Add Select, rename it Select_To.",
          "Enter From as an expression, then the Map in text mode.",
        ],
      },
      {
        id: "cc",
        connector: "select",
        title: "Select_Cc",
        action: "Select (Data operation)",
        fields: [
          {
            label: "From",
            value: "split(coalesce(triggerOutputs()?['body/ccRecipients'], ''), ';')",
            how: "expression",
          },
          {
            label: "Map (text mode)",
            value: '{ "address": "@{trim(item())}", "role": "cc" }',
            how: "code",
          },
        ],
        doThis: [
          'Add a second Select, rename it Select_Cc, same as before with ccRecipients and "cc".',
        ],
      },
      {
        id: "intake",
        connector: "compose",
        title: "Intake",
        action: "Compose",
        fields: [{ label: "Inputs", value: PMO_COMPOSE, how: "code" }],
        doThis: [
          "Add a Compose, rename it Intake.",
          `Paste the code as the Inputs. ${PASTE_JSON}`,
        ],
        tip: "Every token is a whole value of the object, so quotes and line breaks in the email can never break the file.",
      },
      {
        id: "file",
        connector: "onedrive",
        title: "Create file",
        action: "OneDrive for Business",
        fields: [
          { label: "Folder Path", value: "/AI-OS/PMO-Inbox", how: "pick" },
          {
            label: "File Name",
            value: "concat('outlook-', guid(), '.json')",
            how: "expression",
          },
          {
            label: "File Content",
            value: "string(outputs('Intake'))",
            how: "expression",
          },
        ],
        doThis: [
          "Add Create file. Folder Path: AI-OS, then PMO-Inbox.",
          "Enter the File Name and File Content expressions.",
        ],
        tip: "While testing, point Folder Path at a throwaway folder and switch it to PMO-Inbox when the files look right.",
      },
      SAVE([
        "In Outlook flag one test email (your own, not a client's).",
        "Within a minute a file appears in AI-OS \\ PMO-Inbox, and then in the PMO To-Do's Review Queue.",
      ]),
    ],
    test: ["A file appears in PMO-Inbox", "It shows in the PMO To-Do Review Queue"],
  },
  {
    id: "teams",
    name: "Teams message",
    brand: "teams",
    purpose:
      "Sends a Teams message you pick (message menu, then Send to PMO To-Do) to the PMO To-Do. Nothing is sent back to Teams.",
    flowName: "Send to PMO To-Do",
    folder: "AI-OS \\ PMO-Inbox",
    steps: [
      CREATE(
        "Send to PMO To-Do",
        "selected message",
        "For a selected message (V2)",
        "Instant",
      ),
      {
        id: "trigger",
        connector: "teams",
        trigger: true,
        title: "For a selected message (V2)",
        action: "Microsoft Teams",
        fields: [
          {
            label: "Environment (top right)",
            value: "Your default environment",
            how: "pick",
            note: "A flow in another environment never shows up in Teams.",
          },
        ],
        doThis: [
          "Check the environment picker at the top right is your default environment.",
          "Do not add the adaptive-card input: it is not needed.",
        ],
        tip: "If the flow never appears under a message's ... menu, More actions, the Power Automate Actions app is blocked in your Teams admin center.",
      },
      {
        id: "intake",
        connector: "compose",
        title: "Intake",
        action: "Compose",
        fields: [{ label: "Inputs", value: TEAMS_COMPOSE, how: "code" }],
        doThis: [
          "Add a Compose, rename it Intake.",
          `Paste the code as the Inputs. ${PASTE_JSON}`,
        ],
        tip: "If receivedAt fails on an odd message id, replace that whole value with @{utcNow()}.",
      },
      {
        id: "file",
        connector: "onedrive",
        title: "Create file",
        action: "OneDrive for Business",
        fields: [
          { label: "Folder Path", value: "/AI-OS/PMO-Inbox", how: "pick" },
          {
            label: "File Name",
            value: "concat('teams-', guid(), '.json')",
            how: "expression",
          },
          {
            label: "File Content",
            value: "string(outputs('Intake'))",
            how: "expression",
          },
        ],
        doThis: [
          "Add Create file. Folder Path: AI-OS, then PMO-Inbox.",
          "Enter the File Name and File Content expressions.",
        ],
      },
      SAVE([
        "In Teams, open a chat with yourself, write a test message, hover it, then ... > More actions > Send to PMO To-Do > Run.",
        "A file appears in AI-OS \\ PMO-Inbox. Teams items stay filtered until you allow the chat or tenant under Settings in the PMO To-Do.",
      ]),
    ],
    test: [
      "A teams-....json file appears in PMO-Inbox",
      "Allow the chat or tenant in the PMO To-Do settings",
    ],
  },
];

export const guideById = (id: FlowGuide["id"]): FlowGuide =>
  GUIDES.find((g) => g.id === id) ?? GUIDES[0];
