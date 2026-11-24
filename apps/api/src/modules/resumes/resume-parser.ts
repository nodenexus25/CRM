import {
  parsedResumeSchema,
  type ParsedResume,
  type ResumeParserChoice,
} from '@talentflow/types';

import { matchSkill, SKILL_DICTIONARY } from './skill-dictionary';

/**
 * The `ResumeParser` seam.
 *
 * Two implementations sit behind the same interface: a deterministic regex
 * parser that always works offline, and an LLM parser used when an API key is
 * configured. The service picks one based on `LLM_PROVIDER`, and falls back to
 * regex whenever the LLM cannot produce valid JSON — a resume upload must never
 * fail because a model had a bad day.
 */
export interface ResumeParseInput {
  text: string;
  fileName: string;
}

export interface ResumeParseOutput {
  data: ParsedResume;
  confidence: number;
  parserUsed: 'llm' | 'regex';
}

export interface ResumeParser {
  readonly name: 'llm' | 'regex';
  parse(input: ResumeParseInput): Promise<ResumeParseOutput>;
}

export interface AiConfig {
  provider: 'openai' | 'anthropic' | 'regex' | 'none';
  apiKey?: string;
  model: string;
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Regex parser
// ---------------------------------------------------------------------------

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[^\s)>,]+/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)>,]+/i;
const URL_RE = /https?:\/\/[^\s<>")]+/gi;
const PHONE_RE = /(?:\+?\d[\d().\s-]{6,}\d)/g;
const YEARS_RE = /(\d{1,2})(?:\s*\+)?\s*(?:years?|yrs?)\b/i;
const DATE_RANGE_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4}|\d{4})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*\d{4}|\d{4}|present|current|now)/i;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const DEGREE_RE =
  /\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?e|m\.?\s?e|b\.?\s?sc|m\.?\s?sc|b\.?\s?ca|m\.?\s?ca|b\.?\s?com|m\.?\s?com|mba|ph\.?\s?d|bachelor(?:'?s)?|master(?:'?s)?|doctorate|diploma|associate)\b/i;

/** Deterministic, offline resume parser. Always available as the fallback. */
export class RegexResumeParser implements ResumeParser {
  readonly name = 'regex' as const;

  async parse(input: ResumeParseInput): Promise<ResumeParseOutput> {
    const text = input.text;
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const email = truncate(emailMatch(text), 254);
    const phone = truncate(phoneMatch(text, lines), 40);
    const linkedinUrl = truncate(withScheme(LINKEDIN_RE.exec(text)?.[0]), 500);
    const githubUrl = truncate(withScheme(GITHUB_RE.exec(text)?.[0]), 500);
    const websiteUrl = findWebsite(text, linkedinUrl, githubUrl);

    const fullName = guessName(lines);
    const { firstName, lastName } = splitName(fullName);
    const headline = guessHeadline(lines, fullName);
    const location = guessLocation(lines);
    const summary = guessSection(lines, ['summary', 'profile', 'objective', 'about']);

    const skills = guessSkills(lines);
    const experiences = guessExperiences(lines);
    const educations = guessEducations(lines);
    const certifications = guessCertifications(lines);
    const languages = guessLanguages(lines);

    const data = parsedResumeSchema.parse({
      fullName,
      firstName,
      lastName,
      email,
      phone,
      locationCity: location.city,
      locationState: location.state,
      locationCountry: location.country,
      linkedinUrl,
      githubUrl,
      websiteUrl,
      headline,
      summary,
      totalExperienceMonths: guessTotalExperienceMonths(text, experiences),
      skills,
      experiences,
      educations,
      certifications,
      languages,
    });

    return { data, confidence: scoreConfidence(data), parserUsed: 'regex' };
  }
}

// ---------------------------------------------------------------------------
// LLM parser
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You extract structured data from resumes.',
  'Respond with a single JSON object and nothing else.',
  'Use null for unknown scalar fields and [] for unknown lists.',
  'Never invent employers, dates, emails or phone numbers that are not present.',
].join(' ');

