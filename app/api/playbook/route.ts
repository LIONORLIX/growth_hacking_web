import { getBaseRecords } from "@/lib/feishu/client";
import { getPlaybookAppToken, getPlaybookTableId } from "@/lib/playbook-data-source";

function isPublishedRecord(item: any): boolean {
  const raw = item?.fields?.Status ?? item?.fields?.status ?? item?.fields?.STATUS;
  if (typeof raw !== "string") return false;
  return raw.trim().toLowerCase() === "pub";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");
    const recordId = searchParams.get("recordId");

    const data = await getBaseRecords(getPlaybookAppToken(), getPlaybookTableId());
    const allItems = (data as { items?: any[] })?.items || [];
    const publishedItems = allItems.filter(isPublishedRecord);

    if (!slug && !recordId) {
      return Response.json({ ok: true, data: { ...(data as object), items: publishedItems } });
    }

    const items = publishedItems;
    const record =
      items.find((item: any) => recordId && item.record_id === recordId) ||
      items.find((item: any) => {
        if (!slug) return false;
        const s = item.fields?.Slug ?? item.fields?.slug ?? item.fields?.SLUG;
        return typeof s === "string" && s.trim() === slug;
      });

    if (!record) {
      return Response.json({ ok: false, error: "Record not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: record });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
