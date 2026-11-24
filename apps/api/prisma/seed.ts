/**
 * TalentFlow — deterministic demo seed.
 *
 * Run with:  pnpm db:seed        (or `pnpm --filter @talentflow/api prisma:seed`)
 *
 * Goals
 *  - the workspace looks like a real staffing agency the first time it is opened:
 *    1 workspace, 6 users (one per role), 2 teams, 10 clients, 20 jobs,
 *    100 candidates and the surrounding pipeline / interview / offer / placement /
 *    activity / task / email data that makes every screen non-empty;
 *  - every row is generated from a fixed PRNG seed, so two runs on the same day
 *    produce the same demo and screenshots stay stable;
 *  - the provisioning logic mirrors `AuthService.signup()` exactly (roles from
 *    `ROLE_PERMISSION_TEMPLATES`, stages from `DEFAULT_PIPELINE_STAGES`) so a
 *    seeded workspace is indistinguishable from a self-serve one.
 *
 * The script uses a bare `PrismaClient` and writes `tenantId` explicitly rather
 * than going through the tenancy extension: seeding legitimately spans two
 * workspaces, and `prisma.asSystem()` is a Nest-provided concept.
 */
import { resolve } from 'node:path';

import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { hash, type Algorithm } from '@node-rs/argon2';
import { PrismaClient, type Prisma } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

import {
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_REJECTION_REASONS,
  PERMISSIONS,
  ROLE_KEY_DESCRIPTIONS,
  ROLE_KEY_LABELS,
  ROLE_PERMISSION_TEMPLATES,
  ROLE_PRIORITY,
  TENANT_ROLE_KEYS,
} from '@talentflow/types';

// Root `.env` first so it wins over any package-local override.
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Deterministic random
// -----------------------------------------------------------------------------

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = createRandom(20261101);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function pickInt(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function chance(probability: number): boolean {
  return rand() < probability;
}

/** Picks `count` distinct items. */
function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let index = 0; index < Math.min(count, pool.length); index += 1) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  }
  return out;
}

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const daysAhead = (days: number) => new Date(Date.now() + days * DAY);

// -----------------------------------------------------------------------------
// Physical tables, in TRUNCATE order
// -----------------------------------------------------------------------------

const TABLES = [
  'candidate_embeddings',
  'audit_logs',
  'notifications',
  'email_messages',
  'email_templates',
  'tag_links',
  'tags',
  'attachments',
  'notes',
  'tasks',
  'activities',
  'placements',
  'offers',
  'interview_interviewers',
  'interviews',
  'stage_history',
  'applications',
  'candidate_skills',
  'candidate_educations',
  'candidate_experiences',
  'candidate_resumes',
  'candidates',
  'job_skills',
  'job_assignments',
  'job_pipeline_stages',
  'jobs',
  'client_contacts',
  'clients',
  'skills',
  'import_jobs',
  'saved_searches',
  'custom_field_values',
  'custom_fields',
  'team_members',
  'teams',
  'auth_tokens',
  'refresh_tokens',
  'user_roles',
  'role_permissions',
  'roles',
  'users',
  'invoices',
  'subscriptions',
  'tenants',
  'permissions',
  'plans',
] as const;

// -----------------------------------------------------------------------------
// Reference data pools
// -----------------------------------------------------------------------------

const FIRST_NAMES = [
  'Amelia', 'Marcus', 'Priya', 'Diego', 'Hannah', 'Tom', 'Aarav', 'Sofia',
  'Ethan', 'Nadia', 'Lucas', 'Mei', 'Owen', 'Isabel', 'Kofi', 'Elena',
  'Ryan', 'Ananya', 'Jonas', 'Clara', 'Devon', 'Yuki', 'Samuel', 'Leila',
  'Noah', 'Fatima', 'Gabriel', 'Ivy', 'Rohan', 'Camille',
] as const;

const LAST_NAMES = [
  'Grant', 'Bell', 'Nair', 'Alvarez', 'Osei', 'Reyes', 'Mehta', 'Rossi',
  'Whitfield', 'Haddad', 'Ferreira', 'Chen', 'Brennan', 'Duarte', 'Mensah',
  'Petrova', 'Kowalski', 'Iyer', 'Lindqvist', 'Moreau', 'Carter', 'Tanaka',
  'Okafor', 'Bauer', 'Sinclair', 'Rahman', 'Delgado', 'Novak', 'Kapoor', 'Lefevre',
] as const;

const LOCATIONS = [
  { city: 'Austin', state: 'Texas', country: 'USA' },
  { city: 'Denver', state: 'Colorado', country: 'USA' },
  { city: 'Atlanta', state: 'Georgia', country: 'USA' },
  { city: 'Seattle', state: 'Washington', country: 'USA' },
  { city: 'Chicago', state: 'Illinois', country: 'USA' },
  { city: 'Boston', state: 'Massachusetts', country: 'USA' },
  { city: 'Phoenix', state: 'Arizona', country: 'USA' },
  { city: 'Raleigh', state: 'North Carolina', country: 'USA' },
  { city: 'Minneapolis', state: 'Minnesota', country: 'USA' },
  { city: 'Portland', state: 'Oregon', country: 'USA' },
  { city: 'Irving', state: 'Texas', country: 'USA' },
  { city: 'Jersey City', state: 'New Jersey', country: 'USA' },
] as const;

const COMPANIES = [
  'Nimbus Health Systems', 'Vertex Financial Group', 'Brightline Logistics',
  'Northwind Retail Group', 'Sable Aerospace', 'Meridian Insurance',
  'Cobalt Energy Partners', 'Helix Biotech', 'Ironclad Manufacturing',
  'Quantum Telecom', 'Aperture Analytics', 'Ridgeline Software',
  'Pinnacle Health', 'Harbor Freight Tech', 'Lumen Payments',
] as const;

const UNIVERSITIES = [
  'University of Texas at Austin', 'Georgia Institute of Technology',
  'Purdue University', 'Arizona State University', 'North Carolina State University',
  'University of Washington', 'IIT Bombay', 'BITS Pilani', 'University of Illinois',
  'Northeastern University',
] as const;

const DEGREES = [
  'B.S. Computer Science', 'B.E. Information Technology', 'M.S. Computer Science',
  'B.S. Information Systems', 'M.B.A.', 'B.S. Electrical Engineering',
] as const;

/**
 * The workspace skill dictionary. `aliases` are the spellings people actually
 * type, and are what the resume parser normalises against — the dictionary here
 * mirrors the canonical entries in `modules/resumes/skill-dictionary.ts` for the
 * skills the demo workspace uses, so a parsed resume lands on the same skill row
 * a recruiter would have picked by hand.
 */
const SKILLS: readonly { name: string; category: string; aliases: readonly string[] }[] = [
  { name: 'Go', category: 'Languages', aliases: ['Golang'] },
  { name: 'TypeScript', category: 'Languages', aliases: ['TS'] },
  { name: 'Python', category: 'Languages', aliases: ['py', 'python3'] },
  { name: 'Java', category: 'Languages', aliases: ['Java SE', 'Java EE'] },
  { name: 'Kotlin', category: 'Languages', aliases: ['Kotlin/JVM'] },
  { name: 'SQL', category: 'Languages', aliases: ['ANSI SQL'] },
  { name: 'React', category: 'Frameworks', aliases: ['React.js', 'ReactJS'] },
  { name: 'Next.js', category: 'Frameworks', aliases: ['NextJS', 'Next'] },
  { name: 'Node.js', category: 'Frameworks', aliases: ['Node', 'NodeJS'] },
  { name: 'NestJS', category: 'Frameworks', aliases: ['Nest.js', 'Nest'] },
  { name: 'Spring Boot', category: 'Frameworks', aliases: ['SpringBoot'] },
  { name: 'Django', category: 'Frameworks', aliases: ['Django REST'] },
  { name: 'PostgreSQL', category: 'Data', aliases: ['Postgres', 'psql'] },
  { name: 'MongoDB', category: 'Data', aliases: ['Mongo'] },
  { name: 'Redis', category: 'Data', aliases: ['Redis Cache'] },
  { name: 'Snowflake', category: 'Data', aliases: ['Snowflake DW'] },
  { name: 'dbt', category: 'Data', aliases: ['data build tool'] },
  { name: 'Apache Kafka', category: 'Data', aliases: ['Kafka'] },
  { name: 'AWS', category: 'Cloud & DevOps', aliases: ['Amazon Web Services'] },
  { name: 'Azure', category: 'Cloud & DevOps', aliases: ['Microsoft Azure'] },
  { name: 'GCP', category: 'Cloud & DevOps', aliases: ['Google Cloud'] },
  { name: 'Kubernetes', category: 'Cloud & DevOps', aliases: ['k8s'] },
  { name: 'Terraform', category: 'Cloud & DevOps', aliases: ['tf'] },
  { name: 'Docker', category: 'Cloud & DevOps', aliases: ['containers'] },
  { name: 'GitHub Actions', category: 'Cloud & DevOps', aliases: ['GH Actions'] },
  { name: 'REST API design', category: 'Architecture', aliases: ['REST', 'RESTful APIs'] },
  { name: 'GraphQL', category: 'Architecture', aliases: ['GQL'] },
  { name: 'Microservices', category: 'Architecture', aliases: ['micro-service architecture'] },
  { name: 'System design', category: 'Architecture', aliases: ['distributed systems design'] },
  { name: 'CI/CD', category: 'Architecture', aliases: ['continuous integration'] },
  { name: 'HIPAA compliance', category: 'Domain', aliases: ['HIPAA'] },
  { name: 'Agile / Scrum', category: 'Domain', aliases: ['Scrum', 'Agile'] },
];

const JOB_TITLES = [
  'Senior Backend Engineer (Go)', 'Staff Frontend Engineer (React)',
  'DevOps Engineer (Kubernetes)', 'Data Engineer (Snowflake)', 'Machine Learning Engineer',
  'Mobile Engineer (React Native)', 'QA Automation Engineer', 'Site Reliability Engineer',
  'Product Manager (B2B SaaS)', 'Technical Program Manager', 'Cloud Architect (AWS)',
  'Full Stack Engineer (Node/React)', 'Security Engineer (AppSec)',
  'Database Administrator (PostgreSQL)', 'Engineering Manager', 'Scrum Master',
  'Business Analyst', 'Senior UI/UX Designer', 'Salesforce Administrator',
  'Workday Integration Consultant',
] as const;

const CLIENT_INDUSTRIES = [
  'Healthcare', 'Financial Services', 'Logistics', 'Retail', 'Aerospace',
  'Insurance', 'Energy', 'Biotechnology', 'Manufacturing', 'Telecommunications',
] as const;

const CONTACT_TITLES = [
  'VP of Engineering', 'Director of Talent Acquisition', 'Engineering Manager',
  'Technical Recruiter', 'Head of IT', 'Program Director',
] as const;

const CLIENT_NAMES: readonly string[] = [
  'Nimbus Health Systems', 'Vertex Financial Group', 'Brightline Logistics',
  'Northwind Retail Group', 'Sable Aerospace', 'Meridian Insurance',
  'Cobalt Energy Partners', 'Helix Biotech', 'Ironclad Manufacturing',
  'Quantum Telecom',
];

const CANDIDATE_SOURCES = ['LINKEDIN', 'INDEED', 'JOB_BOARD', 'REFERRAL', 'WEBSITE', 'AGENCY', 'MANUAL'] as const;
const WORK_AUTHORIZATIONS = ['CITIZEN', 'PERMANENT_RESIDENT', 'WORK_VISA', 'REQUIRES_SPONSORSHIP'] as const;
const AVAILABILITIES = ['IMMEDIATE', 'TWO_WEEKS', 'ONE_MONTH', 'TWO_MONTHS', 'NOT_LOOKING'] as const;
const JOB_TYPES = ['FULL_TIME', 'CONTRACT', 'CONTRACT_TO_HIRE', 'C2C', 'W2'] as const;
const REMOTE_TYPES = ['ONSITE', 'REMOTE', 'HYBRID'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'LINKEDIN'] as const;