const JSON_SHAPE = `{
  "fullName": string|null, "firstName": string|null, "lastName": string|null,
  "email": string|null, "phone": string|null,
  "locationCity": string|null, "locationState": string|null, "locationCountry": string|null,
  "linkedinUrl": string|null, "githubUrl": string|null, "websiteUrl": string|null,
  "headline": string|null, "summary": string|null, "totalExperienceMonths": number|null,
  "skills": [{ "name": string, "years": number|null, "level": number|null }],
  "experiences": [{ "company": string|null, "title": string|null, "employmentType": string|null,
    "location": string|null, "startDate": string|null, "endDate": string|null, "isCurrent": boolean,
    "description": string|null, "skills": string[] }],
  "educations": [{ "institution": string|null, "degree": string|null, "fieldOfStudy": string|null,
    "startDate": string|null, "endDate": string|null, "grade": string|null, "description": string|null }],
  "certifications": [{ "name": string, "issuer": string|null, "issuedAt": string|null,
    "expiresAt": string|null, "credentialId": string|null, "credentialUrl": string|null }],
  "languages": [{ "name": string, "proficiency": "BASIC"|"CONVERSATIONAL"|"PROFESSIONAL"|"NATIVE" }]
}`;

/**
 * LLM-backed parser. It asks for strict JSON, validates it against the shared
 * schema and retries once before giving up — at which point the caller falls
 * back to the regex parser rather than marking the upload failed.
 */
export class LlmResumeParser implements ResumeParser {
  readonly name = 'llm' as const;

  constructor(
    private readonly config: AiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async parse(input: ResumeParseInput): Promise<ResumeParseOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.callModel(input.text, attempt > 0);
        const parsed = parsedResumeSchema.parse(JSON.parse(raw));
        return { data: parsed, confidence: 0.9, parserUsed: 'llm' };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('The language model did not return usable JSON.');
  }

  private async callModel(text: string, strictRetry: boolean): Promise<string> {
    const prompt = `${SYSTEM_PROMPT}\n\nReturn exactly this shape:\n${JSON_SHAPE}\n\nResume:\n"""\n${text.slice(0, 24_000)}\n"""`;
    const retryNote = strictRetry
      ? '\n\nYour previous reply was not valid JSON. Reply with JSON only.'
      : '';

    if (this.config.provider === 'anthropic') {
      return this.callAnthropic(prompt + retryNote);
    }
    return this.callOpenAi(prompt + retryNote);
  }

  private async callOpenAi(prompt: string): Promise<string> {
    const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) throw new Error(`LLM request failed with status ${response.status}`);
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM response contained no content');
    return content;
  }

  private async callAnthropic(prompt: string): Promise<string> {
    const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`LLM request failed with status ${response.status}`);
    const payload = (await response.json()) as { content?: { text?: string }[] };
    const content = payload.content?.[0]?.text;
    if (!content) throw new Error('LLM response contained no content');
    return content;
  }
}

/** Picks the parser for a request: explicit choice wins, `auto` reads config. */
export function selectResumeParser(choice: ResumeParserChoice, ai: AiConfig): ResumeParser {
  const regex = new RegexResumeParser();

  if (choice === 'regex') return regex;
  if (choice === 'llm') return ai.apiKey ? new LlmResumeParser(ai) : regex;

  const llmConfigured =
    (ai.provider === 'openai' || ai.provider === 'anthropic') && Boolean(ai.apiKey);
  return llmConfigured ? new LlmResumeParser(ai) : regex;
}

// ---------------------------------------------------------------------------
// Regex heuristics
// ---------------------------------------------------------------------------

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function withScheme(value: string | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function emailMatch(text: string): string | null {
  return EMAIL_RE.exec(text)?.[0] ?? null;
}

function phoneMatch(text: string, lines: string[]): string | null {
  const candidates = text.match(PHONE_RE) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) return candidate.trim();
  }
  // Fall back to a labelled "Phone:" line that the loose pattern may have split.
  for (const line of lines) {
    const match = /(?:phone|mobile|tel|contact)\s*[:#-]?\s*(.+)$/i.exec(line);
    const value = match?.[1]?.trim();
    if (value && value.replace(/\D/g, '').length >= 8) return value;
  }
  return null;
}

