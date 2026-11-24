import { $Enums } from '@prisma/client';
import {
  bulkOperationStatusSchema,
  bulkOperationTypeSchema,
  jobStatusSchema,
  resumeParseStatusSchema,
  roleKeySchema,
  skillProficiencySchema,
  stageCategorySchema,
  userStatusSchema,
} from '@talentflow/types';
import { z } from 'zod';

/**
 * Enum parity between the database and the shared contract.
 *
 * Prisma is the storage truth and `packages/types` is the API truth; a Zod enum
 * that silently loses a member shows up as a 422 on a value the database
 * accepts. This suite is the only thing standing between the two, so it covers
 * every enum Phase 2 introduced.
 */
function zodValues(schema: z.ZodEnum<[string, ...string[]]>): string[] {
  return [...schema.options].sort();
}

function databaseValues(enumeration: Record<string, string>): string[] {
  return Object.values(enumeration).sort();
}

describe('Enum parity: Prisma ↔ @talentflow/types', () => {
  const cases: [string, z.ZodEnum<[string, ...string[]]>, Record<string, string>][] = [
    ['RoleKey', roleKeySchema, $Enums.RoleKey],
    ['UserStatus', userStatusSchema, $Enums.UserStatus],
    ['JobStatus', jobStatusSchema, $Enums.JobStatus],
    ['ResumeParseStatus', resumeParseStatusSchema, $Enums.ResumeParseStatus],
    ['StageCategory', stageCategorySchema, $Enums.StageCategory],
    ['SkillProficiency', skillProficiencySchema, $Enums.SkillProficiency],
    ['BulkOperationType', bulkOperationTypeSchema, $Enums.BulkOperationType],
    ['BulkOperationStatus', bulkOperationStatusSchema, $Enums.BulkOperationStatus],
  ];

  it.each(cases)('%s matches the Prisma enum exactly', (_name, schema, enumeration) => {
    expect(zodValues(schema)).toEqual(databaseValues(enumeration));
  });
});
