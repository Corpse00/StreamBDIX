// StreamBDIX - By Corpse
const { extractQuality, titlesMatch, axios } = require('./utils');
const SOURCE_NAME = 'FTPBD';
const EMBY_URL = 'http://media.ftpbd.net:8096';
const USERNAME = 'BNET- -USER';
let cachedToken = null;
let tokenExpiry = 0;
async function authenticate() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
    try {
        const response = await axios.post(`${EMBY_URL}/emby/Users/AuthenticateByName`, {
            Username: USERNAME,
            Pw: ''
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Emby-Authorization': 'MediaBrowser Client="Stremio", Device="StreamBDIX", DeviceId="streambdix-' + Date.now() + '", Version="1.0.0"'
            },
            timeout: 5000
        });
        cachedToken = response.data.AccessToken;
        tokenExpiry = Date.now() + (30 * 60 * 1000);
        return cachedToken;
    } catch { return null; }
}
function buildStreamUrl(itemId, token) {
    return `${EMBY_URL}/emby/Videos/${itemId}/stream?Static=true&api_key=${token}`;
}
async function searchMovieByImdb(imdbId, name, token) {
    try {
        const response = await axios.get(`${EMBY_URL}/emby/Items`, {
            params: {
                AnyProviderIdEquals: `imdb.${imdbId}`,
                IncludeItemTypes: 'Movie',
                Recursive: true,
                Fields: 'MediaSources,ProviderIds,Path',
                api_key: token
            },
            timeout: 5000
        });
        if (response.data?.Items?.length > 0) return response.data.Items;
        if (name) {
            const searchTerm = name.split(/[:\-–]/)[0].trim();
            const nameResponse = await axios.get(`${EMBY_URL}/emby/Items`, {
                params: {
                    SearchTerm: searchTerm,
                    IncludeItemTypes: 'Movie',
                    Recursive: true,
                    Fields: 'MediaSources,ProviderIds,Path',
                    api_key: token
                },
                timeout: 5000
            });
            return (nameResponse.data?.Items || []).filter(item => titlesMatch(item.Name, name));
        }
        return [];
    } catch { return []; }
}
async function searchSeriesByImdb(imdbId, name, token) {
    try {
        const response = await axios.get(`${EMBY_URL}/emby/Items`, {
            params: {
                AnyProviderIdEquals: `imdb.${imdbId}`,
                IncludeItemTypes: 'Series',
                Recursive: true,
                Fields: 'ProviderIds',
                api_key: token
            },
            timeout: 5000
        });
        if (response.data?.Items?.length > 0) return response.data.Items;
        if (name) {
            const searchTerm = name.split(/[:\-–]/)[0].trim();
            const nameResponse = await axios.get(`${EMBY_URL}/emby/Items`, {
                params: {
                    SearchTerm: searchTerm,
                    IncludeItemTypes: 'Series',
                    Recursive: true,
                    Fields: 'ProviderIds',
                    api_key: token
                },
                timeout: 5000
            });
            return (nameResponse.data?.Items || []).filter(item => titlesMatch(item.Name, name));
        }
        return [];
    } catch { return []; }
}
async function getEpisodes(seriesId, season, token) {
    try {
        const response = await axios.get(`${EMBY_URL}/emby/Shows/${seriesId}/Episodes`, {
            params: { Season: season, Fields: 'MediaSources,Path', api_key: token },
            timeout: 5000
        });
        return response.data?.Items || [];
    } catch { return []; }
}
async function getMovieStreams(imdbId, name) {
    const token = await authenticate();
    if (!token) return [];
    const movies = await searchMovieByImdb(imdbId, name, token);
    if (movies.length === 0) return [];
    const streams = [];
    const seen = new Set();
    for (const movie of movies) {
        if (!movie.MediaSources) continue;
        for (const source of movie.MediaSources) {
            const streamUrl = buildStreamUrl(movie.Id, token);
            if (seen.has(streamUrl)) continue;
            seen.add(streamUrl);
            streams.push({ name: SOURCE_NAME, title: extractQuality(source), url: streamUrl });
        }
    }
    return streams;
}
async function getSeriesStreams(imdbId, name, season, episode) {
    const token = await authenticate();
    if (!token) return [];
    const seriesList = await searchSeriesByImdb(imdbId, name, token);
    if (seriesList.length === 0) return [];
    const series = seriesList[0];
    const episodes = await getEpisodes(series.Id, season, token);
    const matchingEpisode = episodes.find(ep => ep.IndexNumber === episode);
    if (!matchingEpisode) return [];
    const streams = [];
    const seen = new Set();
    if (matchingEpisode.MediaSources) {
        for (const source of matchingEpisode.MediaSources) {
            const streamUrl = buildStreamUrl(matchingEpisode.Id, token);
            if (seen.has(streamUrl)) continue;
            seen.add(streamUrl);
            streams.push({ name: SOURCE_NAME, title: extractQuality(source), url: streamUrl });
        }
    }
    return streams;
}
module.exports = {
    name: SOURCE_NAME,
    types: ['movie', 'series'],
    async getStreams(type, meta, season, episode) {
        const imdbId = meta.imdb_id || meta.id;
        const name = meta.name || '';
        if (!imdbId || !imdbId.startsWith('tt')) return [];
        if (type === 'movie') return await getMovieStreams(imdbId, name);
        else return await getSeriesStreams(imdbId, name, season, episode);
    }
};
