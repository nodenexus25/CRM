import type { RoleKey } from './enums';

/**
 * Permission catalogue.
 *
 * Keys follow `resource:action`. The `_all` / `_own` suffix pair carries
 * record-level scoping: a user with `candidate:read_own` only sees candidates
 * they own or are assigned to, while `candidate:read_all` sees the whole tenant.
 * Services translate this through `scopeFilter()`.
 */
export interface PermissionDefinition {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly description: string;
}

export const PERMISSIONS = [
  // --- Workspace -----------------------------------------------------------
  {
    key: 'tenant:read',
    group: 'Workspace',
    label: 'View workspace settings',
    description: 'Read company profile, branding and workspace configuration.',
  },
  {
    key: 'tenant:update',
    group: 'Workspace',
    label: 'Update workspace settings',
    description: 'Edit company profile, branding, timezone, currency and date format.',
  },
  {
    key: 'tenant:manage_settings',
    group: 'Workspace',
    label: 'Manage workspace configuration',
    description: 'Edit pipeline stages, custom fields, email templates and integrations.',
  },
  {
    key: 'tenant:delete',
    group: 'Workspace',
    label: 'Delete workspace',
    description: 'Permanently delete the workspace and all of its data.',
  },

  // --- Users & roles -------------------------------------------------------
  { key: 'user:read', group: 'Users & roles', label: 'View users', description: 'List and read user profiles.' },
  { key: 'user:invite', group: 'Users & roles', label: 'Invite users', description: 'Send workspace invitations.' },
  { key: 'user:update', group: 'Users & roles', label: 'Update users', description: 'Change user details, status and team membership.' },
  { key: 'user:delete', group: 'Users & roles', label: 'Remove users', description: 'Deactivate or remove users from the workspace.' },
  { key: 'role:read', group: 'Users & roles', label: 'View roles', description: 'List roles and their permissions.' },
  { key: 'role:manage', group: 'Users & roles', label: 'Manage roles', description: 'Create roles and change permission assignments.' },

  // --- Clients & contacts --------------------------------------------------
  { key: 'client:read_all', group: 'Clients', label: 'View all clients', description: 'Read every client in the workspace.' },
  { key: 'client:read_own', group: 'Clients', label: 'View own clients', description: 'Read only clients they own.' },
  { key: 'client:create', group: 'Clients', label: 'Create clients', description: 'Add new client companies.' },
  { key: 'client:update', group: 'Clients', label: 'Update clients', description: 'Edit client records.' },
  { key: 'client:delete', group: 'Clients', label: 'Delete clients', description: 'Soft-delete client records.' },
  { key: 'contact:read_all', group: 'Clients', label: 'View all contacts', description: 'Read every client contact.' },
  { key: 'contact:read_own', group: 'Clients', label: 'View own contacts', description: 'Read contacts for clients they own.' },
  { key: 'contact:create', group: 'Clients', label: 'Create contacts', description: 'Add client contacts.' },
  { key: 'contact:update', group: 'Clients', label: 'Update contacts', description: 'Edit client contacts.' },
  { key: 'contact:delete', group: 'Clients', label: 'Delete contacts', description: 'Remove client contacts.' },

  // --- Jobs ----------------------------------------------------------------
  { key: 'job:read_all', group: 'Jobs', label: 'View all jobs', description: 'Read every requisition in the workspace.' },
  { key: 'job:read_own', group: 'Jobs', label: 'View assigned jobs', description: 'Read jobs they own or are assigned to.' },
  { key: 'job:create', group: 'Jobs', label: 'Create jobs', description: 'Create requisitions.' },
  { key: 'job:update', group: 'Jobs', label: 'Update jobs', description: 'Edit requisition details and status.' },
  { key: 'job:delete', group: 'Jobs', label: 'Delete jobs', description: 'Soft-delete requisitions.' },
  { key: 'job:assign', group: 'Jobs', label: 'Assign recruiters', description: 'Add or remove recruiters on a job.' },
  { key: 'job:clone', group: 'Jobs', label: 'Clone jobs', description: 'Duplicate an existing requisition.' },
  { key: 'job:bulk_update', group: 'Jobs', label: 'Bulk update jobs', description: 'Change status, priority or recruiters on many jobs at once.' },
  { key: 'job:publish', group: 'Jobs', label: 'Publish jobs', description: 'Publish requisitions to job boards and the careers page.' },

  // --- Pipeline configuration ----------------------------------------------
  { key: 'pipeline:read', group: 'Pipeline', label: 'View pipeline settings', description: 'Read pipeline stages and rejection reasons.' },
  { key: 'pipeline:manage', group: 'Pipeline', label: 'Manage pipeline settings', description: 'Create, reorder, edit and delete pipeline stages and rejection reasons.' },

  // --- Candidates ----------------------------------------------------------
  { key: 'candidate:read_all', group: 'Candidates', label: 'View all candidates', description: 'Read every candidate in the workspace.' },
  { key: 'candidate:read_own', group: 'Candidates', label: 'View own candidates', description: 'Read candidates they own.' },
  { key: 'candidate:create', group: 'Candidates', label: 'Create candidates', description: 'Add candidates manually or by resume upload.' },
  { key: 'candidate:update', group: 'Candidates', label: 'Update candidates', description: 'Edit candidate profiles.' },
  { key: 'candidate:delete', group: 'Candidates', label: 'Delete candidates', description: 'Soft-delete candidate records.' },
  { key: 'candidate:merge', group: 'Candidates', label: 'Merge duplicates', description: 'Merge duplicate candidate records.' },
  { key: 'candidate:export', group: 'Candidates', label: 'Export candidates', description: 'Export candidate data to CSV.' },
  { key: 'candidate:import', group: 'Candidates', label: 'Import candidates', description: 'Import candidates from CSV/Excel files.' },
  { key: 'candidate:bulk_update', group: 'Candidates', label: 'Bulk update candidates', description: 'Apply tags, owner, status and list changes to many candidates at once.' },
  {
    key: 'candidate:view_pii',
    group: 'Candidates',
    label: 'View candidate contact details',
    description: 'See email, phone and address. Used to keep PII from downstream reviewers.',
  },

  // --- Talent pools --------------------------------------------------------
  { key: 'list:read', group: 'Talent pools', label: 'View hotlists', description: 'Read hotlists and talent pools.' },
  { key: 'list:manage', group: 'Talent pools', label: 'Manage hotlists', description: 'Create hotlists and add or remove candidates.' },

  // --- Applications & submissions -----------------------------------------
  { key: 'application:read_all', group: 'Applications', label: 'View all applications', description: 'Read every application.' },
  { key: 'application:read_own', group: 'Applications', label: 'View own applications', description: 'Read applications they own.' },
  { key: 'application:create', group: 'Applications', label: 'Add to pipeline', description: 'Add a candidate to a job pipeline.' },
  { key: 'application:update', group: 'Applications', label: 'Update applications', description: 'Edit application details.' },
  { key: 'application:move_stage', group: 'Applications', label: 'Move pipeline stage', description: 'Drag candidates between pipeline stages.' },
  { key: 'application:delete', group: 'Applications', label: 'Remove from pipeline', description: 'Remove a candidate from a pipeline.' },
  { key: 'submission:send', group: 'Applications', label: 'Submit to client', description: 'Send a formatted candidate submission to a client contact.' },

  // --- Interviews ----------------------------------------------------------
  { key: 'interview:read', group: 'Interviews', label: 'View interviews', description: 'Read interview schedules and feedback.' },
  { key: 'interview:create', group: 'Interviews', label: 'Schedule interviews', description: 'Create interview records and invite participants.' },
  { key: 'interview:update', group: 'Interviews', label: 'Update interviews', description: 'Reschedule or edit interviews.' },
  { key: 'interview:delete', group: 'Interviews', label: 'Cancel interviews', description: 'Delete interview records.' },
  { key: 'interview:feedback', group: 'Interviews', label: 'Submit feedback', description: 'Record interview feedback and ratings.' },

  // --- Offers & placements -------------------------------------------------
  { key: 'offer:read', group: 'Offers & placements', label: 'View offers', description: 'Read offer records.' },
  { key: 'offer:create', group: 'Offers & placements', label: 'Create offers', description: 'Raise offers for candidates.' },
  { key: 'offer:update', group: 'Offers & placements', label: 'Update offers', description: 'Edit offer details and status.' },
  { key: 'offer:delete', group: 'Offers & placements', label: 'Delete offers', description: 'Delete offer records.' },
  { key: 'placement:read_all', group: 'Offers & placements', label: 'View all placements', description: 'Read every placement.' },
  { key: 'placement:read_own', group: 'Offers & placements', label: 'View own placements', description: 'Read placements they own.' },
  { key: 'placement:create', group: 'Offers & placements', label: 'Create placements', description: 'Convert an accepted offer into a placement.' },
  { key: 'placement:update', group: 'Offers & placements', label: 'Update placements', description: 'Edit placements, rates and dates.' },
  { key: 'placement:delete', group: 'Offers & placements', label: 'Delete placements', description: 'Delete placement records.' },
  { key: 'placement:view_margin', group: 'Offers & placements', label: 'View margins', description: 'See pay rate, bill rate and margin calculations.' },

  // --- Engagement ----------------------------------------------------------
  { key: 'activity:read', group: 'Engagement', label: 'View activities', description: 'Read calls, emails, meetings and notes.' },
  { key: 'activity:create', group: 'Engagement', label: 'Log activities', description: 'Log calls, emails, meetings and notes.' },
  { key: 'activity:update', group: 'Engagement', label: 'Update activities', description: 'Edit logged activities.' },
  { key: 'activity:delete', group: 'Engagement', label: 'Delete activities', description: 'Delete logged activities.' },
  { key: 'task:read', group: 'Engagement', label: 'View tasks', description: 'Read tasks.' },
  { key: 'task:create', group: 'Engagement', label: 'Create tasks', description: 'Create tasks and reminders.' },
  { key: 'task:update', group: 'Engagement', label: 'Update tasks', description: 'Edit, complete or reassign tasks.' },
  { key: 'task:delete', group: 'Engagement', label: 'Delete tasks', description: 'Delete tasks.' },
  { key: 'task:assign', group: 'Engagement', label: 'Assign tasks', description: 'Assign tasks to other users.' },
  { key: 'note:read', group: 'Engagement', label: 'View notes', description: 'Read notes on records.' },
  { key: 'note:create', group: 'Engagement', label: 'Create notes', description: 'Add notes to records.' },
  { key: 'note:update', group: 'Engagement', label: 'Update notes', description: 'Edit own notes.' },
  { key: 'note:delete', group: 'Engagement', label: 'Delete notes', description: 'Delete notes.' },

  // --- Email & files -------------------------------------------------------
  { key: 'email:send', group: 'Email & files', label: 'Send email', description: 'Send email from the app.' },
  { key: 'email:template_read', group: 'Email & files', label: 'View email templates', description: 'Browse email templates.' },
  { key: 'email:template_manage', group: 'Email & files', label: 'Manage email templates', description: 'Create and edit email templates.' },
  { key: 'attachment:read', group: 'Email & files', label: 'View attachments', description: 'Download resumes and attachments.' },
  { key: 'attachment:upload', group: 'Email & files', label: 'Upload attachments', description: 'Upload files to records.' },
  { key: 'attachment:delete', group: 'Email & files', label: 'Delete attachments', description: 'Delete uploaded files.' },

  // --- Data & reporting ----------------------------------------------------
  { key: 'import:create', group: 'Data & reporting', label: 'Import data', description: 'Run CSV/Excel imports.' },
  { key: 'export:create', group: 'Data & reporting', label: 'Export data', description: 'Export any list to CSV.' },
  { key: 'report:view_own', group: 'Data & reporting', label: 'View own reports', description: 'See personal performance metrics.' },
  { key: 'report:view_team', group: 'Data & reporting', label: 'View team reports', description: 'See performance metrics for teams.' },
  { key: 'report:view_all', group: 'Data & reporting', label: 'View company reports', description: 'See workspace-wide metrics and revenue.' },
  { key: 'report:export', group: 'Data & reporting', label: 'Export reports', description: 'Download report data as CSV.' },
  { key: 'saved_search:manage', group: 'Data & reporting', label: 'Manage saved views', description: 'Create and share saved table views.' },

  // --- Billing & governance ------------------------------------------------
  { key: 'billing:read', group: 'Billing & governance', label: 'View billing', description: 'See the current plan, usage and invoices.' },
  { key: 'billing:manage', group: 'Billing & governance', label: 'Manage billing', description: 'Change plan, payment method and seats.' },
  { key: 'audit:read', group: 'Billing & governance', label: 'View audit log', description: 'Read the workspace audit trail.' },

  // --- AI ------------------------------------------------------------------
  { key: 'ai:use', group: 'AI', label: 'Use AI features', description: 'Run AI matching, summaries and JD generation.' },

  // --- Platform (super admin only) ----------------------------------------
  { key: 'platform:tenant_read', group: 'Platform', label: 'View all tenants', description: 'Platform-wide tenant directory and usage.' },
  { key: 'platform:tenant_manage', group: 'Platform', label: 'Manage tenants', description: 'Suspend, resume or delete any tenant.' },
  { key: 'platform:impersonate', group: 'Platform', label: 'Impersonate tenant', description: 'Act on behalf of a tenant (fully audited).' },
  { key: 'platform:billing_read', group: 'Platform', label: 'View platform revenue', description: 'See MRR, plans and platform invoices.' },
  { key: 'platform:flag_manage', group: 'Platform', label: 'Manage feature flags', description: 'Enable or disable features per tenant.' },
  { key: 'platform:audit_read', group: 'Platform', label: 'View platform audit log', description: 'Read cross-tenant audit events.' },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

/** Permission keys that only a platform operator may ever hold. */
export const PLATFORM_PERMISSION_KEYS: readonly PermissionKey[] = ALL_PERMISSION_KEYS.filter((k) =>
  k.startsWith('platform:'),
);

/** Everything a tenant-admin role can possibly hold. */
export const TENANT_PERMISSION_KEYS: readonly PermissionKey[] = ALL_PERMISSION_KEYS.filter(
  (k) => !k.startsWith('platform:'),
);

export function permissionsByGroup(): { group: string; permissions: PermissionDefinition[] }[] {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const permission of PERMISSIONS) {
    const bucket = groups.get(permission.group) ?? [];
    bucket.push(permission);
    groups.set(permission.group, bucket);
  }
  return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }));
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(value);
}

