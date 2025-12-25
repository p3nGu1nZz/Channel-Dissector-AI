import { GoogleGenAI, Type } from "@google/genai";
import { TopicGraphData, PresentationData, VideoData } from "../types";

// Helper to sanitize JSON string if the model returns markdown code blocks
const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  // Remove markdown blocks
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  
  // Attempt to fix common trailing comma errors if near end
  cleaned = cleaned.replace(/,\s*}/g, "}");
  cleaned = cleaned.replace(/,\s*]/g, "]");

  // CRITICAL FIX: Cap excessively large numbers before parsing
  // Matches "key": 123456789...
  cleaned = cleaned.replace(/:\s*(\d{10,})/g, ': 10'); 

  return cleaned;
};

// Robust parser that attempts to fix truncated JSON
const safeParse = (jsonString: string): any => {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.warn("JSON Parse failed, attempting repair...", e);
    let repaired = jsonString.trim();
    
    // 1. Fix unclosed strings
    const quoteCount = (repaired.match(/"/g) || []).length;
    // Check if the last quote is escaped
    const isLastQuoteEscaped = /\\"$/.test(repaired);
    if (quoteCount % 2 !== 0 && !isLastQuoteEscaped) {
        repaired += '"';
    }

    // 2. Fix unclosed structures (Stack based approach)
    const stack: string[] = [];
    let inString = false;
    let escape = false;

    // Scan the string to build the expected closing stack
    for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (char === '"' && !escape) {
            inString = !inString;
        }
        if (!inString) {
            if (char === '{') stack.push('}');
            else if (char === '[') stack.push(']');
            else if (char === '}' || char === ']') {
                // Pop matching brace
                if (stack.length > 0) {
                    const last = stack[stack.length - 1];
                    if (last === char) stack.pop();
                }
            }
        }
        if (char === '\\') escape = !escape;
        else escape = false;
    }

    // Append missing closures in reverse order
    while (stack.length > 0) {
        repaired += stack.pop();
    }

    try {
        console.log("Repaired JSON:", repaired);
        return JSON.parse(repaired);
    } catch (e2) {
        // Last ditch effort: if it failed because we blindly appended, maybe it needed a value?
        // E.g. "key": [EOF] -> "key": null}
        // This is getting too complex, better to throw original error if repair fails
        console.error("Repair failed:", e2);
        throw e;
    }
  }
};

