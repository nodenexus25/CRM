import type {
  ActivityQuery,
  ApplicationQuery,
  BoardQuery,
  BulkOperationQuery,
  CandidateListQuery,
  CandidateQuery,
  ClientQuery,
  DuplicateCheckRequest,
  EmailMessageQuery,
  EmailTemplateQuery,
  ImportJobQuery,
  InterviewCalendarQuery,
  InterviewQuery,
  JobQuery,
  NoteQuery,
  NotificationQuery,
  OfferQuery,
  PlacementQuery,
  RejectionReasonQuery,
  ResumeQuery,
  RoleQuery,
  SavedViewQuery,
  SubmissionQuery,
  TaskQuery,
  UserQuery,
} from '@talentflow/types';

/**
 * Centralised cache keys.
 *
 * Every key is a plain array so it can be serialised into the devtools, and
 * every list key is namespaced by its query object so changing a filter or page
 * produces a distinct cache entry instead of clobbering another view.
 */
export const queryKeys = {
  session: ['session'] as const,

  notifications: {
    all: ['notifications'] as const,
    summary: ['notifications', 'summary'] as const,
    list: (query: Partial<NotificationQuery>) => ['notifications', 'list', query] as const,
  },

  users: {
    all: ['users'] as const,
    list: (query: Partial<UserQuery>) => ['users', 'list', query] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
    permissions: (id: string) => ['users', 'permissions', id] as const,
  },

  roles: {
    all: ['roles'] as const,
    list: (query: Partial<RoleQuery>) => ['roles', 'list', query] as const,
    detail: (id: string) => ['roles', 'detail', id] as const,
    catalogue: ['roles', 'catalogue'] as const,
  },

  teams: {
    all: ['teams'] as const,
    list: ['teams', 'list'] as const,
  },

  workspace: {
    detail: ['workspace', 'detail'] as const,
  },

  pipeline: {
    all: ['pipeline'] as const,
    stages: ['pipeline', 'stages'] as const,
    /** A single job's own stage set — keyed by job so each editor caches apart. */
    jobStages: (jobId: string) => ['pipeline', 'job', jobId] as const,
    rejectionReasons: (query: Partial<RejectionReasonQuery>) =>
      ['pipeline', 'rejection-reasons', query] as const,
  },

  search: {
    all: ['search'] as const,
    global: (term: string) => ['search', 'global', term] as const,
  },

  jobs: {
    all: ['jobs'] as const,
    list: (query: Partial<JobQuery>) => ['jobs', 'list', query] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
    stats: (id: string) => ['jobs', 'stats', id] as const,
    pipeline: (id: string) => ['jobs', 'pipeline', id] as const,
  },

  clients: {
    all: ['clients'] as const,
    list: (query: Partial<ClientQuery>) => ['clients', 'list', query] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
    contacts: (clientId: string) => ['clients', 'contacts', clientId] as const,
    stats: ['clients', 'stats'] as const,
  },

  applications: {
    all: ['applications'] as const,
    list: (query: Partial<ApplicationQuery>) => ['applications', 'list', query] as const,
    board: (jobId: string, query: Partial<BoardQuery>) =>
      ['applications', 'board', jobId, query] as const,
    detail: (id: string) => ['applications', 'detail', id] as const,
  },

  submissions: {
    all: ['submissions'] as const,
    list: (query: Partial<SubmissionQuery>) => ['submissions', 'list', query] as const,
    /** A submission is addressed by its application id. */
    detail: (applicationId: string) => ['submissions', 'detail', applicationId] as const,
  },

  interviews: {
    all: ['interviews'] as const,
    list: (query: Partial<InterviewQuery>) => ['interviews', 'list', query] as const,
    detail: (id: string) => ['interviews', 'detail', id] as const,
    calendar: (query: Partial<InterviewCalendarQuery>) => ['interviews', 'calendar', query] as const,
  },

  offers: {
    all: ['offers'] as const,
    list: (query: Partial<OfferQuery>) => ['offers', 'list', query] as const,
    detail: (id: string) => ['offers', 'detail', id] as const,
  },

  placements: {
    all: ['placements'] as const,
    list: (query: Partial<PlacementQuery>) => ['placements', 'list', query] as const,
    stats: (query: Partial<PlacementQuery>) => ['placements', 'stats', query] as const,
    detail: (id: string) => ['placements', 'detail', id] as const,
  },

  candidates: {
    all: ['candidates'] as const,
    list: (query: Partial<CandidateQuery>) => ['candidates', 'list', query] as const,
    detail: (id: string) => ['candidates', 'detail', id] as const,
    duplicates: (query: Partial<DuplicateCheckRequest>) => ['candidates', 'duplicates', query] as const,
  },

  resumes: {
    all: ['resumes'] as const,
    list: (query: Partial<ResumeQuery>) => ['resumes', 'list', query] as const,
    detail: (id: string) => ['resumes', 'detail', id] as const,
  },

  candidateLists: {
    all: ['candidate-lists'] as const,
    list: (query: Partial<CandidateListQuery>) => ['candidate-lists', 'list', query] as const,
    detail: (id: string) => ['candidate-lists', 'detail', id] as const,
  },

  bulkOperations: {
    all: ['bulk-operations'] as const,
    list: (query: Partial<BulkOperationQuery>) => ['bulk-operations', 'list', query] as const,
    detail: (id: string) => ['bulk-operations', 'detail', id] as const,
  },

  imports: {
    all: ['imports'] as const,
    list: (query: Partial<ImportJobQuery>) => ['imports', 'list', query] as const,
    detail: (id: string) => ['imports', 'detail', id] as const,
    templates: (entity?: string) => ['imports', 'templates', entity ?? 'all'] as const,
  },

  savedViews: {
    all: ['saved-views'] as const,
    list: (query: Partial<SavedViewQuery>) => ['saved-views', 'list', query] as const,
  },

  activities: {
    all: ['activities'] as const,
    list: (query: Partial<ActivityQuery>) => ['activities', 'list', query] as const,
  },

  tasks: {
    all: ['tasks'] as const,
    list: (query: Partial<TaskQuery>) => ['tasks', 'list', query] as const,
    myDay: ['tasks', 'my-day'] as const,
  },

  notes: {
    all: ['notes'] as const,
    list: (query: Partial<NoteQuery>) => ['notes', 'list', query] as const,
  },

  emailTemplates: {
    all: ['email-templates'] as const,
    list: (query: Partial<EmailTemplateQuery>) => ['email-templates', 'list', query] as const,
  },

  emailMessages: {
    all: ['email-messages'] as const,
    list: (query: Partial<EmailMessageQuery>) => ['email-messages', 'list', query] as const,
    detail: (id: string) => ['email-messages', 'detail', id] as const,
  },
} as const;
