import { z } from 'zod';

/**
 * Canonical enum definitions.
 *
 * These mirror the Prisma enums in `apps/api/prisma/schema.prisma` one-for-one
 * (same names, same members). `apps/api/test/enum-parity.spec.ts` fails the build
 * if the two ever drift apart.
 *
 * Each enum is exported three ways:
 *   - a Zod schema for runtime validation at the API boundary
 *   - an inferred TypeScript union type
 *   - a `*_LABELS` record for UI rendering
 */

// ---------------------------------------------------------------------------
// Platform / tenancy
// ---------------------------------------------------------------------------

export const tenantStatusSchema = z.enum([
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;
export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
};

export const subscriptionStatusSchema = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'UNPAID',
  'PAUSED',
  'CANCELED',
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const billingIntervalSchema = z.enum(['MONTHLY', 'YEARLY']);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const paymentProviderSchema = z.enum(['STRIPE', 'RAZORPAY', 'MANUAL']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const invoiceStatusSchema = z.enum([
  'DRAFT',
  'OPEN',
  'PAID',
  'VOID',
  'UNCOLLECTIBLE',
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const roleKeySchema = z.enum([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'RECRUITER_MANAGER',
  'RECRUITER',
  'ACCOUNT_MANAGER',
  'VIEWER',
]);
export type RoleKey = z.infer<typeof roleKeySchema>;
export const ROLE_KEY_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Super Admin',
  TENANT_ADMIN: 'Tenant Admin',
  RECRUITER_MANAGER: 'Recruiter Manager',
  RECRUITER: 'Recruiter',
  ACCOUNT_MANAGER: 'Account Manager',
  VIEWER: 'Viewer',
};
export const ROLE_KEY_DESCRIPTIONS: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Platform owner with cross-tenant access. Not assignable inside a tenant.',
  TENANT_ADMIN: 'Full control of the workspace, users, billing and settings.',
  RECRUITER_MANAGER: 'Manages recruiters, sees all records in the workspace.',
  RECRUITER: 'Works their own candidates, jobs and submissions.',
  ACCOUNT_MANAGER: 'Owns client relationships, jobs and submissions for those clients.',
  VIEWER: 'Read-only access to records they are given visibility on.',
};

export const userStatusSchema = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED']);
export type UserStatus = z.infer<typeof userStatusSchema>;
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  INVITED: 'Invited',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DISABLED: 'Disabled',
};

export const authTokenTypeSchema = z.enum([
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'INVITE',
]);
export type AuthTokenType = z.infer<typeof authTokenTypeSchema>;

export const visibilitySchema = z.enum(['PRIVATE', 'TEAM', 'TENANT']);
export type Visibility = z.infer<typeof visibilitySchema>;

export const permissionEffectSchema = z.enum(['ALLOW', 'DENY']);
export type PermissionEffect = z.infer<typeof permissionEffectSchema>;

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export const clientStatusSchema = z.enum(['PROSPECT', 'ACTIVE', 'INACTIVE', 'CHURNED']);
export type ClientStatus = z.infer<typeof clientStatusSchema>;
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  PROSPECT: 'Prospect',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  CHURNED: 'Churned',
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobStatusSchema = z.enum([
  'DRAFT',
  'OPEN',
  'ON_HOLD',
  'CLOSED',
  'FILLED',
  'CANCELLED',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
  FILLED: 'Filled',
  CANCELLED: 'Cancelled',
};

export const jobTypeSchema = z.enum([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'CONTRACT_TO_HIRE',
  'C2C',
  'W2',
  'INTERNSHIP',
]);
export type JobType = z.infer<typeof jobTypeSchema>;
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  CONTRACT_TO_HIRE: 'Contract-to-hire',
  C2C: 'C2C',
  W2: 'W2',
  INTERNSHIP: 'Internship',
};

export const remoteTypeSchema = z.enum(['ONSITE', 'REMOTE', 'HYBRID']);
export type RemoteType = z.infer<typeof remoteTypeSchema>;
export const REMOTE_TYPE_LABELS: Record<RemoteType, string> = {
  ONSITE: 'On-site',
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
};

export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export type Priority = z.infer<typeof prioritySchema>;
export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

// ---------------------------------------------------------------------------
// Applications & pipeline
// ---------------------------------------------------------------------------

/**
 * Semantic meaning of a pipeline stage. Tenants may rename and reorder stages
 * freely, but every stage maps onto one of these types so reporting stays
 * comparable across workspaces.
 */
export const stageTypeSchema = z.enum([
  'SOURCING',
  'SCREENING',
  'SUBMISSION',
  'CLIENT_REVIEW',
  'INTERVIEW',
  'OFFER',
  'PLACEMENT',
  'REJECTED',
  'WITHDRAWN',
]);
export type StageType = z.infer<typeof stageTypeSchema>;
export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  SOURCING: 'Sourcing',
  SCREENING: 'Screening',
  SUBMISSION: 'Submission',
  CLIENT_REVIEW: 'Client review',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  PLACEMENT: 'Placement',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const applicationStatusSchema = z.enum([
  'ACTIVE',
  'ON_HOLD',
  'REJECTED',
  'WITHDRAWN',
  'PLACED',
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  PLACED: 'Placed',
};

export const submissionStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'CLIENT_VIEWED',
  'SHORTLISTED',
  'INTERVIEWING',
  'OFFERED',
  'REJECTED',
  'WITHDRAWN',
]);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  CLIENT_VIEWED: 'Client viewed',
  SHORTLISTED: 'Shortlisted',
  INTERVIEWING: 'Interviewing',
  OFFERED: 'Offered',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const interviewTypeSchema = z.enum([
  'PHONE',
  'VIDEO',
  'ONSITE',
  'TECHNICAL',
  'PANEL',
  'HR',
]);
export type InterviewType = z.infer<typeof interviewTypeSchema>;
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  PHONE: 'Phone screen',
  VIDEO: 'Video call',
  ONSITE: 'On-site',
  TECHNICAL: 'Technical',
  PANEL: 'Panel',
  HR: 'HR round',
};

