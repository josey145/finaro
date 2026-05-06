const nodemailer = require('nodemailer');
require('dotenv').config();

// ─── Constants ────────────────────────────────────────────────────────────────
const SMTP_CONFIG = {
    host: 'mail.finaro.org',
    port: 465,
    secure: true,                      // SSL/TLS on port 465
    auth: {
        user: 'helpcenter@finaro.org',
        pass: process.env.SMTP_PASS    // Keep password in .env only
    },
    tls: {
        rejectUnauthorized: true       // Enforce valid SSL cert
    }
};

const FROM_ADDRESS  = `"${process.env.SITE_NAME || 'Finora Bank'}" <helpcenter@finaro.org>`;
const MAX_RETRIES   = 4;               // Total attempts per email
const RETRY_DELAYS  = [3000, 6000, 15000]; // ms between retries (3s, 6s, 15s)
const BASE_URL      = process.env.SITE_URL || 'https://choreal-pseudoregal-wynona.ngrok-free.dev';

// ─── Transporter ─────────────────────────────────────────────────────────────
let transporter = null;

const createTransporter = () => {
    const t = nodemailer.createTransport(SMTP_CONFIG);
    return t;
};

const getTransporter = () => {
    if (!transporter) {
        transporter = createTransporter();
    }
    return transporter;
};

// Verify connection on startup — recreate transporter on failure
const verifyConnection = async () => {
    try {
        const t = getTransporter();
        await t.verify();
        console.log('✅ SMTP Ready — helpcenter@finaro.org via mail.finaro.org:465');
        return true;
    } catch (err) {
        console.error('❌ SMTP verification failed:', err.message);
        transporter = null; // Force recreation on next send
        return false;
    }
};

// Run initial verification
verifyConnection();

// ─── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Core Send (with retry) ───────────────────────────────────────────────────
/**
 * Sends an email with automatic retry on failure.
 * Recreates the transporter on each retry to handle stale connections.
 */
