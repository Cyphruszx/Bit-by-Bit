export const ACCEPTED_DROP_TYPES = [
  ".csv",
  ".tsv",
  ".txt",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".heic",
] as const;

export function acceptedDropTypes(): string {
  return ACCEPTED_DROP_TYPES.join(",");
}

export function looksLikeImageUpload(name: string, mime = ""): boolean {
  return /\.(png|jpe?g|webp|gif|heic)$/i.test(name) || mime.startsWith("image/");
}