export const interviewStatusSchema = z.enum([
  'SCHEDULED',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);
export type InterviewStatus = z.infer<typeof interviewStatusSchema>;
export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  SCHEDULED: 'Scheduled',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
  RESCHEDULED: 'Rescheduled',
};

// ---------------------------------------------------------------------------
// Offers & placements
// ---------------------------------------------------------------------------

export const offerStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
]);
export type OfferStatus = z.infer<typeof offerStatusSchema>;
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};

export const placementStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'TERMINATED',
]);
export type PlacementStatus = z.infer<typeof placementStatusSchema>;
export const PLACEMENT_STATUS_LABELS: Record<PlacementStatus, string> = {
  PENDING: 'Pending',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  TERMINATED: 'Terminated',
};

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const candidateSourceSchema = z.enum([
  'LINKEDIN',
  'INDEED',
  'JOB_BOARD',
  'REFERRAL',
  'WEBSITE',
  'AGENCY',
  'CAMPUS',
  'MANUAL',
  'IMPORT',
  'OTHER',
]);
export type CandidateSource = z.infer<typeof candidateSourceSchema>;
export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  LINKEDIN: 'LinkedIn',
  INDEED: 'Indeed',
  JOB_BOARD: 'Job board',
  REFERRAL: 'Referral',
  WEBSITE: 'Website',
  AGENCY: 'Agency',
  CAMPUS: 'Campus',
  MANUAL: 'Added manually',
  IMPORT: 'Imported',
  OTHER: 'Other',
};

export const workAuthorizationSchema = z.enum([
  'CITIZEN',
  'PERMANENT_RESIDENT',
  'WORK_VISA',
  'STUDENT_VISA',
  'REQUIRES_SPONSORSHIP',
  'UNKNOWN',
  'OTHER',
]);
export type WorkAuthorization = z.infer<typeof workAuthorizationSchema>;
export const WORK_AUTHORIZATION_LABELS: Record<WorkAuthorization, string> = {
  CITIZEN: 'Citizen',
  PERMANENT_RESIDENT: 'Permanent resident',
  WORK_VISA: 'Work visa',
  STUDENT_VISA: 'Student visa',
  REQUIRES_SPONSORSHIP: 'Requires sponsorship',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};

export const availabilitySchema = z.enum([
  'IMMEDIATE',
  'TWO_WEEKS',
  'ONE_MONTH',
  'TWO_MONTHS',
  'THREE_MONTHS',
  'NOT_LOOKING',
]);
export type Availability = z.infer<typeof availabilitySchema>;
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  IMMEDIATE: 'Immediately',
  TWO_WEEKS: '2 weeks',
  ONE_MONTH: '1 month',
  TWO_MONTHS: '2 months',
  THREE_MONTHS: '3 months',
  NOT_LOOKING: 'Not looking',
};

export const resumeParseStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'NEEDS_OCR',
]);
export type ResumeParseStatus = z.infer<typeof resumeParseStatusSchema>;
export const RESUME_PARSE_STATUS_LABELS: Record<ResumeParseStatus, string> = {
  PENDING: 'Queued',
  PROCESSING: 'Parsing',
  COMPLETED: 'Parsed',
  FAILED: 'Failed',
  NEEDS_OCR: 'Needs OCR',
};

/**
 * Behavioural bucket for a pipeline stage. Stage names and order are tenant
 * configuration, but `category` stays fixed so reporting and the rejection
 * dialog behave identically in every workspace.
 */