const TAG_SEEDS: readonly { name: string; color: string; category: string }[] = [
  { name: 'Hot', color: '#ef4444', category: 'Priority' },
  { name: 'Passive', color: '#94a3b8', category: 'Priority' },
  { name: 'Needs sponsorship', color: '#f59e0b', category: 'Visa' },
  { name: 'Local only', color: '#0ea5e9', category: 'Location' },
  { name: 'Open to relocate', color: '#22c55e', category: 'Location' },
  { name: 'Ex-agency', color: '#8b5cf6', category: 'Background' },
  { name: 'Interviewed before', color: '#14b8a6', category: 'Background' },
  { name: 'Do not contact', color: '#64748b', category: 'Compliance' },
];

const STAGE_ORDER: readonly string[] = DEFAULT_PIPELINE_STAGES.map((stage) => stage.key);

/** Stage key → SLA in days, for the stages that declare one. */
const STAGE_SLA_DAYS = new Map<string, number>(
  DEFAULT_PIPELINE_STAGES.flatMap((stage) =>
    'slaDays' in stage ? [[stage.key, stage.slaDays as number] as const] : [],
  ),
);

/** Stage key → display name, used for stage-history notes. */
const STAGE_NAME_BY_KEY = new Map<string, string>(
  DEFAULT_PIPELINE_STAGES.map((stage) => [stage.key, stage.name] as const),
);

// -----------------------------------------------------------------------------
// Identifiers — generated here so relations can be wired without round-trips
// -----------------------------------------------------------------------------

const ids = {
  permission: (key: string) => `seed_perm_${key.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
  plan: (code: string) => `seed_plan_${code.toLowerCase()}`,
  tenant: (slug: string) => `seed_tenant_${slug}`,
  role: (tenantSlug: string, key: string) => `seed_role_${tenantSlug}_${key.toLowerCase()}`,
  stage: (key: string) => `seed_stage_${key}`,
  user: (n: number) => `seed_user_${String(n).padStart(2, '0')}`,
  team: (n: number) => `seed_team_${String(n).padStart(2, '0')}`,
  skill: (n: number) => `seed_skill_${String(n).padStart(2, '0')}`,
  client: (n: number) => `seed_client_${String(n).padStart(2, '0')}`,
  contact: (n: number) => `seed_contact_${String(n).padStart(2, '0')}`,
  job: (n: number) => `seed_job_${String(n).padStart(2, '0')}`,
  candidate: (n: number) => `seed_candidate_${String(n).padStart(3, '0')}`,
  resume: (n: number) => `seed_resume_${String(n).padStart(3, '0')}`,
  tag: (n: number) => `seed_tag_${String(n).padStart(2, '0')}`,
  application: (n: number) => `seed_app_${String(n).padStart(3, '0')}`,
  interview: (n: number) => `seed_interview_${String(n).padStart(3, '0')}`,
  offer: (n: number) => `seed_offer_${String(n).padStart(3, '0')}`,
  placement: (n: number) => `seed_placement_${String(n).padStart(3, '0')}`,
  activity: (n: number) => `seed_activity_${String(n).padStart(3, '0')}`,
  task: (n: number) => `seed_task_${String(n).padStart(3, '0')}`,
  note: (n: number) => `seed_note_${String(n).padStart(3, '0')}`,
  email: (n: number) => `seed_email_${String(n).padStart(3, '0')}`,
  template: (key: string) => `seed_template_${key.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
  savedSearch: (n: number) => `seed_saved_${String(n).padStart(2, '0')}`,
  candidateList: (n: number) => `seed_list_${String(n).padStart(2, '0')}`,
  jobStage: (jobNumber: number, key: string) =>
    `seed_job_stage_${String(jobNumber).padStart(2, '0')}_${key}`,
  importJob: (n: number) => `seed_import_${String(n).padStart(2, '0')}`,
  audit: (n: number) => `seed_audit_${String(n).padStart(3, '0')}`,
  invoice: (n: number) => `seed_invoice_${String(n).padStart(2, '0')}`,
  notification: (n: number) => `seed_notification_${String(n).padStart(3, '0')}`,
};

// -----------------------------------------------------------------------------
// Object storage — real files for the demo resumes and import batches
//
// The seed talks to MinIO directly rather than through `StorageService` (which
// is Nest-provided). Failures are non-fatal: a demo without object storage is
// still useful, and `pnpm setup` runs `infra:up` before the seed anyway.
// -----------------------------------------------------------------------------

let storageClient: S3Client | null = null;
let storageBucket = 'talentflow-files';

function getStorage(): { client: S3Client; bucket: string } {
  if (!storageClient) {
    storageBucket = process.env.S3_BUCKET ?? 'talentflow-files';
    storageClient = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9020',
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'talentflow',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'talentflow123',
      },
    });
  }
  return { client: storageClient, bucket: storageBucket };
}

async function ensureBucket(): Promise<void> {
  const { client, bucket } = getStorage();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { client, bucket } = getStorage();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/**
 * Minimal single-page PDF built by hand: a Helvetica text block and a correct
 * cross-reference table. No PDF library is needed for ten demo resumes, and the
 * output has a real text layer so `pdf-parse` can read it back.
 */
function buildTextPdf(title: string, bodyLines: readonly string[]): Buffer {
  const escape = (value: string): string =>
    value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const content = [
    'BT',
    '/F1 18 Tf',
    '72 736 Td',
    `(${escape(title)}) Tj`,
    '/F1 11 Tf',
    ...bodyLines.flatMap((line) => ['0 -18 Td', `(${escape(line)}) Tj`]),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

// -----------------------------------------------------------------------------
// Static configuration rows
// -----------------------------------------------------------------------------

const PLATFORM_TENANT_SLUG = 'talentflow-platform';
const DEMO_TENANT_SLUG = 'acme-demo';

const PLANS: readonly Prisma.PlanCreateManyInput[] = [
  {
    id: ids.plan('STARTER'),
    code: 'STARTER',
    name: 'Starter',
    description: 'For a solo recruiter getting off spreadsheets.',
    monthlyPriceCents: 4900,
    yearlyPriceCents: 49000,
    includedSeats: 3,
    maxJobs: 15,
    maxCandidates: 1000,
    storageGb: 5,
    aiCredits: 50,
    features: { aiMatching: false, customFields: false, sso: false, apiAccess: false, clientPortal: false },
    sortOrder: 1,
  },
  {
    id: ids.plan('GROWTH'),
    code: 'GROWTH',
    name: 'Growth',
    description: 'For boutique agencies running a full desk.',
    monthlyPriceCents: 14900,
    yearlyPriceCents: 149000,
    includedSeats: 10,
    maxJobs: 100,
    maxCandidates: 10000,
    storageGb: 25,
    aiCredits: 500,
    features: { aiMatching: true, customFields: true, sso: false, apiAccess: true, clientPortal: true },
    sortOrder: 2,
  },
  {
    id: ids.plan('PRO'),
    code: 'PRO',
    name: 'Pro',
    description: 'For multi-desk agencies with client portals and reporting needs.',
    monthlyPriceCents: 29900,
    yearlyPriceCents: 299000,
    includedSeats: 25,
    maxJobs: 400,
    maxCandidates: 50000,
    storageGb: 100,
    aiCredits: 2500,
    features: { aiMatching: true, customFields: true, sso: true, apiAccess: true, clientPortal: true },
    sortOrder: 3,
  },
  {
    id: ids.plan('ENTERPRISE'),
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Custom limits, SSO, security review and a named success manager.',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    includedSeats: null,
    maxJobs: null,
    maxCandidates: null,
    storageGb: null,
    aiCredits: null,
    features: { aiMatching: true, customFields: true, sso: true, apiAccess: true, clientPortal: true },
    isPublic: false,
    sortOrder: 4,
  },
];

const EMAIL_TEMPLATES: readonly Omit<Prisma.EmailTemplateCreateManyInput, 'tenantId'>[] = [
  {
    id: ids.template('candidate.submission'),
    name: 'Candidate submission',
    key: 'candidate.submission',
    subject: '{{candidate.fullName}} — {{job.title}} ({{job.referenceCode}})',
    body: 'Hi {{contact.firstName}},\n\nPlease find {{candidate.fullName}} for {{job.title}}. Summary of relevant experience is below.\n\nThanks,\n{{sender.fullName}}',
    category: 'SUBMISSION',
    mergeFields: ['candidate.fullName', 'candidate.headline', 'job.title', 'job.referenceCode', 'contact.firstName', 'sender.fullName'],
    isSystem: true,
  },
  {
    id: ids.template('candidate.outreach'),
    name: 'Candidate outreach',
    key: 'candidate.outreach',
    subject: '{{job.title}} role — are you open to a conversation?',
    body: 'Hi {{candidate.firstName}},\n\nI am working on a {{job.title}} role in {{job.locationCity}} and your background looks like a strong match.\n\nOpen to a quick call this week?\n\n{{sender.fullName}}',
    category: 'SOURCING',
    mergeFields: ['candidate.firstName', 'job.title', 'job.locationCity', 'sender.fullName'],
    isSystem: true,
  },
  {
    id: ids.template('interview.invite'),
    name: 'Interview invitation',
    key: 'interview.invite',
    subject: 'Interview confirmed: {{job.title}}',
    body: 'Hi {{candidate.firstName}},\n\nYour interview is confirmed for {{interview.scheduledStart}}.\nJoin link: {{interview.meetingUrl}}\n\nGood luck!',
    category: 'INTERVIEW',
    mergeFields: ['candidate.firstName', 'job.title', 'interview.scheduledStart', 'interview.meetingUrl'],
    isSystem: true,
  },
  {
    id: ids.template('offer.sent'),
    name: 'Offer notification',
    key: 'offer.sent',
    subject: 'Offer for {{job.title}}',
    body: 'Hi {{candidate.firstName}},\n\nWe are pleased to extend an offer for {{job.title}}. Details are attached.\n\n{{sender.fullName}}',
    category: 'OFFER',
    mergeFields: ['candidate.firstName', 'job.title', 'sender.fullName'],
    isSystem: true,
  },
  {
    id: ids.template('candidate.rejection'),
    name: 'Application update',
    key: 'candidate.rejection',
    subject: 'Update on your application — {{job.title}}',
    body: 'Hi {{candidate.firstName}},\n\nThank you for your interest in {{job.title}}. The team has decided to move forward with other profiles, but we would like to stay in touch.\n\n{{sender.fullName}}',
    category: 'GENERAL',
    mergeFields: ['candidate.firstName', 'job.title', 'sender.fullName'],
    isSystem: true,
  },
];

const SAVED_SEARCHES: readonly Omit<Prisma.SavedSearchCreateManyInput, 'tenantId' | 'userId'>[] = [
  {
    id: ids.savedSearch(1),
    entity: 'candidate',
    name: 'Active Go engineers (remote)',
    filters: { skills: ['Go'], status: 'ACTIVE', willingnessToRelocate: true },
    columns: ['name', 'title', 'location', 'skills', 'owner'],
    sortBy: 'updatedAt',
    sortDir: 'desc',
    visibility: 'TENANT',
    isDefault: true,
  },
  {
    id: ids.savedSearch(2),
    entity: 'candidate',
    name: 'Needs sponsorship',
    filters: { workAuthorization: 'REQUIRES_SPONSORSHIP' },
    columns: ['name', 'title', 'location', 'workAuthorization'],
    sortBy: 'createdAt',
    sortDir: 'desc',
    visibility: 'TENANT',
  },
  {
    id: ids.savedSearch(3),
    entity: 'job',
    name: 'Priority requisitions',
    filters: { status: ['OPEN'], priority: ['HIGH', 'URGENT'] },
    columns: ['title', 'client', 'priority', 'openings', 'owner'],
    sortBy: 'priority',
    sortDir: 'desc',
    visibility: 'TENANT',
  },
  {
    id: ids.savedSearch(4),
    entity: 'client',
    name: 'Active clients',
    filters: { status: 'ACTIVE' },
    columns: ['name', 'industry', 'owner', 'openJobs'],
    sortBy: 'name',
    sortDir: 'asc',
    visibility: 'TENANT',
  },
];

// -----------------------------------------------------------------------------
// Seed
// -----------------------------------------------------------------------------

interface UserSeed {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  role: (typeof TENANT_ROLE_KEYS)[number];
}

function buildUserSeeds(): UserSeed[] {
  const demoEmail = process.env.SEED_DEMO_EMAIL ?? 'admin@acme-demo.test';
  return [
    { key: 'admin', email: demoEmail, firstName: 'Amelia', lastName: 'Grant', title: 'Operations Director', role: 'TENANT_ADMIN' },
    { key: 'manager', email: 'marcus.bell@acme-demo.test', firstName: 'Marcus', lastName: 'Bell', title: 'Recruiting Manager', role: 'RECRUITER_MANAGER' },
    { key: 'recruiter1', email: 'priya.nair@acme-demo.test', firstName: 'Priya', lastName: 'Nair', title: 'Senior Technical Recruiter', role: 'RECRUITER' },
    { key: 'recruiter2', email: 'diego.alvarez@acme-demo.test', firstName: 'Diego', lastName: 'Alvarez', title: 'Technical Recruiter', role: 'RECRUITER' },
    { key: 'accountManager', email: 'hannah.osei@acme-demo.test', firstName: 'Hannah', lastName: 'Osei', title: 'Account Manager', role: 'ACCOUNT_MANAGER' },
    { key: 'viewer', email: 'tom.reyes@acme-demo.test', firstName: 'Tom', lastName: 'Reyes', title: 'Client Reviewer', role: 'VIEWER' },
  ];
}

async function resetDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"public"."${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedPermissions(): Promise<number> {
  await prisma.permission.createMany({
    data: PERMISSIONS.map((permission) => ({
      id: ids.permission(permission.key),
      key: permission.key,
      group: permission.group,
      label: permission.label,
      description: permission.description,
      isPlatform: permission.key.startsWith('platform:'),
    })),
  });

  return PERMISSIONS.length;
}

async function seedPlans(): Promise<void> {
  await prisma.plan.createMany({ data: [...PLANS] });
}

async function seedPlatformTenant(passwordHash: string): Promise<string> {
  const tenantId = ids.tenant(PLATFORM_TENANT_SLUG);
  const roleId = ids.role(PLATFORM_TENANT_SLUG, 'SUPER_ADMIN');
  const userId = 'seed_user_superadmin';

  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'TalentFlow Platform',
      slug: PLATFORM_TENANT_SLUG,
      status: 'ACTIVE',
      isPlatform: true,
      brandColor: '#4F46E5',
      onboardedAt: daysAgo(120),
      settings: {
        legalName: 'TalentFlow Platform',
        currency: 'USD',
        timezone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
      },
    },
  });

  await prisma.role.create({
    data: {
      id: roleId,
      tenantId,
      key: 'SUPER_ADMIN',
      name: ROLE_KEY_LABELS.SUPER_ADMIN,
      description: ROLE_KEY_DESCRIPTIONS.SUPER_ADMIN,
      priority: ROLE_PRIORITY.SUPER_ADMIN,
      isSystem: true,
    },
  });

  await prisma.rolePermission.createMany({
    data: PERMISSIONS.map((permission) => ({
      tenantId,
      roleId,
      permissionId: ids.permission(permission.key),
    })),
  });

  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      email: process.env.SEED_SUPER_ADMIN_EMAIL ?? 'superadmin@talentflow.test',
      firstName: 'Platform',
      lastName: 'Operator',
      title: 'Platform Administrator',
      status: 'ACTIVE',
      emailVerifiedAt: daysAgo(120),
      passwordHash,
      isSuperAdmin: true,
      lastLoginAt: daysAgo(1),
    },
  });

  await prisma.userRole.create({ data: { tenantId, userId, roleId } });

  return tenantId;
}

