import {
  feishuRequest,
  getBaseRecords,
  getDocumentContent,
  getCurrentUser,
  getBaseTables,
  getBaseMeta,
} from "@/lib/feishu/client";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const appToken = searchParams.get("appToken");
    const tableId = searchParams.get("tableId");
    const documentId = searchParams.get("documentId");
    const customUrl = searchParams.get("url");
    
    console.log("[Debug] Request URL:", request.url);
    console.log("[Debug] action:", action);
    console.log("[Debug] appToken:", appToken);

    if (action === "test" || !action) {
      return Response.json({
        ok: true,
        message: "Feishu API test endpoint is working",
        availableActions: [
          "test - Check if endpoint is working",
          "user - Get current user info",
          "baseMeta&appToken=xxx - Get base meta info",
          "baseTables&appToken=xxx - List all tables in base",
          "base&appToken=xxx&tableId=xxx - Get base records",
          "doc&documentId=xxx - Get document content",
          "proxy&url=xxx - Proxy any Feishu API",
        ],
      });
    }

    if (action === "user") {
      const data = await getCurrentUser();
      return Response.json({
        ok: true,
        type: "user",
        data,
      });
    }

    if (action === "baseMeta" && appToken) {
      const data = await getBaseMeta(appToken);
      return Response.json({
        ok: true,
        type: "baseMeta",
        data,
      });
    }

    if (action === "baseTables" && appToken) {
      const data = await getBaseTables(appToken);
      return Response.json({
        ok: true,
        type: "baseTables",
        data,
      });
    }

    if (action === "base" && appToken && tableId) {
      const data = await getBaseRecords(appToken, tableId);
      return Response.json({
        ok: true,
        type: "base",
        data,
      });
    }

    if (action === "doc" && documentId) {
      const data = await getDocumentContent(documentId);
      return Response.json({
        ok: true,
        type: "doc",
        data,
      });
    }

    if (action === "proxy" && customUrl) {
      const data = await feishuRequest(customUrl);
      return Response.json({
        ok: true,
        type: "proxy",
        data,
      });
    }

    return Response.json(
      {
        ok: false,
        error: "Invalid action or missing required parameters",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("[Feishu API Error]", error);
    return Response.json(
      {
        ok: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}
