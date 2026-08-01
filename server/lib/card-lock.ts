const cardLockTails = new Map<string, Promise<void>>();

/**
 * Serializes card mutations inside one running Workbench process.
 *
 * This closes API-level races between review, update, and archive operations.
 * It is intentionally not described as crash recovery or a cross-process lock.
 */
export async function withCardLock<T>(
  cardId: string,
  action: () => Promise<T>
): Promise<T> {
  const previous = cardLockTails.get(cardId) ?? Promise.resolve();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);

  cardLockTails.set(cardId, tail);
  await previous;

  try {
    return await action();
  } finally {
    release();
    if (cardLockTails.get(cardId) === tail) {
      cardLockTails.delete(cardId);
    }
  }
}