async function seedDemoTenant(
  passwordHash: string,
  userSeeds: UserSeed[],
): Promise<{ tenantId: string; userIds: string[] }> {
  const tenantId = ids.tenant(DEMO_TENANT_SLUG);

  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'Acme Demo Staffing',
      slug: DEMO_TENANT_SLUG,
      status: 'ACTIVE',
      brandColor: '#4F46E5',
      primaryDomain: 'acme-demo.talentflow.app',
      referralSource: 'Seed data',
      onboardedAt: daysAgo(96),
      settings: {
        legalName: 'Acme Demo Staffing LLC',
        website: 'https://acme-demo.talentflow.app',
        phone: '+1 512 555 0142',
        addressLine1: '1200 Congress Avenue',
        addressLine2: 'Suite 410',
        city: 'Austin',
        state: 'Texas',
        postalCode: '78701',
        country: 'USA',
        currency: 'USD',
        timezone: 'America/Chicago',
        dateFormat: 'MM/DD/YYYY',
        emailSignature: 'Amelia Grant · Operations Director · Acme Demo Staffing',
      },
    },
  });

  const roleIds = new Map<string, string>();
  for (const key of TENANT_ROLE_KEYS) {
    const roleId = ids.role(DEMO_TENANT_SLUG, key);
    roleIds.set(key, roleId);

    await prisma.role.create({
      data: {
        id: roleId,
        tenantId,
        key,
        name: ROLE_KEY_LABELS[key],
        description: ROLE_KEY_DESCRIPTIONS[key],
        priority: ROLE_PRIORITY[key],
        isSystem: true,
      },
    });

    await prisma.rolePermission.createMany({
      data: ROLE_PERMISSION_TEMPLATES[key].map((permissionKey) => ({
        tenantId,
        roleId,
        permissionId: ids.permission(permissionKey),
      })),
    });
  }

  await prisma.jobPipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
      id: ids.stage(stage.key),
      tenantId,
      key: stage.key,
      name: stage.name,
      type: stage.type,
      category: stage.category,
      color: stage.color,
      order: index,
      isDefault: 'isDefault' in stage ? Boolean(stage.isDefault) : false,
      isTerminal: 'isTerminal' in stage ? Boolean(stage.isTerminal) : false,
      slaDays: 'slaDays' in stage ? stage.slaDays : null,
      description: stage.key === 'submitted' ? 'Sent to the client contact for review' : null,
    })),
  });

  await prisma.rejectionReason.createMany({
    data: DEFAULT_REJECTION_REASONS.map((reason, index) => ({
      tenantId,
      key: reason.key,
      label: reason.label,
      order: index,
      isActive: true,
      isSystem: true,
    })),
  });

  const periodStart = daysAgo(12);
  await prisma.subscription.create({
    data: {
      tenantId,
      planId: ids.plan('GROWTH'),
      status: 'ACTIVE',
      provider: 'MANUAL',
      interval: 'MONTHLY',
      seats: userSeeds.length,
      currentPeriodStart: periodStart,
      currentPeriodEnd: daysAhead(18),
    },
  });

  await prisma.invoice.createMany({
    data: [0, 1, 2].map((offset) => {
      const issuedAt = daysAgo(12 + offset * 30);
      return {
        id: ids.invoice(offset + 1),
        tenantId,
        number: `INV-2026-${String(offset + 1).padStart(4, '0')}`,
        status: 'PAID' as const,
        provider: 'MANUAL' as const,
        subtotalCents: 14900,
        totalCents: 14900,
        lineItems: [{ description: 'Growth plan — monthly', quantity: 1, unitAmountCents: 14900, amountCents: 14900 }],
        periodStart: issuedAt,
        periodEnd: new Date(issuedAt.getTime() + 30 * DAY),
        issuedAt,
        dueAt: new Date(issuedAt.getTime() + 14 * DAY),
        paidAt: new Date(issuedAt.getTime() + 3 * DAY),
      };
    }),
  });

  const userIds: string[] = [];
  for (const [index, seed] of userSeeds.entries()) {
    const userId = ids.user(index + 1);
    userIds.push(userId);

    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: seed.email,
        firstName: seed.firstName,
        lastName: seed.lastName,
        title: seed.title,
        phone: `+1 512 555 0${String(120 + index).padStart(3, '0')}`,
        status: 'ACTIVE',
        emailVerifiedAt: daysAgo(90 - index),
        passwordHash,
        timezone: 'America/Chicago',
        lastLoginAt: daysAgo(index % 5),
      },
    });

    await prisma.userRole.create({
      data: { tenantId, userId, roleId: roleIds.get(seed.role)! },
    });
  }

  await prisma.emailTemplate.createMany({
    data: EMAIL_TEMPLATES.map((template) => ({ ...template, tenantId })),
  });

  return { tenantId, userIds };
}

async function seedTeams(tenantId: string, userIds: string[]): Promise<string[]> {
  const [admin, manager, recruiter1, recruiter2, accountManager, viewer] = userIds as [
    string, string, string, string, string, string,
  ];

  const delivery = ids.team(1);
  const success = ids.team(2);

  await prisma.team.createMany({
    data: [
      {
        id: delivery,
        tenantId,
        name: 'Engineering Delivery',
        description: 'Technical recruiting desk covering engineering and data roles.',
        color: '#4F46E5',
        leaderId: manager,
      },
      {
        id: success,
        tenantId,
        name: 'Client Success',
        description: 'Owns client relationships, submissions and renewals.',
        color: '#0ea5e9',
        leaderId: accountManager,
      },
    ],
  });

  await prisma.teamMember.createMany({
    data: [
      { tenantId, teamId: delivery, userId: manager, isLead: true },
      { tenantId, teamId: delivery, userId: recruiter1 },
      { tenantId, teamId: delivery, userId: recruiter2 },
      { tenantId, teamId: delivery, userId: admin, isLead: false },
      { tenantId, teamId: success, userId: accountManager, isLead: true },
      { tenantId, teamId: success, userId: viewer },
      { tenantId, teamId: success, userId: admin },
    ],
  });

  return [delivery, success];
}

async function seedSkills(tenantId: string): Promise<string[]> {
  await prisma.skill.createMany({
    data: SKILLS.map((skill, index) => ({
      id: ids.skill(index + 1),
      tenantId,
      name: skill.name,
      aliases: [...skill.aliases],
      category: skill.category,
      isSystem: true,
    })),
  });

  return SKILLS.map((_, index) => ids.skill(index + 1));
}

