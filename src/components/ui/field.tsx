import { cn } from "@/lib/utils";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: React.ReactNode;
};

export function Field({ label, name, errors, hint, className, ...props }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium">
        {label}
        {hint}
      </span>
      <input
        name={name}
        aria-invalid={!!errors?.length}
        className={cn(
          "h-12 w-full rounded-xl border bg-card px-4 outline-none transition focus:border-ink focus:ring-4 focus:ring-ink/5",
          errors?.length ? "border-signal" : "border-line",
        )}
        {...props}
      />
      <FieldError errors={errors} />
    </label>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1.5 block text-xs font-medium text-signal">{errors[0]}</span>;
}
