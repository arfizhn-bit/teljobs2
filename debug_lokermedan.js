const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    const url = "https://lokermedan.co.id/";

    console.log(`Testing URL: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    await delay(3000);

    const extractedJobs = await page.evaluate(() => {
        const extracted = [];
        // Extract links directly
        const links = Array.from(document.querySelectorAll('a'))
            .filter(a => a.href && a.href.includes('-loker-') && a.href.endsWith('.html') && !a.href.includes('api.whatsapp.com'));

        links.forEach(linkEl => {
            const title = linkEl.innerText.trim() || linkEl.title || "Unknown";
            if (title.length > 5 && title.toLowerCase() !== "selengkapnya" && title.toLowerCase() !== "apply") {
                let details = "";
                const container = linkEl.closest('.job-item, .card, .post, article, div[class*="item"], div[class*="col-"]');
                if (container) {
                    details = container.innerText.trim();
                }
                extracted.push({
                    title: title,
                    link: linkEl.href,
                    details: details
                });
            }
        });

        // Remove duplicates based on link
        const unique = [];
        const seen = new Set();
        extracted.forEach(job => {
            if (!seen.has(job.link)) {
                seen.add(job.link);
                unique.push(job);
            }
        });

        return unique;
    });

    console.log(`Extracted total: ${extractedJobs.length} jobs from page 1.`);
    console.log(extractedJobs.slice(0, 3)); // show first 3

    if (extractedJobs.length <= 1) {
        console.log("No/few jobs found with first attempt. Dumping page info...");
        const title = await page.title();
        console.log("Page Title:", title);

        const html = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        console.log("Page Text Snippet:", html);

        // Find any links that look like job posts
        const potentialLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(h => h.includes('loker'));
            // get unique links
            return Array.from(new Set(links)).slice(0, 15);
        });
        console.log("Potential Job Links found anywhere:", potentialLinks);
    }

    await browser.close();
})();
