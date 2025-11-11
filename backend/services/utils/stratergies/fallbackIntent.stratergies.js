import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { handleMovieRecommendation } from "./movieRecommend.stratergies.js";
import { handleMovieRecommendByName } from "./movieRecommendByName.stratergies.js";
import { handleRecommendPersonalization } from "./recommendPersonalization.stratergies.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback query logger
function logFallbackQuery(text, matchedBy, confidence = null, intent = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    query: text,
    matchedBy, // 'keyword', 'deepseek', 'heuristic', 'default'
    confidence,
    intent,
  };
  
  // Save to root logs folder (go up from services/utils/stratergies)
  const rootDir = path.join(__dirname, '../../..');
  const logFile = path.join(rootDir, '../logs/fallback_queries.jsonl');
  const logDir = path.dirname(logFile);
  
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('Failed to log fallback query:', err.message);
  }
}

// Save sample queries to JSON file for training/analysis
function saveFallbackSample(text, matchedBy, confidence = null, intent = null) {
  // Only save queries that were successfully classified
  if (matchedBy !== 'keyword' && matchedBy !== 'deepseek' && matchedBy !== 'sentence_transformer') {
    return; // Skip error cases, low confidence, etc.
  }
  
  const rootDir = path.join(__dirname, '../../..');
  const sampleFile = path.join(rootDir, '../logs/fallback_sample.json');
  const logDir = path.dirname(sampleFile);
  
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Read existing samples or create new structure
    let samples = {
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalSamples: 0,
        byMethod: {},
        byIntent: {}
      },
      samples: {
        keyword: {},
        deepseek: {},
        sentence_transformer: {}
      }
    };
    
    if (fs.existsSync(sampleFile)) {
      try {
        const content = fs.readFileSync(sampleFile, 'utf-8');
        samples = JSON.parse(content);
      } catch (parseErr) {
        console.warn('Failed to parse existing sample file, creating new one');
      }
    }
    
    // Ensure structure exists
    if (!samples.samples) samples.samples = { keyword: {}, deepseek: {}, sentence_transformer: {} };
    if (!samples.samples[matchedBy]) samples.samples[matchedBy] = {};
    if (!samples.samples[matchedBy][intent]) samples.samples[matchedBy][intent] = [];
    
    // Add new sample if not duplicate
    const existingSamples = samples.samples[matchedBy][intent];
    const isDuplicate = existingSamples.some(s => s.query.toLowerCase() === text.toLowerCase());
    
    if (!isDuplicate) {
      existingSamples.push({
        query: text,
        confidence: confidence,
        timestamp: new Date().toISOString()
      });
      
      // Update metadata
      samples.metadata.lastUpdated = new Date().toISOString();
      samples.metadata.totalSamples = Object.values(samples.samples)
        .flatMap(methodSamples => Object.values(methodSamples))
        .reduce((sum, arr) => sum + arr.length, 0);
      
      // Count by method
      samples.metadata.byMethod = {};
      for (const [method, intents] of Object.entries(samples.samples)) {
        samples.metadata.byMethod[method] = Object.values(intents)
          .reduce((sum, arr) => sum + arr.length, 0);
      }
      
      // Count by intent
      samples.metadata.byIntent = {};
      for (const methodSamples of Object.values(samples.samples)) {
        for (const [intentName, queries] of Object.entries(methodSamples)) {
          if (!samples.metadata.byIntent[intentName]) {
            samples.metadata.byIntent[intentName] = 0;
          }
          samples.metadata.byIntent[intentName] += queries.length;
        }
      }
      
      // Write back to file with pretty formatting
      fs.writeFileSync(sampleFile, JSON.stringify(samples, null, 2), 'utf-8');
      console.log(`✓ Saved sample: [${matchedBy}] ${intent} - "${text.substring(0, 50)}..."`);
    }
  } catch (err) {
    console.error('Failed to save fallback sample:', err.message);
  }
}

