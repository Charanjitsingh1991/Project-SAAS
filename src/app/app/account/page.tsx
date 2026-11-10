import type { Metadata } from "next";
import { ActionForm, Input, SubmitButton } from "@/components/app/forms";
import { Card, PageHeader } from "@/components/app/ui";
import { changePassword } from "@/app/actions/password";
import { requireWorkspace } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const ws = await requireWorkspace({ allowLocked: true });
  return (
    <>
      <PageHeader title="Account" description="Your sign-in details." />
      <div className="grid max-w-3xl gap-5">
        <Card title="Profile">
          <dl className="grid gap-3 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-mute">Name</dt>
              <dd className="font-medium">{ws.user.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">Email</dt>
              <dd className="font-medium">{ws.user.email}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Change password">
          <ActionForm action={changePassword} className="grid gap-4 p-5 sm:max-w-sm">
            <Input label="Current password" name="current" type="password" autoComplete="current-password" />
            <Input label="New password" name="password" type="password" autoComplete="new-password" />
            <Input label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
            <p className="text-xs text-ink-mute">8+ characters with a letter and a number.</p>
            <SubmitButton>Update password</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
