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
    "https://glints.com/id/opportunities/jobs/explore?keyword=Office+Boy+%2F+Office+Girl&country=ID&locationId=3a47657b-facc-45dc-9d7f-1c6fb25f49d4&locationName=Kab.+Deli+Serdang%2C+Sumatera+Utara&lowestLocationLevel=3&page=1",
    // JobStreet
    "https://id.jobstreet.com/id/jobs/in-Medan-Sumatera-Utara?source=FE_HOME&jobId=90461280&type=standard"
];

const BLACKLIST_COMPANIES = ["PT ALFA SCORPII", "ALFA SCORPII"];

// Helper to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_NOTIFICATIONS_PER_RUN = 5;

// Helper to check freshness (max 3 days)
function isFresh(text) {
    if (!text) return false;
    const lower = text.toLowerCase();

    // "Baru saja", "menit yang lalu", "jam yang lalu" -> Always fresh
    if (lower.includes("baru saja") || lower.includes("menit") || lower.includes("jam") || lower.includes("just now") || lower.includes("minutes") || lower.includes("hours")) {
        return true;
    }

    // Check days
    // Matches "1 hari", "2 days", "3 hari yang lalu", etc.
    const dayMatch = lower.match(/(\d+)\s*(hari|day)/);
    if (dayMatch) {
        const days = parseInt(dayMatch[1]);
        return days <= 3; // Limit to 3 days
    }

    // "minggu" or "bulan" -> Old
    if (lower.includes("minggu") || lower.includes("week") || lower.includes("bulan") || lower.includes("month")) {
        return false;
    }

    return false; // Strict default
}

async function sendFonnteMessage(message) {
    const url = "https://api.fonnte.com/send";
    try {
        const response = await axios.post(url, {
            target: process.env.WHATSAPP_TARGET, // Target WhatsApp Number
            message: message,
        }, {
            headers: {
                "Authorization": process.env.FONNTE_TOKEN
            }
        });
        console.log("WhatsApp message sent via Fonnte:", response.data.status);
    } catch (error) {
        console.error("Failed to send WhatsApp message:", error.message);
    }
}

async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log("Telegram message sent:", response.data.ok);
    } catch (error) {
        console.error("Failed to send Telegram message:", error.message);
    }
}