export const stageCategorySchema = z.enum(['ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN']);
export type StageCategory = z.infer<typeof stageCategorySchema>;
export const STAGE_CATEGORY_LABELS: Record<StageCategory, string> = {
  ACTIVE: 'Active',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const skillProficiencySchema = z.enum([
  'BASIC',
  'CONVERSATIONAL',
  'PROFESSIONAL',
  'NATIVE',
]);
export type SkillProficiency = z.infer<typeof skillProficiencySchema>;
export const SKILL_PROFICIENCY_LABELS: Record<SkillProficiency, string> = {
  BASIC: 'Basic',
  CONVERSATIONAL: 'Conversational',
  PROFESSIONAL: 'Professional',
  NATIVE: 'Native',
};

export const bulkOperationTypeSchema = z.enum([
  'CANDIDATE_TAGS',
  'CANDIDATE_OWNER',
  'CANDIDATE_STATUS',
  'CANDIDATE_ADD_TO_JOB',
  'CANDIDATE_ADD_TO_LIST',
  'CANDIDATE_DELETE',
  'CANDIDATE_EXPORT',
  'JOB_STATUS',
  'JOB_PRIORITY',
  'JOB_ASSIGN_RECRUITERS',
]);
export type BulkOperationType = z.infer<typeof bulkOperationTypeSchema>;
export const BULK_OPERATION_TYPE_LABELS: Record<BulkOperationType, string> = {
  CANDIDATE_TAGS: 'Update tags',
  CANDIDATE_OWNER: 'Change owner',
  CANDIDATE_STATUS: 'Change status',
  CANDIDATE_ADD_TO_JOB: 'Add to job',
  CANDIDATE_ADD_TO_LIST: 'Add to hotlist',
  CANDIDATE_DELETE: 'Delete candidates',
  CANDIDATE_EXPORT: 'Export candidates',
  JOB_STATUS: 'Change job status',
  JOB_PRIORITY: 'Change job priority',
  JOB_ASSIGN_RECRUITERS: 'Assign recruiters',
};

export const bulkOperationStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export type BulkOperationStatus = z.infer<typeof bulkOperationStatusSchema>;
export const BULK_OPERATION_STATUS_LABELS: Record<BulkOperationStatus, string> = {
  PENDING: 'Queued',
  PROCESSING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export const experienceLevelSchema = z.enum([
  'INTERN',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
  'PRINCIPAL',
  'EXECUTIVE',
]);
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export const activityTypeSchema = z.enum([
  'CALL',
  'EMAIL',
  'MEETING',
  'NOTE',
  'SMS',
  'LINKEDIN',
  'TASK',
  'INTERVIEW',
  'SUBMISSION',
  'STAGE_CHANGE',
  'SYSTEM',
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  NOTE: 'Note',
  SMS: 'SMS',
  LINKEDIN: 'LinkedIn',
  TASK: 'Task',
  INTERVIEW: 'Interview',
  SUBMISSION: 'Submission',
  STAGE_CHANGE: 'Stage change',
  SYSTEM: 'System',
};

export const activityDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type ActivityDirection = z.infer<typeof activityDirectionSchema>;

export const taskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const emailMessageStatusSchema = z.enum([
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'RECEIVED',
]);
export type EmailMessageStatus = z.infer<typeof emailMessageStatusSchema>;

export const notificationChannelSchema = z.enum(['IN_APP', 'EMAIL']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

// ---------------------------------------------------------------------------
// Extensibility
// ---------------------------------------------------------------------------

export const customFieldEntitySchema = z.enum(['CANDIDATE', 'JOB', 'CLIENT', 'CONTACT']);
export type CustomFieldEntity = z.infer<typeof customFieldEntitySchema>;

export const customFieldTypeSchema = z.enum([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CURRENCY',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
  'URL',
  'EMAIL',
  'PHONE',
]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const importEntityTypeSchema = z.enum(['CANDIDATE', 'CLIENT', 'JOB', 'CONTACT']);
export type ImportEntityType = z.infer<typeof importEntityTypeSchema>;

export const importStatusSchema = z.enum([
  'PENDING',
  'MAPPING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type ImportStatus = z.infer<typeof importStatusSchema>;

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export const auditActionSchema = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'VIEW',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'EXPORT',
  'IMPORT',
  'IMPERSONATE',
  'INVITE',
  'PASSWORD_RESET',
  'PERMISSION_CHANGE',
  'STATUS_CHANGE',
]);
export type AuditAction = z.infer<typeof auditActionSchema>;
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  RESTORE: 'Restored',
  VIEW: 'Viewed',
  LOGIN: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  LOGOUT: 'Signed out',
  EXPORT: 'Exported',
  IMPORT: 'Imported',
  IMPERSONATE: 'Impersonated',
  INVITE: 'Invited',
  PASSWORD_RESET: 'Password reset',
  PERMISSION_CHANGE: 'Permission change',
  STATUS_CHANGE: 'Status change',
};