async function seedClients(tenantId: string, userIds: string[]): Promise<{ clientIds: string[]; contactIds: string[] }> {
  const owners = [userIds[4]!, userIds[1]!, userIds[0]!];

  await prisma.client.createMany({
    data: CLIENT_NAMES.map((name, index) => {
      const location = LOCATIONS[index % LOCATIONS.length]!;
      const status = index < 7 ? 'ACTIVE' : index === 7 ? 'PROSPECT' : index === 8 ? 'INACTIVE' : 'CHURNED';
      return {
        id: ids.client(index + 1),
        tenantId,
        name,
        legalName: `${name}, Inc.`,
        status,
        industry: CLIENT_INDUSTRIES[index]!,
        website: `https://www.${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.com`,
        phone: `+1 512 555 1${String(100 + index).padStart(3, '0')}`,
        email: `contact@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.com`,
        description: `${CLIENT_INDUSTRIES[index]} client on a master services agreement.`,
        addressLine1: `${100 + index * 17} ${pick(['Market', 'Congress', 'Lakeview', 'Hillcrest', 'Union'])} Street`,
        city: location.city,
        state: location.state,
        postalCode: String(70000 + index * 137),
        country: location.country,
        defaultBillRateCents: pickInt(9000, 18500),
        defaultFeePercentage: pick([18, 20, 22, 25]),
        paymentTermsDays: pick([30, 45, 60]),
        currency: 'USD',
        ownerId: owners[index % owners.length]!,
        source: 'Referral',
        createdById: owners[index % owners.length]!,
        createdAt: daysAgo(90 - index * 5),
      };
    }),
  });

  const contacts: Prisma.ClientContactCreateManyInput[] = [];
  for (let index = 0; index < CLIENT_NAMES.length; index += 1) {
    for (let sub = 0; sub < 2; sub += 1) {
      const number = index * 2 + sub + 1;
      contacts.push({
        id: ids.contact(number),
        tenantId,
        clientId: ids.client(index + 1),
        firstName: pick(FIRST_NAMES),
        lastName: pick(LAST_NAMES),
        email: `hiring${number}@${CLIENT_NAMES[index]!.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.com`,
        phone: `+1 512 555 2${String(100 + number).padStart(3, '0')}`,
        title: CONTACT_TITLES[(index + sub) % CONTACT_TITLES.length]!,
        department: sub === 0 ? 'Engineering' : 'Talent Acquisition',
        isPrimary: sub === 0,
        createdById: owners[index % owners.length]!,
      });
    }
  }

  await prisma.clientContact.createMany({ data: contacts });

  return {
    clientIds: CLIENT_NAMES.map((_, index) => ids.client(index + 1)),
    contactIds: contacts.map((contact) => contact.id as string),
  };
}

interface JobPlan {
  id: string;
  index: number;
  title: string;
  clientId: string;
  contactId: string;
  ownerId: string;
  skillIds: string[];
  status: Prisma.JobCreateManyInput['status'];
  openings: number;
}

async function seedJobs(
  tenantId: string,
  userIds: string[],
  clientIds: string[],
  contactIds: string[],
  skillIds: string[],
): Promise<{ jobPlans: JobPlan[]; jobIds: string[] }> {
  const recruiters = [userIds[1]!, userIds[2]!, userIds[3]!, userIds[4]!];
  const mainSkills = skillIds.slice(0, 25);

  const statuses: Prisma.JobCreateManyInput['status'][] = [
    ...Array<Prisma.JobCreateManyInput['status']>(13).fill('OPEN'),
    'OPEN',
    'DRAFT',
    'DRAFT',
    'ON_HOLD',
    'ON_HOLD',
    'FILLED',
    'FILLED',
    'CLOSED',
  ];

  const jobPlans: JobPlan[] = JOB_TITLES.map((title, index) => {
    const clientIndex = index % clientIds.length;
    return {
      id: ids.job(index + 1),
      index,
      title,
      clientId: clientIds[clientIndex]!,
      contactId: contactIds[clientIndex * 2]!,
      ownerId: recruiters[index % recruiters.length]!,
      skillIds: sample(mainSkills, pickInt(3, 5)),
      status: statuses[index]!,
      openings: pick([1, 1, 1, 2, 2, 3]),
    };
  });

  await prisma.job.createMany({
    data: jobPlans.map((plan) => {
      const location = LOCATIONS[plan.index % LOCATIONS.length]!;
      const title = JOB_TITLES[plan.index]!;
      const jobType = pick(JOB_TYPES);
      const isContract = jobType === 'CONTRACT' || jobType === 'C2C' || jobType === 'W2' || jobType === 'CONTRACT_TO_HIRE';
      const payRateMinCents = isContract ? pickInt(5500, 8500) : pickInt(9500000, 13500000);
      const payRateMaxCents = payRateMinCents + pickInt(1500, 4000) * (isContract ? 1 : 100);
      const createdAt = daysAgo(75 - plan.index * 3);
      const isOpen = plan.status === 'OPEN';

      return {
        id: plan.id,
        tenantId,
        title,
        referenceCode: `ACME-${String(1000 + plan.index + 1)}`,
        status: plan.status,
        jobType,
        remoteType: pick(REMOTE_TYPES),
        priority: pick(PRIORITIES),
        clientId: plan.clientId,
        contactId: plan.contactId,
        description: `${title} for a ${CLIENT_INDUSTRIES[plan.index % CLIENT_INDUSTRIES.length]} client. Hybrid delivery team of eight, reporting into the platform group.`,
        requirements: `5+ years building production systems. Strong ${plan.skillIds
          .slice(0, 2)
          .map((skillId) => SKILLS[Number(skillId.slice(-2)) - 1]?.name ?? 'engineering')
          .join(' and ')} experience. Comfortable owning a service end to end.`,
        responsibilities: 'Design, build and operate services. Mentor mid-level engineers. Partner with product on discovery.',
        locationCity: location.city,
        locationState: location.state,
        locationCountry: location.country,
        openings: plan.openings,
        payRateMinCents,
        payRateMaxCents,
        billRateCents: payRateMinCents + pickInt(1800, 4200),
        ratePeriod: isContract ? 'HOURLY' : 'ANNUAL',
        currency: 'USD',
        minExperienceYears: pick([3, 4, 5, 6]),
        maxExperienceYears: pick([8, 10, 12]),
        educationLevel: pick(['Bachelors', 'Bachelors', 'Masters', null]),
        workAuthorization: pick(['CITIZEN', 'PERMANENT_RESIDENT', 'WORK_VISA', null]),
        visaSponsorship: chance(0.35),
        publishedAt: isOpen ? createdAt : null,
        openedAt: isOpen ? createdAt : null,
        targetFillAt: isOpen ? daysAhead(pickInt(10, 45)) : null,
        closedAt: plan.status === 'CLOSED' ? daysAgo(6) : null,
        ownerId: plan.ownerId,
        createdById: plan.ownerId,
        createdAt,
      };
    }),
  });

  const jobSkills: Prisma.JobSkillCreateManyInput[] = [];
  const jobAssignments: Prisma.JobAssignmentCreateManyInput[] = [];

  for (const plan of jobPlans) {
    for (const skillId of plan.skillIds) {
      jobSkills.push({
        tenantId,
        jobId: plan.id,
        skillId,
        weight: pick([1, 2, 2, 3]),
        required: chance(0.75),
        minYears: pickInt(1, 5),
      });
    }

    jobAssignments.push({
      tenantId,
      jobId: plan.id,
      userId: plan.ownerId,
      role: 'OWNER',
      isPrimary: true,
    });

    const secondary = recruiters.filter((userId) => userId !== plan.ownerId);
    const extra = sample(secondary, chance(0.5) ? 1 : 2);
    for (const userId of extra) {
      jobAssignments.push({ tenantId, jobId: plan.id, userId, role: 'RECRUITER', isPrimary: false });
    }
  }

  await prisma.jobSkill.createMany({ data: jobSkills });
  await prisma.jobAssignment.createMany({ data: jobAssignments });

  return { jobPlans, jobIds: jobPlans.map((plan) => plan.id) };
}

// -----------------------------------------------------------------------------
// Per-job pipelines
// -----------------------------------------------------------------------------

interface JobPipelineOverride {
  /** Zero-based position in `JOB_TITLES`. */
  jobIndex: number;
  /** Stage keys in board order; any key not in the tenant default is declared in `custom`. */
  keys: readonly string[];
  custom?: readonly {
    key: string;
    name: string;
    type: Prisma.JobPipelineStageCreateManyInput['type'];
    category: Prisma.JobPipelineStageCreateManyInput['category'];
    color: string;
  }[];
  /** Per-job display names, e.g. a client that calls review something else. */
  renamed?: Record<string, string>;
  /** Per-job SLA overrides in days; `null` clears the inherited SLA. */
  slaOverrides?: Record<string, number | null>;
}

const JOB_PIPELINE_OVERRIDES: readonly JobPipelineOverride[] = [
  {
    // A team that gates on a take-home exercise before the client sees anyone.
    jobIndex: 1,
    keys: [
      'sourced', 'screening', 'take-home', 'submitted',
      'client-review', 'interview', 'offer', 'placed', 'rejected', 'withdrawn',
    ],
    custom: [
      { key: 'take-home', name: 'Take-home exercise', type: 'SCREENING', category: 'ACTIVE', color: '#0ea5e9' },
    ],
  },
  {
    // Per-job naming: this client's process calls review something else.
    jobIndex: 6,
    keys: STAGE_ORDER,
    renamed: { screening: 'Recruiter screen', 'client-review': 'Account manager review' },
  },
  {
    // A fast-moving requisition with tighter SLAs than the workspace default.
    jobIndex: 11,
    keys: STAGE_ORDER,
    slaOverrides: { screening: 1, submitted: 2, 'client-review': 3, interview: 3 },
  },
];

type StageIdResolver = (jobId: string | null, key: string) => string;

/**
 * Materialises a private pipeline for a handful of jobs, mirroring what
 * `PipelineService.copyTenantStagesToJob` does when a recruiter customises a
 * job's board. Returns a resolver the application seed uses so nothing has to
 * be repointed after the fact.
 */
async function seedJobPipelines(tenantId: string, jobPlans: JobPlan[]): Promise<StageIdResolver> {
  const defaultByKey = new Map<string, (typeof DEFAULT_PIPELINE_STAGES)[number]>(
    DEFAULT_PIPELINE_STAGES.map((stage) => [stage.key, stage] as const),
  );
  const rows: Prisma.JobPipelineStageCreateManyInput[] = [];
  const overridesByJob = new Map<string, Map<string, string>>();

  for (const override of JOB_PIPELINE_OVERRIDES) {
    const job = jobPlans[override.jobIndex];
    if (!job) continue;

    const jobNumber = override.jobIndex + 1;
    const stageIdByKey = new Map<string, string>();

    override.keys.forEach((key, order) => {
      const base = defaultByKey.get(key);
      const custom = override.custom?.find((entry) => entry.key === key);
      if (!base && !custom) return;

      const id = ids.jobStage(jobNumber, key);
      stageIdByKey.set(key, id);

      const slaOverride = override.slaOverrides?.[key];
      rows.push({
        id,
        tenantId,
        jobId: job.id,
        key,
        name: override.renamed?.[key] ?? custom?.name ?? base?.name ?? key,
        type: custom?.type ?? (base?.type as Prisma.JobPipelineStageCreateManyInput['type']),
        category:
          custom?.category ??
          (base?.category as Prisma.JobPipelineStageCreateManyInput['category']),
        color: custom?.color ?? base?.color ?? '#64748b',
        order,
        isDefault: base && 'isDefault' in base ? Boolean(base.isDefault) : false,
        isTerminal: base && 'isTerminal' in base ? Boolean(base.isTerminal) : false,
        slaDays:
          slaOverride !== undefined
            ? slaOverride
            : base && 'slaDays' in base
              ? base.slaDays
              : null,
        description: key === 'submitted' ? 'Sent to the client contact for review' : null,
      });
    });

    overridesByJob.set(job.id, stageIdByKey);
  }

  await prisma.jobPipelineStage.createMany({ data: rows });

  return (jobId, key) => (jobId ? overridesByJob.get(jobId)?.get(key) : undefined) ?? ids.stage(key);
}

/**
 * Uploads one generated PDF per candidate and returns `candidateId → object`.
 * Failures degrade to the synthetic key the resume row would otherwise use.
 */
