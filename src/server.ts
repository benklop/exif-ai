#!/usr/bin/env node

import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse } from "url";
import { readFile, writeFile, unlink } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { tmpdir } from "os";

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
    sendResponse(res, 200, { 
      status: "healthy",
      provider: PROVIDER,
      model: MODEL || "default",
      tasks: TASKS
    });
    return;
  }
  
  // Process image endpoint
  if (url.pathname === "/process" && req.method === "POST") {
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
        
        // Import the AI functions
        const { getDescription, getTags } = await import("./provider/ai-sdk.js");
        
        const imageBufferForAI = await readFile(tempFilePath);
        
        let description = "";
        let tags: string[] = [];
        
        // Process description if requested
        if (requestTasks.includes("description")) {
          try {
            description = await getDescription({
              buffer: imageBufferForAI,
              model: requestModel,
              prompt: requestDescriptionPrompt || "Describe this image in detail.",
              provider: requestProvider
            }) || "";
          } catch (error) {
            console.error("Error generating description:", error);
          }
        }
        
        // Process tags if requested
        if (requestTasks.includes("tag") || requestTasks.includes("tags")) {
          try {
            const tagsResult = await getTags({
              buffer: imageBufferForAI,
              model: requestModel,
              prompt: requestTagPrompt || "Generate relevant tags for this image.",
              provider: requestProvider
            });
            tags = Array.isArray(tagsResult) ? tagsResult : [tagsResult].filter(Boolean);
          } catch (error) {
            console.error("Error generating tags:", error);
          }
        }
        
        sendResponse(res, 200, {
          success: true,
          description,
          tags,
          provider: requestProvider,
          model: requestModel || "default",
          tasks: requestTasks
        });
        
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
