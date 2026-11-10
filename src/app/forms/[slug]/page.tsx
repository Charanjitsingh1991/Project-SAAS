import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ActionForm, Input, SubmitButton, Textarea } from "@/components/app/forms";
import { submitWebLead } from "../actions";
import { webFormOrg } from "../data";

/** 404 for unknown slugs and for workspaces whose plan/modules don't include web forms. */
const getFormOrg = cache(async (slug: string) => {
  const org = await webFormOrg(slug);
  if (!org) notFound();
  return org;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const org = await getFormOrg((await params).slug);
  return { title: `Contact ${org.name}` };
}

export default async function WebFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const org = await getFormOrg((await params).slug);
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      <section className="rounded-[24px] border border-line bg-card p-6 md:p-8">
        <h1 className="font-display text-2xl font-semibold">Get in touch with {org.name}</h1>
        <p className="mt-1 mb-6 text-sm text-ink-soft">Leave your details and the team will reach out.</p>
        <ActionForm action={submitWebLead} className="grid gap-4">
          <input type="hidden" name="slug" value={org.slug} />
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <Input label="Your name" name="name" required maxLength={120} autoComplete="name" />
          <Input label="Work email" name="email" type="email" required maxLength={200} autoComplete="email" />
          <Input label="Phone (optional)" name="phone" type="tel" maxLength={30} autoComplete="tel" placeholder={org.pack.phone.example} />
          <Input label="Company (optional)" name="company" maxLength={160} autoComplete="organization" />
          <Textarea label="How can we help?" name="message" rows={4} maxLength={2000} />
          <div>
            <SubmitButton variant="signal">Send</SubmitButton>
          </div>
        </ActionForm>
      </section>
      <p className="mt-4 text-center text-xs text-ink-mute">Powered by saas.tech</p>
    </main>
  );
}