// Send notification to both WhatsApp and Telegram
async function sendNotification(message) {
    await sendFonnteMessage(message);
    await sendTelegramMessage(message);
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

const fs = require('fs');
const HISTORY_FILE = 'processed_jobs.json';

(async () => {
    console.log("Starting Scraper...");
    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, // Use CI path or default
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let processedJobs = new Set();

    // Load history
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const json = JSON.parse(data);
            processedJobs = new Set(json);
            console.log(`Loaded ${processedJobs.size} processed jobs from history.`);
        } catch (e) {
            console.error("Error reading history file:", e.message);
        }
    }

    try {
        const page = await browser.newPage();
        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let totalNotificationsSent = 0;

        for (const url of TARGET_URLS) {
            console.log(`Scraping: ${url}`);
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(2000); // Wait for content to settle

                let jobs = [];

                if (url.includes('glints.com')) {
                    // --- GLINTS SCRAPING LOGIC ---
                    console.log("Detected Glints URL");
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

                    await delay(2000);

                    // Extract Job Cards
                    jobs = await page.evaluate(() => {
                        const extracted = [];
                        // Primary anchor: Job Title Link
                        const jobLinks = document.querySelectorAll('a[href*="/opportunities/jobs/"]');

                        jobLinks.forEach(link => {
                            let container = link.closest('div[class*="JobCard"]');
                            if (!container) {
                                container = link.parentElement?.parentElement?.parentElement?.parentElement;
                            }

                            if (!container) return;

                            const companyEl = container.querySelector('a[href*="/companies/"]');
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

                        // Filter duplicates
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

                } else if (url.includes('jobstreet')) {
                    // --- JOBSTREET SCRAPING LOGIC ---
                    console.log("Detected JobStreet URL");

                    // JobStreet Infinite Scroll (Simple)
                    await page.evaluate(async () => {
                        await new Promise((resolve) => {
                            let totalHeight = 0;
                            const distance = 300;
                            let retries = 0;
                            const timer = setInterval(() => {
                                const scrollHeight = document.body.scrollHeight;
                                window.scrollBy(0, distance);
                                totalHeight += distance;

                                if (totalHeight >= scrollHeight || totalHeight > 10000) {
                                    clearInterval(timer);
                                    resolve();
                                }
                            }, 200);
                        });
                    });

                    await delay(3000);

                    jobs = await page.evaluate(() => {
                        const extracted = [];
                        // JobStreet uses <article> for job cards usually
                        const articles = document.querySelectorAll('article');

                        articles.forEach(article => {
                            const titleEl = article.querySelector('[data-automation="jobTitle"]');
                            const companyEl = article.querySelector('[data-automation="jobCompany"]');
                            const dateEl = article.querySelector('[data-automation="jobListingDate"]');
                            const locationEl = article.querySelector('[data-automation="jobLocation"]');
                            const linkEl = article.querySelector('a[data-automation="jobTitle"]') || article.querySelector('a[href*="/job/"]');

                            if (titleEl && linkEl) {
                                extracted.push({
                                    title: titleEl.innerText,
                                    company: companyEl ? companyEl.innerText : "Unknown Info",
                                    link: linkEl.href,
                                    // Combine text for context
                                    details: `${titleEl.innerText}\n${companyEl ? companyEl.innerText : ''}\n${locationEl ? locationEl.innerText : ''}\n${dateEl ? dateEl.innerText : ''}`
                                });
                            }
                        });

                        // Filter duplicates
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
                }

                if (jobs.length === 0) {
                    console.log(`No jobs found on ${url}`);
                }

                console.log(`Found ${jobs.length} jobs on this page.`);

                let notificationsSent = 0;

                for (const job of jobs) {
                    if (notificationsSent >= MAX_NOTIFICATIONS_PER_RUN) {
                        console.log("Max notifications reached for this run.");
                        break;
                    }

                    const uniqueId = `${job.title}-${job.company}`;
                    if (processedJobs.has(uniqueId)) continue;
                    processedJobs.add(uniqueId);

                    // 0. DATE Filter
                    if (!isFresh(job.details)) {
                        console.log(`Skipped (Old/No Date): ${job.title} - ${job.company}`);
                        continue;
                    }

                    // 1. Hard Filter
                    if (BLACKLIST_COMPANIES.some(b => job.company.toUpperCase().includes(b))) {
                        console.log(`Skipped (Blacklisted): ${job.company}`);
                        continue;
                    }

                    // 2. AI Verification
                    const verification = await verifyWithAI(job);

                    if (verification.valid) {
                        const msg = `✅ *Job Verified*\n\n📋 *Title*: ${job.title}\n🏢 *Company*: ${job.company}\n🤖 *AI Reason*: ${verification.reason}\n\n🔗 ${job.link}\n\n🔥 #Semangat Arfi`;
                        await sendNotification(msg);
                        notificationsSent++;
                        totalNotificationsSent++;
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

        if (totalNotificationsSent === 0) {
            console.log("No new jobs found in this run. Sending update.");
            await sendNotification("LOKER BELUM ADA FI");
        }

    } catch (error) {
        console.error("Fatal Error:", error);
        await sendNotification(`⚠️ *SCRAPER CRASHED*\n\nError: ${error.message}\n\nCheck GitHub Actions logs.`);
    } finally {
        await browser.close();

        // Save history (Limit to last 1000 to prevent infinite growth)
        try {
            const historyArray = Array.from(processedJobs).slice(-1000);
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyArray, null, 2));
            console.log("Updated job history saved.");
        } catch (e) {
            console.error("Error saving history:", e.message);
        }

        console.log("Scraper finished.");
    }
})();
