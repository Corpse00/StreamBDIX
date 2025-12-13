const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

const manifest = require('./addon.json');
const builder = new addonBuilder(manifest);

const sources = [
    require('./sources/dflix'),
    require('./sources/dhakaflix'),
];

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

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
    process.stdout.write('Fetching...');

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
    if (!meta) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        return { streams: [] };
    }

    const relevantSources = sources.filter(source => source.types.includes(type));

    const streamPromises = relevantSources.map(source => 
        source.getStreams(type, meta, season, episode)
            .catch(() => [])
    );
    
    const results = await Promise.all(streamPromises);
    const allStreams = results.flat();
    
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    
    return { streams: allStreams };
});

module.exports = builder.getInterface();
