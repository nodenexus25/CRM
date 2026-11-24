import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars from 'handlebars';
import nodemailer, { type Transporter } from 'nodemailer';

import { ServiceUnavailableError } from '@/common/errors/domain-errors';
import type { AppConfig } from '@/config/configuration';

/** Templates shipped in `src/infra/mail/templates`. */
export type MailTemplate = 'verify-email' | 'reset-password' | 'invite' | 'welcome' | 'password-changed';

export interface SendMailInput {
  to: string | string[];
  subject: string;
  template: MailTemplate;
  context?: Record<string, unknown>;
  replyTo?: string;
}

/**
 * A message whose subject and body the tenant composed itself. Unlike
 * `SendMailInput` nothing is rendered from a shipped `.hbs` file — the caller
 * owns the copy, and the merge fields were already resolved server-side.
 */
export interface SendRawMailInput {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

const TEMPLATE_DIR = join(__dirname, 'templates');

/**
 * Nodemailer + Handlebars. Locally every message lands in Mailpit
 * (`MAILPIT_UI_URL`), so no external SMTP account is needed to develop.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly appName: string;
  private readonly appUrl: string;
  /** Compiled templates, cached after first use. */
  private readonly cache = new Map<MailTemplate, Handlebars.TemplateDelegate>();

  constructor(config: ConfigService<AppConfig, true>) {
    const mail = config.get('mail', { infer: true });
    this.from = mail.from;
    this.appName = config.get('appName', { infer: true });
    this.appUrl = config.get('appUrl', { infer: true });

    this.transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
      // Local Mailpit speaks plain SMTP without TLS.
      tls: mail.secure ? undefined : { rejectUnauthorized: false },
    });
  }

  /** The envelope sender, so callers can record it against the message row. */
  get fromAddress(): string {
    return this.from;
  }

  async send(input: SendMailInput): Promise<void> {
    const html = this.render(input.template, {
      appName: this.appName,
      appUrl: this.appUrl,
      year: new Date().getFullYear(),
      ...input.context,
    });

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html,
        replyTo: input.replyTo,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send "${input.template}" email to ${String(input.to)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableError('We could not send that email. Please try again.', error);
    }
  }

  /**
   * Delivers a tenant-composed message. There is no template to render, so the
   * plain-text body is used as given and `html` is optional.
   */
  async sendRaw(input: SendRawMailInput): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        cc: input.cc?.length ? input.cc : undefined,
        bcc: input.bcc?.length ? input.bcc : undefined,
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: input.replyTo,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send composed message to ${String(input.to)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableError('We could not send that email. Please try again.', error);
    }
  }

  /** Used by the health module to prove SMTP is reachable. */
  async verifyConnection(): Promise<void> {
    await this.transporter.verify();
  }

  private render(template: MailTemplate, context: Record<string, unknown>): string {
    const compiled = this.cache.get(template) ?? this.compile(template);
    return compiled(context);
  }

  private compile(template: MailTemplate): Handlebars.TemplateDelegate {
    const file = join(TEMPLATE_DIR, `${template}.hbs`);
    const source = readFileSync(file, 'utf8');
    const compiled = Handlebars.compile(source, { strict: false });
    this.cache.set(template, compiled);
    return compiled;
  }
}
