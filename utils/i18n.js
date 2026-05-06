const fs = require('fs');
const path = require('path');

const locales = {};
const localesDir = path.join(__dirname, '..', 'locales');

// Load all locale files
fs.readdirSync(localesDir).forEach(file => {
    if (file.endsWith('.json')) {
        const lang = file.replace('.json', '');
        locales[lang] = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
    }
});

function t(lang, key, vars = {}) {
    const messages = locales[lang] || locales['en'] || {};
    let text = messages[key] || key;
    
    // Replace variables like {{name}}
    Object.keys(vars).forEach(k => {
        text = text.replace(new RegExp(`{{${k}}}`, 'g'), vars[k]);
    });
    
    return text;
}

module.exports = { t, locales };