import "server-only";
import { addDaysYmd, todayYmd } from "@/lib/format";
import type { Ctx } from "@/lib/activity";
import { approvePayrollRun, createPayrollRun, payPayrollRun } from "@/lib/payroll-data";

function lastWorkingDay(period: string) {
  const [y, m] = period.split("-").map(Number);
  let d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysYmd(d, -1);
  return d;
}

/** Previous month: fully processed (created → approved → paid). Current month: draft. */
export async function seedPayroll(ctx: Ctx): Promise<void> {
  const current = todayYmd().slice(0, 7);
  const [y, m] = current.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

  const past = await createPayrollRun(ctx, prev);
  if ("runId" in past) {
    await approvePayrollRun(ctx, past.runId);
    await payPayrollRun(ctx, past.runId, lastWorkingDay(prev));
  }
  await createPayrollRun(ctx, current);
}
