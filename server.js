import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY= process.env.GEMINI_API_KEY;

app.post("/summarize",async(req,res)=>{
    const {comments} = req.body;
    try{
        const prompt=`You're a smart video critic. Based on these YouTube comments, write a short and critical review of the video:\n\n${comments.join('\n')}`;

        const response=await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            contents:[{parts:[{text:prompt}]}]
        }
        );
        const summary=response.data.candidates[0].content.parts[0].text;
        res.send({summary});

    }catch(e){
        console.error(e.response?.data || e.message);
        res.status(500).send({error: 'Failed to summarize comments'});
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server Running");
});