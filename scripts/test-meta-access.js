const graphVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v23.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;

async function graph(pathname, token) {
  const separator = pathname.includes("?") ? "&" : "?";
  const response = await fetch(`${graphBase}/${pathname}${separator}access_token=${encodeURIComponent(token)}`);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const token = requireEnv("FACEBOOK_PAGE_ACCESS_TOKEN");
  const pageId = requireEnv("FACEBOOK_PAGE_ID");
  const me = await graph("me?fields=id,name", token);
  if (!me.response.ok) throw new Error(`Facebook token check failed: ${JSON.stringify(me.body)}`);

  let page = me.body;
  if (me.body.id !== pageId) {
    const accounts = await graph("me/accounts?fields=id,name,tasks", token);
    if (!accounts.response.ok) throw new Error(`Facebook Page lookup failed: ${JSON.stringify(accounts.body)}`);
    page = Array.isArray(accounts.body.data)
      ? accounts.body.data.find((item) => item.id === pageId)
      : undefined;
  }
  if (!page) throw new Error(`Configured Facebook Page ${pageId} is not available to this token`);

  const connected = await graph(
    `${encodeURIComponent(pageId)}?fields=id,name,instagram_business_account{id,username},connected_instagram_account{id,username}`,
    token,
  );
  if (!connected.response.ok) throw new Error(`Connected Instagram lookup failed: ${JSON.stringify(connected.body)}`);

  const instagram = connected.body.instagram_business_account || connected.body.connected_instagram_account;
  console.log(JSON.stringify({
    facebook: { id: page.id, name: page.name, tasks: page.tasks },
    instagram: instagram ? { id: instagram.id, username: instagram.username } : null,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
