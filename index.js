#!/usr/bin/env node
// StreamBDIX - By Corpse

const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getRouter } = require('stremio-addon-sdk');
const { spawn, execSync } = require('child_process');

const PORT = process.env.PORT || 7001;

const SOURCES = {
    dflix: { name: 'Dflix', urls: ['https://movies.discoveryftp.net', 'https://cdn1.discoveryftp.net', 'https://cdn2.discoveryftp.net'] },
    dhakaflix: { name: 'DhakaFlix', urls: ['http://172.16.50.14/DHAKA-FLIX-14/', 'http://172.16.50.12/DHAKA-FLIX-12/', 'http://172.16.50.12'] },
    roarzone: { name: 'RoarZone', urls: ['https://play.roarzone.info'] },
    ftpbd: { name: 'FTPBD', urls: ['http://media.ftpbd.net:8096'] },
    circleftp: { name: 'CircleFTP', urls: ['http://new.circleftp.net'] },
    iccftp: { name: 'ICC FTP', urls: ['http://10.16.100.244'] }
};

const dataDir = () => path.join(process.env.HOME || process.env.USERPROFILE, '.streambdix');
const cfgPath = () => path.join(dataDir(), 'config.json');
const tokenPath = () => path.join(dataDir(), '.token');

let tunnelProcess = null;

function ensureDataDir() {
    const dir = dataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
}

function getConfig() {
    try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); }
    catch { return { sources: Object.keys(SOURCES) }; }
}

function saveConfig(cfg) {
    ensureDataDir();
    fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
}

function getToken() {
    try { return fs.readFileSync(tokenPath(), 'utf8').trim(); }
    catch { return ''; }
}

function saveToken(token) {
    ensureDataDir();
    fs.writeFileSync(tokenPath(), token, { mode: 0o600 });
}

function deleteToken() {
    try { fs.unlinkSync(tokenPath()); } catch { }
}

function isCloudflaredInstalled() {
    try {
        const cmd = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared';
        execSync(cmd, { encoding: 'utf8' });
        return true;
    } catch { return false; }
}

function getCloudflaredPath() {
    try {
        const cmd = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared';
        return execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0];
    } catch { return null; }
}

function updateTunnel() {
    const cfg = getConfig();
    const token = getToken();
    const enabled = cfg.tunnelEnabled;

    if (tunnelProcess) {
        if (!enabled || !token || (tunnelProcess.token !== token)) {
            tunnelProcess.kill();
            tunnelProcess = null;
        }
    }

    if (enabled && token && !tunnelProcess) {
        const cloudflaredPath = getCloudflaredPath();
        if (!cloudflaredPath) {
            console.error('cloudflared not installed');
            return;
        }
        try {
            const child = spawn(cloudflaredPath, ['tunnel', 'run', '--token', token], { stdio: 'ignore' });
            tunnelProcess = child;
            tunnelProcess.token = token;
            child.on('error', () => { tunnelProcess = null; });
            child.on('exit', () => { if (tunnelProcess === child) tunnelProcess = null; });
        } catch (e) {
            console.error('Error spawning cloudflared:', e);
        }
    }
}

async function checkSources() {
    const results = {};
    await Promise.all(Object.entries(SOURCES).map(async ([k, v]) => {
        const checks = await Promise.all(v.urls.map(async url => {
            const start = Date.now();
            try { await axios.get(url, { timeout: 3000 }); return { ok: true, ping: Date.now() - start }; }
            catch { return { ok: false }; }
        }));
        const good = checks.filter(c => c.ok);
        const avg = good.length ? Math.round(good.reduce((a, c) => a + c.ping, 0) / good.length) : null;
        results[k] = { reachable: good.length > 0, working: good.length, total: v.urls.length, ping: avg };
    }));
    return results;
}

const cfg = getConfig();
process.env.STREAMBDIX_SOURCES = JSON.stringify(cfg.sources);
updateTunnel();

