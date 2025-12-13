// StreamBDIX - By Corpse
const axios = require('axios');

const QUALITY_MAP = [
    [['2160p', '4k'], '4K'],
    [['1080p'], '1080p'],
    [['720p'], '720p'],
    [['480p'], '480p']
];

const SOURCE_MAP = [
    [['imax'], 'IMAX'],
    [['hmax', 'hbo max'], 'HMAX'],
    [['bluray', 'blu-ray'], 'BluRay'],
    [['brrip', 'bdrip'], 'BRRip'],
    [['web-dl', 'webdl'], 'WEB-DL'],
    [['webrip'], 'WEBRip'],
    [['hdrip'], 'HDRip'],
    [['hdtv'], 'HDTV'],
    [['dvdrip'], 'DVDRip'],
    [['hdr'], 'HDR'],
    [['sdr'], 'SDR'],
    [['ddp5', 'ddp5.1', 'dd5.1', 'dd5', 'eac3', 'dolby atmos', '5.1', '7.1'], 'Dolby Atmos'],
    [['aac'], 'AAC'],
    [['amzn', 'amazon'], 'AMZN'],
];

function extractQuality(text) {
    const t = (typeof text === 'string' ? text : text?.Name || text?.Path || '').toLowerCase();
    const q = QUALITY_MAP.find(([keys]) => keys.some(k => t.includes(k)))?.[1] || '';
    const s = SOURCE_MAP.find(([keys]) => keys.some(k => t.includes(k)))?.[1] || '';
    return (q + (s ? ' ' + s : '')).trim() || 'Unknown';
}

function normalize(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titlesMatch(a, b) {
    const n1 = normalize(a), n2 = normalize(b);
    return n1.includes(n2) || n2.includes(n1);
}

function extractYear(text) {
    const m = (text || '').match(/\b(19\d{2}|20\d{2})\b/);
    return m ? parseInt(m[1]) : null;
}

module.exports = { extractQuality, normalize, titlesMatch, extractYear, axios };
