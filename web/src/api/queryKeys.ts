// Central query keys so WebSocket handlers, mutations and invalidations
// all reference the same cache entries.
export const messageKeys = {
  infinite: ['messages', 'infinite'] as const,
  latest: ['messages', 'latest'] as const,
};

export const searchKeys = {
  results: (query: string) => ['search', query] as const,
};