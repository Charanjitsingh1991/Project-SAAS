import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app/ui";
import { EMPLOYEE_IMPORT_MAX_ROWS, employeeColumns, employeeTemplate } from "@/lib/employee-import";
import { packFor, requireWorkspace } from "@/lib/tenancy";
import { hrmTabs } from "../tabs";
import { importEmployees } from "./actions";
import { EmployeeImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import employees" };
// Large imports insert row by row.
export const maxDuration = 60;

export default async function ImportEmployeesPage() {
  const ws = await requireWorkspace({ module: "hrm" });
  const pack = packFor(ws);
  const columns = employeeColumns(pack);

  return (
    <>
      <PageHeader title="Import employees" description="Add or update people in bulk from a CSV file." tabs={hrmTabs(ws, "directory")} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Upload">
          <EmployeeImportForm action={importEmployees} template={employeeTemplate(pack)} />
        </Card>
        <Card title="Expected columns">
          <p className="font-mono text-xs break-all">{columns.join(",")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>Header names are case-insensitive and match the employees export, so an exported file can be re-imported.</li>
            <li>
              <b>name</b>, <b>designation</b> and <b>join_date</b> (YYYY-MM-DD) are required for new employees. Up to {EMPLOYEE_IMPORT_MAX_ROWS.toLocaleString()} rows per file.
            </li>
            <li>Department is matched by name. Manager is an employee code or email of someone already in the directory or elsewhere in the file.</li>
            <li>Employees are matched by code, then email. Leave <b>code</b> blank to number new employees automatically.</li>
            <li>
              {pack.code === "AE"
                ? "annual_package is the yearly total; optionally add monthly basic, housing, transport and other columns instead."
                : "annual_ctc is the yearly cost to company; pf_enrolled and metro default to yes."}{" "}
              Identity and bank columns are validated for {pack.name}.
            </li>
            <li>Status and exit_date columns from an export are ignored. Invalid rows are skipped and listed with their line number.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