const READ_ONLY_SUFFIXES = ['read', 'view', 'read_all', 'read_own', 'view_own', 'view_team', 'view_all'];

function isReadPermission(key: PermissionKey): boolean {
  const action = key.slice(key.indexOf(':') + 1);
  return READ_ONLY_SUFFIXES.includes(action);
}

/**
 * Built-in role templates. These are materialised as rows per tenant at signup
 * and can then be customised freely — `Role.isSystem` protects them from deletion
 * but not from permission edits.
 */
export const ROLE_PERMISSION_TEMPLATES: Record<RoleKey, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,

  TENANT_ADMIN: TENANT_PERMISSION_KEYS,

  RECRUITER_MANAGER: TENANT_PERMISSION_KEYS.filter(
    (key) =>
      key !== 'tenant:delete' &&
      key !== 'billing:manage' &&
      key !== 'role:manage' &&
      key !== 'user:delete',
  ),

  RECRUITER: [
    'tenant:read',
    'user:read',
    'client:read_all',
    'contact:read_all',
    'job:read_all',
    'job:create',
    'job:update',
    'job:clone',
    'job:bulk_update',
    'pipeline:read',
    'candidate:read_all',
    'candidate:create',
    'candidate:update',
    'candidate:export',
    'candidate:import',
    'candidate:bulk_update',
    'candidate:view_pii',
    'list:read',
    'list:manage',
    'application:read_all',
    'application:create',
    'application:update',
    'application:move_stage',
    'submission:send',
    'interview:read',
    'interview:create',
    'interview:update',
    'interview:feedback',
    'offer:read',
    'offer:create',
    'placement:read_all',
    'placement:create',
    'activity:read',
    'activity:create',
    'activity:update',
    'task:read',
    'task:create',
    'task:update',
    'task:assign',
    'note:read',
    'note:create',
    'note:update',
    'email:send',
    'email:template_read',
    'attachment:read',
    'attachment:upload',
    'import:create',
    'export:create',
    'report:view_own',
    'saved_search:manage',
    'ai:use',
  ],

  ACCOUNT_MANAGER: [
    'tenant:read',
    'user:read',
    'client:read_all',
    'client:create',
    'client:update',
    'contact:read_all',
    'contact:create',
    'contact:update',
    'job:read_all',
    'job:create',
    'job:update',
    'job:clone',
    'job:assign',
    'pipeline:read',
    'candidate:read_all',
    'candidate:create',
    'candidate:update',
    'candidate:view_pii',
    'list:read',
    'list:manage',
    'application:read_all',
    'application:create',
    'application:update',
    'submission:send',
    'interview:read',
    'interview:create',
    'interview:update',
    'interview:feedback',
    'offer:read',
    'offer:create',
    'offer:update',
    'placement:read_all',
    'placement:create',
    'activity:read',
    'activity:create',
    'activity:update',
    'task:read',
    'task:create',
    'task:update',
    'note:read',
    'note:create',
    'note:update',
    'email:send',
    'email:template_read',
    'attachment:read',
    'attachment:upload',
    'export:create',
    'report:view_own',
    'report:view_team',
    'saved_search:manage',
  ],

  VIEWER: ALL_PERMISSION_KEYS.filter(
    (key) => !key.startsWith('platform:') && isReadPermission(key),
  ),
};

