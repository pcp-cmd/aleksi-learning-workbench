import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../app/query-keys";
import { apiClient } from "../../lib/api-client";
import {
  libraryQueryScope,
  useLibraryIdentity
} from "../../lib/library-identity";
import { loadDocumentDescriptor } from "./document-api";

export type ReadingListEntry = {
  id: string;
  type: "reading";
  title: string;
  concept: string;
  relativePath: string;
  updatedAt: string;
};

type ReadingListResponse = {
  readings: ReadingListEntry[];
};

export function useReadings() {
  const identity = useLibraryIdentity();
  return useQuery({
    queryKey: [...queryKeys.readings.all, ...libraryQueryScope(identity)],
    queryFn: ({ signal }) =>
      apiClient.get<ReadingListResponse>("/api/readings", { signal })
  });
}

export function useDocumentDescriptor(id: string | null) {
  const identity = useLibraryIdentity();
  return useQuery({
    queryKey: [
      ...queryKeys.documents.detail(id ?? ""),
      ...libraryQueryScope(identity)
    ],
    queryFn: ({ signal }) => loadDocumentDescriptor(id ?? "", signal),
    enabled: id !== null
  });
}
