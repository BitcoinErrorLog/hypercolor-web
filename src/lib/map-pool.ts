/** Bounded concurrency over an array. Order of results matches `items`. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item, index);
    }
  }

  const workers = Math.min(limit, items.length);
  if (workers === 0) return [];
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