// 1. ANALYZE CHANNEL (Search + Graph Creation)
export const analyzeChannelContent = async (
  channelUrl: string,
  onProgress?: (message: string, percentage: number) => void
): Promise<{ videos: VideoData[], graph: TopicGraphData }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  if (onProgress) onProgress("Initializing channel discovery...", 5);

  // --- STEP 1: Discovery (Identify Channel & Target Videos) ---
  // We separate this to ensure we get the *right* videos before analyzing them.
  const discoveryPrompt = `
    I need to identify the YouTube channel associated with this URL or input: "${channelUrl}".
    
    Task:
    1. Identify the exact Channel Name and Creator.
    2. Identify 5 of the most popular, controversial, or intellectually significant videos from this channel.
    
    Return a concise list containing:
    - Channel Name
    - List of 5 Video Titles
  `;

  const discoveryResponse = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: discoveryPrompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const discoveryData = discoveryResponse.text;
  if (onProgress) onProgress("Deep scanning video content (this may take a moment)...", 25);

  // --- STEP 2: Deep Content Analysis (The "Scrape") ---
  // Now we ask Gemini to "watch" (search about) these specific videos.
  const analysisPrompt = `
    Based on the following channel discovery data:
    ${discoveryData}

    Perform a "Deep Forensic Scan" of the identified videos.
    
    Task:
    1. For EACH of the 5 videos, use Google Search to find detailed summaries, transcripts, or commentary to understand the *exact* arguments made.
    2. Synthesize the channel's core recurring themes, mental models, and philosophy based *only* on these videos.
    3. Determine the "Relevance" (centrality to worldview) and "Popularity" (audience reception) of these themes.

    Provide a comprehensive text analysis that includes the detailed video summaries and the thematic breakdown.
  `;

  const analysisResponse = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: analysisPrompt,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 2048 }, // Enable thinking to synthesize themes across multiple search results
    },
  });

  const fullAnalysis = analysisResponse.text;
  if (onProgress) onProgress("Structuring video data...", 60);

  // --- STEP 3: Extract Video JSON ---
  const videoPrompt = `
    Based on this analysis:
    ${fullAnalysis.slice(0, 25000)} 

    Generate a JSON object containing an array of the 5 videos analyzed.
    Each video must have a "title" and a "summary" (2-3 sentences max).

    Output PURE JSON.
  `;

  const videoResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: videoPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          videos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
              }
            }
          }
        }
      }
    }
  });

  const videoJson = cleanJson(videoResponse.text);
  let videos: VideoData[] = [];
  try {
    const parsedVideos = safeParse(videoJson);
    if (parsedVideos && Array.isArray(parsedVideos.videos)) {
        videos = parsedVideos.videos;
    } else {
        console.warn("Video list missing from response, using empty array.");
        videos = [];
    }
  } catch (e) {
    console.error("Video Parsing Error", e);
    throw new Error("Failed to parse video list from model output.");
  }

  // --- STEP 4: Build Graph ---
  if (onProgress) onProgress("Constructing knowledge graph...", 80);

  // We truncate searchData to prevent context overflow or confusion
  const graphPrompt = `
    Context: Forensic Analysis of a YouTube channel.
    Analysis Data: ${fullAnalysis.slice(0, 20000)}
    Identified Videos: ${JSON.stringify(videos)}

    Task: Create a directed knowledge graph representing the channel's worldview.

    Generate a JSON object containing:
    1. "graph": 
       - "nodes": Array of objects (Max 12 nodes total).
          - "id": Topic Name (Unique String, Max 4 words).
          - "group": 1 (Core Philosophy), 2 (Major Concepts), 3 (Specific Arguments).
          - "desc": Short 1-sentence description (Max 15 words).
          - "longDescription": A concise explanation (max 2 sentences) of this node's role.
          - "relevance": Integer from 1 to 10. **MUST BE LESS THAN 11**.
          - "popularity": Integer from 1 to 10. **MUST BE LESS THAN 11**.
       - "links": Array of objects { "source": "Topic Name", "target": "Topic Name", "value": 1-5 }. 
          **CRITICAL**: The graph MUST be contiguous (fully connected). Use the exact "id" strings from nodes for source/target.
          **VALUE GUIDE**: 
            1: Loose thematic connection.
            3: Strong conceptual link.
            5: Critical dependency (Target directly derived from Source).
    2. "summary": A one-paragraph executive summary of the channel's worldview.

    Output PURE JSON only. Ensure numerical values are standard Integers (e.g. 5, not 500000).
  `;

  const graphResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview', 
    contents: graphPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          graph: {
            type: Type.OBJECT,
            properties: {
              nodes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    group: { type: Type.INTEGER },
                    desc: { type: Type.STRING },
                    longDescription: { type: Type.STRING },
                    relevance: { type: Type.INTEGER },
                    popularity: { type: Type.INTEGER },
                  }
                }
              },
              links: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    source: { type: Type.STRING },
                    target: { type: Type.STRING },
                    value: { type: Type.INTEGER },
                  }
                }
              }
            }
          },
          summary: { type: Type.STRING }
        }
      }
    }
  });

  if (onProgress) onProgress("Finalizing analysis...", 95);
  const graphJson = cleanJson(graphResponse.text);
  
  try {
    const parsedGraph = safeParse(graphJson);
    
    // Safety check for missing data
    const nodes = parsedGraph?.graph?.nodes;
    if (!Array.isArray(nodes)) {
       throw new Error("Model failed to generate graph structure.");
    }
    
    // Sanitization pass: ensure integers are within bounds
    const sanitizedNodes = nodes.map((node: any) => ({
      ...node,
      relevance: Math.min(10, Math.max(1, parseInt(node.relevance) || 5)),
      popularity: Math.min(10, Math.max(1, parseInt(node.popularity) || 5))
    }));

    const links = Array.isArray(parsedGraph.graph.links) ? parsedGraph.graph.links : [];
    // Sanitize links to ensure values are between 1-5
    const sanitizedLinks = links.map((link: any) => ({
      ...link,
      value: Math.min(5, Math.max(1, parseInt(link.value) || 3))
    }));

    return {
      videos: videos,
      graph: {
        nodes: sanitizedNodes,
        links: sanitizedLinks,
        summary: parsedGraph.summary || "No summary available."
      }
    };
  } catch (e) {
    console.error("Graph Parsing Error:", e);
    console.error("Raw Graph Output:", graphJson);
    throw new Error("Failed to construct topic graph. The model output was malformed.");
  }
};

