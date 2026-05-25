require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const cookieParser = require('cookie-parser');
const flash        = require('connect-flash');
const publicRoutes = require('./routes/public.route');
const path         = require('path');

// ── Preferences middleware ────────────────────────────────────────────────────
// //

const app = express();

// ============================================
// VIEW ENGINE
// ============================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// CORE MIDDLEWARE
// ============================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || 'session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
//app.use(preferencesMiddleware);
app.use(flash());

// ── Flash + user locals ───────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success');
    res.locals.error_msg   = req.flash('error');
    res.locals.info_msg    = req.flash('info');
    res.locals.user        = req.user || null;
    next();
});

// ── Load user preferences AFTER req.user is set by auth ──────────────────────


app.use((req, res, next) => {
    console.log('>>> TEST MIDDLEWARE HIT:', req.originalUrl);
    next();
});

// ============================================
// ROUTES
// ============================================
app.use('/',       publicRoutes);
app.use('/auth',   require('./routes/auth'));
app.use('/user',   require('./routes/user'));
app.use('/admin',  require('./routes/admin'));

// ============================================
// ERROR HANDLERS
// ============================================
// Add to app.js or routes
app.get('/test-email', async (req, res) => {
    try {
        const transporter = require('./utils/email'); // however you import it
        await transporter.sendMail({
            from: process.env.FROM_EMAIL || 'helpcenter@finaro.org',
            to: 'your-personal-email@gmail.com', // use your real email
            subject: 'Test from Render',
            text: 'If you see this, SMTP works!'
        });
        res.send('✅ Email sent! Check your inbox.');
    } catch (err) {
        console.error('EMAIL ERROR:', err);
        res.status(500).send('❌ Email failed: ' + err.message);
    }
});


app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        req.flash('error', 'File is too large. Maximum size is 5 MB.');
        return res.redirect('back');
    }
    if (err.message && err.message.includes('Only PDF')) {
        req.flash('error', err.message);
        return res.redirect('back');
    }
    next(err);
});

app.use((req, res) => {
    res.status(404).render('errors/404', {
        title:   'Page Not Found',
        message: 'The page you are looking for does not exist.',
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('errors/500', {
        title:   'Server Error',
        message: 'Something went wrong. Please try again later.',
    });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    try {
        const ngrok = require('ngrok');
        const url   = await ngrok.connect({
            addr:      PORT,
            authtoken: process.env.NGROK_AUTHTOKEN || undefined
        });
        process.env.BASE_URL = url;
        console.log(`🌐 Public URL: ${url}`);
        console.log(`✅ Gmail SMTP Ready`);
    } catch (error) {
        console.log('⚠️  ngrok not started. Using localhost for internal testing.');
        process.env.BASE_URL = `http://localhost:${PORT}`;
    }
});

// ── MOVED TO BOTTOM — was breaking route registration ────────────────────────
module.exports = app;

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    try { const ngrok = require('ngrok'); await ngrok.kill(); } catch(e) {}
    process.exit(0);
});