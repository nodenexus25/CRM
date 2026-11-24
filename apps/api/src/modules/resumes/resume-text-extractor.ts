import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

/**
 * Turns an uploaded resume file into plain text.
 *
 * The extractor is intentionally narrow: it produces text plus a verdict on
 * whether a text layer existed at all. Detecting "no text layer" here — rather
 * than deeper in the parser — is what lets the pipeline report `NEEDS_OCR` for
 * a scanned image PDF instead of silently returning an empty parse.
 *
 * DOC is best-effort: `mammoth` only understands OOXML, so a legacy binary
 * `.doc` is attempted and, when it fails, reported as `failed` so the caller
 * can fall back to a format-agnostic outcome rather than crashing the worker.
 */
export interface ExtractedResumeText {
  text: string;
  /** False when the file carries no extractable text (scanned PDF, blank doc). */
  hasTextLayer: boolean;
  /** True when the file type itself could not be decoded. */
  failed: boolean;
}

/** Below this many visible characters we treat the file as having no text layer. */
const MIN_TEXT_LENGTH = 16;

export async function extractResumeText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedResumeText> {
  const kind = resolveResumeKind(mimeType, fileName);

  try {
    switch (kind) {
      case 'pdf':
        return finalize(await extractPdf(buffer));
      case 'docx':
        return finalize(await extractDocx(buffer));
      case 'doc':
        return finalize(await extractDoc(buffer));
      case 'rtf':
        return finalize(extractRtf(buffer.toString('utf8')));
      case 'txt':
        return finalize(buffer.toString('utf8'));
      default:
        return { text: '', hasTextLayer: false, failed: true };
    }
  } catch {
    // A decode failure is distinct from "no text layer": an encrypted or truly
    // corrupt file is a failure, whereas a valid scanned PDF is `NEEDS_OCR`.
    return { text: '', hasTextLayer: false, failed: true };
  }
}

export type ResumeKind = 'pdf' | 'docx' | 'doc' | 'rtf' | 'txt' | 'unknown';

/**
 * Resolves the container format from a declared MIME type, falling back to the
 * file extension when the browser sent `application/octet-stream`.
 */
export function resolveResumeKind(mimeType: string, fileName: string): ResumeKind {
  const lower = fileName.toLowerCase();
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/msword':
      return 'doc';
    case 'application/rtf':
    case 'text/rtf':
      return 'rtf';
    case 'text/plain':
      return 'txt';
    default:
      break;
  }
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.doc')) return 'doc';
  if (lower.endsWith('.rtf')) return 'rtf';
  if (lower.endsWith('.txt')) return 'txt';
  return 'unknown';
}

/** Number of leading bytes a magic-byte probe needs. */
export const RESUME_SIGNATURE_BYTES = 8;

const RESUME_SIGNATURES: readonly { kind: ResumeKind; bytes: readonly number[] }[] = [
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { kind: 'docx', bytes: [0x50, 0x4b, 0x03, 0x04] }, // ZIP local file header
  { kind: 'doc', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }, // OLE2 compound file
];

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

/**
 * Identifies the container from its leading bytes.
 *
 * A presigned `PUT` means the API never sees the file as it is written, so the
 * declared `Content-Type` is an unverified claim. Comparing it against the
 * actual signature at completion time is what stops a browser from labelling an
 * executable as a PDF. RTF and plain text carry no reliable signature, so they
 * are detected structurally (`{\rtf`) or treated as `unknown` — never as a
 * mismatch.
 */
export function detectResumeKindFromBytes(prefix: Buffer): ResumeKind {
  for (const signature of RESUME_SIGNATURES) {
    if (startsWith(prefix, signature.bytes)) return signature.kind;
  }
  if (prefix.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  // DOCX and DOC share no signature, but a `.docx` is always a ZIP; a legacy
  // `.doc` that happens to be OOXML-in-disguise is caught by the ZIP signature.
  return 'unknown';
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // `pdf.js` reads the *whole* underlying `ArrayBuffer`, not just the view. A
  // pooled Node `Buffer` hands back a shared 8 KB pool as its `.buffer`, so the
  // parser sees bytes past the PDF and reports it as corrupt ("bad XRef entry").
  // Copying into a tightly-sized `Uint8Array` guarantees it only sees these bytes.
  const data = new Uint8Array(buffer) as unknown as Buffer;
  const result = await pdfParse(data);
  return result.text ?? '';
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

/** Mammoth rejects OLE2 `.doc`; attempt it and let the throw bubble to `failed`. */
async function extractDoc(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

/**
 * Minimal RTF-to-text: drop control words and groups, then decode the handful of
 * escapes a resume actually uses (`\'xx` hex, `\uN` unicode, `\\ \{ \}`).
 */
function extractRtf(raw: string): string {
  return raw
    .replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_match, code: string) => {
      const value = Number(code);
      return value < 0 ? String.fromCharCode(value + 65536) : String.fromCharCode(value);
    })
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\[\\{}]/g, (match) => match.slice(1))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function finalize(text: string): ExtractedResumeText {
  const cleaned = text.split('\u0000').join('').trim();
  return {
    text: cleaned,
    hasTextLayer: cleaned.length >= MIN_TEXT_LENGTH,
    failed: false,
  };
}
