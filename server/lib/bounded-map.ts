export async function boundedMap<T, R>(
  values: readonly T[],
  maxConcurrency: number,
  operation: (value: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError("maxConcurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    for (;;) {
      if (signal?.aborted === true) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Bounded operation was cancelled");
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await operation(values[index]!, index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(maxConcurrency, values.length) },
      () => worker()
    )
  );
  return results;
}
