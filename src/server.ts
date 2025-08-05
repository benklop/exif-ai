#!/usr/bin/env node

import { config } from "dotenv";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse } from "url";
import { readFile, writeFile, unlink } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { tmpdir } from "os";

// Load environment variables from .env.local if it exists
try {
  config({ path: ".env.local" });
} catch (error) {
  // .env.local is optional, continue without it
}

// Environment configuration
const PORT = parseInt(process.env.PORT || "3000", 10);
const PROVIDER = process.env.EXIF_AI_PROVIDER || "ollama";
const MODEL = process.env.EXIF_AI_MODEL;
const DESCRIPTION_PROMPT = process.env.EXIF_AI_DESCRIPTION_PROMPT;
const TAG_PROMPT = process.env.EXIF_AI_TAG_PROMPT;
const TASKS = process.env.EXIF_AI_TASKS ? process.env.EXIF_AI_TASKS.split(",") : ["description", "tag"];
const VERBOSE = process.env.EXIF_AI_VERBOSE === "true";

// Response helper
function sendResponse(res: ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

// Error handler
function sendError(res: ServerResponse, statusCode: number, message: string, error?: any) {
  console.error(`Error ${statusCode}: ${message}`, error);
  sendResponse(res, statusCode, { 
    error: message,
    ...(VERBOSE && error ? { details: error.message || error } : {})
  });
}

// Health check function that tests provider connectivity
async function checkProviderHealth(): Promise<{ status: string, provider: string, model: string, tasks: string[], error?: string }> {
  const baseResponse = {
    provider: PROVIDER,
    model: MODEL || "default",
    tasks: TASKS
  };

  try {
    // For test provider, always return healthy
    if (PROVIDER === "test") {
      return { ...baseResponse, status: "healthy" };
    }

    // Test connectivity without generating text (to avoid costs)
    switch (PROVIDER.toLowerCase()) {
      case "google": {
        // For Google, we can check if the API key is valid by making a simple request
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
          return { ...baseResponse, status: "unhealthy", error: "Google API key not found" };
        }
        
        // Make a simple request to list models (cheaper than generation)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          return { ...baseResponse, status: "healthy" };
        } else {
          return { ...baseResponse, status: "unhealthy", error: `Google API error: ${response.status} ${response.statusText}` };
        }
      }
      
      case "openai": {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return { ...baseResponse, status: "unhealthy", error: "OpenAI API key not found" };
        }
        
        // Check OpenAI models endpoint
        const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com";
        const response = await fetch(`${baseURL}/v1/models`, {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json' 
          }
        });
        
        if (response.ok) {
          return { ...baseResponse, status: "healthy" };
        } else {
          return { ...baseResponse, status: "unhealthy", error: `OpenAI API error: ${response.status} ${response.statusText}` };
        }
      }
      
      case "ollama": {
        // For Ollama, check if the server is responding
        const baseURL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        const response = await fetch(`${baseURL}/api/tags`, {
          method: 'GET'
        });
        
        if (response.ok) {
          return { ...baseResponse, status: "healthy" };
        } else {
          return { ...baseResponse, status: "unhealthy", error: `Ollama server error: ${response.status} ${response.statusText}` };
        }
      }
      
      case "anthropic": {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return { ...baseResponse, status: "unhealthy", error: "Anthropic API key not found" };
        }
        
        // Anthropic doesn't have a models endpoint, but we can validate the API key format
        if (!apiKey.startsWith('sk-ant-')) {
          return { ...baseResponse, status: "unhealthy", error: "Invalid Anthropic API key format" };
        }
        
        return { ...baseResponse, status: "healthy" };
      }
      
      default: {
        // For other providers, try to create the model without calling it
        try {
          const { getModel } = await import("./provider/ai-sdk.js");
          const model = getModel(PROVIDER, MODEL);
          
          // If we can create the model without error, consider it healthy
          if (model) {
            return { ...baseResponse, status: "healthy" };
          } else {
            return { ...baseResponse, status: "unhealthy", error: "Failed to create model instance" };
          }
        } catch (error: any) {
          return { ...baseResponse, status: "unhealthy", error: `Provider initialization error: ${error.message}` };
        }
      }
    }
    
  } catch (error: any) {
    return { 
      ...baseResponse, 
      status: "unhealthy", 
      error: error.message || "Unknown error connecting to provider" 
    };
  }
}

