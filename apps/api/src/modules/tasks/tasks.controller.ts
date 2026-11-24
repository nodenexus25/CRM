import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTaskSchema,
  idSchema,
  taskQuerySchema,
  updateTaskSchema,
  type CreateTaskRequest,
  type MyDay,
  type Paginated,
  type TaskListItem,
  type TaskQuery,
  type UpdateTaskRequest,
} from '@talentflow/types';
import { z } from 'zod';

import { Audit } from '@/common/decorators/audit.decorator';
import { RequirePermissions } from '@/common/decorators/require-permissions.decorator';
import { ZodBody, ZodParam, ZodQuery } from '@/common/decorators/zod.decorator';

import { TasksService } from './tasks.service';

const idParamSchema = z.object({ id: idSchema });

/**
 * Tasks — the daily to-do surface. Reads and writes are gated by `task:*`; the
 * service scopes every query to the tenant that `prisma.client` already applies.
 * Reassigning still requires `task:assign`, which the service re-checks because
 * merely holding `task:update` is not enough to hand work to someone else.
 */
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('task:read')
  @ApiOperation({ summary: 'List tasks with status, priority, assignee and date filters' })
  list(@ZodQuery(taskQuerySchema) query: TaskQuery): Promise<Paginated<TaskListItem>> {
    return this.tasks.list(query);
  }

  // Declared before the parameterised routes so the literal path wins the match.
  @Get('my-day')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: 'Everything on the caller’s plate today' })
  myDay(): Promise<MyDay> {
    return this.tasks.myDay();
  }

  @Post()
  @RequirePermissions('task:create')
  @Audit({ action: 'CREATE', entity: 'Task' })
  @ApiOperation({ summary: 'Create a task or reminder' })
  create(@ZodBody(createTaskSchema) body: CreateTaskRequest): Promise<TaskListItem> {
    return this.tasks.create(body);
  }

  @Patch(':id')
  @RequirePermissions('task:update')
  @Audit({ action: 'UPDATE', entity: 'Task' })
  @ApiOperation({ summary: 'Edit, complete or reassign a task' })
  update(
    @ZodParam(idParamSchema) params: { id: string },
    @ZodBody(updateTaskSchema) body: UpdateTaskRequest,
  ): Promise<TaskListItem> {
    return this.tasks.update(params.id, body);
  }

  @Post(':id/complete')
  @RequirePermissions('task:update')
  @Audit({ action: 'STATUS_CHANGE', entity: 'Task' })
  @ApiOperation({ summary: 'Mark a task complete' })
  complete(@ZodParam(idParamSchema) params: { id: string }): Promise<TaskListItem> {
    return this.tasks.complete(params.id);
  }

  @Delete(':id')
  @RequirePermissions('task:delete')
  @Audit({ action: 'DELETE', entity: 'Task' })
  @ApiOperation({ summary: 'Soft-delete a task' })
  remove(@ZodParam(idParamSchema) params: { id: string }): Promise<{ deleted: true }> {
    return this.tasks.remove(params.id);
  }
}
