import { ActionForm } from "@/components/app/forms";
import { updateGoalProgress } from "../actions";

/** Progress bar with an inline 0–100 check-in form. */
export function ProgressCell({ id, progress, editable = true }: { id: number; progress: number; editable?: boolean }) {
  return (
    <div className="min-w-40">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-2 flex-1 rounded-full bg-paper-2">
          <span className="block h-2 rounded-full bg-ink" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
        <span className="w-9 text-right font-mono text-xs">{progress}%</span>
      </div>
      {editable && (
        <ActionForm action={updateGoalProgress} resetOnSuccess={false} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={id} />
          <input
            name="progress"
            type="number"
            min={0}
            max={100}
            defaultValue={progress}
            aria-label="Progress percent"
            className="h-8 w-16 rounded-full border border-line bg-paper/60 px-2.5 text-xs outline-none focus:border-ink"
          />
          <button className="h-8 rounded-full border border-line px-3 text-xs font-medium hover:border-ink">Update</button>
        </ActionForm>
      )}
    </div>
  );
}
