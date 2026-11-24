/**
 * Every model that carries a `tenantId` column.
 *
 * The tenancy extension in `tenancy.extension.ts` uses this set to decide which
 * queries must be rewritten. A model missing from this list would be a silent
 * isolation hole, so the set is asserted against the generated Prisma client at
 * boot (`assertTenantModelCoverage`).
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  // Billing
  'Subscription',
  'Invoice',
  // Identity & access
  'User',
  'Role',
  'RolePermission',
  'UserRole',
  'Team',
  'TeamMember',
  'RefreshToken',
  'AuthToken',
  // CRM
  'Client',
  'ClientContact',
  // ATS
  'Skill',
  'Job',
  'JobPipelineStage',
  'JobAssignment',
  'JobSkill',
  // Candidates
  'Candidate',
  'CandidateResume',
  'CandidateEmail',
  'CandidatePhone',
  'CandidateExperience',
  'CandidateEducation',
  'CandidateSkill',
  'CandidateCertification',
  'CandidateLanguage',
  // Talent pools / hotlists
  'CandidateList',
  'CandidateListMember',
  // Applications
  'Application',
  'StageHistory',
  'Interview',
  'InterviewInterviewer',
  'Offer',
  'Placement',
  // Pipeline configuration
  'RejectionReason',
  'TenantSequence',
  // Engagement
  'Activity',
  'Task',
  'Note',
  'Attachment',
  'Tag',
  'TagLink',
  // Email & notifications
  'EmailTemplate',
  'EmailMessage',
  'Notification',
  // Extensibility
  'CustomField',
  'CustomFieldValue',
  'SavedSearch',
  'ImportJob',
  'ImportTemplate',
  'BulkOperation',
  // Governance
  'AuditLog',
  // AI
  'CandidateEmbedding',
]);

/**
 * Models that deliberately have no tenant scope. Anything not in either set is
 * reported by `assertTenantModelCoverage` so a new model cannot be added without
 * an explicit isolation decision.
 */
export const PLATFORM_MODELS: ReadonlySet<string> = new Set(['Plan', 'Tenant', 'Permission']);

/**
 * Fails fast when a Prisma model exists that is neither tenant-scoped nor an
 * explicit platform model. Without this guard a new `tenantId`-bearing model
 * added in a later phase would silently escape the extension.
 */
export function assertTenantModelCoverage(modelNames: readonly string[]): string[] {
  return modelNames.filter((name) => !TENANT_MODELS.has(name) && !PLATFORM_MODELS.has(name));
}
