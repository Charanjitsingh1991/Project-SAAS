import { configuredProviders } from "@/lib/oauth-server";
import { PROVIDER_META, type OAuthProvider } from "@/lib/oauth";

const ICONS: Record<OAuthProvider, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  ),
  microsoft: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  ),
};

/** "Continue with Google/Microsoft" links; renders nothing unless a provider is configured. */
export function OAuthButtons({ next, invite, verb = "Continue" }: { next?: string; invite?: string; verb?: string }) {
  const providers = configuredProviders();
  if (!providers.length) return null;
  const qs = new URLSearchParams();
  if (next) qs.set("next", next);
  if (invite) qs.set("invite", invite);
  const suffix = qs.size ? `?${qs}` : "";

  return (
    <div className="mb-6 space-y-3">
      {providers.map((p) => (
        <a
          key={p}
          href={`/api/auth/${p}/start${suffix}`}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-ink/20 bg-card py-3 font-medium transition hover:border-ink/40"
        >
          {ICONS[p]}
          {verb} with {PROVIDER_META[p].label}
        </a>
      ))}
      <div className="flex items-center gap-3 pt-1 text-xs text-ink-mute">
        <span className="h-px flex-1 bg-line" />
        or use email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