function findWebsite(text: string, linkedinUrl: string | null, githubUrl: string | null): string | null {
  const urls = text.match(URL_RE) ?? [];
  for (const url of urls) {
    const lower = url.toLowerCase();
    if (lower.includes('linkedin.com') || lower.includes('github.com')) continue;
    if (linkedinUrl && url === linkedinUrl) continue;
    if (githubUrl && url === githubUrl) continue;
    return truncate(url, 500);
  }
  return null;
}

function looksLikeName(line: string): boolean {
  if (line.length < 3 || line.length > 60) return false;
  if (/[@\d]/.test(line)) return false;
  const lower = line.toLowerCase();
  if (/(resume|curriculum vitae|\.com)/.test(lower)) return false;
  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 5) return false;
  return words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word));
}

function guessName(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    if (looksLikeName(line)) return truncate(line, 200);
  }
  return null;
}

function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const words = fullName.split(/\s+/);
  if (words.length === 1) return { firstName: truncate(words[0], 120), lastName: null };
  return {
    firstName: truncate(words[0], 120),
    lastName: truncate(words[words.length - 1], 120),
  };
}

function guessHeadline(lines: string[], fullName: string | null): string | null {
  const startIndex = fullName ? lines.indexOf(fullName) + 1 : 0;
  for (const line of lines.slice(startIndex, startIndex + 3)) {
    if (line.length > 90) continue;
    if (/[@]/.test(line)) continue;
    if (URL_RE.test(line)) continue;
    if (!/[A-Za-z]{3}/.test(line)) continue;
    return truncate(line, 200);
  }
  return null;
}

