require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const TARGET_URLS = [
    // Social Media
    "https://glints.com/id/opportunities/jobs/explore?keyword=social+media&country=ID&locationId=a6f7a20f-7172-4436-a418-afc91020ba0f&locationName=Medan%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    "https://glints.com/id/opportunities/jobs/explore?keyword=social+media&country=ID&locationId=3a47657b-facc-45dc-9d7f-1c6fb25f49d4&locationName=Kab.+Deli+Serdang%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    // Marketing
    "https://glints.com/id/opportunities/jobs/explore?keyword=marketing&country=ID&locationId=a6f7a20f-7172-4436-a418-afc91020ba0f&locationName=Medan%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    "https://glints.com/id/opportunities/jobs/explore?keyword=Staff+Marketing&country=ID&locationId=3a47657b-facc-45dc-9d7f-1c6fb25f49d4&locationName=Kab.+Deli+Serdang%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    // IT
    "https://glints.com/id/opportunities/jobs/explore?keyword=IT&country=ID&locationId=a6f7a20f-7172-4436-a418-afc91020ba0f&locationName=Medan%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    "https://glints.com/id/opportunities/jobs/explore?keyword=IT&country=ID&locationId=3a47657b-facc-45dc-9d7f-1c6fb25f49d4&locationName=Kab.+Deli+Serdang%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    // Office Boy
    "https://glints.com/id/opportunities/jobs/explore?keyword=Office+Boy+%2F+Office+Girl&country=ID&locationId=3a47657b-facc-45dc-9d7f-1c6fb25f49d4&locationName=Kab.+Deli+Serdang%2C+Sumatera+Utara&lowestLocationLevel=3&page=1"
];

const BLACKLIST_COMPANIES = ["PT ALFA SCORPII", "ALFA SCORPII"];

// Helper to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log("Telegram message sent.");
    } catch (error) {
        console.error("Failed to send Telegram message:", error.message);
    }
}

async function verifyWithAI(job) {
    console.log(`Verifying job with AI: ${job.title} at ${job.company}`);

    // Explicitly check for blacklist before AI to save credits
    if (BLACKLIST_COMPANIES.some(b => job.company.toUpperCase().includes(b))) {
        return { valid: false, reason: "Blacklisted Company (Alfa Scorpii)" };
    }

    try {
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "google/gemini-2.0-flash-001", // Fast and cheap model
            messages: [
                {
                    role: "system",
                    content: "You are a job Verification Assistant. Your task is to verify if a job posting looks legitimate, fresh, and is NOT a scam. The user specifically wants to AVOID 'PT ALFA SCORPII' (which is already filtered, but keep it in mind). Verify the job title and company seem professional. If the job seems like a generic scam or low-quality listing, mark it invalid. valid: true/false. reason: short explanation."
                },
                {
                    role: "user",
                    content: `Analyze this job posting details:\n${job.details}\n\nLink: ${job.link}\n\nIs this job legitimate, fresh (look for 'updated x days ago', max 30 days), and worth applying to? Return ONLY JSON: {"valid": boolean, "reason": "string"}`
                }
            ]
        }, {
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        const content = response.data.choices[0].message.content;
        // Clean JSON string
        const jsonString = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonString);

    } catch (error) {
        console.error("AI Verification failed:", error.message);
        // Fallback: If AI fails, assume valid but warn
        return { valid: true, reason: "AI Check Failed (Network/API Error)" };
    }
}

(async () => {
    console.log("Starting Glints Scraper...");
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, // Use CI path or default
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const processedJobs = new Set(); // To avoid duplicates in this run

    try {
        const page = await browser.newPage();
        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        for (const url of TARGET_URLS) {
            console.log(`Scraping: ${url}`);
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

                // Scroll down to trigger lazy loading
                await page.evaluate(async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;

                            if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 5000) { // Limit scroll
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });

                await delay(2000); // Wait for content to settle

                // Extract Job Cards
                const jobs = await page.evaluate(() => {
                    const extracted = [];
                    // Primary anchor: Job Title Link
                    const jobLinks = document.querySelectorAll('a[href*="/opportunities/jobs/"]');

                    jobLinks.forEach(link => {
                        // Traverse up to find the card container.
                        // Based on debug, title is inside CompactOpportunityCardsc...
                        // We need a common parent that holds both Title and Company.

                        let container = link.closest('div[class*="JobCard"]'); // Try generic JobCard class
                        if (!container) {
                            // Fallback: Go up 4 levels (Title -> Wrapper -> Content -> Card) - Adjusted based on typical React structures
                            container = link.parentElement?.parentElement?.parentElement?.parentElement;
                        }

                        if (!container) return;

                        const companyEl = container.querySelector('a[href*="/companies/"]');
                        // Some jobs might not have a company link
                        const companyName = companyEl ? companyEl.innerText : (container.innerText.split('\n')[1] || "Unknown");

                        if (link && companyName) {
                            extracted.push({
                                title: link.innerText,
                                company: companyName,
                                link: link.href,
                                details: container.innerText
                            });
                        }
                    });
                    // Filter duplicates based on link
                    const unique = [];
                    const seen = new Set();
                    extracted.forEach(item => {
                        if (!seen.has(item.link)) {
                            seen.add(item.link);
                            unique.push(item);
                        }
                    });
                    return unique;
                });

                if (jobs.length === 0) {
                    console.log("No jobs found. Link Debug:");
                    const debugLinks = await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a[href*="/opportunities/jobs/"]'));
                        return links.slice(0, 10).map(a => ({
                            text: a.innerText,
                            href: a.href,
                            parentClass: a.parentElement.className,
                            outerHTML: a.outerHTML
                        }));
                    });
                    console.log("Found links:", JSON.stringify(debugLinks, null, 2));
                }

                console.log(`Found ${jobs.length} jobs on this page.`);

                for (const job of jobs) {
                    const uniqueId = `${job.title}-${job.company}`;
                    if (processedJobs.has(uniqueId)) continue;
                    processedJobs.add(uniqueId);

                    // 1. Hard Filter
                    if (BLACKLIST_COMPANIES.some(b => job.company.toUpperCase().includes(b))) {
                        console.log(`Skipped (Blacklisted): ${job.company}`);
                        continue;
                    }

                    // 2. AI Verification
                    const verification = await verifyWithAI(job);

                    if (verification.valid) {
                        const msg = `✅ *Job Verified*\n\n📋 *Title*: ${job.title}\n🏢 *Company*: ${job.company}\n🤖 *AI Reason*: ${verification.reason}\n\n🔗 [Apply Here](${job.link})`;
                        await sendTelegramMessage(msg);
                    } else {
                        console.log(`Skipped (AI Reject): ${job.title} - ${verification.reason}`);
                    }

                    await delay(1000); // Rate limit protection for API/Telegram
                }

            } catch (err) {
                console.error(`Error scraping ${url}:`, err.message);
            }

            await delay(3000); // Wait between pages
        }

    } catch (error) {
        console.error("Fatal Error:", error);
    } finally {
        await browser.close();
        console.log("Scraper finished.");
    }
})();
