import Link from "next/link";
import { BarChart3, CircleUserRound, CreditCard, History, LayoutGrid, LogOut, Plug, Settings2, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { switchWorkspace } from "@/app/app/actions";
import { Logo } from "@/components/logo";
import { MODULES } from "@/lib/modules";
import { canManage, roleCanUse, type ModuleKey } from "@/lib/roles";
import { planDef } from "@/lib/plans";
import { getWorkspace, hasFeature, planModules, type ActiveWorkspace } from "@/lib/tenancy";
import { formatDate } from "@/lib/format";
import { SearchTrigger } from "./command-palette";
import { MobileNav, NavLinks, OrgSwitcher, type NavItem } from "./nav";

function buildNav(ws: ActiveWorkspace): { main: NavItem[]; modules: NavItem[]; settings: NavItem[] } {
  const included = planModules(ws);
  const modules = MODULES.filter((m) => roleCanUse(ws.role, m.key as ModuleKey) && included.includes(m.key as ModuleKey)).map((m) => ({
    href: `/app/${m.key}`,
    label: m.short,
    icon: m.key === "analytics" ? <BarChart3 className="size-3.5" /> : <m.icon className="size-3.5" />,
    color: m.color,
  }));
  const settings: NavItem[] = [];
  // Everyone can reach Integrations: the personal calendar feed needs no admin rights.
  settings.push({ href: "/app/integrations", label: "Integrations", icon: <Plug className="size-3.5" /> });
  if (canManage(ws.role)) {
    settings.push({ href: "/app/team", label: "Team & roles", icon: <UsersRound className="size-3.5" /> });
    settings.push({ href: "/app/billing", label: "Billing", icon: <CreditCard className="size-3.5" /> });
    settings.push({ href: "/app/settings", label: "Settings", icon: <Settings2 className="size-3.5" /> });
    if (hasFeature(ws, "auditLog")) settings.push({ href: "/app/audit", label: "Audit log", icon: <History className="size-3.5" /> });
  }
  if (ws.isPlatformAdmin) settings.push({ href: "/admin", label: "Platform admin", icon: <ShieldCheck className="size-3.5" />, color: "bg-lime" });
  return {
    main: [
      { href: "/app", label: "Overview", icon: <LayoutGrid className="size-3.5" /> },
      { href: "/app/me", label: "My space", icon: <CircleUserRound className="size-3.5" /> },
      ...(hasFeature(ws, "copilot") ? [{ href: "/app/ask", label: "Ask AI", icon: <Sparkles className="size-3.5" /> }] : []),
    ],
    modules,
    settings,
  };
}

function TrialChip({ ws }: { ws: ActiveWorkspace }) {
  const a = ws.access;
  if (a.state === "trial") {
    const pct = Math.min(100, ((a.day - 1) / 14) * 100);
    return (
      <Link href={canManage(ws.role) ? "/app/billing" : "/app"} className="block rounded-xl border border-line bg-card p-3 text-xs hover:border-ink">
        <div className="flex justify-between font-medium">
          <span>Free trial · day {Math.min(a.day, 14)}/14</span>
          <span className={a.lastDay ? "text-signal" : "text-ink-soft"}>{a.daysLeft}d left</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-2">
          <div className={a.lastDay ? "h-full bg-signal" : "h-full bg-ink"} style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <p className="mt-1.5 text-ink-mute">Ends {formatDate(new Date(a.endsAt.getTime() - 1))}, 11:59 PM</p>
      </Link>
    );
  }
  if (a.state === "comped")
    return (
      <div className="rounded-xl border border-line bg-lime/60 p-3 text-xs font-medium">
        {planDef(ws.org.plan).name} plan · free access
      </div>
    );
  if (a.state === "paid")
    return (
      <div className="rounded-xl border border-line bg-mint/60 p-3 text-xs font-medium">
        {planDef(ws.org.plan).name} plan · active
      </div>
    );
  if (a.state === "past_due") return <div className="rounded-xl bg-butter p-3 text-xs font-medium">Payment failed — update card</div>;
  return <div className="rounded-xl bg-signal p-3 text-xs font-medium text-white">Workspace deactivated</div>;
}

function NavBody({ ws }: { ws: ActiveWorkspace }) {
  const nav = buildNav(ws);
  return (
    <div className="flex flex-col gap-5">
      <OrgSwitcher orgs={ws.orgs} currentId={ws.org.id} action={switchWorkspace} />
      <SearchTrigger />
      <NavLinks items={nav.main} />
      <div>
        <p className="mb-2 px-3 font-mono text-[10px] tracking-widest text-ink-mute uppercase">Modules</p>
        <NavLinks items={nav.modules} />
      </div>
      {nav.settings.length > 0 && (
        <div>
          <p className="mb-2 px-3 font-mono text-[10px] tracking-widest text-ink-mute uppercase">Workspace</p>
          <NavLinks items={nav.settings} />
        </div>
      )}
      <TrialChip ws={ws} />
      <div className="flex items-center gap-3 border-t border-line pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs text-paper">
          {ws.user.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{ws.user.name}</p>
          <p className="truncate text-xs text-ink-mute">{ws.user.email}</p>
        </div>
        <Link href="/app/account" aria-label="Account" title="Account" className="grid size-8 place-items-center rounded-full hover:bg-paper-2">
          <Settings2 className="size-4" />
        </Link>
        <form action={logout}>
          <button aria-label="Log out" title="Log out" className="grid size-8 place-items-center rounded-full hover:bg-paper-2">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export async function Sidebar() {
  const ws = await getWorkspace();
  if (!ws?.org || !ws.role || !ws.access) {
    return (
      <header className="flex h-16 items-center px-5 lg:hidden">
        <Logo />
      </header>
    );
  }
  const active = ws as ActiveWorkspace;
  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-4 backdrop-blur lg:hidden print:hidden">
        <Logo />
        <MobileNav>
          <NavBody ws={active} />
        </MobileNav>
      </header>
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper-2/40 px-4 py-5 lg:flex print:hidden">
        <Logo className="mb-6 px-2" />
        <NavBody ws={active} />
      </aside>
    </>
  );
}
