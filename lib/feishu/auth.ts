type TenantAccessTokenResp = {
    code: number;
    msg: string;
    tenant_access_token: string;
    expire: number;
  };
  
  let cachedToken: { value: string; expiresAt: number } | null = null;
  
  export async function getTenantAccessToken(): Promise<string> {
    const now = Date.now();
  
    if (cachedToken && now < cachedToken.expiresAt) {
      return cachedToken.value;
    }
  
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
  
    if (!appId || !appSecret) {
      throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET in .env.local");
    }
  
    const res = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
        }),
        cache: "no-store",
      }
    );
  
    if (!res.ok) {
      throw new Error(`Feishu auth failed: ${res.status}`);
    }
  
    const data = (await res.json()) as TenantAccessTokenResp;
  
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu auth error: ${data.msg}`);
    }
  
    cachedToken = {
      value: data.tenant_access_token,
      expiresAt: now + (data.expire - 60) * 1000,
    };
  
    return data.tenant_access_token;
  }