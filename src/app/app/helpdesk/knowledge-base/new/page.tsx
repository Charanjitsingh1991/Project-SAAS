import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app/ui";
import { requireWorkspace } from "@/lib/tenancy";
import { HELPDESK_TABS } from "../../tabs";
import { ArticleForm } from "../article-form";

export const metadata: Metadata = { title: "New article" };

export default async function NewArticlePage() {
  await requireWorkspace({ module: "helpdesk" });
  return (
    <>
      <PageHeader title="New article" description="Answers customers can find on your public help center." tabs={HELPDESK_TABS("kb")} />
      <Card className="max-w-3xl">
        <ArticleForm />
      </Card>
    </>
  );
}
