import assert from "node:assert/strict";
import test from "node:test";
import { cellTone, personInitials } from "./cellStyle.ts";
import { REGISTERS, registerById } from "./defs.ts";
import { heatmap } from "./heatmap.ts";
import { TOOL_GROUPS, formSections, groupTools } from "./layout.ts";
import { filterRecords } from "./records.ts";

const raid = registerById("raid");
const record = (values) => ({
  id: "rg_000000000001",
  createdAt: "",
  updatedAt: "",
  values: { status: "Open", ...values },
});

test("cellTone: impact, likelihood and RAG fields run from green to red", () => {
  assert.equal(cellTone(raid, "impact", "Low"), "success");
  assert.equal(cellTone(raid, "likelihood", "Medium"), "warning");
  assert.equal(cellTone(raid, "impact", "High"), "danger");
  assert.equal(cellTone(registerById("status-report"), "budget", "Amber"), "warning");
  assert.equal(cellTone(raid, "impact", ""), null);
  assert.equal(cellTone(raid, "title", "High"), null);
  assert.equal(cellTone(registerById("stakeholders"), "influence", "High"), null);
});

test("cellTone: statuses are red when open, amber in progress, green when closed", () => {
  assert.equal(cellTone(raid, "status", "Open"), "danger");
  assert.equal(cellTone(raid, "status", "Mitigating"), "warning");
  assert.equal(cellTone(raid, "status", "Closed"), "success");
  const decisions = registerById("decisions");
  assert.equal(cellTone(decisions, "status", "Superseded"), "neutral");
  assert.equal(cellTone(decisions, "status", "Decided"), "accent");
  assert.equal(cellTone(registerById("sla"), "priority", "P1"), "danger");
});

test("cellTone: RAID types have their own chip, other kinds a neutral outline", () => {
  assert.equal(cellTone(raid, "kind", "Issue"), "danger");
  assert.equal(cellTone(raid, "kind", "Risk"), "warning");
  assert.equal(cellTone(registerById("doclinks"), "kind", "Plan"), "outline");
});

test("personInitials: first and last word, from a name or an e-mail address", () => {
  assert.equal(personInitials("Priya Nair"), "PN");
  assert.equal(personInitials("priya"), "P");
  assert.equal(personInitials("Mary Ann van Dyke"), "MD");
  assert.equal(personInitials("priya.nair@example.com"), "PN");
  assert.equal(personInitials("  "), "");
  assert.equal(personInitials("élodie Roux"), "ÉR");
});

test("heatmap: counts open items per impact x likelihood, highest impact first", () => {
  const items = [
    record({ impact: "High", likelihood: "High" }),
    record({ impact: "High", likelihood: "High" }),
    record({ impact: "Low", likelihood: "Medium" }),
    record({ impact: "High", likelihood: "Low", status: "Closed" }),
  ];
  const map = heatmap(raid, items);
  assert.deepEqual(map.rows, ["High", "Medium", "Low"]);
  assert.deepEqual(map.cols, ["Low", "Medium", "High"]);
  assert.equal(map.total, 3);
  const at = (row, col) => map.cells[map.rows.indexOf(row)][map.cols.indexOf(col)];
  assert.equal(at("High", "High").count, 2);
  assert.equal(at("High", "High").tone, "danger");
  assert.equal(at("Low", "Medium").count, 1);
  assert.equal(at("Low", "Low").tone, "success");
  assert.equal(at("Medium", "Medium").tone, "warning");
  assert.equal(at("High", "Low").count, 0);
});

test("heatmap: only tools that ask for one have it", () => {
  assert.equal(heatmap(registerById("decisions"), []), null);
});

test("filterRecords: a heat-map cell narrows by its field values", () => {
  const items = [
    record({ impact: "High", likelihood: "High" }),
    record({ impact: "High", likelihood: "Low" }),
  ];
  const hit = filterRecords(raid, items, {
    match: { impact: "High", likelihood: "Low" },
  });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].values.likelihood, "Low");
  assert.equal(filterRecords(raid, items, { match: {} }).length, 2);
});

test("groupTools: the fourteen tools fall into four named groups, each once", () => {
  const tools = REGISTERS.map((def) => ({ id: def.id }));
  const groups = groupTools(tools);
  assert.deepEqual(
    groups.map((g) => g.title),
    TOOL_GROUPS.map((g) => g.title),
  );
  const ids = groups.flatMap((g) => g.tools.map((t) => t.id));
  assert.equal(ids.length, 14);
  assert.deepEqual([...ids].sort(), tools.map((t) => t.id).sort());
});

test("groupTools: an unlisted tool goes to More and an empty group is dropped", () => {
  const groups = groupTools([{ id: "raid" }, { id: "brand-new" }]);
  assert.deepEqual(
    groups.map((g) => [g.title, g.tools.map((t) => t.id)]),
    [
      ["Risks and decisions", ["raid"]],
      ["More", ["brand-new"]],
    ],
  );
});

test("formSections: RAID reads What, Who, When, Mitigation and loses no field", () => {
  const sections = formSections(raid);
  assert.deepEqual(
    sections.map((s) => s.title),
    ["What", "Who", "When", "Mitigation"],
  );
  assert.deepEqual(
    sections.flatMap((s) => s.fields.map((f) => f.key)).sort(),
    raid.fields.map((f) => f.key).sort(),
  );
});

test("formSections: other tools are grouped by field type and keep every field once", () => {
  for (const def of REGISTERS) {
    const keys = formSections(def).flatMap((s) => s.fields.map((f) => f.key));
    assert.deepEqual(keys.sort(), def.fields.map((f) => f.key).sort(), def.id);
  }
  const vendors = formSections(registerById("vendors"));
  assert.equal(vendors[0].title, "What");
  assert.ok(vendors.some((s) => s.title === "Who"));
});
