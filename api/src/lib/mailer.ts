import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../env.js'

/**
 * Outbound email.
 *
 * Three drivers, because the failure modes differ:
 *
 *   smtp    — real delivery.
 *   console — prints to the log. Development only, and it prints the reset
 *             URL because that is the whole point locally.
 *   capture — keeps messages in memory for tests to assert on.
 *
 * A send failure never breaks the request that triggered it. If the mail
 * server is down, an admin creating a staff account should still get the
 * account created and the temporary password on screen — losing the whole
 * operation because a notification could not go out is worse than the
 * notification not going out.
 */

export type Mail = {
  to: string
  subject: string
  text: string
  html: string
}

export type SendResult = { delivered: boolean; error?: string }

const captured: Mail[] = []

/** Test-only. Returns everything the capture driver has collected. */
export function capturedMail(): readonly Mail[] {
  return captured
}
export function clearCapturedMail(): void {
  captured.length = 0
}

let transporter: Transporter | null = null

function smtpTransport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env().SMTP_HOST,
    port: env().SMTP_PORT,
    secure: env().SMTP_PORT === 465,
    auth: env().SMTP_USER ? { user: env().SMTP_USER, pass: env().SMTP_PASSWORD } : undefined,
  })
  return transporter
}

export async function sendMail(
  mail: Mail,
  log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
): Promise<SendResult> {
  const driver = env().MAIL_DRIVER

  try {
    if (driver === 'capture') {
      captured.push(mail)
      return { delivered: true }
    }

    if (driver === 'console') {
      log?.info({ to: mail.to, subject: mail.subject, body: mail.text }, 'email (console driver)')
      return { delivered: true }
    }

    await smtpTransport().sendMail({
      from: env().MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return { delivered: true }
  } catch (error) {
    // Logged, never thrown. See the note at the top.
    log?.error({ err: error, to: mail.to, subject: mail.subject }, 'email delivery failed')
    return { delivered: false, error: (error as Error).message }
  }
}

// ------------------------------------------------------------- templates

function layout(heading: string, body: string, action?: { label: string; url: string }) {
  const button = action
    ? `<p style="margin:26px 0"><a href="${action.url}" style="background:#5b4df7;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${action.label}</a></p>
       <p style="font-size:13px;color:#64748b">If the button does not work, paste this into your browser:<br><span style="word-break:break-all">${action.url}</span></p>`
    : ''

  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;padding:28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#20233a">
    <div style="max-width:560px;margin:auto;background:#fff;border-radius:14px;padding:32px">
      <p style="font-weight:800;font-size:18px;margin:0 0 24px">EduNova</p>
      <h1 style="font-size:20px;margin:0 0 14px">${heading}</h1>
      <div style="font-size:15px;line-height:1.6;color:#3f4256">${body}</div>
      ${button}
    </div>
    <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#8b8fa3;text-align:center">
      Sent by your school's EduNova system. If you were not expecting this, you can ignore it.
    </p>
  </body></html>`
}

export function passwordResetMail(input: { to: string; token: string; expiresMinutes: number }): Mail {
  const url = `${env().APP_URL}/reset-password?token=${encodeURIComponent(input.token)}`
  const text =
    `Someone asked to reset the password for your EduNova account.\n\n` +
    `Open this link to set a new one (it expires in ${input.expiresMinutes} minutes):\n${url}\n\n` +
    `If this was not you, you can ignore this email — your password has not changed.`

  return {
    to: input.to,
    subject: 'Reset your EduNova password',
    text,
    html: layout(
      'Reset your password',
      `<p>Someone asked to reset the password for your EduNova account.</p>
       <p>This link expires in <strong>${input.expiresMinutes} minutes</strong>. If it was not you, ignore this email — your password has not changed.</p>`,
      { label: 'Set a new password', url },
    ),
  }
}

export function accountCreatedMail(input: { to: string; displayName: string; schoolName: string }): Mail {
  const url = `${env().APP_URL}/login`
  const text =
    `Hello ${input.displayName},\n\n` +
    `An EduNova account has been created for you at ${input.schoolName}.\n\n` +
    `Sign in at: ${url}\n\n` +
    `Your temporary password has been given to you separately. You will be asked to ` +
    `change it the first time you sign in.`

  return {
    to: input.to,
    subject: `Your EduNova account at ${input.schoolName}`,
    text,
    // The temporary password is deliberately NOT in this email. It is shown
    // once on screen to the administrator, who hands it over directly —
    // emailing a credential puts it in a mailbox forever.
    html: layout(
      `Your account is ready`,
      `<p>Hello ${input.displayName},</p>
       <p>An EduNova account has been created for you at <strong>${input.schoolName}</strong>.</p>
       <p>Your temporary password has been given to you separately. You will be asked to change it the first time you sign in.</p>`,
      { label: 'Sign in', url },
    ),
  }
}