// Parse multipart form data (simple implementation for images)
async function parseMultipartData(req: IncomingMessage): Promise<{ fields: Record<string, string>, files: Record<string, Buffer> }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundary = req.headers["content-type"]?.split("boundary=")[1];
        
        if (!boundary) {
          reject(new Error("No boundary found in content-type"));
          return;
        }
        
        const parts = buffer.toString("binary").split(`--${boundary}`);
        const fields: Record<string, string> = {};
        const files: Record<string, Buffer> = {};
        
        for (const part of parts) {
          if (part.includes("Content-Disposition: form-data")) {
            const headers = part.split("\r\n\r\n")[0];
            const content = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
            
            const nameMatch = headers.match(/name="([^"]+)"/);
            const filenameMatch = headers.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
              const fieldName = nameMatch[1];
              
              if (filenameMatch) {
                // This is a file
                const binaryContent = content.replace(/\r\n$/, "");
                files[fieldName] = Buffer.from(binaryContent, "binary");
              } else {
                // This is a text field
                fields[fieldName] = content.replace(/\r\n$/, "");
              }
            }
          }
        }
        
        resolve({ fields, files });
      } catch (error) {
        reject(error);
      }
    });
    
    req.on("error", reject);
  });
}

// Main request handler
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = parse(req.url || "", true);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    sendResponse(res, 200, { message: "OK" });
    return;
  }
  
  // Health check endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    console.log(`[${new Date().toISOString()}] Health check request from ${req.socket.remoteAddress}`);
    try {
      const healthStatus = await checkProviderHealth();
      const statusCode = healthStatus.status === "healthy" ? 200 : 503;
      console.log(`[${new Date().toISOString()}] Health check result: ${healthStatus.status}`);
      sendResponse(res, statusCode, healthStatus);
    } catch (error: any) {
      console.log(`[${new Date().toISOString()}] Health check failed:`, error.message);
      sendResponse(res, 503, {
        status: "unhealthy",
        provider: PROVIDER,
        model: MODEL || "default",
        tasks: TASKS,
        error: error.message || "Health check failed"
      });
    }
    return;
  }
  
  // Process image endpoint
  if (url.pathname === "/process" && req.method === "POST") {
    console.log(`[${new Date().toISOString()}] Processing image request from ${req.socket.remoteAddress}`);
    
    try {
      const contentType = req.headers["content-type"] || "";
      
      if (!contentType.includes("multipart/form-data")) {
        sendError(res, 400, "Content-Type must be multipart/form-data");
        return;
      }
      
      const { fields, files } = await parseMultipartData(req);
      
      const imageBuffer = files.image;
      if (!imageBuffer) {
        sendError(res, 400, "No image file provided in 'image' field");
        return;
      }
      
      // Create temporary file
      const tempFilePath = join(tmpdir(), `exif-ai-${randomUUID()}.jpg`);
      await writeFile(tempFilePath, imageBuffer);
      
      try {
        // Override configuration from request fields if provided
        const requestTasks = fields.tasks ? fields.tasks.split(",") : TASKS;
        const requestProvider = fields.provider || PROVIDER;
        const requestModel = fields.model || MODEL;
        const requestDescriptionPrompt = fields.descriptionPrompt || DESCRIPTION_PROMPT;
        const requestTagPrompt = fields.tagPrompt || TAG_PROMPT;
        
        console.log(`[${new Date().toISOString()}] Processing with:`, {
          provider: requestProvider,
          model: requestModel || "default",
          tasks: requestTasks
        });
        
        // Import the AI functions
        const { getDescriptionWithUsage, getTagsWithUsage } = await import("./provider/ai-sdk.js");
        
        const imageBufferForAI = await readFile(tempFilePath);
        
        let description = "";
        let tags: string[] = [];
        let rawTagsText = "";
        let totalTokensUsed = 0;
        let descriptionTokens = 0;
        let tagsTokens = 0;
        
        // Process description if requested
        if (requestTasks.includes("description")) {
          console.log(`[${new Date().toISOString()}] Generating description...`);
          try {
            const descResult = await getDescriptionWithUsage({
              buffer: imageBufferForAI,
              model: requestModel,
              prompt: requestDescriptionPrompt || "Describe this image in detail.",
              provider: requestProvider
            });
            description = descResult.text || "";
            descriptionTokens = descResult.usage?.totalTokens || 0;
            totalTokensUsed += descriptionTokens;
            
            console.log(`[${new Date().toISOString()}] Description generated (${description.length} chars, ${descriptionTokens} tokens)`);
          } catch (error) {
            console.error("Error generating description:", error);
          }
        }
        
        // Process tags if requested
        if (requestTasks.includes("tag") || requestTasks.includes("tags")) {
          console.log(`[${new Date().toISOString()}] Generating tags...`);
          try {
            const tagsResult = await getTagsWithUsage({
              buffer: imageBufferForAI,
              model: requestModel,
              prompt: requestTagPrompt || "Output only the most relevant one or two word tags separated by commas. No text before or after. Example: mountain, sky, night, stars",
              provider: requestProvider
            });
            
            const tagsText = tagsResult.text;
            rawTagsText = tagsText; // Store for output
            tagsTokens = tagsResult.usage?.totalTokens || 0;
            totalTokensUsed += tagsTokens;
            
            // Parse tags from string response and clean them
            // Split by common delimiters (commas, newlines, semicolons, etc.)
            let rawTags = tagsText.split(/[,\n;|]/).map((tag: string) => tag.trim());
            
            // Clean each tag - remove formatting and keep only alphanumeric + spaces
            tags = rawTags
              .map((tag: string) => {
                // Remove markdown formatting, brackets, quotes, etc.
                let cleaned = tag
                  .replace(/^[*\-•\d\.\)\]\}\>"\'\`]+\s*/, '') // Remove prefixes like *, -, •, numbers, brackets, quotes
                  .replace(/[*"\'\`\[\{\<\]\}\>]+$/, '') // Remove suffixes like quotes, brackets
                  .replace(/[^\w\s]/g, ' ') // Replace all non-alphanumeric (except spaces) with spaces
                  .replace(/\s+/g, ' ') // Collapse multiple spaces into one
                  .trim(); // Remove leading/trailing whitespace
                
                return cleaned;
              })
              .filter((tag: string) => {
                // Filter out empty tags, overly long ones, and tags with more than 2 words
                const wordCount = tag.split(' ').length;
                return tag.length > 0 && tag.length <= 50 && wordCount <= 2;
              })
              .slice(0, 20); // Limit to first 20 tags
            
            console.log(`[${new Date().toISOString()}] Tags generated: ${tags.length} tags (${tagsTokens} tokens)`);
          } catch (error) {
            console.error("Error generating tags:", error);
          }
        }
        
        sendResponse(res, 200, {
          success: true,
          description,
          tags,
          rawTagsText, // Include raw tags text for debugging
          provider: requestProvider,
          model: requestModel || "default",
          tasks: requestTasks,
          ...(totalTokensUsed > 0 && { 
            tokenUsage: {
              description: descriptionTokens,
              tags: tagsTokens,
              total: totalTokensUsed
            }
          })
        });
        
        console.log(`[${new Date().toISOString()}] Request completed successfully (Total tokens: ${totalTokensUsed})`);
        
      } finally {
        // Clean up temporary file
        try {
          await unlink(tempFilePath);
        } catch (error) {
          console.error("Error cleaning up temp file:", error);
        }
      }
      
    } catch (error) {
      sendError(res, 500, "Internal server error", error);
    }
    return;
  }
  
  // 404 for other routes
  sendError(res, 404, "Not found");
}