async function uploadResumePdfs(
  tenantId: string,
  plans: readonly CandidatePlan[],
): Promise<Map<string, { key: string; size: number }>> {
  const uploaded = new Map<string, { key: string; size: number }>();

  try {
    await ensureBucket();
  } catch (error) {
    console.warn(
      `  storage unavailable — skipping PDF resumes (${error instanceof Error ? error.message : String(error)})`,
    );
    return uploaded;
  }

  for (const plan of plans) {
    const pdf = buildTextPdf(`${plan.firstName} ${plan.lastName}`, [
      plan.currentTitle,
      `${plan.location.city}, ${plan.location.state}`,
      '',
      'Summary',
      `Engineer focused on ${plan.currentTitle.toLowerCase()} with production experience`,
      'across payments, healthcare and logistics platforms.',
      '',
      'Skills',
      sample(SKILLS, 6).map((skill) => skill.name).join(' · '),
      '',
      'Experience',
      `${plan.currentTitle} — current role`,
      'Delivered platform services, owned on-call rotation and led design reviews.',
    ]);

    const key = `resumes/${tenantId}/${plan.id}/resume.pdf`;
    try {
      await putObject(key, pdf, 'application/pdf');
      uploaded.set(plan.id, { key, size: pdf.byteLength });
    } catch (error) {
      console.warn(
        `  could not upload resume for ${plan.firstName} ${plan.lastName} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return uploaded;
}

interface CandidatePlan {
  id: string;
  index: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  currentTitle: string;
  ownerId: string;
  location: { city: string; state: string; country: string };
}

async function seedCandidates(
  tenantId: string,
  userIds: string[],
  skillIds: string[],
): Promise<CandidatePlan[]> {
  const recruiters = [userIds[1]!, userIds[2]!, userIds[3]!, userIds[4]!];
  const candidateCount = 100;

  const plans: CandidatePlan[] = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length]!;
    const lastName = LAST_NAMES[(index * 7) % LAST_NAMES.length]!;
    plans.push({
      id: ids.candidate(index + 1),
      index,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index + 1}@candidate-mail.test`,
      phone: `+1 ${pickInt(200, 989)} 555 ${String(pickInt(1000, 9999))}`,
      currentTitle: JOB_TITLES[(index * 3) % JOB_TITLES.length]!,
      ownerId: recruiters[index % recruiters.length]!,
      location: LOCATIONS[(index * 5) % LOCATIONS.length]!,
    });
  }

  // Real PDFs for the first ten candidates, so the resume viewer and the
  // re-parse flow have actual bytes to work with. The rest keep a synthetic key.
  const resumeFiles = await uploadResumePdfs(tenantId, plans.slice(0, 10));

  await prisma.candidate.createMany({
    data: plans.map((plan) => {
      const years = pickInt(2, 15);
      const level: Prisma.CandidateCreateManyInput['experienceLevel'] =
        years <= 3 ? 'JUNIOR' : years <= 6 ? 'MID' : years <= 10 ? 'SENIOR' : pick(['LEAD', 'PRINCIPAL']);
      const company = COMPANIES[(plan.index * 3) % COMPANIES.length]!;
      return {
        id: plan.id,
        tenantId,
        firstName: plan.firstName,
        lastName: plan.lastName,
        email: plan.email,
        phone: plan.phone,
        headline: `${plan.currentTitle} · ${years} yrs`,
        summary: `Backend-leaning engineer with ${years} years across ${pick(['healthcare', 'fintech', 'logistics', 'retail'])}. Currently at ${company}.`,
        currentTitle: plan.currentTitle,
        currentCompany: company,
        locationCity: plan.location.city,
        locationState: plan.location.state,
        locationCountry: plan.location.country,
        willingToRelocate: chance(0.45),
        totalExperienceMonths: years * 12,
        relevantExperienceMonths: years * 12 - pickInt(0, 18),
        experienceLevel: level,
        workAuthorization: pick(WORK_AUTHORIZATIONS),
        availability: pick(AVAILABILITIES),
        noticePeriodDays: pick([0, 14, 30, 30, 60]),
        expectedSalaryCents: pickInt(11000000, 21000000),
        expectedSalaryCurrency: 'USD',
        currentSalaryCents: pickInt(9500000, 18000000),
        linkedinUrl: chance(0.7) ? `https://www.linkedin.com/in/${plan.firstName.toLowerCase()}-${plan.lastName.toLowerCase()}-${plan.index + 1}` : null,
        githubUrl: chance(0.4) ? `https://github.com/${plan.firstName.toLowerCase()}${plan.index + 1}` : null,
        source: pick(CANDIDATE_SOURCES),
        status: 'ACTIVE',
        rating: pick([3, 3, 4, 4, 5, null]),
        isHot: chance(0.18),
        ownerId: plan.ownerId,
        tags: [],
        dedupeKey: plan.email,
        lastContactedAt: chance(0.7) ? daysAgo(pickInt(1, 30)) : null,
        createdById: plan.ownerId,
        createdAt: daysAgo(pickInt(1, 80)),
      };
    }),
  });

  // Resumes — the first ten point at the PDFs uploaded above.
  await prisma.candidateResume.createMany({
    data: plans.map((plan) => {
      const uploaded = resumeFiles.get(plan.id);
      return {
        id: ids.resume(plan.index + 1),
        tenantId,
        candidateId: plan.id,
        fileName: `${plan.firstName}-${plan.lastName}-Resume.pdf`,
        storageKey: uploaded?.key ?? `resumes/${plan.id}/${plan.firstName}-${plan.lastName}-Resume.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: uploaded?.size ?? pickInt(80_000, 420_000),
        isPrimary: true,
        version: 1,
        extractedText: `${plan.firstName} ${plan.lastName}\n${plan.currentTitle}\n\nExperience summary generated by the demo seed.`,
        parseStatus: chance(0.8) ? 'COMPLETED' : 'PENDING',
        parsedAt: chance(0.8) ? daysAgo(pickInt(1, 60)) : null,
        uploadedById: plan.ownerId,
      };
    }),
  });

  // Multiple emails and phones per candidate. The primary row mirrors the
  // denormalised `Candidate.email` / `Candidate.phone` column verbatim.
  const emails: Prisma.CandidateEmailCreateManyInput[] = [];
  const phones: Prisma.CandidatePhoneCreateManyInput[] = [];

  for (const plan of plans) {
    emails.push({
      tenantId,
      candidateId: plan.id,
      address: plan.email,
      label: 'Work',
      isPrimary: true,
    });
    phones.push({
      tenantId,
      candidateId: plan.id,
      number: plan.phone,
      label: 'Mobile',
      isPrimary: true,
    });

    if (chance(0.35)) {
      emails.push({
        tenantId,
        candidateId: plan.id,
        address: `${plan.firstName.toLowerCase()}.${plan.lastName.toLowerCase()}${plan.index + 1}@gmail.com`,
        label: 'Personal',
        isPrimary: false,
      });
    }
    if (chance(0.25)) {
      phones.push({
        tenantId,
        candidateId: plan.id,
        number: `+1 ${pickInt(200, 989)} 555 ${String(pickInt(1000, 9999))}`,
        label: 'Home',
        isPrimary: false,
      });
    }
  }

  await prisma.candidateEmail.createMany({ data: emails });
  await prisma.candidatePhone.createMany({ data: phones });

  // Experience + education
  const experiences: Prisma.CandidateExperienceCreateManyInput[] = [];
  const educations: Prisma.CandidateEducationCreateManyInput[] = [];
  const candidateSkills: Prisma.CandidateSkillCreateManyInput[] = [];

  for (const plan of plans) {
    const roles = pickInt(1, 3);
    for (let role = 0; role < roles; role += 1) {
      const start = daysAgo(pickInt(400, 2200) + role * 200);
      const isCurrent = role === 0;
      experiences.push({
        id: `seed_exp_${String(plan.index + 1).padStart(3, '0')}_${role}`,
        tenantId,
        candidateId: plan.id,
        company: isCurrent
          ? COMPANIES[(plan.index * 3) % COMPANIES.length]!
          : COMPANIES[(plan.index * 5 + role * 3) % COMPANIES.length]!,
        title: role === 0 ? plan.currentTitle : JOB_TITLES[(plan.index + role * 4) % JOB_TITLES.length]!,
        employmentType: pick(['Full-time', 'Contract', 'Full-time']),
        location: `${plan.location.city}, ${plan.location.state}`,
        startDate: start,
        endDate: isCurrent ? null : new Date(start.getTime() + pickInt(300, 900) * DAY),
        isCurrent,
        description: 'Delivered platform services, owned on-call rotation and led design reviews.',
        skills: sample(SKILLS, 3).map((skill) => skill.name),
      });
    }

    educations.push({
      id: `seed_edu_${String(plan.index + 1).padStart(3, '0')}`,
      tenantId,
      candidateId: plan.id,
      institution: UNIVERSITIES[plan.index % UNIVERSITIES.length]!,
      degree: pick(DEGREES),
      fieldOfStudy: pick(['Computer Science', 'Information Systems', 'Software Engineering']),
      startDate: daysAgo(pickInt(2600, 4000)),
      endDate: daysAgo(pickInt(1600, 2400)),
      grade: pick(['3.4 GPA', '3.7 GPA', '3.9 GPA', 'First Class']),
    });

    for (const skillId of sample(skillIds, pickInt(3, 6))) {
      candidateSkills.push({
        tenantId,
        candidateId: plan.id,
        skillId,
        years: pickInt(1, 12),
        level: pickInt(2, 5),
        isPrimary: chance(0.35),
        lastUsedAt: daysAgo(pickInt(5, 300)),
      });
    }
  }

  await prisma.candidateExperience.createMany({ data: experiences });
  await prisma.candidateEducation.createMany({ data: educations });
  await prisma.candidateSkill.createMany({ data: candidateSkills });

  return plans;
}

interface StageHistoryStep {
  fromStageKey: string | null;
  toStageKey: string;
  at: Date;
  /** Seconds spent in `fromStageKey` before this move. */
  durationSeconds: number | null;
}

interface ApplicationPlan {
  id: string;
  index: number;
  jobIndex: number;
  jobId: string;
  candidate: CandidatePlan;
  stageKey: string;
  status: Prisma.ApplicationCreateManyInput['status'];
  submissionStatus: Prisma.ApplicationCreateManyInput['submissionStatus'];
  boardOrder: number;
  ownerId: string;
  resumeId: string;
  appliedAt: Date;
  /** When the candidate entered the current stage — powers days-in-stage / SLA. */
  enteredStageAt: Date;
  /** Stage the candidate was rejected from, when the application is rejected. */
  rejectedFromStageKey: string | null;
  history: StageHistoryStep[];
}

/**
 * Builds the funnel path an application took, walking **backwards** from the
 * time it entered its current stage. Walking backwards means no timestamp can
 * land in the future, whatever the dwell times add up to.
 *
 * A subset of dwell times deliberately exceeds the stage's `slaDays`, which is
 * what makes the "stale" filters and the SLA badge on the board non-empty.
 */
function buildApplicationTimeline(
  stageKey: string,
): { appliedAt: Date; enteredAt: Date; rejectedFromStageKey: string | null; steps: StageHistoryStep[] } {
  const targetIndex = STAGE_ORDER.indexOf(stageKey);
  const terminal = stageKey === 'rejected' || stageKey === 'withdrawn';

  // Rejections and withdrawals happen part-way down the funnel; progressions
  // walk the whole way to the stage they end on.
  const reachedBefore = terminal ? pickInt(1, 5) : Math.max(1, targetIndex);
  const prefix = STAGE_ORDER.slice(0, reachedBefore);
  const pathToUse =
    prefix[prefix.length - 1] === stageKey ? prefix : [...prefix, stageKey];
  const rejectedFromStageKey = terminal ? (pathToUse[pathToUse.length - 2] ?? 'screening') : null;

  const currentSla = STAGE_SLA_DAYS.get(stageKey) ?? null;
  const breachCurrentStage = !terminal && currentSla !== null && chance(0.4);
  const daysInCurrentStage = breachCurrentStage
    ? currentSla + pickInt(1, 12)
    : pickInt(0, currentSla ?? 20);

  const steps: StageHistoryStep[] = [];
  let cursor = Date.now() - daysInCurrentStage * DAY;

  for (let index = pathToUse.length - 1; index >= 0; index -= 1) {
    steps.unshift({
      fromStageKey: index === 0 ? null : pathToUse[index - 1]!,
      toStageKey: pathToUse[index]!,
      at: new Date(cursor),
      durationSeconds: null,
    });

    if (index > 0) {
      const stageBefore = pathToUse[index - 1]!;
      const sla = STAGE_SLA_DAYS.get(stageBefore) ?? null;
      const breached = sla !== null && chance(0.35);
      const days = breached ? sla + pickInt(1, 10) : pickInt(0, sla ?? 21);
      cursor -= days * DAY;
    }
  }

  for (let index = 1; index < steps.length; index += 1) {
    steps[index]!.durationSeconds = Math.round(
      (steps[index]!.at.getTime() - steps[index - 1]!.at.getTime()) / 1000,
    );
  }

  return {
    appliedAt: steps[0]!.at,
    enteredAt: steps[steps.length - 1]!.at,
    rejectedFromStageKey,
    steps,
  };
}

function planApplications(
  jobPlans: JobPlan[],
  candidates: CandidatePlan[],
  userIds: string[],
): ApplicationPlan[] {
  const recruiters = [userIds[1]!, userIds[2]!, userIds[3]!, userIds[4]!];
  const plans: ApplicationPlan[] = [];
  let counter = 0;

  // Stage mix: mostly early funnel, a handful at the far end.
  const stageWeights: readonly (typeof STAGE_ORDER)[number][] = [
    'sourced', 'sourced', 'screening', 'screening', 'screening',
    'submitted', 'submitted', 'client-review', 'client-review',
    'interview', 'interview', 'offer', 'placed',
    'rejected', 'withdrawn',
  ];

  for (const job of jobPlans) {
    const count = pickInt(3, 6);
    const start = (job.index * 17) % candidates.length;

    for (let offset = 0; offset < count; offset += 1) {
      const candidate = candidates[(start + offset) % candidates.length]!;
      const stageKey = pick(stageWeights);
      counter += 1;

      const status: Prisma.ApplicationCreateManyInput['status'] =
        stageKey === 'placed'
          ? 'PLACED'
          : stageKey === 'rejected'
            ? 'REJECTED'
            : stageKey === 'withdrawn'
              ? 'WITHDRAWN'
              : 'ACTIVE';

      const submissionStatus: Prisma.ApplicationCreateManyInput['submissionStatus'] =
        stageKey === 'sourced' || stageKey === 'screening'
          ? 'DRAFT'
          : stageKey === 'submitted'
            ? 'SUBMITTED'
            : stageKey === 'client-review'
              ? 'CLIENT_VIEWED'
              : stageKey === 'interview'
                ? 'INTERVIEWING'
                : stageKey === 'offer' || stageKey === 'placed'
                  ? 'OFFERED'
                  : stageKey === 'rejected'
                    ? 'REJECTED'
                    : 'WITHDRAWN';

      const timeline = buildApplicationTimeline(stageKey);

      plans.push({
        id: ids.application(counter),
        index: counter,
        jobIndex: job.index,
        jobId: job.id,
        candidate,
        stageKey,
        status,
        submissionStatus,
        boardOrder: offset * 1024,
        ownerId: job.ownerId ?? recruiters[counter % recruiters.length]!,
        resumeId: ids.resume(candidate.index + 1),
        appliedAt: timeline.appliedAt,
        enteredStageAt: timeline.enteredAt,
        rejectedFromStageKey: timeline.rejectedFromStageKey,
        history: timeline.steps,
      });
    }
  }

  return plans;
}

async function seedApplications(
  tenantId: string,
  plans: ApplicationPlan[],
  jobPlans: JobPlan[],
  stageIdFor: StageIdResolver,
): Promise<{ interviewable: ApplicationPlan[]; placed: ApplicationPlan[] }> {
  await prisma.application.createMany({
    data: plans.map((plan) => {
      // One roll decides both fields, and only a submission a client has
      // actually seen can carry feedback — never before it was submitted.
      const feedback =
        plan.submissionStatus !== 'DRAFT' && chance(0.25)
          ? {
              text: pick([
                'Strong profile, moving to the next round.',
                'Good experience, but the rate is above budget.',
                'Hiring manager wants a technical screen first.',
                'Not the right seniority for this team.',
              ]),
              at: new Date(Math.max(plan.appliedAt.getTime(), daysAgo(pickInt(1, 20)).getTime())),
            }
          : null;

      return {
      id: plan.id,
      tenantId,
      jobId: plan.jobId,
      candidateId: plan.candidate.id,
      stageId: stageIdFor(plan.jobId, plan.stageKey),
      status: plan.status,
      submissionStatus: plan.submissionStatus,
      submittedAt: plan.submissionStatus === 'DRAFT' ? null : plan.appliedAt,
      submittedById: plan.submissionStatus === 'DRAFT' ? null : plan.ownerId,
      clientFeedback: feedback?.text ?? null,
      clientFeedbackAt: feedback?.at ?? null,
      boardOrder: plan.boardOrder,
      source: plan.candidate.index % 2 === 0 ? 'LINKEDIN' : 'REFERRAL',
      rating: pick([3, 4, 4, 5, null]),
      isRejected: plan.stageKey === 'rejected',
      rejectedReason: plan.stageKey === 'rejected' ? pick(['Client chose another profile', 'Rate too high', 'Skills mismatch']) : null,
      rejectedAt: plan.stageKey === 'rejected' ? plan.enteredStageAt : null,
      rejectedStageId:
        plan.stageKey === 'rejected' && plan.rejectedFromStageKey
          ? stageIdFor(plan.jobId, plan.rejectedFromStageKey)
          : null,
      appliedAt: plan.appliedAt,
      // `stageEnteredAt` is what the SLA badge and the "stale" filter read, so
      // the seeded dwell time has to land here — not on `updatedAt`.
      stageEnteredAt: plan.enteredStageAt,
      lastStageChangedAt: plan.enteredStageAt,
      ownerId: plan.ownerId,
      resumeId: plan.resumeId,
      createdById: plan.ownerId,
      createdAt: plan.appliedAt,
      };
    }),
  });

  // Stage history — the exact path the timeline builder walked to reach the
  // current stage, including the transitions that breached their stage SLA.
  const history: Prisma.StageHistoryCreateManyInput[] = [];
  for (const plan of plans) {
    for (const step of plan.history) {
      history.push({
        tenantId,
        applicationId: plan.id,
        fromStageId: step.fromStageKey ? stageIdFor(plan.jobId, step.fromStageKey) : null,
        toStageId: stageIdFor(plan.jobId, step.toStageKey),
        note: step.fromStageKey
          ? `Moved to ${STAGE_NAME_BY_KEY.get(step.toStageKey) ?? step.toStageKey}`
          : 'Added to pipeline',
        changedById: plan.ownerId,
        durationSeconds: step.durationSeconds,
        createdAt: step.at,
      });
    }
  }
  await prisma.stageHistory.createMany({ data: history });

  // Keep job.filledCount honest.
  for (const job of jobPlans) {
    const filled = plans.filter((plan) => plan.jobIndex === job.index && plan.stageKey === 'placed').length;
    if (filled > 0) {
      await prisma.job.update({ where: { id: job.id }, data: { filledCount: filled } });
    }
  }

  const interviewable = plans.filter((plan) => ['interview', 'offer', 'placed'].includes(plan.stageKey));
  const placed = plans.filter((plan) => plan.stageKey === 'placed');

  return { interviewable, placed };
}

async function seedInterviews(
  tenantId: string,
  interviewable: ApplicationPlan[],
): Promise<number> {
  const interviewRows: Prisma.InterviewCreateManyInput[] = [];
  const interviewerRows: Prisma.InterviewInterviewerCreateManyInput[] = [];
  let counter = 0;

  for (const plan of interviewable) {
    const rounds = pickInt(1, 2);
    for (let round = 1; round <= rounds; round += 1) {
      counter += 1;
      const id = ids.interview(counter);
      const start = round === 1 ? daysAgo(pickInt(2, 20)) : daysAhead(pickInt(1, 10));
      const completed = start.getTime() < Date.now();
      const type = pick(['PHONE', 'VIDEO', 'ONSITE', 'TECHNICAL', 'PANEL', 'HR'] as const);

      interviewRows.push({
        id,
        tenantId,
        applicationId: plan.id,
        type,
        status: completed ? (chance(0.85) ? 'COMPLETED' : 'NO_SHOW') : 'SCHEDULED',
        round,
        title: round === 1 ? 'Hiring manager screen' : 'Technical deep dive',
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + 60 * 60_000),
        timezone: 'America/Chicago',
        durationMinutes: 60,
        location: type === 'ONSITE' ? 'Client office — Austin, TX' : null,
        meetingUrl: type === 'ONSITE' ? null : `https://meet.example.com/${id}`,
        externalInterviewer: chance(0.4) ? `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} (client)` : null,
        feedback: completed ? pick(['Strong systems knowledge.', 'Good communication, slightly light on Kubernetes.', 'Excellent domain fit.']) : null,
        rating: completed ? pickInt(3, 5) : null,
        strengths: completed ? 'Clear ownership, strong debugging instinct.' : null,
        concerns: completed ? pick([null, 'Notice period is 60 days.', 'Wants fully remote.']) : null,
        feedbackAt: completed ? start : null,
        submittedById: completed ? plan.ownerId : null,
        createdById: plan.ownerId,
      });

      interviewerRows.push({ tenantId, interviewId: id, userId: plan.ownerId, isLead: true });
    }
  }

  await prisma.interview.createMany({ data: interviewRows });
  await prisma.interviewInterviewer.createMany({ data: interviewerRows });

  return interviewRows.length;
}

async function seedOffersAndPlacements(
  tenantId: string,
  placed: ApplicationPlan[],
  jobPlans: JobPlan[],
): Promise<{ offers: number; placements: number }> {
  const offers: Prisma.OfferCreateManyInput[] = [];
  const placements: Prisma.PlacementCreateManyInput[] = [];
  let counter = 0;

  for (const plan of placed) {
    counter += 1;
    const offerId = ids.offer(counter);
    const job = jobPlans[plan.jobIndex]!;
    const salaryCents = pickInt(11000000, 19500000);
    const billRateCents = pickInt(9500, 16500);
    const payRateCents = billRateCents - pickInt(2000, 3800);
    const startDate = daysAhead(pickInt(3, 30));

    offers.push({
      id: offerId,
      tenantId,
      applicationId: plan.id,
      status: 'ACCEPTED',
      title: job.title,
      salaryCents,
      payRateCents,
      billRateCents,
      ratePeriod: 'HOURLY',
      currency: 'USD',
      bonusCents: pick([0, 500000, 1000000]),
      startDate,
      expiresAt: daysAgo(pickInt(1, 10)),
      sentAt: daysAgo(pickInt(6, 20)),
      respondedAt: daysAgo(pickInt(1, 5)),
      notes: 'Candidate negotiated a signing bonus; approved by the client.',
      createdById: plan.ownerId,
    });

    placements.push({
      id: ids.placement(counter),
      tenantId,
      applicationId: plan.id,
      offerId,
      status: 'ACTIVE',
      startDate,
      endDate: new Date(startDate.getTime() + 180 * DAY),
      payRateCents,
      billRateCents,
      ratePeriod: 'HOURLY',
      currency: 'USD',
      marginCents: billRateCents - payRateCents,
      marginPercentage: Number((((billRateCents - payRateCents) / billRateCents) * 100).toFixed(2)),
      feeCents: null,
      feePercentage: null,
      guaranteeDays: 90,
      recruiterId: plan.ownerId,
      clientId: job.clientId,
      jobId: job.id,
      notes: 'Six-month contract with an extension option.',
      invoiceRef: `PL-2026-${String(counter).padStart(3, '0')}`,
      createdById: plan.ownerId,
    });
  }

  await prisma.offer.createMany({ data: offers });
  await prisma.placement.createMany({ data: placements });

  return { offers: offers.length, placements: placements.length };
}

async function seedTags(
  tenantId: string,
  candidates: CandidatePlan[],
): Promise<number> {
  await prisma.tag.createMany({
    data: TAG_SEEDS.map((tag, index) => ({
      id: ids.tag(index + 1),
      tenantId,
      name: tag.name,
      color: tag.color,
      category: tag.category,
    })),
  });

  const links: Prisma.TagLinkCreateManyInput[] = [];
  for (const candidate of candidates) {
    if (!chance(0.55)) continue;
    const tags = sample(TAG_SEEDS, pickInt(1, 2));
    for (const tag of tags) {
      links.push({
        tenantId,
        tagId: ids.tag(TAG_SEEDS.indexOf(tag) + 1),
        entityType: 'CANDIDATE',
        entityId: candidate.id,
        createdById: candidate.ownerId,
      });
    }
  }

  await prisma.tagLink.createMany({ data: links });
  return links.length;
}

async function seedEngagement(
  tenantId: string,
  userIds: string[],
  candidates: CandidatePlan[],
  jobPlans: JobPlan[],
  applications: ApplicationPlan[],
): Promise<{ activities: number; tasks: number; notes: number; emails: number }> {
  const activities: Prisma.ActivityCreateManyInput[] = [];
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const notes: Prisma.NoteCreateManyInput[] = [];
  const emails: Prisma.EmailMessageCreateManyInput[] = [];

  for (let index = 0; index < 260; index += 1) {
    const candidate = candidates[index % candidates.length]!;
    const type = pick(ACTIVITY_TYPES);
    const occurredAt = daysAgo(pickInt(0, 60));
    const inHours = pickInt(9, 18);

    activities.push({
      id: ids.activity(index + 1),
      tenantId,
      type,
      direction: type === 'EMAIL' || type === 'CALL' ? pick(['INBOUND', 'OUTBOUND'] as const) : null,
      subject:
        type === 'CALL'
          ? `Screening call with ${candidate.firstName}`
          : type === 'EMAIL'
            ? `Emailed ${candidate.firstName} about the ${JOB_TITLES[candidate.index % JOB_TITLES.length]} role`
            : type === 'MEETING'
              ? `Intake meeting with the client`
              : type === 'LINKEDIN'
                ? `LinkedIn message to ${candidate.firstName}`
                : `Note on ${candidate.firstName} ${candidate.lastName}`,
      body: pick([
        'Discussed current role, notice period and comp expectations.',
        'Candidate is interested but wants remote-only.',
        'Follow-up scheduled for next week.',
        'Client asked for two more comparable profiles.',
      ]),
      occurredAt: new Date(occurredAt.getTime() + inHours * 3_600_000),
      durationMinutes: type === 'CALL' || type === 'MEETING' ? pick([15, 30, 45, 60]) : null,
      entityType: 'CANDIDATE',
      entityId: candidate.id,
      candidateId: candidate.id,
      outcome: pick([null, 'Positive', 'Neutral', 'No answer']),
      isPinned: chance(0.08),
      createdById: candidate.ownerId,
      createdAt: occurredAt,
    });
  }

  for (const plan of applications.slice(0, 60)) {
    const job = jobPlans[plan.jobIndex]!;
    activities.push({
      id: ids.activity(activities.length + 1),
      tenantId,
      type: 'SUBMISSION',
      subject: `${plan.candidate.firstName} ${plan.candidate.lastName} submitted to ${job.title}`,
      body: 'Profile sent to the client contact; awaiting feedback.',
      occurredAt: plan.appliedAt,
      entityType: 'APPLICATION',
      entityId: plan.id,
      candidateId: plan.candidate.id,
      jobId: plan.jobId,
      applicationId: plan.id,
      createdById: plan.ownerId,
      createdAt: plan.appliedAt,
    });
  }

  for (let index = 0; index < 45; index += 1) {
    const assignee = userIds[index % userIds.length]!;
    const candidate = candidates[(index * 2) % candidates.length]!;
    const status = pick(['OPEN', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const);
    const dueAt = status === 'COMPLETED' ? daysAgo(pickInt(1, 14)) : daysAhead(pickInt(0, 14));

    tasks.push({
      id: ids.task(index + 1),
      tenantId,
      title: pick([
        `Follow up with ${candidate.firstName} ${candidate.lastName}`,
        'Send submission pack to client',
        'Chase interview feedback',
        'Confirm interview panel availability',
        'Refresh candidate availability',
      ]),
      description: 'Auto-generated by the demo seed so the My Day view has content.',
      status,
      priority: pick(PRIORITIES),
      dueAt,
      completedAt: status === 'COMPLETED' ? dueAt : null,
      reminderAt: status === 'OPEN' ? new Date(dueAt.getTime() - 3_600_000) : null,
      assigneeId: assignee,
      entityType: 'CANDIDATE',
      entityId: candidate.id,
      candidateId: candidate.id,
      createdById: assignee,
    });
  }

  for (let index = 0; index < 70; index += 1) {
    const candidate = candidates[(index * 3) % candidates.length]!;
    notes.push({
      id: ids.note(index + 1),
      tenantId,
      body: pick([
        'Prefers a start date after the current quarter.',
        'Counter-offered at the client; waiting on approval.',
        'Available for onsite interviews on Tuesdays and Thursdays.',
        'Referred by an existing candidate — handle with care.',
      ]),
      isPinned: chance(0.15),
      entityType: 'CANDIDATE',
      entityId: candidate.id,
      candidateId: candidate.id,
      createdById: candidate.ownerId,
    });
  }

  const templateKeys = EMAIL_TEMPLATES.map((template) => template.key as string);
  for (let index = 0; index < 45; index += 1) {
    const candidate = candidates[(index * 4) % candidates.length]!;
    const templateKey = templateKeys[index % templateKeys.length]!;
    const sentAt = daysAgo(pickInt(1, 45));
    emails.push({
      id: ids.email(index + 1),
      tenantId,
      direction: 'OUTBOUND',
      fromAddress: 'no-reply@acme-demo.test',
      fromName: 'Acme Demo Staffing',
      toAddresses: [candidate.email],
      subject: `Regarding your application — ${candidate.currentTitle}`,
      bodyText: `Hi ${candidate.firstName},\n\nFollowing up on the ${candidate.currentTitle} conversations.\n\nAmelia`,
      status: 'SENT',
      messageId: `<seed-${index + 1}@acme-demo.test>`,
      templateId: ids.template(templateKey),
      entityType: 'CANDIDATE',
      entityId: candidate.id,
      candidateId: candidate.id,
      sentAt,
      createdById: candidate.ownerId,
      createdAt: sentAt,
    });
  }

  await prisma.activity.createMany({ data: activities });
  await prisma.task.createMany({ data: tasks });
  await prisma.note.createMany({ data: notes });
  await prisma.emailMessage.createMany({ data: emails });

  return {
    activities: activities.length,
    tasks: tasks.length,
    notes: notes.length,
    emails: emails.length,
  };
}

async function seedGovernance(
  tenantId: string,
  userIds: string[],
  userSeeds: UserSeed[],
  jobIds: string[],
): Promise<{ auditLogs: number; notifications: number }> {
  const logs: Prisma.AuditLogCreateManyInput[] = [];
  const actions = ['CREATE', 'UPDATE', 'VIEW', 'LOGIN', 'EXPORT', 'STATUS_CHANGE'] as const;

  for (let index = 0; index < 40; index += 1) {
    const userIndex = index % userSeeds.length;
    const seed = userSeeds[userIndex]!;
    const action = pick(actions);
    const entity = pick(['Job', 'Candidate', 'Client', 'Application', 'User']);
    logs.push({
      id: ids.audit(index + 1),
      tenantId,
      action,
      entity,
      entityId: entity === 'Job' ? jobIds[index % jobIds.length]! : null,
      description: `${seed.firstName} ${seed.lastName} performed ${action.toLowerCase()} on ${entity}`,
      actorId: userIds[userIndex]!,
      actorEmail: seed.email,
      actorName: `${seed.firstName} ${seed.lastName}`,
      ipAddress: `203.0.113.${pickInt(2, 250)}`,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      requestId: `seed-req-${String(index + 1).padStart(4, '0')}`,
      createdAt: daysAgo(pickInt(0, 45)),
    });
  }

  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const notificationTypes: readonly { type: string; title: string; body: string; link: string; icon: string }[] = [
    { type: 'task.assigned', title: 'New task assigned', body: 'Follow up with a candidate before EOD.', link: '/tasks', icon: 'check-circle' },
    { type: 'interview.scheduled', title: 'Interview scheduled', body: 'Client interview booked for Thursday 2:00 PM.', link: '/interviews', icon: 'calendar' },
    { type: 'submission.feedback', title: 'Client feedback received', body: 'Shortlisted for the next round.', link: '/applications', icon: 'message-square' },
    { type: 'candidate.created', title: 'Candidate added', body: 'A new candidate was added to the workspace.', link: '/candidates', icon: 'user-plus' },
    { type: 'offer.accepted', title: 'Offer accepted', body: 'A candidate accepted the offer.', link: '/offers', icon: 'party-popper' },
  ];

  for (let index = 0; index < 30; index += 1) {
    const userId = userIds[index % userIds.length]!;
    const item = notificationTypes[index % notificationTypes.length]!;
    notifications.push({
      id: ids.notification(index + 1),
      tenantId,
      userId,
      type: item.type,
      channel: 'IN_APP',
      title: item.title,
      body: item.body,
      link: item.link,
      icon: item.icon,
      // Deliberately not a modulo of `index`: the recipient is chosen with
      // `index % userIds.length`, so any `index % n` read pattern where `n`
      // shares a factor with the user count would give some users an entirely
      // read inbox and the bell badge would never appear on first sign-in.
      readAt: chance(0.4) ? daysAgo(pickInt(0, 5)) : null,
      createdAt: daysAgo(pickInt(0, 10)),
    });
  }

  await prisma.auditLog.createMany({ data: logs });
  await prisma.notification.createMany({ data: notifications });

  return { auditLogs: logs.length, notifications: notifications.length };
}

async function seedSavedSearches(tenantId: string, userId: string): Promise<void> {
  await prisma.savedSearch.createMany({
    data: SAVED_SEARCHES.map((search) => ({ ...search, tenantId, userId: search.visibility === 'PRIVATE' ? userId : null })),
  });
}

async function setCandidateTags(tenantId: string, candidates: CandidatePlan[]): Promise<void> {
  for (const candidate of candidates) {
    if (!chance(0.35)) continue;
    const tags = sample(TAG_SEEDS, 1).map((tag) => tag.name);
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { tags },
    });
  }
}

