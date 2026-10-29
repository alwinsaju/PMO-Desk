import fs from "node:fs";
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });
const base = (o) => ({ schema: "pmo-intake/1", producer: "qa-synthetic", source: "outlook", receivedAt: "2026-10-25T09:30:00+05:30", recipients: [{ name: "Alwin Saju", address: "alsaju@deloitte.com", role: "to" }], body: { format: "text" }, ...o });
const F = {
  "01-task-due.json": base({ sourceId: "QA-0001", sender: { name: "Pat Sample", address: "pat.sample@deloitte.com" }, subject: "Q4 status pack - input needed", body: { format: "text", text: "Hi Alwin,\n\nCould you please send me the consolidated RAID log for the Contoso Programme by Tuesday 27 October? I need it for the steering committee pre-read.\n\nThanks,\nPat" }, thread: { conversationId: "QA-CONV-1" } }),
  "02-fyi.json": base({ sourceId: "QA-0002", sender: { name: "News Bot", address: "news@deloitte.com" }, subject: "Weekly newsletter FYI", body: { format: "text", text: "FYI - for your information only, no action needed. Unsubscribe at the bottom." } }),
  "03-blocked-domain.json": base({ sourceId: "QA-0003", sender: { name: "Vendor", address: "someone@takeda.com" }, subject: "Please send the report", body: { format: "text", text: "Please send the report by Friday." } }),
  "04-external-domain.json": base({ sourceId: "QA-0004", sender: { name: "Ext", address: "ext@example.org" }, subject: "Quick ask", body: { format: "text", text: "Could you please review the attached by Thursday?" } }),
  "05-duplicate-of-01.json": base({ sourceId: "QA-0001", sender: { name: "Pat Sample", address: "pat.sample@deloitte.com" }, subject: "Q4 status pack - input needed", body: { format: "text", text: "Could you please send me the consolidated RAID log by Tuesday 27 October?" } }),
  "06-unicode.json": base({ sourceId: "QA-0006", sender: { name: "Zoë Ångström", address: "zoe@deloitte.com" }, subject: "Überprüfung der Prüfliste – 日本語 😀", body: { format: "text", text: "Hallo Alwin, bitte prüfe die Checkliste für das Kundenprojekt München bis Freitag 30 Oktober. Danke!" } }),
  "07-teams.json": base({ source: "teams", sourceId: "QA-TEAMS-1/9001", sender: { name: "Jordan Sample" }, subject: "PMO channel", receivedAt: "2026-10-25T10:00:00+05:30", body: { format: "text", text: "Alwin, can you chase the vendor for the revised SOW before Friday?" } }),
  "08-cadence.json": base({ sourceId: "QA-0008", sender: { name: "Pat Sample", address: "pat.sample@deloitte.com" }, subject: "Weekly report", body: { format: "text", text: "Please send the weekly status report every Monday morning." } }),
  "09-long.json": base({ sourceId: "QA-0009", sender: { name: "Pat Sample", address: "pat.sample@deloitte.com" }, subject: "Long message ".repeat(30), body: { format: "text", text: ("Please update the plan for workstream 7. ".repeat(400)) + "\n\nCould you also send the budget by Wednesday?" } }),
};
for (const [n, o] of Object.entries(F)) fs.writeFileSync(`${dir}/${n}`, JSON.stringify(o, null, 2));
fs.writeFileSync(`${dir}/10-invalid.json`, "{ this is not json");
fs.writeFileSync(`${dir}/11-wrong-schema.json`, JSON.stringify({ schema: "other/9", hello: 1 }));
fs.writeFileSync(`${dir}/12-not-json.txt`, "just a text file");
console.log(Object.keys(F).length + 3, "fixtures in", dir);
