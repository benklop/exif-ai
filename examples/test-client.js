#!/usr/bin/env node

// Simple test client for the Exif AI API server
import { readFile } from "fs/promises";
import FormData from "form-data";
import fetch from "node-fetch";

const API_URL = process.env.API_URL || "http://localhost:3000";

async function testServer() {
  try {
    // Test health endpoint
    console.log("Testing health endpoint...");
    const healthResponse = await fetch(`${API_URL}/health`);
    const healthData = await healthResponse.json();
    console.log("Health check:", healthData);

    // Test image processing - you'll need to provide an image file
    const imagePath = process.argv[2];
    if (!imagePath) {
      console.log("\nTo test image processing, provide an image path:");
      console.log("node test-client.js /path/to/image.jpg");
      return;
    }

    console.log(`\nTesting image processing with: ${imagePath}`);
    
    const imageBuffer = await readFile(imagePath);
    const formData = new FormData();
    formData.append("image", imageBuffer, "test.jpg");
    
    // You can also test with custom fields
    formData.append("provider", "ollama");
    formData.append("tasks", "description,tag");
    
    const processResponse = await fetch(`${API_URL}/process`, {
      method: "POST",
      body: formData,
      headers: formData.getHeaders(),
    });

    const processData = await processResponse.json();
    console.log("Processing result:");
    console.log(JSON.stringify(processData, null, 2));

  } catch (error) {
    console.error("Test failed:", error);
  }
}

testServer();
