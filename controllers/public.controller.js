/**
 * Public Controller
 * Handles all public-facing pages for Finaro
 */

const pool = require('../config/database');

// ─── Helper: Load user preferences (if logged in) ────────────────────────────
async function loadUserPreferences(req, res) {
    // Set defaults first
    res.locals._lang = 'en';
    res.locals._theme = 'light';
    res.locals._currency = 'USD';
    res.locals._symbol = '$';
    res.locals.lang = 'en';
    res.locals.theme = 'light';
    res.locals.currency = 'USD';
    res.locals.currencySymbol = '$';

    if (!req.user || !req.user.id) return;

    try {
        const [[prefs]] = await pool.execute(
            `SELECT preferred_language, preferred_currency, preferred_theme 
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (prefs) {
            const lang = prefs.preferred_language || 'en';
            const currency = prefs.preferred_currency || 'USD';
            const theme = prefs.preferred_theme || 'light';

            const symbols = { 
                USD: '$', EUR: '€', GBP: '£', JPY: '¥', MYR: 'RM', NGN: '₦',
                CAD: 'C$', AUD: 'A$', SGD: 'S$', HKD: 'HK$', KRW: '₩',
                INR: '₹', CNY: '¥', CHF: 'Fr', SEK: 'kr', NOK: 'kr'
            };
            const symbol = symbols[currency] || currency + ' ';

            res.locals._lang = lang;
            res.locals._theme = theme;
            res.locals._currency = currency;
            res.locals._symbol = symbol;
            res.locals.lang = lang;
            res.locals.theme = theme;
            res.locals.currency = currency;
            res.locals.currencySymbol = symbol;

            req.session.lang = lang;
            req.session.currency = currency;
            req.session.theme = theme;
        }
    } catch (err) {
        console.error('Public controller preferences load error:', err.message);
    }
}

// ─── Helper: Get base page data with preferences ─────────────────────────────
function getPageData(req, res, page, title, extra = {}) {
    return {
        title: `${title} | Finaro`,
        page,
        lang: res.locals.lang || 'en',
        theme: res.locals.theme || 'light',
        currency: res.locals.currency || 'USD',
        currencySymbol: res.locals.currencySymbol || '$',
        _lang: res.locals._lang || 'en',
        _theme: res.locals._theme || 'light',
        _currency: res.locals._currency || 'USD',
        _symbol: res.locals._symbol || '$',
        user: req.user || null,
        navItems: [
            { id: 'products', label: 'Products', href: '/' },
            { id: 'solutions', label: 'Solutions', href: '/solutions' },
            { id: 'about', label: 'About Us', href: '/about' },
            { id: 'pricing', label: 'Pricing', href: '/pricing' },
            { id: 'policy', label: 'Policy', href: '/policy' },
        ],
        ...extra
    };
}

const publicController = {

    // GET /  and  GET /products
    home: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/index', getPageData(req, res, 'products', 'Products', {
            hero: {
                headline: 'Digital banking for the modern economy.',
                subheadline: 'A unified platform for payments, savings, and global treasury. Built for people who value time as much as money. Open your account in under 5 minutes with digital KYC verification.',
                ctaPrimary: 'Join Early Access',
                ctaSecondary: 'View Demo'
            },
            stats: [
                { value: '4.5%', label: 'APY Savings' },
                { value: '140+', label: 'Countries' },
                { value: '30+', label: 'Currencies' },
                { value: '24/7', label: 'Support' },
            ],
            products: [
                { icon: 'fa-credit-card', title: 'Smart Debit', desc: 'Virtual and physical cards with zero FX fees, instant spend notifications, and tap-to-pay technology with Apple Pay & Google Wallet.', tags: ['Zero FX Fees', 'Instant Notifications', 'Tap-to-Pay'] },
                { icon: 'fa-chart-line', title: 'Vault Savings', desc: 'High-yield interest accounts with 4.5% APY and no lock-in periods. Significantly higher than the national average with personalized savings tools.', tags: ['4.5% APY', 'No Lock-in', 'Interest Calculator'] },
                { icon: 'fa-globe', title: 'Global Transfer', desc: 'Send money to 140+ countries at the real exchange rate in seconds. ACH transfers with iron-clad security.', tags: ['140+ Countries', 'Real Exchange Rate', 'Instant'] },
                { icon: 'fa-wallet', title: 'Multi-Currency Wallet', desc: 'Hold, exchange, and spend in 30+ currencies with real-time rates. Perfect for travelers, freelancers, and global businesses.', tags: ['30+ Currencies', 'Real-time Rates', 'Instant Exchange'] },
                { icon: 'fa-piggy-bank', title: 'Vault Goals', desc: 'Set savings targets with automated round-ups and milestone rewards. Track your progress and celebrate every achievement.', tags: ['Auto Round-ups', 'Milestone Rewards', 'Goal Tracking'] },
                { icon: 'fa-hand-holding-dollar', title: 'Instant Loans', desc: 'Get approved in minutes with flexible repayment and no hidden fees. Competitive rates tailored to your financial profile.', tags: ['Minutes Approval', 'Flexible Terms', 'No Hidden Fees'] },
            ],
            accountManagement: [
                { icon: 'fa-gauge-high', title: 'Dashboard', desc: 'Get a complete overview of all your accounts, balances, and recent transactions in one unified dashboard.' },
                { icon: 'fa-user-circle', title: 'Profile Management', desc: 'View and edit your personal information, update preferences, and manage account settings with ease.' },
                { icon: 'fa-circle-plus', title: 'Open New Account', desc: 'Create new bank accounts in minutes. Choose from savings, checking, joint accounts, and more.' },
                { icon: 'fa-file-invoice', title: 'Account Details', desc: 'View detailed information for each account including statements, transaction history, and analytics.' },
                { icon: 'fa-sliders', title: 'Settings', desc: 'Configure user preferences, notification settings, security options, and language preferences.' },
                { icon: 'fa-bell', title: 'Notifications', desc: 'Real-time transaction alerts and account updates via SMS, email, and push notifications.' },
            ],
            features: [
                { icon: 'fa-bolt', title: 'Instant Setup', desc: 'Open your account in under 5 minutes with digital KYC verification. No paperwork, no branch visits.' },
                { icon: 'fa-lock', title: 'Bank-Grade Security', desc: 'AES-256 encryption with biometric authentication, PIN protection, and 24/7 fraud monitoring.' },
                { icon: 'fa-mobile-screen', title: 'Mobile First', desc: 'Manage everything from our iOS and Android apps. Banking at your fingertips.' },
                { icon: 'fa-headset', title: '24/7 Support', desc: 'Real humans available around the clock via chat, email, and phone. We\'re here when you need us.' },
                { icon: 'fa-language', title: 'Multi-Language', desc: 'Support for English, Spanish, French, and more. Banking in the language you\'re most comfortable with.' },
                { icon: 'fa-exchange-alt', title: 'Currency Converter', desc: 'Real-time exchange rates for 30+ currencies. Convert and transfer with complete transparency.' },
                { icon: 'fa-users', title: 'Joint Accounts', desc: 'Open accounts with a spouse or partner and easily share finances with full transparency.' },
                { icon: 'fa-gem', title: 'Luxury Credit Cards', desc: 'Metal credit cards with cash back, designed to meet all your financial needs with style.' },
            ],
            authFeatures: [
                { icon: 'fa-user-plus', title: 'User Registration', desc: 'Sign up with email verification to create your secure Finaro account.' },
                { icon: 'fa-right-to-bracket', title: 'Secure Login/Logout', desc: 'Session-based authentication with secure token management and automatic timeout.' },
                { icon: 'fa-key', title: 'Password Management', desc: 'Forgot password and reset functionality with secure email verification links.' },
                { icon: 'fa-shield-halved', title: 'PIN Authentication', desc: 'Additional security layer for transactions with customizable PIN protection.' },
                { icon: 'fa-envelope-circle-check', title: 'Email Verification', desc: 'Account activation via secure verification link to ensure your identity.' },
                { icon: 'fa-fingerprint', title: 'Biometric Authentication', desc: 'Face ID and fingerprint login support for quick and secure access.' },
            ],
            compliance: [
                { icon: 'fa-id-card', title: 'KYC Submission', desc: 'Submit identity verification documents securely through our encrypted portal. Support for passports, driver\'s licenses, and national IDs.' },
                { icon: 'fa-chart-pie', title: 'KYC Status Tracking', desc: 'Monitor your verification progress in real-time. Get notified instantly when your account is verified and ready to use.' },
            ],
            transactions: [
                { icon: 'fa-arrow-down', title: 'Deposits', desc: 'Add funds to your account instantly via bank transfer, card, or mobile payment methods.' },
                { icon: 'fa-arrow-up', title: 'Withdrawals', desc: 'Withdraw money to external accounts quickly and securely with full tracking.' },
                { icon: 'fa-people-arrows', title: 'Internal Transfers', desc: 'Send money to other Finaro users instantly with account number name verification.' },
            ]
        }));
    },

    // GET /solutions
    solutions: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/solutions', getPageData(req, res, 'solutions', 'Solutions', {
            hero: {
                headline: 'Solutions for Every Business',
                subheadline: 'Powerful financial tools designed to help your business grow, scale, and succeed globally.'
            },
            solutions: [
                {
                    title: 'Solutions for Entrepreneurs',
                    desc: 'Manage your business finances from one dashboard. Integrate with your favorite accounting software and automate your tax filings.',
                    features: ['Automated Invoicing', 'Bulk Payroll Processing', 'Multi-currency Business Accounts', 'Real-time Analytics'],
                    icon: 'fa-chart-pie',
                    cta: 'Explore Business',
                    ctaLink: '/auth/register',
                    reverse: false
                },
                {
                    title: 'Enterprise Treasury',
                    desc: 'Advanced treasury management for large organizations. Optimize cash flow, manage risk, and streamline global operations.',
                    features: ['Cash Flow Forecasting', 'FX Risk Management', 'API Integration', 'Custom Reporting'],
                    icon: 'fa-building-columns',
                    cta: 'Contact Sales',
                    ctaLink: '/contact',
                    reverse: true
                },
                {
                    title: 'Freelancer Suite',
                    desc: 'Designed for independent professionals who need simple, powerful financial tools without the complexity of traditional banking.',
                    features: ['Smart Invoicing', 'Tax Estimation', 'Client Management', 'Instant Payouts'],
                    icon: 'fa-briefcase',
                    cta: 'Start Free',
                    ctaLink: '/auth/register',
                    reverse: false
                }
            ],
            personalSolutions: [
                {
                    title: 'Everyday Banking',
                    desc: 'Fee-free checking with a Vault Debit Card, instant notifications, and seamless mobile payments. No hidden fees, no minimum balance requirements.',
                    features: ['Fee-Free Demand Accounts', 'Vault Debit Card with Tap-to-Pay', 'Instant Account Notifications', 'Apple Pay & Google Wallet'],
                    icon: 'fa-wallet',
                    cta: 'Open Account',
                    ctaLink: '/auth/register',
                    reverse: false
                },
                {
                    title: 'Family Banking',
                    desc: 'Manage finances together with dedicated family accounts. Joint accounts, minor accounts managed by parents, and shared savings goals.',
                    features: ['Joint Accounts', 'Minor Accounts with Parent Controls', 'Shared Savings Goals', 'Family Spending Insights'],
                    icon: 'fa-house-user',
                    cta: 'Get Started',
                    ctaLink: '/auth/register',
                    reverse: true
                }
            ],
            securityFeatures: [
                { icon: 'fa-shield-halved', title: 'Multi-Factor Authentication', desc: 'Enforced across all accounts and transfers for maximum protection.' },
                { icon: 'fa-fingerprint', title: 'Biometric Login', desc: 'Face ID and fingerprint authentication for quick, secure access.' },
                { icon: 'fa-eye', title: 'Fraud Monitoring', desc: 'State-of-the-art tools to detect and halt suspicious activities in real-time.' },
                { icon: 'fa-lock', title: 'AES-256 Encryption', desc: 'Industry-standard encryption ensuring the safety of your data.' },
                { icon: 'fa-id-card', title: 'Digital KYC', desc: 'Streamlined identity verification with passport, driver\'s license, and national ID support.' },
                { icon: 'fa-file-shield', title: 'Regulatory Compliance', desc: 'Full compliance with banking regulations and data protection standards.' },
            ],
            integrations: [
                { brand: 'fab', icon: 'fa-slack', title: 'Slack', desc: 'Get instant notifications for transactions and alerts.' },
                { brand: 'fab', icon: 'fa-stripe', title: 'Stripe', desc: 'Seamless payment processing and reconciliation.' },
                { brand: 'fab', icon: 'fa-xero', title: 'Xero', desc: 'Automatic sync with your accounting software.' },
                { brand: 'fab', icon: 'fa-salesforce', title: 'Salesforce', desc: 'CRM integration for customer financial data.' },
                { brand: 'fab', icon: 'fa-shopify', title: 'Shopify', desc: 'E-commerce payment processing made simple.' },
                { brand: 'fab', icon: 'fa-aws', title: 'AWS', desc: 'Cloud infrastructure billing and cost management.' },
            ]
        }));
    },

    // GET /about
    about: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/about', getPageData(req, res, 'about', 'About Us', {
            hero: {
                headline: 'The Finaro Mission',
                subheadline: 'We are a team of financiers and engineers building the future of digital banking.'
            },
            stats: [
                { value: '2026', label: 'Founded' },
                { value: '140+', label: 'Target Markets' },
                { value: '24/7', label: 'Support Planned' },
                { value: '4.5%', label: 'Target APY' },
            ],
            timeline: [
                { year: '2024', title: 'The Idea', desc: 'Finaro was conceived by a group of fintech professionals who saw a gap in accessible, transparent digital banking for underserved communities.', icon: 'fa-lightbulb' },
                { year: '2025', title: 'Development Begins', desc: 'Our engineering team started building the core platform. Focus on security, compliance, and a seamless user experience from day one.', icon: 'fa-code' },
                { year: '2025', title: 'Security & Compliance', desc: 'Implemented bank-grade encryption, fraud detection systems, and began working with regulatory bodies to ensure full compliance.', icon: 'fa-shield-halved' },
                { year: '2026', title: 'Team Growth', desc: 'Expanded our team across engineering, compliance, and customer success. Built partnerships with payment processors and banking infrastructure providers.', icon: 'fa-users' },
                { year: '2026', title: 'Early Access Launch', desc: 'Opening our doors to early adopters. Inviting users to join our beta program and help shape the future of Finaro.', icon: 'fa-rocket' },
            ],
            values: [
                { icon: 'fa-handshake', title: 'Transparency', desc: 'No hidden fees, no surprises. We believe in complete honesty with our customers.' },
                { icon: 'fa-shield-halved', title: 'Security First', desc: 'Your financial data is protected with military-grade encryption and constant monitoring.' },
                { icon: 'fa-lightbulb', title: 'Innovation', desc: 'We constantly push boundaries to deliver cutting-edge financial solutions.' },
                { icon: 'fa-heart', title: 'Customer Obsessed', desc: 'Every feature we build starts with understanding what our users truly need.' },
            ],
            team: [
                { icon: 'fa-user-tie', name: 'Sarah Chen', role: 'CEO & Co-Founder', bio: 'Former fintech strategist with experience across digital banking and payment platforms.' },
                { icon: 'fa-user-gear', name: 'Marcus Johnson', role: 'CTO & Co-Founder', bio: 'Software architect with deep expertise in secure financial systems and cloud infrastructure.' },
                { icon: 'fa-user-shield', name: 'Elena Rodriguez', role: 'Chief Security Officer', bio: 'Cybersecurity specialist focused on building robust protection for financial data and transactions.' },
            ]
        }));
    },

    // GET /pricing
    pricing: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/pricing', getPageData(req, res, 'pricing', 'Pricing', {
            hero: {
                headline: 'Simple Pricing',
                subheadline: 'No hidden fees. No maintenance charges. Just transparent banking. Plans subject to change during early access.'
            },
            plans: [
                {
                    name: 'Personal',
                    price: '$0',
                    period: '/mo',
                    features: ['Standard Debit Card', 'Unlimited Domestic Transfers', 'Basic Savings Vaults', 'Mobile App Access', 'Email Support'],
                    cta: 'Join Early Access',
                    ctaLink: '/auth/register',
                    featured: false
                },
                {
                    name: 'Pro Plan',
                    price: '$9',
                    period: '/mo',
                    features: ['Metal Debit Card', 'Higher Interest Rates (up to 4.5%)', 'Global Travel Insurance', 'Priority Support', 'Unlimited FX Transfers', 'Lounge Access'],
                    cta: 'Join Early Access',
                    ctaLink: '/auth/register',
                    featured: true,
                    badge: 'EARLY ACCESS'
                },
                {
                    name: 'Business',
                    price: '$29',
                    period: '/mo',
                    features: ['Everything in Pro', 'Multi-user Access', 'API Access', 'Bulk Payroll', 'Dedicated Account Manager', 'Custom Integrations'],
                    cta: 'Contact Us',
                    ctaLink: '/contact',
                    featured: false
                }
            ],
            comparison: [
                { feature: 'Debit Card', icon: 'fa-credit-card', personal: true, pro: true, business: true },
                { feature: 'APY Rate', icon: 'fa-percent', personal: 'Up to 3.5%', pro: 'Up to 4.5%', business: 'Up to 4.5%' },
                { feature: 'FX Transfers', icon: 'fa-globe', personal: '5/mo', pro: 'Unlimited', business: 'Unlimited' },
                { feature: 'Support', icon: 'fa-headset', personal: 'Email', pro: 'Priority', business: 'Dedicated' },
                { feature: 'API Access', icon: 'fa-plug', personal: false, pro: false, business: true },
            ],
            faqs: [
                { question: 'Can I switch plans anytime?', answer: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately and we\'ll prorate any difference.' },
                { question: 'Is there a free trial for Pro?', answer: 'Yes! Every new user gets a 30-day free trial of Pro features during early access. No credit card required to start.' },
                { question: 'What payment methods do you accept?', answer: 'We accept all major credit cards and bank transfers. Additional payment methods will be added as we expand.' },
                { question: 'Will pricing change after launch?', answer: 'Early access members will lock in their current pricing for 12 months after full launch. Any future changes will be communicated 60 days in advance.' },
            ]
        }));
    },

    // GET /policy
    policy: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/policy', getPageData(req, res, 'policy', 'Privacy & Terms', {
            hero: {
                headline: 'Privacy & Terms',
                subheadline: 'Your trust is our most valuable asset. Here\'s how we plan to protect it.'
            },
            policies: [
                { icon: 'fa-shield-halved', title: 'Data Security', number: '1', text: 'We are implementing bank-grade AES-256 encryption to protect your data. All transactions will be monitored by fraud detection systems. Our infrastructure will be hosted in SOC 2 Type II certified data centers with redundant backups across multiple geographic regions.' },
                { icon: 'fa-user-lock', title: 'Privacy Policy', number: '2', text: 'Finaro will never sell your personal data to third parties. We will only share information necessary to process your transactions and comply with applicable regulations. You will have full control over your data and can request a complete export or deletion at any time through your account settings.' },
                { icon: 'fa-id-card', title: 'Account Terms', number: '3', text: 'Users must be 18 years or older. All accounts will be subject to KYC (Know Your Customer) verification before full access is granted. We are committed to complying with GDPR, CCPA, and all applicable financial regulations in the jurisdictions where we operate.' },
                { icon: 'fa-money-bill-transfer', title: 'Transaction Policies', number: '4', text: 'All transactions will be final once confirmed. In case of unauthorized transactions, please report within 24 hours for immediate investigation. We plan to offer purchase protection on eligible transactions and dispute resolution services for merchant conflicts.' },
                { icon: 'fa-cookie-bite', title: 'Cookies & Tracking', number: '5', text: 'We use essential cookies for platform functionality and optional analytics cookies to improve your experience. You can manage your cookie preferences at any time through your browser settings or our privacy dashboard.' },
                { icon: 'fa-gavel', title: 'Legal Compliance', number: '6', text: 'Finaro is working toward full regulatory compliance in all target jurisdictions. We are committed to maintaining compliance with anti-money laundering (AML) and counter-terrorism financing (CTF) regulations as we prepare for launch.' },
                { icon: 'fa-file-contract', title: 'Early Access Terms', number: '7', text: 'By joining our early access program, you agree to help us test and improve the platform. Features may change, and occasional downtime may occur as we refine our systems. Your feedback is invaluable in shaping the final product.' },
                { icon: 'fa-rotate', title: 'Policy Updates', number: '8', text: 'These policies are subject to change as we approach full launch. We will notify all users of any material changes via email and in-app notifications at least 30 days before they take effect.' },
            ],
            contact: [
                { icon: 'fa-envelope', title: 'Email', info: 'hello@finaro.org' },
                { icon: 'fa-comments', title: 'Support', info: 'Available during early access' },
            ]
        }));
    },

    // GET /demo
    demo: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/demo', getPageData(req, res, 'demo', 'Demo', {
            hero: {
                headline: 'See Finaro in Action',
                subheadline: 'Explore the features and experience that await you. Here\'s a preview of what\'s being built.'
            },
            dashboardFeatures: [
                { icon: 'fa-gauge-high', title: 'Account Overview', desc: 'See all your accounts, balances, and net worth at a glance. Real-time updates keep you informed.' },
                { icon: 'fa-list-ul', title: 'Transaction History', desc: 'Detailed transaction logs with search, filters, and export options. Never lose track of a penny.' },
                { icon: 'fa-bell', title: 'Smart Notifications', desc: 'Instant alerts for transactions, goals, and security events. Customizable to your preferences.' },
            ],
            bankingFeatures: [
                { icon: 'fa-credit-card', title: 'Smart Debit Card', desc: 'Virtual and physical cards with instant freeze, spending limits, and real-time notifications. Zero FX fees on all purchases.' },
                { icon: 'fa-arrow-down', title: 'Instant Deposits', desc: 'Add funds via bank transfer, card, or mobile payment. Multiple options for maximum convenience.' },
                { icon: 'fa-people-arrows', title: 'Quick Transfers', desc: 'Send money to other Finaro users instantly. External transfers to 140+ countries at real exchange rates.' },
            ],
            savingsFeatures: [
                { icon: 'fa-chart-line', title: 'Vault Savings', desc: 'High-yield savings with up to 4.5% APY. No lock-in periods, no minimum balance. Your money, your rules.' },
                { icon: 'fa-bullseye', title: 'Vault Goals', desc: 'Set custom savings targets with automated round-ups. Visual progress tracking keeps you motivated.' },
                { icon: 'fa-wallet', title: 'Multi-Currency Wallet', desc: 'Hold, exchange, and spend in 30+ currencies. Real-time rates with complete transparency.' },
            ],
            securityFeatures: [
                { icon: 'fa-fingerprint', title: 'Biometric Login', desc: 'Face ID and fingerprint authentication for quick, secure access. No more forgotten passwords.' },
                { icon: 'fa-shield-halved', title: 'Transaction PIN', desc: 'Customizable PIN protection for every transaction. Add an extra layer of security to your transfers.' },
                { icon: 'fa-eye', title: 'Fraud Monitoring', desc: '24/7 automated monitoring detects suspicious activity instantly. We alert you the moment something looks off.' },
            ],
            workflow: [
                { step: 1, title: 'Sign Up', desc: 'Create your account with email and password. Verify your email to activate your profile.' },
                { step: 2, title: 'Verify Identity', desc: 'Upload your passport, driver\'s license, or national ID. Our AI-powered system verifies documents in minutes.' },
                { step: 3, title: 'Set Security', desc: 'Configure your PIN, enable biometric login, and set up two-factor authentication for maximum protection.' },
                { step: 4, title: 'Start Banking', desc: 'Your account is ready! Add funds, create savings goals, and start sending money worldwide.' },
            ],
            mobileFeatures: [
                { icon: 'fa-apple', brand: 'fab', title: 'iOS App', desc: 'Native iOS experience with Face ID, Apple Pay integration, and seamless iCloud backup. Optimized for iPhone and iPad.' },
                { icon: 'fa-android', brand: 'fab', title: 'Android App', desc: 'Native Android experience with fingerprint unlock, Google Pay support, and Material Design interface.' },
                { icon: 'fa-mobile-screen-button', title: 'Responsive Web', desc: 'Full functionality on any device with a browser. No download required — just log in and go.' },
            ]
        }));
    },

    // GET /contact
    contact: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/contact', getPageData(req, res, 'contact', 'Contact Us', {
            hero: {
                headline: 'Get in Touch',
                subheadline: 'Have questions about Finaro? We\'d love to hear from you.'
            },
            contactMethods: [
                { icon: 'fa-envelope', title: 'Email', info: 'hello@finaro.org', desc: 'For general inquiries and support' },
                { icon: 'fa-comments', title: 'Live Chat', info: 'Available during business hours', desc: 'Get instant answers from our team' },
                { icon: 'fa-phone', title: 'Phone', info: 'Coming soon', desc: 'Phone support launching with full release' },
            ],
            departments: [
                { icon: 'fa-headset', title: 'Customer Support', email: 'support@finaro.org', desc: 'Help with accounts, transactions, and technical issues' },
                { icon: 'fa-briefcase', title: 'Business Inquiries', email: 'helpcenter@finaro.org', desc: 'Partnerships, enterprise solutions, and API access' },
                { icon: 'fa-newspaper', title: 'Press & Media', email: 'helpcenter@finaro.org', desc: 'Media kits, interviews, and press releases' },
                { icon: 'fa-shield-halved', title: 'Security', email: 'helpcenter@finaro.org', desc: 'Report vulnerabilities or security concerns' },
            ]
        }));
    },

    // GET /support (Help Center)
    support: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/support', getPageData(req, res, 'support', 'Help Center', {
            hero: {
                headline: 'Help Center',
                subheadline: 'Find answers to common questions and learn how to use Finaro.'
            },
            categories: [
                { icon: 'fa-user-plus', title: 'Getting Started', articles: ['How to create an account', 'KYC verification guide', 'Setting up security'] },
                { icon: 'fa-credit-card', title: 'Cards & Payments', articles: ['Ordering your debit card', 'Managing card settings', 'Dispute a transaction'] },
                { icon: 'fa-chart-line', title: 'Savings & Goals', articles: ['Creating a savings vault', 'Setting up round-ups', 'Understanding APY'] },
                { icon: 'fa-globe', title: 'Transfers', articles: ['Sending money internationally', 'Transfer fees explained', 'Tracking your transfer'] },
                { icon: 'fa-shield-halved', title: 'Security', articles: ['Reset your password', 'Enable biometric login', 'Report suspicious activity'] },
                { icon: 'fa-sliders', title: 'Account Settings', articles: ['Update personal info', 'Change language', 'Close your account'] },
            ]
        }));
    },

    // GET /status (Status Page)
    status: async (req, res) => {
        await loadUserPreferences(req, res);

        res.render('pages/status', getPageData(req, res, 'status', 'System Status', {
            hero: {
                headline: 'System Status',
                subheadline: 'Real-time status of Finaro services.'
            },
            systems: [
                { name: 'Web Platform', status: 'operational', icon: 'fa-desktop' },
                { name: 'Mobile App (iOS)', status: 'operational', icon: 'fa-apple' },
                { name: 'Mobile App (Android)', status: 'operational', icon: 'fa-android' },
                { name: 'Card Processing', status: 'operational', icon: 'fa-credit-card' },
                { name: 'Transfers', status: 'operational', icon: 'fa-paper-plane' },
                { name: 'KYC Verification', status: 'operational', icon: 'fa-id-card' },
                { name: 'Notifications', status: 'operational', icon: 'fa-bell' },
                { name: 'API', status: 'maintenance', icon: 'fa-plug' },
            ],
            incidents: [
                { date: '2026-04-28', title: 'Scheduled Maintenance', status: 'resolved', desc: 'Routine system updates completed successfully.' },
                { date: '2026-04-15', title: 'API Performance Degradation', status: 'resolved', desc: 'Temporary slowdown in API response times. Issue identified and resolved within 30 minutes.' },
            ]
        }));
    }
};

module.exports = publicController;