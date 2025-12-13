// StreamBDIX - By Corpse
const { extractQuality, titlesMatch, extractYear, axios } = require('./utils');
const SOURCE_NAME = 'DFLIX';
const DFLIX_URL = 'https://movies.discoveryftp.net';
const axiosConfig = {
    timeout: 5000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
};
async function search(query, type) {
    const searchType = type === 'movie' ? 'm' : 's';
    try {
        const response = await axios.post(
            `${DFLIX_URL}/search`,
            `term=${encodeURIComponent(query)}&types=${searchType}`,
            { ...axiosConfig, headers: { ...axiosConfig.headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const html = response.data;
        const results = [];
        const itemRegex = /<a href="(\/[ms]\/view\/\d+)"[^>]*>[\s\S]*?<div class="searchtitle"[^>]*>([^<]+)<\/div>[\s\S]*?<div class="searchdetails"[^>]*>([\s\S]*?)<\/div>/gi;
        let match;
        while ((match = itemRegex.exec(html)) !== null) {
            const href = match[1];
            const title = match[2].trim();
            const details = match[3].replace(/<[^>]+>/g, ' ').trim();
            if (title && href) {
                results.push({ title, details, url: DFLIX_URL + href });
            }
        }
        return results;
    } catch { return []; }
}
function extractDownloadLinks(html) {
    const links = [];
    const cdnRegex = /href="(https?:\/\/p?cdn\d*\.discoveryftp\.net[^"]*\.(?:mkv|mp4))"/gi;
    let match;
    while ((match = cdnRegex.exec(html)) !== null) {
        if (!links.includes(match[1])) links.push(match[1]);
    }
    return links;
}
function extractVariantLinks(html, currentPath) {
    const variants = [];
    const variantRegex = /href="(\/m\/view\/\d+)"/gi;
    let match;
    while ((match = variantRegex.exec(html)) !== null) {
        const href = match[1];
        if (href !== currentPath && !variants.includes(href)) variants.push(DFLIX_URL + href);
    }
    return variants;
}
async function getMovieStreams(url) {
    try {
        const response = await axios.get(url, axiosConfig);
        const html = response.data;
        const currentPath = url.replace(DFLIX_URL, '');
        let allLinks = extractDownloadLinks(html);
        const variantUrls = extractVariantLinks(html, currentPath);
        if (variantUrls.length > 0) {
            const variantResponses = await Promise.all(
                variantUrls.map(vUrl => axios.get(vUrl, axiosConfig).catch(() => null))
            );
            for (const vRes of variantResponses) {
                if (vRes && vRes.data) {
                    const variantLinks = extractDownloadLinks(vRes.data);
                    for (const link of variantLinks) {
                        if (!allLinks.includes(link)) allLinks.push(link);
                    }
                }
            }
        }
        return allLinks.map(link => ({ name: SOURCE_NAME, title: extractQuality(link), url: link }));
    } catch { return []; }
}
async function getSeriesStreams(url, season, episode) {
    try {
        const sPad = String(season).padStart(2, '0');
        const baseViewPath = url.replace(DFLIX_URL, '');
        let response = await axios.get(url, axiosConfig);
        let html = response.data;
        const seasonPageMatch = html.match(new RegExp(`href="(${baseViewPath}/${sPad})"`, 'i'));
        if (seasonPageMatch) {
            response = await axios.get(DFLIX_URL + seasonPageMatch[1], axiosConfig);
            html = response.data;
        }
        const epRegex = new RegExp(`S${season}\\s*\\|\\s*EP\\s*${episode}\\s*<a\\s+href="([^"]+\\.(?:mkv|mp4))"`, 'gi');
        const directLinks = [];
        let match;
        while ((match = epRegex.exec(html)) !== null) directLinks.push(match[1]);
        if (directLinks.length > 0) {
            return directLinks.map(link => ({ name: SOURCE_NAME, title: extractQuality(link), url: link }));
        }
        const cdnMatch = html.match(/href="(https?:\/\/cdn\d*\.discoveryftp\.net\/[^"]+\/)"\s*title="Browse/i);
        if (!cdnMatch) return [];
        const cdnUrl = cdnMatch[1];
        const cdnBase = cdnUrl.match(/^(https?:\/\/[^\/]+)/)[1];
        const cdnRes = await axios.get(cdnUrl, { ...axiosConfig, maxRedirects: 10 });
        const seasonMatch = cdnRes.data.match(new RegExp(`href="([^"]*[Ss]eason[\\s%20]+0*${season}/)`, 'i'));
        if (!seasonMatch) return [];
        const seasonUrl = seasonMatch[1].startsWith('http') ? seasonMatch[1] : cdnBase + seasonMatch[1];
        const seasonRes = await axios.get(seasonUrl, { ...axiosConfig, maxRedirects: 10 });
        const streams = [];
        const fileRegex = /<a href="([^"]*\.(?:mkv|mp4))"/gi;
        while ((match = fileRegex.exec(seasonRes.data)) !== null) {
            const filename = decodeURIComponent(match[1].split('/').pop());
            const seMatch = filename.match(/S0*(\d+)\D*E0*(\d+)/i);
            if (seMatch && parseInt(seMatch[1]) === season && parseInt(seMatch[2]) === episode) {
                const fileUrl = match[1].startsWith('http') ? match[1] :
                    match[1].startsWith('/') ? cdnBase + match[1] : seasonUrl + match[1];
                streams.push({ name: SOURCE_NAME, title: extractQuality(filename), url: fileUrl });
            }
        }
        return streams;
    } catch { return []; }
}
module.exports = {
    name: SOURCE_NAME,
    types: ['movie', 'series'],
    async getStreams(type, meta, season, episode) {
        const results = await search(meta.name, type);
        if (results.length === 0) return [];
        let bestMatch = null;
        let bestScore = 0;
        for (const result of results) {
            if (!titlesMatch(result.title, meta.name)) continue;
            let score = 10;
            if (meta.year) {
                const resultYear = extractYear(result.details || result.title);
                if (resultYear) {
                    const yearDiff = Math.abs(resultYear - meta.year);
                    if (yearDiff === 0) score += 10;
                    else if (yearDiff === 1) score += 5;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestMatch = result;
            }
        }
        if (!bestMatch) return [];
        if (type === 'movie') return await getMovieStreams(bestMatch.url);
        else return await getSeriesStreams(bestMatch.url, season, episode);
    }
};
