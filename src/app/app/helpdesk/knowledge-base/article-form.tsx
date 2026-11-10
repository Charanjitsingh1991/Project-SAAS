import Link from "next/link";
import { ActionForm, Input, SubmitButton, Textarea } from "@/components/app/forms";
import { HELPDESK_CATEGORIES } from "@/lib/helpdesk";
import { saveArticleAction } from "../actions";

export function ArticleForm({ article }: { article?: { id: number; title: string; category: string; body: string; published: boolean } }) {
  return (
    <ActionForm action={saveArticleAction} resetOnSuccess={false} className="space-y-4">
      {article && <input type="hidden" name="id" value={article.id} />}
      <Input label="Title" name="title" required maxLength={160} defaultValue={article?.title} />
      <div>
        <Input label="Category" name="category" required maxLength={60} list="kb-categories" defaultValue={article?.category ?? "General"} />
        <datalist id="kb-categories">
          {HELPDESK_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <Textarea label="Body (blank line = new paragraph)" name="body" rows={14} required maxLength={50000} defaultValue={article?.body} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="published" defaultChecked={article?.published ?? false} className="size-4 accent-ink" />
        Published on the public help center
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton>{article ? "Save article" : "Create article"}</SubmitButton>
        <Link href="/app/helpdesk/knowledge-base" className="text-sm text-ink-soft hover:text-ink">
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}
