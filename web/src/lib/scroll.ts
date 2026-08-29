interface Scrollable {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function distanceFromBottom(el: Scrollable): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function isNearBottom(el: Scrollable, threshold = 200): boolean {
  return distanceFromBottom(el) < threshold;
}

// Load-more trigger. Deliberately independent from the scroll-button
// state so the button works even when there are no older pages.
export function shouldLoadMore(
  scrollTop: number,
  hasNextPage: boolean,
  isFetchingNextPage: boolean
): boolean {
  return scrollTop < 50 && hasNextPage && !isFetchingNextPage;
}