/**
 * Spec 2A.1 / §20. Authoritative upload check.
 *
 * CSV only, unless INGEST_PDF_ENABLED is on (PDF and photos). Anything else
 * is 415 UNSUPPORTED_FILE_TYPE before a batch, quota write, or ledger row.
 * OFX/QFX stay rejected either way. Fiskil does not use this route.
 */

import { CORE_FILES_PER_ATTEMPT } from "@/lib/money-flow/core-ingest";
import { ingestPdfEnabled } from "@/lib/money-flow/ingest-pdf-flag";
import { interpretEmptyError } from "@/lib/money-flow/ingest-copy";
import { interpretDocuments, MAX_FILE_BYTES } from "@/lib/money-flow/interpret";
import { classifyUpload, UNSUPPORTED_FILE_TYPE } from "@/lib/money-flow/upload-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: interpretEmptyError() }, { status: 400 });
  }

  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0 || files.every((file) => file.size === 0)) {
    return Response.json({ ok: false, error: interpretEmptyError() }, { status: 400 });
  }
  if (files.length > CORE_FILES_PER_ATTEMPT) {
    return Response.json({ ok: false, error: "Upload one file at a time." }, { status: 400 });
  }

  const file = files[0];
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ ok: false, error: `${file.name} is larger than 12MB.` }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const openBanking = form.get("openBanking") === "true";
  const decision = classifyUpload(file.name, file.type || "", bytes, {
    pdfEnabled: ingestPdfEnabled(),
    openBanking,
  });
  if (!decision.ok) {
    return Response.json(
      { ok: false, code: UNSUPPORTED_FILE_TYPE, message: decision.message },
      { status: 415 },
    );
  }

  const result = await interpretDocuments([
    { filename: file.name, mime: file.type || "", bytes },
  ]);
  return Response.json({ ok: true, ...result });
}
