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

// Advanced prompt engineering with structured analysis
function createAnalysisPrompt(comments) {
    const commentText = comments.join('\n• ');
    
    return `You are an expert content analyst specializing in audience feedback interpretation. Analyze these YouTube comments to provide a comprehensive yet concise video assessment.

COMMENTS TO ANALYZE:
• ${commentText}

ANALYSIS FRAMEWORK:
Your response must be exactly 3-4 paragraphs, each serving a specific purpose:

**PARAGRAPH 1 - AUDIENCE RECEPTION:**
Determine overall sentiment (positive/mixed/negative) and audience engagement level. Identify the primary emotional reactions and general consensus.

**PARAGRAPH 2 - CONTENT QUALITY INSIGHTS:**
Analyze what viewers specifically praised or criticized about the video content, presentation style, information accuracy, and production quality.

**PARAGRAPH 3 - KEY THEMES & TOPICS:**
Identify the main subjects, concerns, or topics that dominate the discussion. Highlight recurring patterns in viewer feedback.

**PARAGRAPH 4 - ACTIONABLE SUMMARY:**
Provide a brief, balanced conclusion with the most important takeaways for content creators.

WRITING GUIDELINES:
- Write in a professional, analytical tone
- Use specific, concrete language rather than vague generalizations
- Include quantitative insights when patterns are clear (e.g., "majority," "several," "few")
- Avoid repetitive phrasing between paragraphs
- Focus on actionable insights rather than just listing opinions
- Maintain objectivity while being decisive in your analysis

Begin your analysis now:`;
}

// Fallback prompt for smaller comment sets
function createSimplePrompt(comments) {
    const commentText = comments.join('\n• ');
    
    return `Analyze these YouTube comments and provide a concise, insightful summary in 2-3 paragraphs:

• ${commentText}

Focus on:
1. Overall audience sentiment and engagement
2. Specific content feedback and key themes
3. Most important takeaways for understanding viewer reception

Write professionally and analytically, avoiding generic statements. Be specific about what viewers liked, disliked, or found noteworthy.`;
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

// Post-processing for better formatting
function formatSummary(rawSummary) {
    return rawSummary
        .replace(/\*\*(.*?)\*\*/g, '**$1**') // Preserve markdown
        .replace(/\n{3,}/g, '\n\n') // Normalize spacing
        .replace(/^\s+|\s+$/g, '') // Trim whitespace
        .replace(/([.!?])\s*([A-Z])/g, '$1 $2') // Fix spacing after punctuation
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n\n');
}

app.post("/summarize", async (req, res) => {
    const { comments, metadata } = req.body;
    
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
    
    const prompt = processedComments.length >= 20 
        ? createAnalysisPrompt(processedComments)
        : createSimplePrompt(processedComments);
    
    const requestConfig = getGeminiConfig(prompt);
    
    // Enhanced logging for debugging
    console.log(`Processing ${processedComments.length} comments (${comments.length} original)`);
    console.log(`Prompt length: ${prompt.length} characters`);
    
    const requestId = Date.now().toString();
    
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
            analysisType: processedComments.length >= 20 ? 'detailed' : 'simple',
            timestamp: new Date().toISOString(),
            requestId: requestId
        }
    };
    
    console.log(`Analysis complete. Request ID: ${requestId}, Summary length: ${formattedSummary.length} chars`);
    
    res.json(responseData);
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