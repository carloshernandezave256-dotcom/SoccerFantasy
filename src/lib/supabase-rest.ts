type FetchLike = typeof fetch;

export async function fetchAllRestRows<T>(
  url: string,
  requestHeaders: HeadersInit,
  fetchImpl: FetchLike = fetch,
  pageSize = 1000,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("REST page size must be a positive integer.");
  }

  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchImpl(url, {
      headers: {
        ...Object.fromEntries(new Headers(requestHeaders).entries()),
        Range: `${offset}-${offset + pageSize - 1}`,
        "Range-Unit": "items",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error((await response.text()) || `REST page request failed with ${response.status}.`);
    }

    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
