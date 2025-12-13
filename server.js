// StreamBDIX - By Corpse
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = require('./addon.json');
const builder = new addonBuilder(manifest);

const allSources = {
    dflix: require('./sources/dflix'),
    dhakaflix: require('./sources/dhakaflix'),
    roarzone: require('./sources/roarzone'),
    ftpbd: require('./sources/ftpbd'),
    circleftp: require('./sources/circleftp'),
    iccftp: require('./sources/iccftp'),
};

function getEnabledSources() {
    try {
        const enabled = JSON.parse(process.env.STREAMBDIX_SOURCES || '[]');
        return enabled.map(key => allSources[key]).filter(Boolean);
    } catch {
        return Object.values(allSources);
    }
}

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

const QUALITY_RANK = { '4k': 4, '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, 'unknown': 0 };
const SOURCE_RANK = {
    'imax': 20, 'hmax': 19, 'hbo max': 19,
    'bluray': 18, 'blu-ray': 18, 'brrip': 17, 'bdrip': 17,
    'web-dl': 16, 'webdl': 16, 'webrip': 15, 'hdrip': 14, 'hdtv': 13, 'dvdrip': 12,
    'hdr': 10, 'sdr': 9,
    'dolby atmos': 8, 'ddp5.1': 7, 'ddp5': 7, 'dd5.1': 7, 'dd5': 7, 'eac3': 7,
    '7.1': 6, '5.1': 5, 'ac3': 5, 'aac': 4,
    'amzn': 3, 'amazon': 3,
};

function getStreamScore(title) {
    const t = (title || '').toLowerCase();
    let qScore = 0, sScore = 0;

    for (const [k, v] of Object.entries(QUALITY_RANK)) {
        if (t.includes(k)) { qScore = v; break; }
    }
    for (const [k, v] of Object.entries(SOURCE_RANK)) {
        if (t.includes(k)) { sScore = v; break; }
    }

    return qScore * 10 + sScore;
}

function sortStreams(streams) {
    return streams.sort((a, b) => getStreamScore(b.title) - getStreamScore(a.title));
}

async function getMetaFromCinemeta(type, imdbId) {
    try {
        const response = await axios.get(`${CINEMETA_URL}/meta/${type}/${imdbId}.json`, {
            timeout: 5000
        });
        return response.data?.meta || null;
    } catch (error) {
        return null;
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    let imdbId, season, episode;

    if (type === 'series') {
        const parts = id.split(':');
        imdbId = parts[0];
        season = parseInt(parts[1]) || 1;
        episode = parseInt(parts[2]) || 1;
    } else {
        imdbId = id;
    }

    const meta = await getMetaFromCinemeta(type, imdbId);
    if (!meta) return { streams: [] };

    const sources = getEnabledSources();
    const relevantSources = sources.filter(source => source.types.includes(type));

    const streamPromises = relevantSources.map(source =>
        source.getStreams(type, meta, season, episode).catch(() => [])
    );

    const results = await Promise.all(streamPromises);
    const streams = sortStreams(results.flat());
    return { streams };
});

module.exports = builder.getInterface();