// Advanced keyword matcher with patterns
function tryKeywordMatch(text) {
  if (!text || typeof text !== 'string') return null;
  
  const lower = text.toLowerCase().trim();
  
  // Pattern 1: Movie by name - có từ khóa rõ ràng về tên phim
  const byNamePatterns = [
    /gợi ý.*phim.*(giống|tương tự|như|theo)/i,
    /phim.*(giống|tương tự|như).*(phim)?\s+[A-Z]/i,
    /tìm.*phim.*(giống|tương tự|như)/i,
    /(có|biết).*phim.*nào.*(giống|tương tự|như)/i,
    /phim.*kiểu.*như/i,
  ];
  
  for (const pattern of byNamePatterns) {
    if (pattern.test(text)) {
      console.log('✓ Keyword match: recommend_movie_by_name (pattern)');
      return { intent: 'recommend_movie_by_name', method: 'keyword_pattern' };
    }
  }
  
  // Check for explicit movie names mentions
  if ((lower.includes('tên') || lower.includes('name') || lower.includes('similar') || 
       lower.includes('giống') || lower.includes('như') || lower.includes('tương tự')) &&
      (lower.includes('phim') || lower.includes('movie') || lower.includes('film'))) {
    console.log('✓ Keyword match: recommend_movie_by_name (explicit)');
    return { intent: 'recommend_movie_by_name', method: 'keyword_explicit' };
  }
  
  // Pattern 2: Personalized recommendations
  const personalizationPatterns = [
    /gợi ý.*phim.*(cá nhân|cho tôi|cho mình|phù hợp với tôi)/i,
    /phim.*(cá nhân|phù hợp|dành cho tôi)/i,
    /đề xuất.*phim.*(cho tôi|cho mình)/i,
    /(tôi|mình).*(thích|yêu).*phim.*nào/i,
    /phim.*nào.*(phù hợp|hay).*(cho tôi|với tôi)/i,
    /dựa trên.*(sở thích|lịch sử|đánh giá)/i,
  ];
  
  for (const pattern of personalizationPatterns) {
    if (pattern.test(text)) {
      console.log('✓ Keyword match: recommend_personalization (pattern)');
      return { intent: 'recommend_personalization', method: 'keyword_pattern' };
    }
  }
  
  if ((lower.includes('cá nhân') || lower.includes('personal') || 
       lower.includes('cho tôi') || lower.includes('cho mình') ||
       lower.includes('đánh giá') || lower.includes('sở thích') ||
       lower.includes('phù hợp với tôi')) &&
      (lower.includes('phim') || lower.includes('movie') || lower.includes('gợi ý') || lower.includes('đề xuất'))) {
    console.log('✓ Keyword match: recommend_personalization (explicit)');
    return { intent: 'recommend_personalization', method: 'keyword_explicit' };
  }
  
  // Pattern 3: General movie recommendations (thể loại, mood, etc)
  const generalPatterns = [
    /gợi ý.*phim.*(hành động|kinh dị|tình cảm|hài|khoa học|viễn tưởng|phiêu lưu|hoạt hình)/i,
    /phim.*(hành động|kinh dị|tình cảm|hài|khoa học|viễn tưởng|phiêu lưu|hoạt hình).*nào.*hay/i,
    /tìm.*phim.*(hay|đáng xem|hot|mới)/i,
    /phim.*nào.*(hay|đáng xem|hot|mới)/i,
    /có.*phim.*nào.*(để xem|xem)/i,
    /(muốn|cần).*xem.*phim/i,
    /gợi ý.*phim.*cho.*(cuối tuần|tối nay|hôm nay)/i,
  ];
  
  for (const pattern of generalPatterns) {
    if (pattern.test(text)) {
      console.log('✓ Keyword match: movie_recommendation_request (pattern)');
      return { intent: 'movie_recommendation_request', method: 'keyword_pattern' };
    }
  }
  
  // Simple keyword check for general recommendations
  if ((lower.includes('gợi ý') || lower.includes('recommend') || lower.includes('đề xuất') || 
       lower.includes('tìm') || lower.includes('có phim nào')) &&
      (lower.includes('phim') || lower.includes('movie') || lower.includes('film'))) {
    console.log('✓ Keyword match: movie_recommendation_request (general)');
    return { intent: 'movie_recommendation_request', method: 'keyword_general' };
  }
  
  return null;
}

/**
 * Fallback intent handler that calls an external DEEP_SEEK_API to classify the incoming
 * request text to one of the known intents, then forwards the request to that intent's handler.
 * If the API is unavailable or returns low-confidence, uses simple keyword heuristics.
 *
 * Input: request (Dialogflow-like request object)
 * Output: object with `fulfillmentMessages` (Dialogflow response shape) or whatever the delegated handler returns.
 */