function guessLocation(lines: string[]): { city: string | null; state: string | null; country: string | null } {
  for (const line of lines.slice(0, 12)) {
    const match = /([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z][A-Za-z .'-]{1,40})/.exec(line);
    if (!match) continue;
    const city = truncate(match[1] ?? null, 120);
    const second = (match[2] ?? '').trim();
    if (!city) continue;
    if (/^[A-Z]{2}$/.test(second)) {
      return { city, state: truncate(second, 120), country: null };
    }
    return { city, state: null, country: truncate(second, 120) };
  }
  return { city: null, state: null, country: null };
}

/** Returns the body of the first matching section, or null. */
function guessSection(lines: string[], headings: string[]): string | null {
  const start = findHeadingIndex(lines, headings);
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (isHeading(line) && body.length > 0) break;
    body.push(line);
    if (body.join(' ').length > 4000) break;
  }
  const text = body.join(' ').trim();
  return truncate(text, 8000);
}

function findHeadingIndex(lines: string[], headings: string[]): number {
  return lines.findIndex((line) => {
    const normalized = line.toLowerCase().replace(/[:•\-–]/g, '').trim();
    return headings.some((heading) => normalized === heading || normalized.startsWith(`${heading} `));
  });
}

function isHeading(line: string): boolean {
  if (line.length > 40) return false;
  if (/[:]$/.test(line)) return true;
  return /^(summary|profile|objective|about|experience|work experience|employment|education|skills|technical skills|projects|certifications|certificates|languages|interests|achievements|awards|references)\b/i.test(
    line,
  );
}

function guessSkills(lines: string[]): ParsedResume['skills'] {
  const found = new Map<string, { name: string; years: number | null; level: number | null }>();

  const sectionText = guessSection(lines, ['skills', 'technical skills', 'core competencies', 'technologies', 'tools']);
  const sectionCandidates = sectionText
    ? sectionText.split(/[,;|•·\n]|\s{2,}/).map((entry) => entry.trim()).filter(Boolean)
    : [];

  for (const candidate of sectionCandidates) {
    const entry = normalizeCandidate(candidate);
    if (entry) found.set(entry.name.toLowerCase(), entry);
  }

  // Dictionary sweep across the whole document catches skills mentioned in
  // prose (e.g. inside an experience bullet) that have no dedicated section.
  const haystack = lines.join('\n');
  for (const dictionaryEntry of SKILL_DICTIONARY) {
    if (found.size >= 60) break;
    const spellings = [dictionaryEntry.name, ...dictionaryEntry.aliases];
    if (spellings.some((spelling) => containsSpelling(haystack, spelling))) {
      found.set(dictionaryEntry.name.toLowerCase(), { name: dictionaryEntry.name, years: null, level: null });
    }
  }

  return [...found.values()].slice(0, 120);
}

function normalizeCandidate(candidate: string): { name: string; years: number | null; level: number | null } | null {
  const cleaned = candidate.replace(/^[-–•*\s]+/, '').trim();
  if (cleaned.length < 1 || cleaned.length > 80) return null;
  if (!/[A-Za-z+#.]/.test(cleaned)) return null;
  if (/[@]/.test(cleaned)) return null;
  const entry = matchSkill(cleaned);
  return { name: entry?.name ?? cleaned, years: null, level: null };
}

function containsSpelling(text: string, spelling: string): boolean {
  const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text);
}

function guessExperiences(lines: string[]): ParsedResume['experiences'] {
  const start = findHeadingIndex(lines, ['experience', 'work experience', 'employment', 'professional experience']);
  if (start === -1) return [];

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (isHeading(line) && body.length > 0) break;
    body.push(line);
  }

  const experiences: ParsedResume['experiences'] = [];
  let current: { headerLines: string[]; bodyLines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const parsed = buildExperience(current.headerLines, current.bodyLines);
    if (parsed) experiences.push(parsed);
    current = null;
  };

  for (const line of body) {
    if (DATE_RANGE_RE.test(line)) {
      flush();
      current = { headerLines: [line], bodyLines: [] };
    } else if (current) {
      if (current.headerLines.length < 3 && !current.bodyLines.length) current.headerLines.push(line);
      else current.bodyLines.push(line);
    } else {
      current = { headerLines: [line], bodyLines: [] };
    }
  }
  flush();

  return experiences.slice(0, 60);
}

function buildExperience(
  headerLines: string[],
  bodyLines: string[],
): ParsedResume['experiences'][number] | null {
  const dateLine = headerLines.find((line) => DATE_RANGE_RE.test(line));
  if (!dateLine) return null;

  const range = DATE_RANGE_RE.exec(dateLine);
  const { startDate, endDate, isCurrent } = parseDateRange(range?.[1], range?.[2]);

  const titleCompany = headerLines
    .filter((line) => line !== dateLine)
    .join(' ')
    .replace(DATE_RANGE_RE, '')
    .replace(/[|•·]\s*$/, '')
    .trim();

  const { title, company } = splitTitleCompany(titleCompany);
  const description = truncate(bodyLines.join(' ').trim(), 8000);
  const skills = guessSkills(bodyLines).map((skill) => skill.name).slice(0, 50);

  return {
    company,
    title,
    employmentType: null,
    location: null,
    startDate,
    endDate,
    isCurrent,
    description,
    skills,
  };
}

function splitTitleCompany(value: string): { title: string | null; company: string | null } {
  if (!value) return { title: null, company: null };
  const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(value);
  if (at) return { title: truncate(at[1] ?? null, 200), company: truncate(at[2] ?? null, 200) };
  const comma = /^(.+?),\s*(.+)$/.exec(value);
  if (comma) return { title: truncate(comma[1] ?? null, 200), company: truncate(comma[2] ?? null, 200) };
  return { title: truncate(value, 200), company: null };
}

function parseDateRange(
  start: string | undefined,
  end: string | undefined,
): { startDate: Date | null; endDate: Date | null; isCurrent: boolean } {
  const startDate = parseLooseDate(start);
  const isCurrent = !end || /present|current|now/i.test(end);
  return {
    startDate,
    endDate: isCurrent ? null : parseLooseDate(end),
    isCurrent,
  };
}

function parseLooseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const monthYear = /^([a-z]+)\.?\s*,?\s*(\d{4})$/i.exec(trimmed);
  if (monthYear) {
    const month = MONTHS[(monthYear[1] ?? '').toLowerCase()];
    const year = Number(monthYear[2]);
    if (month !== undefined && Number.isFinite(year)) return new Date(Date.UTC(year, month, 1));
  }
  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) return new Date(Date.UTC(Number(yearOnly[1]), 0, 1));
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function guessEducations(lines: string[]): ParsedResume['educations'] {
  const start = findHeadingIndex(lines, ['education', 'academic background', 'qualifications']);
  if (start === -1) return [];

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (isHeading(line) && body.length > 0) break;
    body.push(line);
  }

  const educations: ParsedResume['educations'] = [];
  for (let i = 0; i < body.length; i += 1) {
    const line = body[i] ?? '';
    const degreeMatch = DEGREE_RE.exec(line);
    if (!degreeMatch) continue;

    const institutionLine = body[i + 1] ?? body[i - 1] ?? '';
    const range = DATE_RANGE_RE.exec(line) ?? DATE_RANGE_RE.exec(institutionLine);
    const { startDate, endDate } = parseDateRange(range?.[1], range?.[2]);

    educations.push({
      institution: degreeMatch.index === 0 ? truncate(institutionLine, 200) : truncate(line, 200),
      degree: truncate(degreeMatch[0], 160),
      fieldOfStudy: null,
      startDate,
      endDate,
      grade: null,
      description: null,
    });
  }

  return educations.slice(0, 40);
}

