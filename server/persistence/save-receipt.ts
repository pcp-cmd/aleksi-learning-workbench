export type SaveReceipt = {
  relativePath: string;
  absolutePath: string;
  modifiedAt: string;
};

export function createSaveReceipt(
  relativePath: string,
  absolutePath: string,
  modifiedAt: string
): SaveReceipt {
  return { relativePath, absolutePath, modifiedAt };
}
