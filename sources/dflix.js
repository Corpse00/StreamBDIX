const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE_NAME = 'DFLIX';
const DFLIX_URL = 'https://movies.discoveryftp.net';

async function fetchPage(url) {
    return axios.get(url, {
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
}

async function postPage(url, data) {
    return axios.post(url, data, {
        headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
    });
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

function extractYear(text) {
    const match = text.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? parseInt(match[1]) : null;
}

function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^\w]/g, '');
}

function titlesMatch(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);
    return norm1.includes(norm2) || norm2.includes(norm1);
}

async function search(query, type) {
    const searchType = type === 'movie' ? 'm' : 's';
    
    try {
        const response = await postPage(`${DFLIX_URL}/search`, `term=${encodeURIComponent(query)}&types=${searchType}`);
        const $ = cheerio.load(response.data);
        
        const results = [];
        $('div.moviesearchiteam').each((_, item) => {
            const $item = $(item);
            const title = $item.find('div.searchtitle').text().trim();
            const details = $item.find('div.searchdetails').text().trim();
            const href = $item.find('a').attr('href');
            if (title && href) {
                results.push({ title, details, url: DFLIX_URL + href });
            }
        });
        
        return results;
    } catch (error) {
        return [];
    }
}

async function getMovieStreams(url) {
    try {
        const response = await fetchPage(url);
        const $ = cheerio.load(response.data);
        const streams = [];

        $('a').each((_, el) => {
            const $el = $(el);
            const href = $el.attr('href') || '';
            const text = $el.text().trim().toLowerCase();
            
            if (text.includes('download') && (href.includes('.mkv') || href.includes('.mp4'))) {
                const quality = extractQuality(href);
                streams.push({
                    name: SOURCE_NAME,
                    title: quality,
                    url: href
                });
            }
        });

        const qualityLinks = [];
        $('a.badge, div.badge-outline a, a.btn-outline-success').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (href && href.startsWith('/m/view/') && !href.includes('.mkv')) {
                qualityLinks.push({ text, url: DFLIX_URL + href });
            }
        });

        for (const link of qualityLinks) {
            if (link.url !== url) {
                try {
                    const variantResponse = await fetchPage(link.url);
                    const $variant = cheerio.load(variantResponse.data);
                    
                    $variant('a').each((_, el) => {
                        const $el = $variant(el);
                        const href = $el.attr('href') || '';
                        const text = $el.text().trim().toLowerCase();
                        
                        if (text.includes('download') && (href.includes('.mkv') || href.includes('.mp4'))) {
                            if (!streams.find(s => s.url === href)) {
                                streams.push({
                                    name: SOURCE_NAME,
                                    title: extractQuality(href),
                                    url: href
                                });
                            }
                        }
                    });
                } catch (e) { /* ignore variant errors */ }
            }
        }
        
        return streams;
    } catch (error) {
        return [];
    }
}

async function getSeriesStreams(url, season, episode) {
    try {
        const seasonPadded = String(season).padStart(2, '0');
        const seasonUrl = `${url}/${seasonPadded}`;
        
        const response = await fetchPage(seasonUrl);
        const $ = cheerio.load(response.data);
        const streams = [];

        $('h5').each((_, el) => {
            const $h5 = $(el);
            const text = $h5.text().trim();
            const link = $h5.find('a').attr('href');
            
            const epMatch = text.match(/EP\s*(\d+)/i);
            if (epMatch && link && parseInt(epMatch[1]) === episode) {
                streams.push({
                    name: SOURCE_NAME,
                    title: extractQuality(link),
                    url: link
                });
            }
        });
        
        return streams;
    } catch (error) {
        return [];
    }
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

        if (type === 'movie') {
            return await getMovieStreams(bestMatch.url);
        } else {
            return await getSeriesStreams(bestMatch.url, season, episode);
        }
    }
};