// -----------------------------------------------------------------------------
// Hotlists
// -----------------------------------------------------------------------------

const CANDIDATE_LISTS: readonly {
  name: string;
  description: string;
  color: string;
  visibility: Prisma.CandidateListCreateManyInput['visibility'];
  /** Picks members from the seeded candidate pool by position, deterministically. */
  memberIndexes: readonly number[];
}[] = [
  {
    name: 'Bench — Go & platform engineers',
    description: 'Bench-eligible engineers we can submit the same day a Go req opens.',
    color: '#6366f1',
    visibility: 'TENANT',
    memberIndexes: [0, 3, 6, 12, 18, 25, 33, 41, 52, 60, 71, 84],
  },
  {
    name: 'Fintech shortlist',
    description: 'Pre-screened profiles for the Vertex Financial Group programme.',
    color: '#0ea5e9',
    visibility: 'TENANT',
    memberIndexes: [2, 5, 9, 14, 21, 30, 38, 47, 55],
  },
  {
    name: 'My priority outreach',
    description: 'Candidates this desk is actively working this week.',
    color: '#f59e0b',
    visibility: 'PRIVATE',
    memberIndexes: [1, 7, 11, 16, 23, 29],
  },
];

async function seedCandidateLists(
  tenantId: string,
  candidates: CandidatePlan[],
  userIds: string[],
): Promise<number> {
  const ownerId = userIds[1]!;
  const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));

  await prisma.candidateList.createMany({
    data: CANDIDATE_LISTS.map((list, index) => ({
      id: ids.candidateList(index + 1),
      tenantId,
      name: list.name,
      description: list.description,
      color: list.color,
      visibility: list.visibility,
      ownerId: list.visibility === 'PRIVATE' ? ownerId : null,
      createdById: ownerId,
      createdAt: daysAgo(pickInt(20, 70)),
    })),
  });

  const members: Prisma.CandidateListMemberCreateManyInput[] = [];
  CANDIDATE_LISTS.forEach((list, index) => {
    for (const memberIndex of list.memberIndexes) {
      const candidate = byIndex.get(memberIndex);
      if (!candidate) continue;
      members.push({
        tenantId,
        listId: ids.candidateList(index + 1),
        candidateId: candidate.id,
        addedById: ownerId,
        createdAt: daysAgo(pickInt(1, 25)),
      });
    }
  });

  await prisma.candidateListMember.createMany({ data: members });
  return CANDIDATE_LISTS.length;
}