export async function handleFallbackIntent(request) {
  console.log("=== handleFallbackIntent called ===");

  // Read env variables at runtime to ensure they're loaded
  const DEEP_SEEK_API = process.env.DEEP_SEEK_API;
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL;

  // Extract best text candidate from several common fields
  const textCandidates = request.text ? [request.text] : [];
  console.log("Text candidates:", textCandidates);
  console.log("Env flags:", {
    DEEP_SEEK_API: !!DEEP_SEEK_API,
    DEEPSEEK_API_KEY: !!DEEPSEEK_API_KEY,
    DEEPSEEK_API_URL: !!DEEPSEEK_API_URL,
  });
  let text = (textCandidates.find((t) => typeof t === "string" && t.trim().length > 0) || "").trim();
  if (!text) {
    try {
      text = JSON.stringify(request || {}).slice(0, 1000);
    } catch (e) {
      text = "";
    }
  }

  // Known intents and mapping to handlers (keep duplicated mapping local to avoid circular imports)
  const intentMap = {
    movie_recommendation_request: handleMovieRecommendation,
    recommend_movie_by_name: handleMovieRecommendByName,
    recommend_personalization: handleRecommendPersonalization,
  };

  // ===== STEP 1: TRY KEYWORD MATCHING FIRST (NO API CALL) =====
  console.log("Step 1: Trying keyword matching...");
  const keywordMatch = tryKeywordMatch(text);
  if (keywordMatch && intentMap[keywordMatch.intent]) {
    console.log(`✅ Matched by keywords: ${keywordMatch.intent} (${keywordMatch.method})`);
    logFallbackQuery(text, 'keyword', 1.0, keywordMatch.intent);
    saveFallbackSample(text, 'keyword', 1.0, keywordMatch.intent);
    try {
      const result = await intentMap[keywordMatch.intent](request);
      if (result && typeof result === "object") {
        result.debug = Object.assign({}, result.debug || {}, { 
          matchedBy: 'keyword', 
          method: keywordMatch.method,
          intent: keywordMatch.intent 
        });
      }
      return result;
    } catch (e) {
      console.error("Error in keyword-matched handler:", e.message);
      // Continue to API fallback
    }
  }
  console.log("No keyword match found, checking API availability...");

  // ===== STEP 2: TRY LOCAL SENTENCE TRANSFORMER CLASSIFIER =====
  console.log("Step 2: Trying local Sentence Transformer classifier...");
  const FLASK_API_URL = process.env.FLASK_API_URL || "http://localhost:5000";
  
  try {
    const classifyResp = await axios.post(`${FLASK_API_URL}/classify_intent`, 
      { query: text },
      { timeout: 10000 }  // Fast timeout for local service
    );
    
    if (classifyResp.data && classifyResp.data.ok) {
      const { intent: chosen, confidence, method } = classifyResp.data;
      console.log(`Local classifier result: ${chosen} (confidence: ${confidence}, method: ${method})`);
      
      const LOCAL_THRESHOLD = 0.5;  // Lower threshold for local classifier
      if (chosen && intentMap[chosen] && confidence >= LOCAL_THRESHOLD) {
        console.log(`✅ Local classifier matched: ${chosen} (confidence=${confidence})`);
        logFallbackQuery(text, 'sentence_transformer', confidence, chosen);
        saveFallbackSample(text, 'sentence_transformer', confidence, chosen);
        
        try {
          const result = await intentMap[chosen](request);
          if (result && typeof result === "object") {
            result.debug = Object.assign({}, result.debug || {}, { 
              matchedBy: 'sentence_transformer',
              confidence: confidence,
              intent: chosen 
            });
          }
          return result;
        } catch (e) {
          console.error("Error in sentence-transformer-matched handler:", e.message);
          // Continue to DeepSeek fallback
        }
      } else {
        console.log(`⚠️  Local classifier confidence too low (${confidence} < ${LOCAL_THRESHOLD})`);
      }
    }
  } catch (localErr) {
    console.log("Local classifier unavailable, falling back to DeepSeek API:", localErr.message);
  }

  // ===== STEP 3: CHECK IF DEEPSEEK API IS AVAILABLE =====
  const hasDirectApi = !!DEEP_SEEK_API;
  const hasKeyUrlPair = !!DEEPSEEK_API_KEY && !!DEEPSEEK_API_URL;

  if (!hasDirectApi && !hasKeyUrlPair) {
    console.warn("DEEP_SEEK API not configured. Using simple heuristics.");
    logFallbackQuery(text, 'heuristic_no_api', 0.5, null);
    
    const lower = (text || "").toLowerCase();
    if (lower.includes("tên") || lower.includes("name") || lower.includes("similar") || lower.includes("giống")) {
      return handleMovieRecommendByName(request);
    }
    if (lower.includes("cá nhân") || lower.includes("personal") || lower.includes("đánh giá")) {
      return handleRecommendPersonalization(request);
    }
    return handleMovieRecommendation(request);
  }

  // ===== STEP 4: USE DEEPSEEK API FOR COMPLEX/AMBIGUOUS QUERIES =====
  console.log("Step 3: Calling DeepSeek API for complex query classification...");
  
  try {
    // Build prompt for intent classification
    const intentList = Object.keys(intentMap).join(", ");
    const systemPrompt = `You are an intent classifier for a movie recommendation chatbot. 
Given user text, classify it into ONE of these intents:
- movie_recommendation_request: General movie recommendations (genre, mood, etc.)
- recommend_movie_by_name: Find similar movies based on a movie name
- recommend_personalization: Personalized recommendations based on user history/ratings

Respond ONLY with a JSON object in this exact format:
{"intent": "intent_name", "confidence": 0.95}

Available intents: ${intentList}`;

    const payload = {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.3,
      max_tokens: 100,
      response_format: { type: "json_object" }
    };
    
    console.log("Calling DEEP_SEEK_API with text:", text.substring(0, 100));

    let resp;
    if (hasDirectApi) {
      resp = await axios.post(DEEP_SEEK_API, payload, { 
        timeout: 8000,
        headers: { "Content-Type": "application/json" }
      });
    } else {
      // hasKeyUrlPair is true (we checked earlier). Use the URL with Authorization header.
      const headers = { 
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      };
      resp = await axios.post(DEEPSEEK_API_URL, payload, { headers, timeout: 8000 });
    }
    const data = resp && resp.data ? resp.data : null;
    console.log("DEEP_SEEK_API response received:", !!data);

    let chosen = null;
    let confidence = 0;

    if (data && data.choices && data.choices.length > 0) {
      // Parse DeepSeek response (OpenAI format)
      const content = data.choices[0].message?.content;
      console.log("DeepSeek response content:", content);
      
      if (content) {
        try {
          const parsed = JSON.parse(content);
          chosen = parsed.intent;
          confidence = parsed.confidence || 0;
          console.log("Parsed intent:", chosen, "confidence:", confidence);
        } catch (parseErr) {
          console.error("Failed to parse DeepSeek JSON response:", parseErr.message);
          // Try to extract intent from text response
          const intentMatch = content.match(/movie_recommendation_request|recommend_movie_by_name|recommend_personalization/i);
          if (intentMatch) {
            chosen = intentMatch[0].toLowerCase();
            confidence = 0.7;
            console.log("Extracted intent from text:", chosen);
          }
        }
      }
    }

    const THRESHOLD = 0.6;
    if (chosen && intentMap[chosen] && confidence >= THRESHOLD) {
      console.log(`✅ DeepSeek classified: ${chosen} (confidence=${confidence}). Routing to handler.`);
      logFallbackQuery(text, 'deepseek', confidence, chosen);
      saveFallbackSample(text, 'deepseek', confidence, chosen);
      
      try {
        const result = await intentMap[chosen](request);
        // attach debug info for troubleshooting
        if (result && typeof result === "object") {
          result.debug = Object.assign({}, result.debug || {}, { 
            matchedBy: 'deepseek',
            _deep_seek: { chosen, confidence, raw: data } 
          });
        }
        return result;
      } catch (e) {
        console.error("Error while delegating to chosen intent handler:", e && e.message ? e.message : e);
        // fallthrough to default friendly error
      }
    }

    // ===== STEP 4: CONFIDENCE TOO LOW - USE AI TO RESPOND HELPFULLY =====
    console.log(`⚠️  Confidence too low (${confidence}) or no intent detected. Asking DeepSeek to respond directly.`);
    logFallbackQuery(text, 'deepseek_low_confidence', confidence, chosen);
    
    try {
      const helpfulPrompt = `Bạn là trợ lý chatbot gợi ý phim thông minh. Người dùng vừa hỏi: "${text}"

Hệ thống không chắc chắn về ý định của người dùng. Hãy:
1. Trả lời câu hỏi của người dùng một cách hữu ích và thân thiện
2. Giới thiệu các tính năng có sẵn trong hệ thống:
   - 🎬 Gợi ý phim theo thể loại, tâm trạng (ví dụ: "Gợi ý phim hành động", "Phim hay cho tối cuối tuần")
   - 🎯 Gợi ý phim tương tự theo tên (ví dụ: "Gợi ý phim giống Inception", "Phim như Titanic")
   - ⭐ Gợi ý phim cá nhân hóa dựa trên lịch sử đánh giá của bạn (ví dụ: "Gợi ý phim cá nhân", "Phim phù hợp với tôi")

Trả lời ngắn gọn, thân thiện bằng tiếng Việt (2-3 câu). Không dùng markdown.`;

      const helpfulPayload = {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Bạn là trợ lý chatbot gợi ý phim thân thiện. Trả lời ngắn gọn, hữu ích." },
          { role: "user", content: helpfulPrompt }
        ],
        temperature: 0.7,
        max_tokens: 200
      };

      let helpfulResp;
      if (hasDirectApi) {
        helpfulResp = await axios.post(DEEP_SEEK_API, helpfulPayload, { 
          timeout: 8000,
          headers: { "Content-Type": "application/json" }
        });
      } else {
        const headers = { 
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        };
        helpfulResp = await axios.post(DEEPSEEK_API_URL, helpfulPayload, { headers, timeout: 8000 });
      }

      const helpfulData = helpfulResp?.data;
      if (helpfulData && helpfulData.choices && helpfulData.choices.length > 0) {
        const helpfulContent = helpfulData.choices[0].message?.content?.trim();
        console.log("DeepSeek helpful response:", helpfulContent);
        
        if (helpfulContent) {
          return {
            fulfillmentMessages: [
              { text: { text: [helpfulContent] } }
            ],
            debug: { 
              deepSeek: { 
                classification: { chosen, confidence }, 
                helpfulResponse: helpfulData 
              }, 
              text 
            }
          };
        }
      }
    } catch (helpErr) {
      console.error("Error getting helpful response from DeepSeek:", helpErr.message);
    }

    // ===== STEP 5: FINAL FALLBACK - DEFAULT HELP MESSAGE =====
    console.log("⚠️  Returning default fallback message.");
    logFallbackQuery(text, 'default_fallback', 0, null);
    
    return {
      fulfillmentMessages: [
        { text: { text: ["Xin lỗi, tôi chưa hiểu rõ yêu cầu của bạn. Tôi có thể giúp bạn:\n\n🎬 Gợi ý phim theo thể loại hoặc tâm trạng (ví dụ: \"Gợi ý phim hành động\")\n🎯 Tìm phim tương tự (ví dụ: \"Gợi ý phim giống Inception\")\n⭐ Gợi ý phim cá nhân hóa dựa trên sở thích của bạn\n\nBạn muốn thử tính năng nào?"] } }
      ],
      debug: { matchedBy: 'default_fallback', deepSeek: data, text }
    };
  } catch (err) {
    console.error("❌ Error calling DEEP_SEEK_API:", err && err.message ? err.message : err);
    if (err.response) {
      console.error("API response status:", err.response.status);
      console.error("API response data:", JSON.stringify(err.response.data).substring(0, 500));
    }
    
    // ===== API ERROR FALLBACK - USE SIMPLE HEURISTICS =====
    console.log("⚠️  API error, falling back to simple heuristics");
    logFallbackQuery(text, 'error_fallback', 0, null);
    
    const lower = (text || "").toLowerCase();
    if (lower.includes("tên") || lower.includes("name") || lower.includes("similar") || lower.includes("giống")) {
      return handleMovieRecommendByName(request);
    }
    if (lower.includes("cá nhân") || lower.includes("personal") || lower.includes("đánh giá")) {
      return handleRecommendPersonalization(request);
    }
    return handleMovieRecommendation(request);
  }
}
