'use client';
// Renders a TanStack query's three states the same way on every screen:
//   <QueryView query={q} loading={<Skeleton rows={6} />} empty={(d) => d.length === 0 && <Empty/>}>
//     {(data) => <List data={data} />}
//   </QueryView>
// On a refetch error with data already loaded, the data stays and the error card shows above it.
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorCard } from './ErrorCard';
import { Skeleton } from './Skeleton';

export interface QueryViewProps<T> {
  query: UseQueryResult<T, unknown>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  /** Return a node to show instead of children when the data is empty. */
  empty?: (data: T) => ReactNode | false | null | undefined;
}

export function QueryView<T>({ query, children, loading, empty }: QueryViewProps<T>) {
  if (query.data === undefined) {
    if (query.isError) return <ErrorCard error={query.error} onRetry={() => void query.refetch()} />;
    return <>{loading ?? <Skeleton />}</>;
  }
  const e = empty?.(query.data);
  return (
    <>
      {query.isError ? <ErrorCard error={query.error} onRetry={() => void query.refetch()} /> : null}
      {e ? e : children(query.data)}
    </>
  );
}
