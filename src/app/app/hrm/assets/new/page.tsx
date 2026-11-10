import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/app/ui";
import { requireWorkspace } from "@/lib/tenancy";
import { AssetForm } from "../_asset-form";
import { createAsset } from "../actions";
import { hrmTabs } from "../../tabs";

export const metadata: Metadata = { title: "New asset" };

export default async function NewAssetPage() {
  const ws = await requireWorkspace({ module: "hrm", manage: true });
  return (
    <>
      <PageHeader title="New asset" description="The asset tag is assigned automatically." tabs={hrmTabs(ws, "assets")} />
      <Card className="max-w-2xl">
        <AssetForm action={createAsset} currency={ws.org.currency} />
      </Card>
    </>
  );
}
