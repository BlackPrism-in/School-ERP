import type { Tx } from '../db/client.js'

/**
 * Explicit audit entries.
 *
 * Row *changes* are captured automatically by the triggers in migration 0009
 * — do not duplicate those here. This is for events that have no row to
 * trigger on: logins, failed logins, sign-outs, and reads of sensitive data
 * (Postgres has no SELECT trigger, and DPDP expects a school to be able to
 * say who looked at a child's record).
 */
export type AuditEvent = {
  action:
    | 'login'
    | 'login_failed'
    | 'logout'
    | 'password_changed'
    | 'password_reset_requested'
    | 'password_reset_completed'
    | 'mfa_enrolled'
    | 'mfa_failed'
    | 'sensitive_read'
    | 'export'
  entityType: string
  entityId?: string | null
  actorUserId?: string | null
  actorLabel?: string | null
  detail?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export async function writeAudit(tx: Tx, event: AuditEvent): Promise<void> {
  await tx`
    insert into audit_log (tenant_id, actor_user_id, actor_label, action, entity_type,
                           entity_id, after_data, ip, user_agent, request_id)
    values (app_current_tenant(), ${event.actorUserId ?? null}, ${event.actorLabel ?? null},
            ${event.action}, ${event.entityType}, ${event.entityId ?? null},
            ${event.detail ? JSON.stringify(event.detail) : null}::jsonb,
            ${event.ip ?? null}, ${event.userAgent ?? null}, ${event.requestId ?? null})
  `
}