// 2. GENERATE REBUTTAL PRESENTATION
export const generateRebuttal = async (
  channelUrl: string, 
  graphSummary: string, 
  videos: VideoData[],
  customInstructions: string,
  onProgress?: (message: string, percentage: number) => void
): Promise<PresentationData> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  if (onProgress) onProgress("Initializing cognitive engine (Deep Thinking)...", 10);

  const safeVideos = Array.isArray(videos) ? videos : [];

  // Updated Prompt for Higher Quality Content
  const prompt = `
    Role: You are an elite Epistemologist, Investigative Journalist, and Logic Professor. 
    Target: We are conducting a high-level forensic deconstruction of the YouTube channel ${channelUrl}.
    
    Context Data:
    - Channel Worldview: ${graphSummary}
    - Top Videos: ${safeVideos.map(v => v.title).slice(0, 5).join(", ")}.
    - User Custom Direction: "${customInstructions || 'Adopt a tone of rigorous, empirical scientific skepticism. Dismantle pseudoscience and logical leaps.'}"

    Objective:
    Generate a 5-slide "Deep Dive & Rebuttal" presentation.
    Your goal is to perform a "steelmanning" operation: First, articulate the creator's arguments *better than they do*, then dismantle them with superior evidence, first-principles logic, and epistemological clarity.
    
    Research Phase (Use Google Search):
    1. Find specific, direct quotes or core thesis statements from these videos.
    2. Identify the underlying axioms or "hidden premises" this channel relies on.
    3. Find high-quality counter-evidence (scientific consensus, historical data, logical contradictions).
    
    Slide Structure Requirements (Strict Adherence):
    1. **Title**: Use a "Dialectical" style (e.g., "The Myth of X," "Correlation vs Causation," "The Naturalistic Fallacy").
    2. **Bullet Points**: Exactly 3 items per slide, structured strictly as follows (include the labels):
       - "The Claim: [Insert a specific, recognizable argument or quote from the channel]"
       - "The Mechanism: [Briefly explain the rhetorical device or logical error used]"
       - "The Reality: [A hard-hitting fact or logical axiom that contradicts the claim]"
    3. **Rebuttal**: A dense, high-impact paragraph (approx 80-100 words). Do not use fluff. Cite specific concepts, fallacies (e.g., Motte-and-Bailey, Gish Gallop), or scientific principles. Address the *nuance*—why is the argument compelling, and why is it ultimately wrong?
    4. **Visual Prompt**: A creative, abstract art prompt for a background image. It should be metaphorical and visually striking (e.g., "A golden cage representing ideological capture, cinematic lighting").
    5. **Speaker Notes**: A script for the presenter. Tone: Charismatic, authoritative, yet fair. Use rhetorical questions. (Approx 100 words).

    Output Format:
    Return a JSON object with a "slides" array.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview', 
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }], 
      // Use Thinking Config for complex reasoning. Increased budget for better quality.
      thinkingConfig: { thinkingBudget: 8192 },
      responseMimeType: "application/json",
       responseSchema: {
        type: Type.OBJECT,
        properties: {
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                rebuttal: { type: Type.STRING },
                speakerNotes: { type: Type.STRING },
                visualPrompt: { type: Type.STRING },
              }
            }
          }
        }
       }
    }
  });

  if (onProgress) onProgress("Synthesizing slides...", 90);
  const rawJson = response.text;
  
  try {
    const data = safeParse(cleanJson(rawJson));
    if (!data || !Array.isArray(data.slides)) {
        throw new Error("No slides generated.");
    }
    
    // Sanitize slides to ensure arrays exist
    data.slides = data.slides.map((s: any) => ({
      ...s,
      bulletPoints: Array.isArray(s.bulletPoints) ? s.bulletPoints : [],
      speakerNotes: s.speakerNotes || "",
      rebuttal: s.rebuttal || "",
      visualPrompt: s.visualPrompt || "Abstract digital landscape, dark elegant colors"
    }));

    return data;
  } catch (e) {
    console.error("JSON Parsing Error in Presentation:", e);
    // Fallback moved to safeParse logic
    throw new Error("Failed to generate presentation. The analysis was too complex for the output window. Please try again.");
  }
};

// 3. GENERATE SLIDE IMAGE
export const generateSlideImage = async (prompt: string): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
      const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
              parts: [{ text: "Generate a high quality, abstract, moody, 4k background image: " + prompt }]
          },
           config: {
             imageConfig: { aspectRatio: "16:9" }
           }
      });

      // Scan candidates for inline data (image bytes)
      if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
          for (const part of response.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                   return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
              }
          }
      }
      return null;
  } catch (e) {
      console.error("Image Gen Failed:", e);
      return null;
  }
};