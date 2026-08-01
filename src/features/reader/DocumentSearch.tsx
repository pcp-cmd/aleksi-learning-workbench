import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { DocumentSearchResult } from "../../../shared/document-contract";
import { queryKeys } from "../../app/query-keys";
import { libraryQueryScope, useLibraryIdentity } from "../../lib/library-identity";
import { searchDocument } from "./document-api";

export function DocumentSearch({
  documentId,
  onActivate
}: {
  documentId: string;
  onActivate: (result: DocumentSearchResult, query: string) => void;
}) {
  const identity = useLibraryIdentity();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const results = useQuery({
    queryKey: [...queryKeys.documents.search(documentId, query), ...libraryQueryScope(identity)],
    queryFn: ({ signal }) => searchDocument(documentId, query, signal),
    enabled: query.length > 0
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input.trim());
  }

  return (
    <section aria-label="全文搜索" className="document-search">
      <form onSubmit={submit} role="search">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="搜索完整材料"
          maxLength={200}
          onChange={(event) => setInput(event.target.value)}
          placeholder="搜索完整材料"
          value={input}
        />
      </form>
      {results.isFetching ? <p role="status">正在搜索完整材料…</p> : null}
      {results.isError ? <p role="alert">无法完成全文搜索</p> : null}
      {results.data?.results.length === 0 ? <p>没有找到匹配内容。</p> : null}
      {(results.data?.results.length ?? 0) > 0 ? (
        <ol aria-label="全文搜索结果">
          {results.data?.results.map((result, index) => (
            <li key={`${result.chunkId}-${result.sourceStartOffset}-${index}`}>
              <button onClick={() => onActivate(result, query)} type="button">
                <strong>{result.headingPath.at(-1) ?? "文档内容"}</strong>
                <span>{result.preview}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