// -----------------------------------------------------------------------------
// Near-duplicate candidates
// -----------------------------------------------------------------------------

/**
 * Deliberate near-duplicates: the same person captured twice with a different
 * email or a middle initial. This is what the duplicate-detection view in the
 * candidates module is for, and an empty one would be untestable.
 */
async function seedDuplicateCandidates(
  tenantId: string,
  candidates: CandidatePlan[],
): Promise<number> {
  const pairs: readonly { sourceIndex: number; emailSuffix: string; middleName: string | null }[] = [
    { sourceIndex: 0, emailSuffix: '+dup', middleName: null },
    { sourceIndex: 4, emailSuffix: '@personal-mail.test', middleName: 'J' },
    { sourceIndex: 9, emailSuffix: '.alt@candidate-mail.test', middleName: null },
    { sourceIndex: 17, emailSuffix: '+backup', middleName: 'K' },
    { sourceIndex: 26, emailSuffix: '@contract-mail.test', middleName: null },
    { sourceIndex: 33, emailSuffix: '+dup', middleName: 'R' },
  ];

  const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));
  const rows: Prisma.CandidateCreateManyInput[] = [];

  pairs.forEach((pair, order) => {
    const source = byIndex.get(pair.sourceIndex);
    if (!source) return;
    const variant = `${source.firstName}${pair.middleName ? ` ${pair.middleName}` : ''} ${source.lastName}`;
    const [localPart, domain] = source.email.split('@');
    const email = pair.emailSuffix.startsWith('@')
      ? `${localPart}${pair.emailSuffix}`
      : `${localPart}${pair.emailSuffix}@${domain ?? 'candidate-mail.test'}`;

    rows.push({
      id: `seed_duplicate_${String(order + 1).padStart(2, '0')}`,
      tenantId,
      firstName: source.firstName,
      lastName: source.lastName,
      email,
      phone: source.phone,
      headline: `${source.currentTitle} · duplicate record`,
      currentTitle: source.currentTitle,
      locationCity: source.location.city,
      locationState: source.location.state,
      locationCountry: source.location.country,
      source: 'MANUAL',
      status: 'ACTIVE',
      // A different normalised key than the original, so it shows up as a
      // *candidate* duplicate rather than being rejected at insert time.
      dedupeKey: `${variant.toLowerCase()}|${pair.emailSuffix}`,
      ownerId: source.ownerId,
      createdById: source.ownerId,
      createdAt: daysAgo(pickInt(1, 30)),
    });
  });

  await prisma.candidate.createMany({ data: rows });

  // Mirror the primary email/phone rows so the duplicate looks fully populated.
  const contacts: Prisma.CandidateEmailCreateManyInput[] = rows.map((row) => ({
    tenantId,
    candidateId: row.id!,
    address: row.email!,
    label: 'Work',
    isPrimary: true,
  }));
  await prisma.candidateEmail.createMany({ data: contacts });

  return rows.length;
}

