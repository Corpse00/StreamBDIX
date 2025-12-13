// StreamBDIX - By Corpse
const { extractQuality, titlesMatch, extractYear, axios } = require('./utils');
const SOURCE_NAME = 'CircleFTP';
const API_URL = 'http://new.circleftp.net:5000/api';
function extractEpisodeNumber(title) {
    let m = title.match(/S:?\d+[\.:]*E:?(\d+)/i);
    if (!m) m = title.match(/Episode[:\s]*(\d+)/i);
    return m ? parseInt(m[1]) : null;
}
async function search(query) {
    try {
        const response = await axios.get(`${API_URL}/posts`, {
            params: { searchTerm: query, order: 'desc' },
            timeout: 5000
        });
        return response.data.posts || [];
    } catch { return []; }
}
async function getPostDetails(id) {
    try {
        const response = await axios.get(`${API_URL}/posts/${id}`, { timeout: 5000 });
        return response.data;
    } catch { return null; }
}
async function getMovieStreams(name, year) {
    const posts = await search(name);
    const matches = posts.filter(p => {
        if (p.type !== 'singleVideo') return false;
        if (!titlesMatch(p.name || p.title, name)) return false;
        if (year && p.year && Math.abs(parseInt(p.year) - year) > 1) return false;
        return true;
    });
    if (matches.length === 0) return [];
    const details = await Promise.all(matches.map(m => getPostDetails(m.id).catch(() => null)));
    const streams = [];
    const seen = new Set();
    for (let i = 0; i < matches.length; i++) {
        const detail = details[i];
        if (!detail || !detail.content) continue;
        if (seen.has(detail.content)) continue;
        seen.add(detail.content);
        streams.push({
            name: SOURCE_NAME,
            title: extractQuality(matches[i].quality || matches[i].title || detail.content),
            url: detail.content
        });
    }
    return streams;
}
async function getSeriesStreams(name, season, episode) {
    const posts = await search(name);
    const matches = posts.filter(p => {
        if (p.type !== 'series') return false;
        if (!titlesMatch(p.name || p.title, name)) return false;
        return true;
    });
    if (matches.length === 0) return [];
    const details = await Promise.all(matches.map(m => getPostDetails(m.id).catch(() => null)));
    const streams = [];
    const seen = new Set();
    for (let i = 0; i < matches.length; i++) {
        const detail = details[i];
        if (!detail || !Array.isArray(detail.content)) continue;
        const seasonData = detail.content.find(s => {
            const num = parseInt(s.seasonName.replace(/\D/g, ''));
            return num === season;
        });
        if (!seasonData || !seasonData.episodes) continue;
        const ep = seasonData.episodes.find(e => extractEpisodeNumber(e.title) === episode);
        if (!ep || !ep.link) continue;
        if (seen.has(ep.link)) continue;
        seen.add(ep.link);
        streams.push({
            name: SOURCE_NAME,
            title: extractQuality(matches[i].quality || matches[i].title || ep.link),
            url: ep.link
        });
    }
    return streams;
}
module.exports = {
    name: SOURCE_NAME,
    types: ['movie', 'series'],
    async getStreams(type, meta, season, episode) {
        const name = meta.name;
        if (!name) return [];
        if (type === 'movie') {
            return await getMovieStreams(name, meta.year);
        } else {
            return await getSeriesStreams(name, season, episode);
        }
    }
};
