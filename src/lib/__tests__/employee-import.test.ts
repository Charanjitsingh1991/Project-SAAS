import assert from "node:assert/strict";
import { test } from "node:test";
import { COUNTRIES } from "../countries";
import { EMPLOYEE_IMPORT_MAX_ROWS, employeeColumns, employeeTemplate, missingForNew, parseEmployees } from "../employee-import";

const IN = COUNTRIES.IN;
const AE = COUNTRIES.AE;

test("employees: case-insensitive headers, aliases, row numbers, in-file dupes", () => {
  const csv = [
    "Name,Email,Designation,Join Date,Department,Annual CTC,PAN,Gender",
    "Asha Verma,ASHA@x.com,Engineer,2026-04-01,Ops,600000,abcde1234f,F",
    "B,bad,Engineer,2026-04-01,,,,",
    "Cy Dee,asha@x.com,Engineer,2026-04-01,,,,",
    "Di Eve,di@x.com,Engineer,2026-13-01,,,,",
  ].join("\n");
  const r = parseEmployees(csv, IN);
  assert.equal(r.fatal, undefined);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].row, 2);
  const d = r.rows[0].data;
  assert.equal(d.email, "asha@x.com");
  assert.equal(d.annualCtc, 60_000_000);
  assert.equal(d.gender, "female");
  assert.equal(d.fields.pan, "ABCDE1234F");
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(r.errors[1].message, /Duplicate of row 2/);
});

test("employees: invalid country fields are reported with column names", () => {
  const r = parseEmployees("name,designation,join_date,pan,ifsc\nAsha V,Eng,2026-04-01,NOPE,HDFC0001234\n", IN);
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /pan:/);
});

test("employees: missing required columns, empty and capped files are fatal", () => {
  assert.match(parseEmployees("name,email\nA B,a@x.com\n", IN).fatal!, /Missing required columns: designation, join_date/);
  assert.match(parseEmployees("", IN).fatal!, /empty/);
  assert.match(parseEmployees("name,designation,join_date\n", IN).fatal!, /no data rows/);
  const many = "name,designation,join_date\n" + Array.from({ length: EMPLOYEE_IMPORT_MAX_ROWS + 1 }, (_, i) => `Emp ${i},Eng,2026-01-01`).join("\n");
  assert.match(parseEmployees(many, IN).fatal!, /Too many rows/);
  const ok = "name,designation,join_date\n" + Array.from({ length: EMPLOYEE_IMPORT_MAX_ROWS }, (_, i) => `Emp ${i},Eng,2026-01-01`).join("\n");
  assert.equal(parseEmployees(ok, IN).rows.length, EMPLOYEE_IMPORT_MAX_ROWS);
});

test("employees: duplicate codes rejected, update rows may omit designation/join date values", () => {
  const r = parseEmployees("code,name,designation,join_date,email\nEMP-0001,Asha V,,,a@x.com\nemp-0001,Bo Cee,Eng,2026-01-01,b@x.com\n", IN);
  assert.equal(r.rows.length, 1);
  assert.match(r.errors[0].message, /Duplicate employee code of row 2/);
  assert.deepEqual(missingForNew(r.rows[0].data), ["designation", "join_date"]);
});

test("employees: UAE package, components, nationality names and export headers", () => {
  const r = parseEmployees(
    "name,designation,join_date,annual_package,nationality,emirates_id,labour_card,wps_person_id,manager\nAsha V,Eng,2026-01-01,120000,India,784-1990-1234567-1,555,10012345678901,EMP-0001\n",
    AE,
  );
  assert.deepEqual(r.errors, []);
  const d = r.rows[0].data;
  assert.equal(d.annualCtc, 12_000_000);
  assert.equal(d.fields.nationality, "IN");
  assert.equal(d.fields.labourCardNumber, "555");
  assert.equal(d.manager, "EMP-0001");
  assert.equal(d.pfEnrolled, undefined);

  const c = parseEmployees("name,designation,join_date,basic,housing\nAsha V,Eng,2026-01-01,5000,2000\n", AE);
  assert.deepEqual(c.rows[0].data.components, { basic: 500_000, housing: 200_000, transport: 0, other: 0 });
  assert.equal(c.rows[0].data.annualCtc, 8_400_000);
});

test("employees: template parses cleanly for both country packs", () => {
  for (const pack of [IN, AE]) {
    const cols = employeeColumns(pack);
    const tpl = employeeTemplate(pack);
    assert.equal(tpl.split("\n")[0], cols.join(","));
    const r = parseEmployees(tpl, pack);
    assert.equal(r.fatal, undefined);
    assert.deepEqual(r.errors, [], pack.code);
    assert.equal(r.rows.length, 1);
  }
});
