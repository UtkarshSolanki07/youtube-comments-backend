import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash';

// -- Optimized Comment Cleaner --
function preprocessComments(comments) {
    const unique = new Set();
    return comments
        .map(c => c?.trim().replace(/\s+/g, ' '))
        .filter(c =>
            c &&
            c.length >= 10 &&
            c.length <= 800 &&
            /\w/.test(c) &&
            !c.includes('http') &&
            !/^first|second|early|late$/i.test(c) &&
            !unique.has(c) && unique.add(c)
        )
        .slice(0, 100); // Tighter limit for Gemini speed
}

// -- Lightweight Prompt Template --
function createMarkdownPrompt(comments) {
    return `
Analyze YouTube comments and write a **creator-focused markdown summary**.

### Comments
- ${comments.join('\n- ')}

### Format
### Sentiment
- One line only (Positive / Mixed / Negative).

### Key Opinions
- Bullet points of repeated opinions or praise.

### Unique Views
- Outlier, surprising, or emotional takes (if any).

### Creator Insights
- 2 short bullet tips the creator can use.
`.trim();
}

// -- Gemini Request Config --
const getGeminiConfig = (prompt) => ({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
        temperature: 0.2,
        topK: 20,
        topP: 0.7,
        maxOutputTokens: 600
    },
    safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
});

// -- Output Cleaner --
function formatSummary(raw) {
    return raw
        .replace(/\*\*(.*?)\*\*/g, '**$1**') // Safe markdown bolding
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join('\n');
}

// -- Main Analysis Endpoint --
app.post("/summarize", async (req, res) => {
    const { comments } = req.body;

    if (!Array.isArray(comments) || comments.length === 0) {
        return res.status(400).json({ error: 'comments array is required' });
    }

    const cleaned = preprocessComments(comments);
    if (cleaned.length < 3) {
        return res.status(400).json({ error: 'Minimum 3 quality comments required' });
    }

    const prompt = createMarkdownPrompt(cleaned);
    const requestId = Date.now().toString();

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            getGeminiConfig(prompt),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-request-id': requestId
                },
                timeout: 25000
            }
        );

        const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) {
            return res.status(502).json({ error: 'Empty response from Gemini' });
        }

        res.json({
            summary: formatSummary(raw),
            metadata: {
                processed: cleaned.length,
                original: comments.length,
                time: new Date().toISOString(),
                requestId
            }
        });

    } catch (err) {
        console.error(`[Gemini Error][${requestId}]`, err?.response?.data || err.message);
        res.status(500).json({ error: 'Gemini summarization failed' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', model: GEMINI_MODEL, timestamp: new Date().toISOString() });
});

// Final fallback error handler
app.use((err, req, res, next) => {
    console.error('[Unhandled]', err);
    res.status(500).json({ error: 'Unexpected server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔵 Server running on port ${PORT}`);
});