const sendEmail = async (to, subject, html, attempt = 1) => {
    try {
        const t = getTransporter();
        const info = await t.sendMail({
            from:    FROM_ADDRESS,
            to,
            subject,
            html
        });

        console.log(`✉️  Email sent → ${to} | Subject: "${subject}" | MsgID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        const isLastAttempt = attempt >= MAX_RETRIES;

        console.error(
            `❌ Email attempt ${attempt}/${MAX_RETRIES} failed → ${to} | ${error.message}`
        );

        // Always recreate transporter after any failure (handles dropped connections)
        transporter = null;

        if (!isLastAttempt) {
            const delay = RETRY_DELAYS[attempt - 1] || 15000;
            console.log(`🔄 Retrying in ${delay / 1000}s…`);
            await sleep(delay);
            return sendEmail(to, subject, html, attempt + 1);
        }

        // All retries exhausted — log full details for debugging
        console.error('🚨 All retry attempts exhausted. Email NOT delivered.', {
            to,
            subject,
            errorCode:    error.code,
            errorMessage: error.message,
            timestamp:    new Date().toISOString()
        });

        return { success: false, error: error.message };
    }
};

// ─── Convenience wrapper (fire-and-forget with logging) ──────────────────────
/**
 * Use this when you don't need to await delivery confirmation.
 * Failures are fully logged but won't crash your app.
 */
const sendEmailSafe = (to, subject, html) => {
    sendEmail(to, subject, html).then(({ success, error }) => {
        if (!success) {
            console.error(`🚨 Final email failure logged: to=${to} subject="${subject}" error=${error}`);
        }
    }).catch((err) => {
        // Should never reach here due to internal try/catch, but just in case
        console.error('🚨 Unexpected sendEmail crash:', err.message);
    });
};

// ─── Email Templates ──────────────────────────────────────────────────────────
const header = `
    <div style="background:#0d9488;padding:30px;text-align:center;">
        <h1 style="color:white;margin:0;letter-spacing:2px;">FINORA BANK</h1>
    </div>`;

const footer = `
    <p style="color:#94a3b8;font-size:12px;margin-top:30px;text-align:center;">
        © Finora Bank · This is an automated message, please do not reply.
    </p>`;

const wrapper = (content) => `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px;background:#f8fafc;">
            ${content}
            ${footer}
        </div>
    </div>`;

// ─── Verification Email ───────────────────────────────────────────────────────
const sendVerificationEmail = async (email, token, name) => {
    const verificationUrl = `${BASE_URL}/auth/verify-email?token=${token}`;
    console.log('🔗 Verification URL:', verificationUrl);

    const html = wrapper(`
        <h2>Welcome, ${name}!</h2>
        <p>Click the button below to verify your email address:</p>
        <div style="text-align:center;margin:24px 0;">
            <a href="${verificationUrl}"
               style="display:inline-block;padding:14px 28px;background:#0d9488;
                      color:white;text-decoration:none;border-radius:8px;font-size:16px;">
                Verify Email
            </a>
        </div>
        <p style="word-break:break-all;color:#64748b;font-size:13px;">${verificationUrl}</p>
        <p><small>This link expires in <strong>24 hours</strong>.</small></p>
    `);

    return sendEmail(email, 'Verify Your Email — Finora Bank', html);
};

// ─── Welcome Email ────────────────────────────────────────────────────────────
const sendWelcomeEmail = async (email, name) => {
    const html = wrapper(`
        <h2>Welcome to Finora Bank, ${name}! 🎉</h2>
        <p>Your account is now active and ready to use.</p>
        <div style="text-align:center;margin:24px 0;">
            <a href="${BASE_URL}/auth/login"
               style="display:inline-block;padding:14px 28px;background:#0d9488;
                      color:white;text-decoration:none;border-radius:8px;font-size:16px;">
                Login Now
            </a>
        </div>
    `);

    return sendEmail(email, 'Welcome to Finora Bank!', html);
};

// ─── Withdrawal Code Email ────────────────────────────────────────────────────
const sendWithdrawalCode = async (email, code, name) => {
    const html = wrapper(`
        <h2>Hi ${name},</h2>
        <p>Your 7-digit withdrawal verification code is:</p>
        <div style="font-size:32px;letter-spacing:10px;color:#0d9488;font-weight:bold;
                    text-align:center;padding:20px;background:#f0fdfa;
                    border-radius:8px;margin:20px 0;">
            ${code}
        </div>
        <p><strong>⏱ Valid for 30 minutes only.</strong></p>
        <p style="color:#dc2626;font-size:13px;">
            Never share this code with anyone. Finora Bank will never ask for it.
        </p>
    `);

    return sendEmail(email, 'Your Withdrawal Code — Finora Bank', html);
};

// ─── Transaction Notification Email ──────────────────────────────────────────
const sendTransactionEmail = async (email, name, type, amount, description) => {
    const isCredit = type === 'admin_credit';
    const color    = isCredit ? '#16a34a' : '#dc2626';
    const icon     = isCredit ? '💰'      : '💸';
    const label    = isCredit ? 'Credit'  : 'Debit';
    const verb     = isCredit ? 'credited to' : 'deducted from';

    const formatted = parseFloat(amount).toLocaleString('en-US', {
        style: 'currency', currency: 'USD'
    });

    const html = wrapper(`
        <h2>Hi ${name}, ${icon} Account ${label}</h2>
        <p style="color:#64748b;">A transaction has been applied to your account.</p>

        <div style="background:white;border-radius:12px;padding:24px;
                    margin:20px 0;border-left:4px solid ${color};">
            <table style="width:100%;border-collapse:collapse;">
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:14px;">Type</td>
                    <td style="padding:8px 0;font-weight:700;color:${color};text-align:right;">${label}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:14px;">Amount</td>
                    <td style="padding:8px 0;font-weight:700;font-size:20px;color:${color};text-align:right;">${formatted}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:14px;">Description</td>
                    <td style="padding:8px 0;font-weight:600;text-align:right;">${description || 'N/A'}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:14px;">Date</td>
                    <td style="padding:8px 0;font-weight:600;text-align:right;">${new Date().toLocaleString()}</td>
                </tr>
            </table>
        </div>

        <p style="color:#64748b;font-size:14px;">
            ${formatted} has been ${verb} your Finora Bank account.
            If you did not authorize this, please contact support immediately.
        </p>
    `);

    return sendEmail(email, `${icon} Account ${label} — Finora Bank`, html);
};

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
    sendEmail,
    sendEmailSafe,
    sendVerificationEmail,
    sendWelcomeEmail,
    sendWithdrawalCode,
    sendTransactionEmail,
    verifyConnection
};