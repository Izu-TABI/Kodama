// Asks our server for a YouTube video's or TED talk's captions.
export async function lookupUrl(url, signal) {
  let res;
  try {
    res = await fetch(`/api/lookup?url=${encodeURIComponent(url)}`, { signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('サーバーに接続できませんでした');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error?.message || '読み込めませんでした');
  return body;
}
