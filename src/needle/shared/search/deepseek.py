from needle.shared.search.base import HttpSearchClient, SearchResult
from needle.shared.search.queryops import QueryOps, clipped_text, parse_ops

MAX_QUERY_CHARS = 128
MAX_COUNT = 50


def _query(ops: QueryOps) -> str:
    tail = [" OR ".join(f"site:{s}" for s in ops.sites)] if ops.sites else []
    if ops.after:
        tail.append(f"after:{ops.after.isoformat()}")
    if ops.before:
        tail.append(f"before:{ops.before.isoformat()}")
    suffix = " ".join(tail)
    budget = MAX_QUERY_CHARS - len(suffix) - (1 if suffix else 0)
    return " ".join(p for p in (clipped_text(ops.text, max(budget, 0)), suffix) if p)


class DeepSeekClient(HttpSearchClient):
    engine = "deepseek"
    base_url = "https://api.deepseek.com"

    async def search(
        self, query: str, *, num_results: int = 10
    ) -> tuple[list[SearchResult] | None, dict[str, str] | None]:
        payload, err = await self._request_json(
            "POST",
            f"{self.base_url}/v1/tools/search",
            json={"query": _query(parse_ops(query)), "count": min(num_results, MAX_COUNT)},
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        if err is not None:
            return None, err
        raw_results = payload.get("results", []) if isinstance(payload, dict) else []
        results = [
            SearchResult(
                url=r["url"],
                title=r.get("title") or None,
                snippet=r.get("summary") or r.get("snippet") or None,
                published_date=r.get("date") or None,
            )
            for r in raw_results[:num_results]
            if isinstance(r, dict) and r.get("url")
        ]
        return results, None