// Create and start server
const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Exif AI API Server running on port ${PORT}`);
  console.log(`Configuration:`);
  console.log(`  Provider: ${PROVIDER}`);
  console.log(`  Model: ${MODEL || "default"}`);
  console.log(`  Tasks: ${TASKS.join(", ")}`);
  console.log(`  Verbose: ${VERBOSE}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health  - Health check`);
  console.log(`  POST /process - Process image`);
  console.log(`\nEnvironment variables:`);
  console.log(`  PORT                      - Server port (default: 3000)`);
  console.log(`  EXIF_AI_PROVIDER         - AI provider (default: ollama)`);
  console.log(`  EXIF_AI_MODEL            - AI model (optional)`);
  console.log(`  EXIF_AI_DESCRIPTION_PROMPT - Custom description prompt (optional)`);
  console.log(`  EXIF_AI_TAG_PROMPT       - Custom tag prompt (optional)`);
  console.log(`  EXIF_AI_TASKS            - Comma-separated tasks (default: description,tag)`);
  console.log(`  EXIF_AI_VERBOSE          - Enable verbose logging (default: false)`);
});

server.on("error", (error: Error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  server.close(() => {
    console.log("Server stopped");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\nShutting down server...");
  server.close(() => {
    console.log("Server stopped");
    process.exit(0);
  });
});
