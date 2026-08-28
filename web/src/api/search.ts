import { request } from './client';
import { Message } from './messages';

export interface SearchResponse {
  results: Message[];
}

export const searchApi = {
  search: (q: string, limit = 50) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return request<SearchResponse>(`/search?${params}`);
  },
};