/**
 * Resolution priority for the built-in role templates — higher wins when a user
 * holds several roles. Shared so the API's tenant provisioning and the seed
 * script can never drift apart.
 */
export const ROLE_PRIORITY: Record<RoleKey, number> = {
  SUPER_ADMIN: 100,
  TENANT_ADMIN: 90,
  RECRUITER_MANAGER: 70,
  RECRUITER: 50,
  ACCOUNT_MANAGER: 40,
  VIEWER: 10,
};

/** Roles provisioned inside every workspace (everything except SUPER_ADMIN). */
export const TENANT_ROLE_KEYS = [
  'TENANT_ADMIN',
  'RECRUITER_MANAGER',
  'RECRUITER',
  'ACCOUNT_MANAGER',
  'VIEWER',
] as const satisfies readonly RoleKey[];

/**
 * Default pipeline created for every new workspace, in order.
 *
 * `category` drives stage behaviour (the rejection dialog, the placement
 * prompt) and must stay in sync with `isTerminal`: only `HIRED`, `REJECTED` and
 * `WITHDRAWN` stages may be terminal.
 */
export const DEFAULT_PIPELINE_STAGES = [
  { key: 'sourced', name: 'Sourced', type: 'SOURCING', category: 'ACTIVE', color: '#64748b', isDefault: true },
  { key: 'screening', name: 'Screening', type: 'SCREENING', category: 'ACTIVE', color: '#0ea5e9', slaDays: 3 },
  { key: 'submitted', name: 'Submitted to client', type: 'SUBMISSION', category: 'ACTIVE', color: '#6366f1', slaDays: 5 },
  { key: 'client-review', name: 'Client review', type: 'CLIENT_REVIEW', category: 'ACTIVE', color: '#8b5cf6', slaDays: 7 },
  { key: 'interview', name: 'Interview', type: 'INTERVIEW', category: 'ACTIVE', color: '#f59e0b', slaDays: 7 },
  { key: 'offer', name: 'Offer', type: 'OFFER', category: 'ACTIVE', color: '#14b8a6', slaDays: 5 },
  { key: 'placed', name: 'Placed', type: 'PLACEMENT', category: 'HIRED', color: '#22c55e', isTerminal: true },
  { key: 'rejected', name: 'Rejected', type: 'REJECTED', category: 'REJECTED', color: '#ef4444', isTerminal: true },
  { key: 'withdrawn', name: 'Withdrawn', type: 'WITHDRAWN', category: 'WITHDRAWN', color: '#94a3b8', isTerminal: true },
] as const;