// -----------------------------------------------------------------------------
// Import history
// -----------------------------------------------------------------------------

/**
 * Import history: one successful run and one that failed part-way, so the
 * import page shows both the happy path and the error-download path.
 */
async function seedImportJobs(
  tenantId: string,
  userId: string,
  candidates: CandidatePlan[],
): Promise<number> {
  const completedKey = `imports/${tenantId}/seed/candidates-q3.csv`;
  const failedKey = `imports/${tenantId}/seed/clients-broken.csv`;

  const completedCsv = [
    'First Name,Last Name,Email,Phone,Current Title,Company,City,State',
    ...candidates
      .slice(0, 8)
      .map((candidate) =>
        [
          candidate.firstName,
          candidate.lastName,
          candidate.email,
          candidate.phone,
          candidate.currentTitle,
          COMPANIES[candidate.index % COMPANIES.length],
          candidate.location.city,
          candidate.location.state,
        ].join(','),
      ),
  ].join('\n');

  const failedCsv = [
    'Company,Status,Industry,Website',
    'Northwind Retail Group,ACTIVE,Retail,https://www.northwindretailgroup.example.com',
    'Broken Row,NOT_A_STATUS,Unknown,not-a-url',
    '',
    'Acme Industrial,ACTIVE,Manufacturing,https://www.acmeindustrial.example.com',
  ].join('\n');

  try {
    await ensureBucket();
    await putObject(completedKey, Buffer.from(completedCsv, 'utf8'), 'text/csv');
    await putObject(failedKey, Buffer.from(failedCsv, 'utf8'), 'text/csv');
  } catch (error) {
    console.warn(
      `  storage unavailable — import rows reference keys that were not uploaded (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  await prisma.importJob.createMany({
    data: [
      {
        id: ids.importJob(1),
        tenantId,
        entity: 'CANDIDATE',
        status: 'COMPLETED',
        fileName: 'candidates-q3.csv',
        storageKey: completedKey,
        mimeType: 'text/csv',
        mapping: {
          'First Name': 'firstName',
          'Last Name': 'lastName',
          Email: 'email',
          Phone: 'phone',
          'Current Title': 'currentTitle',
          Company: 'currentCompany',
          City: 'locationCity',
          State: 'locationState',
        },
        options: { duplicateStrategy: 'SKIP', hasHeaderRow: true },
        totalRows: 8,
        processedRows: 8,
        createdRows: 8,
        updatedRows: 0,
        skippedRows: 0,
        failedRows: 0,
        errors: [],
        startedAt: daysAgo(9),
        completedAt: daysAgo(9),
        createdById: userId,
        createdAt: daysAgo(9),
      },
      {
        id: ids.importJob(2),
        tenantId,
        entity: 'CLIENT',
        status: 'FAILED',
        fileName: 'clients-broken.csv',
        storageKey: failedKey,
        mimeType: 'text/csv',
        mapping: { Company: 'name', Status: 'status', Industry: 'industry', Website: 'website' },
        options: { duplicateStrategy: 'UPDATE', hasHeaderRow: true },
        totalRows: 3,
        processedRows: 3,
        createdRows: 2,
        updatedRows: 0,
        skippedRows: 0,
        failedRows: 1,
        errors: [
          {
            row: 3,
            field: 'status',
            message: '"NOT_A_STATUS" is not a valid client status — expected PROSPECT, ACTIVE, INACTIVE or CHURNED',
          },
        ],
        startedAt: daysAgo(3),
        completedAt: daysAgo(3),
        createdById: userId,
        createdAt: daysAgo(3),
      },
    ],
  });

  return 2;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();
  const demoPassword = process.env.SEED_WORKSPACE_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? 'Passw0rd!23';
  const userSeeds = buildUserSeeds();

  console.log('\nTalentFlow seed\n---------------');
  console.log('  truncating existing demo data…');
  await resetDatabase();

  const passwordHash = await hash(demoPassword, {
    algorithm: 2 as Algorithm,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });

  const permissionCount = await seedPermissions();
  await seedPlans();
  await seedPlatformTenant(passwordHash);
  const { tenantId, userIds } = await seedDemoTenant(passwordHash, userSeeds);
  await seedTeams(tenantId, userIds);
  const skillIds = await seedSkills(tenantId);
  const { clientIds, contactIds } = await seedClients(tenantId, userIds);
  const { jobPlans } = await seedJobs(tenantId, userIds, clientIds, contactIds, skillIds);
  const stageIdFor = await seedJobPipelines(tenantId, jobPlans);
  const candidates = await seedCandidates(tenantId, userIds, skillIds);

  const applicationPlans = planApplications(jobPlans, candidates, userIds);
  const { interviewable, placed } = await seedApplications(
    tenantId,
    applicationPlans,
    jobPlans,
    stageIdFor,
  );
  const interviewCount = await seedInterviews(tenantId, interviewable);
  const { offers, placements } = await seedOffersAndPlacements(tenantId, placed, jobPlans);
  const tagLinks = await seedTags(tenantId, candidates);
  const engagement = await seedEngagement(tenantId, userIds, candidates, jobPlans, applicationPlans);
  const governance = await seedGovernance(tenantId, userIds, userSeeds, jobPlans.map((job) => job.id));
  await seedSavedSearches(tenantId, userIds[0]!);
  await setCandidateTags(tenantId, candidates);
  const hotlists = await seedCandidateLists(tenantId, candidates, userIds);
  const duplicates = await seedDuplicateCandidates(tenantId, candidates);
  const importJobs = await seedImportJobs(tenantId, userIds[0]!, candidates);

  const counts = await Promise.all([
    prisma.user.count({ where: { tenantId } }),
    prisma.client.count({ where: { tenantId } }),
    prisma.job.count({ where: { tenantId } }),
    prisma.candidate.count({ where: { tenantId } }),
    prisma.application.count({ where: { tenantId } }),
  ]);

  console.log(`
  permissions      ${permissionCount}
  plans            ${PLANS.length}
  workspaces       2 (1 platform + 1 demo)
  users            ${counts[0]}
  clients          ${counts[1]}
  jobs             ${counts[2]}
  candidates       ${counts[3]}
  applications     ${counts[4]}
  interviews       ${interviewCount}
  offers           ${offers}
  placements       ${placements}
  tag links        ${tagLinks}
  activities       ${engagement.activities}
  tasks            ${engagement.tasks}
  notes            ${engagement.notes}
  emails           ${engagement.emails}
  audit logs       ${governance.auditLogs}
  notifications    ${governance.notifications}
  hotlists         ${hotlists}
  duplicates       ${duplicates}
  import jobs      ${importJobs}

  sign in with
    workspace admin  ${userSeeds[0]!.email}
    platform admin   ${process.env.SEED_SUPER_ADMIN_EMAIL ?? 'superadmin@talentflow.test'}
    password         ${demoPassword}

  done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s
`);
}

main()
  .catch((error: unknown) => {
    console.error('\n  Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
