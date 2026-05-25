const nodemailer = require('nodemailer');
require('dotenv').config();

// ─── PRIMARY SMTP (Your mail.finaro.org) ────────────────────────────────────
const PRIMARY_CONFIG = {
    host: 'mail.finaro.org',
    port: 465,
    secure: true,
    auth: {
        user: 'helpcenter@finaro.org',
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
};

// ─── FALLBACK SMTP (Gmail) ─────────────────────────────────────────────────
const FALLBACK_CONFIG = {
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
};

// ─── Transporters ────────────────────────────────────────────────────────────
let primaryTransporter = null;
let fallbackTransporter = null;

const getPrimaryTransporter = () => {
    if (!primaryTransporter) {
        primaryTransporter = nodemailer.createTransport(PRIMARY_CONFIG);
    }
    return primaryTransporter;
};

const getFallbackTransporter = () => {
    if (!fallbackTransporter) {
        fallbackTransporter = nodemailer.createTransport(FALLBACK_CONFIG);
    }
    return fallbackTransporter;
};

// ─── Test which one works ─────────────────────────────────────────────────────
const testTransporters = async () => {
    try {
        const primary = getPrimaryTransporter();
        await primary.verify();
        console.log('✅ Primary SMTP Ready — mail.finaro.org');
        return 'primary';
    } catch (err) {
        console.log('⚠️ Primary SMTP failed:', err.message);
        try {
            const fallback = getFallbackTransporter();
            await fallback.verify();
            console.log('✅ Fallback SMTP Ready — Gmail');
            return 'fallback';
        } catch (err2) {
            console.log('❌ Both SMTPs failed:', err2.message);
            return null;
        }
    }
};

// Run test on startup
let activeTransporter = null;
testTransporters().then(result => {
    if (result === 'primary') activeTransporter = getPrimaryTransporter();
    else if (result === 'fallback') activeTransporter = getFallbackTransporter();
});

// ─── Send Email (auto-fallback) ─────────────────────────────────────────────
const sendEmail = async (to, subject, html, attempt = 1) => {
    const MAX_RETRIES = 3;
    
    try {
        // Use active transporter, or test again if none
        if (!activeTransporter) {
            const result = await testTransporters();
            activeTransporter = result === 'primary' ? getPrimaryTransporter() : 
                               result === 'fallback' ? getFallbackTransporter() : null;
        }

        if (!activeTransporter) {
            throw new Error('No working SMTP available');
        }

        const info = await activeTransporter.sendMail({
            from: `"${process.env.SITE_NAME || 'Ambrato Bank'}" <${activeTransporter === getFallbackTransporter() ? process.env.GMAIL_USER : 'helpcenter@finaro.org'}>`,
            to,
            subject,
            html
        });

        console.log(`✉️ Email sent → ${to} | Subject: "${subject}" | MsgID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error(`❌ Email attempt ${attempt} failed:`, error.message);
        
        // If primary failed, switch to fallback
        if (activeTransporter === getPrimaryTransporter() && attempt === 1) {
            console.log('🔄 Switching to Gmail fallback...');
            activeTransporter = getFallbackTransporter();
            return sendEmail(to, subject, html, attempt + 1);
        }

        if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 3000));
            return sendEmail(to, subject, html, attempt + 1);
        }

        return { success: false, error: error.message };
    }
};

// ─── Safe Send (fire-and-forget) ─────────────────────────────────────────────
const sendEmailSafe = (to, subject, html) => {
    sendEmail(to, subject, html).catch(err => {
        console.error('🚨 Email crash:', err.message);
    });
};

// ─── Templates & Exports (same as before) ──────────────────────────────────
const header = `
    <div style="background:#0d9488;padding:30px;text-align:center;">
        <h1 style="color:white;margin:0;letter-spacing:2px;">AMBRATO BANK</h1>
    </div>`;

const footer = `
    <p style="color:#94a3b8;font-size:12px;margin-top:30px;text-align:center;">
        © Ambrato Bank · This is an automated message, please do not reply.
    </p>`;

const wrapper = (content) => `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        ${header}
        <div style="padding:30px;background:#f8fafc;">
            ${content}
            ${footer}
        </div>
    </div>`;

const sendVerificationEmail = async (email, token, name) => {
    const BASE_URL = process.env.SITE_URL || 'https://ambrato.onrender.com';
    const verificationUrl = `${BASE_URL}/auth/verify-email?token=${token}`;
    
    const html = wrapper(`
        <h2>Welcome, ${name}!</h2>
        <p>Click the button below to verify your email address:</p>
        <div style="text-align:center;margin:24px 0;">
            <a href="${verificationUrl}" style="display:inline-block;padding:14px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-size:16px;">
                Verify Email
            </a>
        </div>
        <p style="word-break:break-all;color:#64748b;font-size:13px;">${verificationUrl}</p>
        <p><small>This link expires in <strong>24 hours</strong>.</small></p>
    `);

    return sendEmail(email, 'Verify Your Email — Ambrato Bank', html);
};

const sendWelcomeEmail = async (email, name) => {
    const BASE_URL = process.env.SITE_URL || 'https://ambrato.onrender.com';
    const html = wrapper(`
        <h2>Welcome to Ambrato Bank, ${name}! 🎉</h2>
        <p>Your account is now active and ready to use.</p>
        <div style="text-align:center;margin:24px 0;">
            <a href="${BASE_URL}/auth/login" style="display:inline-block;padding:14px 28px;background:#0d9488;color:white;text-decoration:none;border-radius:8px;font-size:16px;">
                Login Now
            </a>
        </div>
    `);

    return sendEmail(email, 'Welcome to Ambrato Bank!', html);
};

const sendWithdrawalCode = async (email, code, name) => {
    const html = wrapper(`
        <h2>Hi ${name},</h2>
        <p>Your 7-digit withdrawal verification code is:</p>
        <div style="font-size:32px;letter-spacing:10px;color:#0d9488;font-weight:bold;text-align:center;padding:20px;background:#f0fdfa;border-radius:8px;margin:20px 0;">
            ${code}
        </div>
        <p><strong>⏱ Valid for 30 minutes only.</strong></p>
        <p style="color:#dc2626;font-size:13px;">
            Never share this code with anyone. Ambrato Bank will never ask for it.
        </p>
    `);

    return sendEmail(email, 'Your Withdrawal Code — Ambrato Bank', html);
};

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
        <div style="background:white;border-radius:12px;padding:24px;margin:20px 0;border-left:4px solid ${color};">
            <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Type</td><td style="padding:8px 0;font-weight:700;color:${color};text-align:right;">${label}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Amount</td><td style="padding:8px 0;font-weight:700;font-size:20px;color:${color};text-align:right;">${formatted}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Description</td><td style="padding:8px 0;font-weight:600;text-align:right;">${description || 'N/A'}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Date</td><td style="padding:8px 0;font-weight:600;text-align:right;">${new Date().toLocaleString()}</td></tr>
            </table>
        </div>
        <p style="color:#64748b;font-size:14px;">
            ${formatted} has been ${verb} your Ambrato Bank account.
            If you did not authorize this, please contact support immediately.
        </p>
    `);

    return sendEmail(email, `${icon} Account ${label} — Ambrato Bank`, html);
};

module.exports = {
    sendEmail,
    sendEmailSafe,
    sendVerificationEmail,
    sendWelcomeEmail,
    sendWithdrawalCode,
    sendTransactionEmail
};