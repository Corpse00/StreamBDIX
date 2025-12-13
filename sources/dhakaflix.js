const axios = require('axios');

const SOURCE_NAME = 'DHAKAFLIX';

const SERVERS = {
    movies: {
        url: 'http://172.16.50.14',
        name: 'DHAKA-FLIX-14',
        types: ['movie']
    },
    series: {
        url: 'http://172.16.50.12',
        name: 'DHAKA-FLIX-12',
        types: ['series']
    }
};

function getNameFromPath(href) {
    const decoded = decodeURIComponent(href);
    const parts = decoded.split('/').filter(p => p);
    return parts[parts.length - 1] || '';
}

function extractTitleAndYear(filename) {
    let match = filename.match(/^(.+?)\s*\((\d{4})\)/);
    if (match) {
        return { title: match[1].trim(), year: parseInt(match[2]) };
    }
    
    match = filename.match(/\b(19\d{2}|20\d{2})\b/);
    if (match) {
        const year = parseInt(match[1]);
        const titleMatch = filename.match(/^(.+?)(?:\s*[\(\[\-\|]|\s+\d{4}|$)/);
        return { title: titleMatch ? titleMatch[1].trim() : filename, year };
    }
    
    return { title: filename, year: null };
}

function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^\w]/g, '');
}

function titlesMatch(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);
    return norm1.includes(norm2) || norm2.includes(norm1);
}

function extractQuality(filename) {
    let quality = 'Unknown';
    if (filename.includes('2160p') || filename.includes('4K') || filename.includes('4k')) quality = '4K';
    else if (filename.includes('1080p')) quality = '1080p';
    else if (filename.includes('720p')) quality = '720p';
    else if (filename.includes('480p')) quality = '480p';
    
    let source = '';
    const fn = filename.toLowerCase();
    if (fn.includes('imax')) source = 'IMAX';
    else if (fn.includes('hmax') || fn.includes('hbo max')) source = 'HMAX';
    else if (fn.includes('bluray') || fn.includes('blu-ray')) source = 'BluRay';
    else if (fn.includes('brrip') || fn.includes('bdrip')) source = 'BRRip';
    else if (fn.includes('web-dl') || fn.includes('webdl')) source = 'WEB-DL';
    else if (fn.includes('webrip')) source = 'WEBRip';
    else if (fn.includes('hdrip')) source = 'HDRip';
    else if (fn.includes('dvdrip')) source = 'DVDRip';
    else if (fn.includes('hdtv')) source = 'HDTV';
    
    return `${quality}${source ? ' ' + source : ''}`;
}

function extractSeasonEpisode(filename) {
    const match = filename.match(/S(\d+)E(\d+)/i);
    if (match) {
        return { season: parseInt(match[1]), episode: parseInt(match[2]) };
    }
    return null;
}

async function searchServer(query, server) {
    try {
        const searchUrl = `${server.url}/${server.name}/`;
        const body = JSON.stringify({
            action: 'get',
            search: {
                href: `/${server.name}/`,
                pattern: query,
                ignorecase: true
            }
        });
        
        const response = await axios.post(searchUrl, body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        });
        
        if (!response.data?.search) return [];
        
        return response.data.search
            .filter(item => {
                const href = item.href.toLowerCase();
                return !item.size || href.endsWith('.mkv') || href.endsWith('.mp4');
            })
            .map(item => ({
                href: item.href,
                name: getNameFromPath(item.href),
                isFile: item.size !== null,
                fullUrl: server.url + item.href
            }));
    } catch (error) {
        return [];
    }
}

function findMovieStreams(results, metaName, metaYear) {
    const streams = [];
    const seen = new Set();
    
    for (const result of results) {
        if (!result.isFile) continue;
        
        const { title: fileTitle, year: fileYear } = extractTitleAndYear(result.name);
        
        if (!titlesMatch(fileTitle, metaName)) continue;
        if (metaYear && fileYear && Math.abs(metaYear - fileYear) > 1) continue;
        if (seen.has(result.fullUrl)) continue;
        seen.add(result.fullUrl);
        
        streams.push({
            name: SOURCE_NAME,
            title: extractQuality(result.name),
            url: result.fullUrl
        });
    }
    
    return streams;
}

function findSeriesStreams(results, metaName, targetSeason, targetEpisode) {
    const streams = [];
    const seen = new Set();
    
    for (const result of results) {
        if (!result.isFile) continue;
        
        const { title: fileTitle } = extractTitleAndYear(result.name);
        if (!titlesMatch(fileTitle, metaName)) continue;
        
        const seInfo = extractSeasonEpisode(result.name);
        if (!seInfo) continue;
        if (seInfo.season !== targetSeason || seInfo.episode !== targetEpisode) continue;
        
        if (seen.has(result.fullUrl)) continue;
        seen.add(result.fullUrl);
        
        streams.push({
            name: SOURCE_NAME,
            title: extractQuality(result.name),
            url: result.fullUrl
        });
    }
    
    return streams;
}

function getSearchTerms(title) {
    const cleaned = title.replace(/[:\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = cleaned.split(' ').filter(w => w.length > 2);
    
    const terms = [];
    if (words.length > 0) terms.push(words[0]);
    if (words.length > 1) terms.push(words.slice(0, 2).join(' '));
    terms.push(cleaned);
    
    return [...new Set(terms)];
}

module.exports = {
    name: SOURCE_NAME,
    types: ['movie', 'series'],
    
    async getStreams(type, meta, season, episode) {
        const server = type === 'movie' ? SERVERS.movies : SERVERS.series;
        
        const searchTerms = getSearchTerms(meta.name);
        let allResults = [];
        
        for (const term of searchTerms) {
            const results = await searchServer(term, server);
            if (results.length > 0) {
                allResults = results;
                break;
            }
        }
        
        if (allResults.length === 0) return [];

        if (type === 'movie') {
            return findMovieStreams(allResults, meta.name, meta.year);
        } else {
            return findSeriesStreams(allResults, meta.name, season, episode);
        }
    }
};
