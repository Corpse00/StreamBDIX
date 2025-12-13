#!/usr/bin/env node

const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('./server');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 7001;
const CURRENT_VERSION = require('./package.json').version;

function getConfigPath() {
    const home = process.env.HOME || process.env.USERPROFILE;
    return path.join(home, '.streambdix');
}

function saveVersion() {
    try {
        fs.writeFileSync(getConfigPath(), CURRENT_VERSION);
    } catch {}
}

function getOpenReason() {
    const configPath = getConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const lastVersion = fs.readFileSync(configPath, 'utf8').trim();
            if (lastVersion !== CURRENT_VERSION) {
                return 'Update detected! Opening browser for reinstall...';
            }
            return null;
        }
        return 'First run detected! Opening browser for installation...';
    } catch {
        return 'First run detected! Opening browser for installation...';
    }
}

function countdown(seconds, reason, callback) {
    process.stdout.write(`\n  ${reason}\n`);
    let remaining = seconds;
    
    const tick = () => {
        process.stdout.write(`\r  Opening in ${remaining}...`);
        if (remaining <= 0) {
            process.stdout.write('\r' + ' '.repeat(30) + '\r');
            callback();
        } else {
            remaining--;
            setTimeout(tick, 1000);
        }
    };
    tick();
}

function openBrowser(url) {
    const platform = process.platform;
    let cmd;
    if (platform === 'darwin') cmd = `open "${url}"`;
    else if (platform === 'win32') cmd = `start "" "${url}"`;
    else cmd = `xdg-open "${url}"`;
    
    exec(cmd, () => {});
}

const originalLog = console.log;
console.log = () => {};

serveHTTP(addonInterface, { port: PORT })
    .then(({ url }) => {
        console.log = originalLog;
        const addonUrl = `http://127.0.0.1:${PORT}`;
        console.log('');
        console.log('╔═════════════════════════════════════════════════════╗');
        console.log('║                     StreamBDIX                      ║');
        console.log('╠═════════════════════════════════════════════════════╣');
        console.log('║                                                     ║');
        console.log('║          Addon URL: ' + addonUrl + '           ║');
        console.log('║                                                     ║');
        console.log('╠═════════════════════════════════════════════════════╣');
        console.log('║                                                     ║');
        console.log('║       Keep this terminal open while streaming       ║');
        console.log('║                Press Ctrl+C to stop                 ║');
        console.log('║                                                     ║');
        console.log('╚═════════════════════════════════════════════════════╝');
        console.log('');
        
        const openReason = getOpenReason();
        if (openReason) {
            countdown(3, openReason, () => {
                openBrowser(addonUrl);
                saveVersion();
            });
        }
    })
    .catch(err => console.error('STARTUP ERROR:', err));
