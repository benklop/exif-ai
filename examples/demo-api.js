#!/usr/bin/env node

/**
 * Simple demo script showing how to use the Exif AI API server
 * Usage: node demo-api.js [path-to-image] [provider]
 */

import { readFileSync } from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function demoAPI() {
  console.log('🎯 Exif AI API Demo\n');

  // Test 1: Health check
  console.log('1. Testing health endpoint...');
  try {
    const healthResponse = await fetch(`${API_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health:', JSON.stringify(healthData, null, 2));
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return;
  }

  // Test 2: Image processing
  const imagePath = process.argv[2] || '/home/benklop/exif-ai/src/__tests__/image/VCG211476897295.jpeg';
  const provider = process.argv[3] || 'test';

  console.log(`\n2. Testing image processing...`);
  console.log(`   Image: ${imagePath}`);
  console.log(`   Provider: ${provider}`);

  try {
    const imageBuffer = readFileSync(imagePath);
    const formData = new FormData();
    
    formData.append('image', imageBuffer, 'demo.jpg');
    formData.append('provider', provider);
    formData.append('tasks', 'description,tag');
    formData.append('descriptionPrompt', 'Provide a detailed description of this image.');
    formData.append('tagPrompt', 'Output only tags separated by commas. Example: mountain, sky, night');

    const startTime = Date.now();
    const response = await fetch(`${API_URL}/process`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    const endTime = Date.now();

    if (response.ok) {
      console.log('✅ Processing successful!');
      console.log(`⏱️  Processing time: ${endTime - startTime}ms`);
      console.log('\n📝 Results:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log('❌ Processing failed:', data);
    }

  } catch (error) {
    console.log('❌ Image processing failed:', error.message);
  }

  console.log('\n🎉 Demo completed!');
}

// Run the demo
demoAPI().catch(console.error);
