"use server";

import { CORE_FILES_PER_ATTEMPT, coreIngestUnavailable } from "@/lib/money-flow/core-ingest";
import { detectFileKind } from "@/lib/money-flow/detect";
import { interpretDocuments, MAX_FILE_BYTES } from "@/lib/money-flow/interpret";

export async function interpretUploadedDocuments(formData: FormData) {
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) {
    return { ok: false as const, error: "Choose a CSV or a photo to interpret." };
  }
  if (files.length > CORE_FILES_PER_ATTEMPT) {
    return { ok: false as const, error: "Upload one file at a time." };
  }

  const payload = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false as const, error: `${file.name} is larger than 12MB.` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blocked = coreIngestUnavailable(detectFileKind(file.name, file.type || "", bytes));
    if (blocked) {
      return { ok: false as const, error: blocked };
    }
    payload.push({
      filename: file.name,
      mime: file.type || "",
      bytes,
    });
  }

  const result = await interpretDocuments(payload);
  return { ok: true as const, ...result };
}
