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

// Enhanced comment preprocessing
function preprocessComments(comments) {
    return comments
        .filter(comment => comment && comment.trim().length > 5)
        .map(comment => comment.trim().replace(/\s+/g, ' '))
        .filter(comment => !comment.match(/^(first|second|third|early|late)$/i))
        .slice(0, 120); // Limit for token efficiency
}

// Improved prompt for concise, valuable, and well-structured markdown analysis
function createMarkdownAnalysisPrompt(comments) {
    const commentText = comments.join('\n- ');
    return `
You are an expert YouTube audience analyst. Your task is to analyze the following comments and produce a concise, actionable summary in **clear markdown**.

## Comments to Analyze
- ${commentText}

## Instructions
- **Summarize the overall sentiment** (positive, negative, or mixed) in 1-2 sentences.
- **Highlight the top 2-3 recurring themes or opinions** (e.g., praise, criticism, suggestions) using bullet points.
- **Identify any outlier or unique perspectives** if present.
- **Provide 2 actionable insights** for the video creator, each as a bullet point.
- Use markdown headings, bold for key points, and bullet points for clarity.
- Be concise, specific, and avoid generic statements.
- Do not repeat information; focus on what matters most to creators.

## Output Format Example

### Sentiment
**Overall:** Positive

### Key Themes
- **High praise** for video clarity and editing.
- **Requests** for more in-depth examples.
- **Mixed feedback** on pacing.

### Unique Opinions
- One viewer suggested adding subtitles for accessibility.

### Actionable Insights
- Consider adding more detailed examples in future videos.
- Explore adding subtitles to improve accessibility.

Now, analyze the comments and provide your summary in this format.
`.trim();
}

// Enhanced API configuration
const getGeminiConfig = (prompt) => ({
    contents: [{
        parts: [{ text: prompt }]
    }],
    generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 800,
        stopSequences: []
    },
    safetySettings: [
        {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            category: "HARM_CATEGORY_HATE_SPEECH", 
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
    ]
});

// Post-processing for better markdown formatting
function formatSummary(rawSummary) {
    return rawSummary
        .replace(/\*\*(.*?)\*\*/g, '**$1**') // Preserve markdown
        .replace(/\n{3,}/g, '\n\n') // Normalize spacing
        .replace(/^\s+|\s+$/g, '') // Trim whitespace
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n\n');
}

app.post("/summarize", async (req, res) => {
    const { comments } = req.body;

    // Enhanced input validation
    if (!comments || !Array.isArray(comments) || comments.length === 0) {
        return res.status(400).json({ 
            error: 'Invalid input: comments array is required and must not be empty' 
        });
    }

    if (comments.length > 200) {
        return res.status(400).json({ 
            error: 'Too many comments: maximum 200 comments allowed per request' 
        });
    }

    const processedComments = preprocessComments(comments);

    if (processedComments.length < 3) {
        return res.status(400).json({ 
            error: 'Insufficient comments: at least 3 meaningful comments required for analysis' 
        });
    }

    // Always use improved markdown prompt
    const prompt = createMarkdownAnalysisPrompt(processedComments);

    const requestConfig = getGeminiConfig(prompt);

    // Enhanced logging for debugging
    console.log(`Processing ${processedComments.length} comments (${comments.length} original)`);
    console.log(`Prompt length: ${prompt.length} characters`);

    const requestId = Date.now().toString();

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            requestConfig,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-request-id': requestId
                },
                timeout: 30000
            }
        );

        // Enhanced response validation
        if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error('Invalid Gemini response structure:', JSON.stringify(response.data, null, 2));
            return res.status(502).json({ 
                error: 'Invalid response from AI service' 
            });
        }

        const rawSummary = response.data.candidates[0].content.parts[0].text;
        const formattedSummary = formatSummary(rawSummary);

        // Enhanced response with metadata
        const responseData = {
            summary: formattedSummary,
            metadata: {
                commentsProcessed: processedComments.length,
                originalCount: comments.length,
                analysisType: 'markdown-structured',
                timestamp: new Date().toISOString(),
                requestId: requestId
            }
        };

        console.log(`Analysis complete. Request ID: ${requestId}, Summary length: ${formattedSummary.length} chars`);

        res.json(responseData);
    } catch (err) {
        console.error('Error during Gemini API call:', err);
        res.status(500).json({
            error: 'Failed to generate summary'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        model: GEMINI_MODEL 
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        requestId: Date.now().toString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Using Gemini model: ${GEMINI_MODEL}`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);
});