const addonInterface = require('./server');
const router = getRouter(addonInterface);

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const isLocal = () => {
        if (req.headers['cf-connecting-ip'] || req.headers['cf-ray']) return false;
        const remote = req.socket?.remoteAddress || '';
        return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    };

    if (url.pathname === '/api/config' && req.method === 'GET') {
        const cfg = getConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            sources: cfg.sources,
            forcedSources: cfg.forcedSources || [],
            tunnelEnabled: cfg.tunnelEnabled || false,
            hasToken: !!getToken(),
            tunnelActive: !!tunnelProcess,
            cloudflaredInstalled: isCloudflaredInstalled()
        }));
        return;
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const cfg = getConfig();

                if (data.sources && Array.isArray(data.sources)) {
                    cfg.sources = data.sources.filter(s => SOURCES[s]);
                    process.env.STREAMBDIX_SOURCES = JSON.stringify(cfg.sources);
                }

                if (data.forcedSources && Array.isArray(data.forcedSources)) {
                    cfg.forcedSources = data.forcedSources.filter(s => SOURCES[s]);
                }

                if (typeof data.tunnelEnabled === 'boolean' && isLocal()) {
                    cfg.tunnelEnabled = data.tunnelEnabled;
                }

                saveConfig(cfg);
                updateTunnel();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch { res.writeHead(400); res.end('bad'); }
        });
        return;
    }

    if (url.pathname === '/api/token' && req.method === 'POST') {
        if (!isLocal()) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Local access only' }));
            return;
        }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.delete) {
                    deleteToken();
                    const cfg = getConfig();
                    cfg.tunnelEnabled = false;
                    saveConfig(cfg);
                    updateTunnel();
                } else if (data.token) {
                    saveToken(data.token);
                    updateTunnel();
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch { res.writeHead(400); res.end('bad'); }
        });
        return;
    }

    if (url.pathname === '/api/token/validate' && req.method === 'POST') {
        if (!isLocal()) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false, error: 'Local access only' }));
            return;
        }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const { token } = JSON.parse(body);
                if (!token) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false, error: 'Token required' }));
                    return;
                }
                const cloudflaredPath = getCloudflaredPath();
                if (!cloudflaredPath) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false, error: 'cloudflared not installed' }));
                    return;
                }
                const testProcess = spawn(cloudflaredPath, ['tunnel', 'run', '--token', token], { stdio: 'ignore' });
                let exited = false;
                testProcess.on('exit', () => { exited = true; });
                testProcess.on('error', () => { exited = true; });
                setTimeout(() => {
                    if (exited) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ valid: false, error: 'Invalid token' }));
                    } else {
                        testProcess.kill();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ valid: true }));
                    }
                }, 4000);
            } catch { res.writeHead(400); res.end('bad'); }
        });
        return;
    }

    if (url.pathname === '/api/sources/check') {
        checkSources().then(r => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(r));
        });
        return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
        return;
    }

    if (url.pathname === '/manifest.json' || url.pathname.startsWith('/stream/') || url.pathname.startsWith('/catalog/') || url.pathname.startsWith('/meta/')) {
        router(req, res, () => { res.writeHead(404); res.end(); });
        return;
    }

    res.writeHead(404);
    res.end();
});

process.on('exit', () => { if (tunnelProcess) tunnelProcess.kill(); });
process.on('SIGINT', () => { process.exit(); });

server.listen(PORT, '127.0.0.1', () => {
    const center = (t, w = 51) => "║" + t.padStart((w + t.length) / 2).padEnd(w) + "║";
    console.log(`
╔═══════════════════════════════════════════════════╗
${center("StreamBDIX")}
╠═══════════════════════════════════════════════════╣
${center("")}
${center(`http://127.0.0.1:${PORT}`)}
${center("")}
${center("Keep terminal open while streaming")}
${center("Press Ctrl+C to stop")}
${center("")}
╚═══════════════════════════════════════════════════╝
`);
});
