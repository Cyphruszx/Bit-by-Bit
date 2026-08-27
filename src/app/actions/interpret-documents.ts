"use server";

import { interpretDocuments, MAX_FILE_BYTES, MAX_FILES } from "@/lib/money-flow/interpret";
import { assertSameOrigin, clientIp } from "@/lib/security/origin";
import { rateLimit } from "@/lib/security/rate-limit";

export async function interpretUploadedDocuments(formData: FormData) {
  try {
    await assertSameOrigin();
  } catch {
    return { ok: false as const, error: "Invalid request origin." };
  }
  const ip = await clientIp();
  if (!rateLimit(`interpret:${ip}`, 12, 60 * 1000) || !rateLimit(`interpret-hour:${ip}`, 40, 60 * 60 * 1000)) {
    return { ok: false as const, error: "Too many uploads. Try again shortly." };
  }

  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) {
    return { ok: false as const, error: "Choose at least one document to interpret." };
  }
  if (files.length > MAX_FILES) {
    return { ok: false as const, error: `Upload up to ${MAX_FILES} documents at a time.` };
  }

  const payload = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false as const, error: `${file.name} is larger than 12MB.` };
    }
    payload.push({
      filename: file.name,
      mime: file.type || "",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }

  const result = await interpretDocuments(payload);
  return { ok: true as const, ...result };
}