function guessCertifications(lines: string[]): ParsedResume['certifications'] {
  const sectionText = guessSection(lines, ['certifications', 'certificates', 'licenses']);
  if (!sectionText) return [];
  return sectionText
    .split(/[,;|•·]|\s{3,}/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2 && entry.length <= 160)
    .slice(0, 60)
    .map((name) => ({
      name,
      issuer: null,
      issuedAt: null,
      expiresAt: null,
      credentialId: null,
      credentialUrl: null,
    }));
}

function guessLanguages(lines: string[]): ParsedResume['languages'] {
  const found = new Map<string, { name: string; proficiency: ParsedResume['languages'][number]['proficiency'] }>();
  const sectionText = guessSection(lines, ['languages', 'language proficiency']);

  if (sectionText) {
    for (const entry of sectionText.split(/[,;|•·]|\s{2,}/).map((value) => value.trim())) {
      const match = /^([A-Za-z][A-Za-z\s'-]{1,30}?)(?:\s*[:(]\s*(native|fluent|professional|conversational|basic|intermediate|advanced))?$/i.exec(entry);
      const name = match?.[1]?.trim();
      if (!name) continue;
      found.set(name.toLowerCase(), { name, proficiency: proficiencyFrom(match?.[2]) });
    }
  }

  const haystack = lines.join('\n');
  for (const dictionaryEntry of SKILL_DICTIONARY) {
    if (dictionaryEntry.category !== 'LANGUAGE' || found.size >= 30) continue;
    if (containsSpelling(haystack, dictionaryEntry.name)) {
      found.set(dictionaryEntry.name.toLowerCase(), {
        name: dictionaryEntry.name,
        proficiency: 'PROFESSIONAL',
      });
    }
  }

  return [...found.values()].slice(0, 30);
}

function proficiencyFrom(value: string | undefined): ParsedResume['languages'][number]['proficiency'] {
  switch ((value ?? '').toLowerCase()) {
    case 'native':
      return 'NATIVE';
    case 'conversational':
    case 'basic':
      return 'CONVERSATIONAL';
    case 'professional':
    case 'fluent':
    case 'advanced':
    case 'intermediate':
      return 'PROFESSIONAL';
    default:
      return 'PROFESSIONAL';
  }
}

function guessTotalExperienceMonths(text: string, experiences: ParsedResume['experiences']): number | null {
  const explicit = YEARS_RE.exec(text);
  if (explicit) {
    const years = Number(explicit[1]);
    if (Number.isFinite(years)) return Math.min(years * 12, 840);
  }

  let months = 0;
  for (const experience of experiences) {
    if (!experience.startDate) continue;
    const start = experience.startDate.getTime();
    const end = experience.endDate ? experience.endDate.getTime() : Date.now();
    months += Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.4375)));
  }
  return months > 0 ? Math.min(months, 840) : null;
}

function scoreConfidence(data: ParsedResume): number {
  let score = 0.2;
  if (data.email) score += 0.3;
  if (data.phone) score += 0.1;
  if (data.fullName) score += 0.15;
  if (data.skills.length > 0) score += 0.15;
  if (data.experiences.length > 0) score += 0.1;
  if (data.educations.length > 0) score += 0.05;
  return Math.min(Number(score.toFixed(2)), 0.95);
}
