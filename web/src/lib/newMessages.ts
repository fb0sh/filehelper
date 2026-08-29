// New-message accounting for the message list.
//
// The infinite query cache is newest-first. `previousNewestId` is the id
// that was newest on the previous render; when a newer message arrives it
// is no longer at index 0, and the number of messages now before it is
// exactly how many are genuinely new. Older pages prepended by history
// pagination never touch index 0, so they never count as new messages.

export function computeAddedNewest(
  previousNewestId: string | null | undefined,
  allMessages: { id: string }[]
): number {
  if (!previousNewestId) return 0;
  const idx = allMessages.findIndex((m) => m.id === previousNewestId);
  // Still the newest, or the id vanished (context jump / deletion):
  // don't guess — treat as no new messages rather than counting a page.
  if (idx <= 0) return 0;
  return idx;
}

export type NewMessageAction = { kind: 'scroll' } | { kind: 'count'; count: number };

export function decideNewMessage(wasNearBottom: boolean, added: number): NewMessageAction {
  if (added <= 0) return { kind: 'count', count: 0 };
  return wasNearBottom
    ? { kind: 'scroll' }
    : { kind: 'count', count: added };
}