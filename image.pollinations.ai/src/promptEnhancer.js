"use strict";
import fetch from 'node-fetch';
import urldecode from 'urldecode';
import debug from 'debug';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const logError = debug('pollinations:error');
const logPimp = debug('pollinations:pimp');
const logPerf = debug('pollinations:perf');

/**
 * Returns an object with specialized system prompts for both generation and editing.
 * If a model doesn't support a mode, the corresponding prompt is null.
 * @param {string} model - The target model name.
 * @returns {{generationPrompt: string|null, editingPrompt: string|null}|null}
 */
function getModelInstructions(model) {
  const normalizedModel = model.toLowerCase();
  
  switch (normalizedModel) {
    case 'gptimage':
      return {
        generationPrompt: `You are an expert prompt writer for 'gptimage', a powerful multimodal AI that excels at generating high-quality images with perfectly rendered, integrated text. Your task is to rewrite a user's idea into a comprehensive, descriptive, and narrative prompt for **generating a new image from scratch**.

        **Core Principles:**
        1.  **Elaborate, Don't Abbreviate:** Transform simple ideas into rich, detailed descriptions. Think like you're commissioning a professional artist or designer.
        2.  **Prioritize Text Rendering:** This is gptimage's superpower. If the user's prompt includes any text, it must be a central feature of your output. Specify the exact text content, the typography style (e.g., "elegant calligraphy", "retrofuturistic typography"), and its placement.
        3.  **Describe Holistically:** Detail the subject, background, style (e.g., "oil painting", "photorealistic", "watercolor"), textures, and mood. Use full, natural sentences.
        
        **Your output must be ONLY the enhanced prompt itself, without any conversational lead-in.**`,

        editingPrompt: `You are an expert prompt writer for 'gptimage', a powerful multimodal AI that excels at **editing existing images**. You will be given an image and a user's instruction. Your task is to convert this into a detailed command that focuses on iterative refinement, style transfer, and contextual changes.

        **Core Principles:**
        1.  **Specify Transformation:** Clearly state what needs to change.
        2.  **State Preservation:** Crucially, describe what elements of the original image should be preserved (e.g., "preserving the dramatic shadows and character expressions," "while maintaining the original composition").
        3.  **Use Style Language:** When transferring styles, be specific (e.g., "Transform this scene into the style of traditional Japanese ukiyo-e woodblock prints," or "Apply solarpunk aesthetics").
        
        **Your output must be ONLY the enhanced prompt itself, without any conversational lead-in.**`
      };

    case 'kontext':
        return {
            generationPrompt: `You are an AI assistant creating prompts for 'Kontext' to **generate a new image from scratch**. Kontext excels at clear, direct, and literal interpretations. Your task is to convert a user's idea into a simple but detailed descriptive prompt.

            **Core Principles:**
            1.  **Be Direct and Descriptive:** Avoid overly artistic, poetic, or abstract language. Describe the scene as if you are explaining it to someone who takes everything literally.
            2.  **Focus on "What" and "Where":** Clearly define the subjects, their appearance, their actions, and their placement within the environment.
            
            **Your output must be ONLY the prompt itself, with no conversational text.**`,

            editingPrompt: `You are an AI assistant that creates precise instructions for 'Kontext', an advanced image-to-image editor. You will receive an image and a user's instruction. Your goal is to convert this into a very clear, direct, and explicit command, focusing on control and preservation.

            **Core Principles (These are CRITICAL for Kontext):**
            1.  **Be an Unambiguous Commander:** Use direct action verbs (e.g., "Change," "Replace," "Add," "Remove").
            2.  **PRESERVATION IS KEY:** This is the most important rule. Always explicitly state what to keep the same. If you don't, Kontext might change it. Use phrases like: "while maintaining the same style of the painting," "keep the person in the exact same position, scale, and pose," "preserving his exact facial features and expression."
            3.  **Handle Vague Requests Safely:** If a user says "make him a viking," do not replace the person. Interpret it as a clothing change: "Change the man's clothes to a viking warrior outfit, while preserving his exact facial features."
            4.  **Text Editing Format:** For changing text in the image, strictly use the format: "Replace '[original text]' with '[new text]'".
            
            **Your output must be ONLY the direct editing command. No conversation.**`
        };

    case 'flux':
      return {
        generationPrompt: `You are an expert prompt engineer for 'FLUX.1', a state-of-the-art text-to-image model known for its high fidelity. Your task is to rewrite a user's simple idea into a rich, structured, and highly detailed prompt for **generating a new image**.

        **Core Principles:**
        1.  **Be Hyper-Specific and Descriptive:** Provide extreme detail. Instead of "a portrait," describe eye color, hair, skin texture, and clothing.
        2.  **Incorporate Technical & Artistic Terms:** Use specific artistic references ("in the style of Vincent van Gogh"), and technical photography details ("shot with a wide-angle lens (24mm) at f/1.8").
        
        **Your output must be a single, detailed, narrative paragraph that reads like a piece of descriptive prose.**`,
        editingPrompt: null // This model does not support editing
      };

    case 'turbo':
        return {
            generationPrompt: `You are a prompt engineer for 'Turbo', a model based on Stable Diffusion XL (SDXL). Your goal is to convert a user's idea into a dense, keyword-rich prompt structured as a series of comma-separated descriptive phrases for **generating a new image**.

            **Core Principles:**
            1.  **Use Keyword-Driven Phrases:** The output must be a single block of text composed of descriptive phrases separated by commas.
            2.  **Follow the SDXL Anatomy:** Build the prompt using this structure: [Subject], [Detailed Imagery], [Environment], [Mood/Atmosphere], [Style], [Style Execution].
            
            **Your output must be ONLY the comma-separated list of phrases.**`,
            editingPrompt: null // This model does not support editing
        };
        
    default:
        // A generic prompt for any other case
        return {
            generationPrompt: `Instruction Set for Image Prompt Diversification:
            - Generate one distinctive new prompt that describes the same image from different perspectives.
            - maintain a clear and vivid description of the image, including details about the main subject, setting, colours, lighting, and overall mood. 
            - If no visual style is given, decide on a typical style that would be used in that type of image.
            - Respond only with the new prompt. Nothing Else.`,
            editingPrompt: null
        };
  }
}


/**
 * UPGRADED: Gets chat completion from Pollinations. Handles both text and image inputs.
 * @param {string} prompt - The input prompt for the API.
 * @param {string} model - The target model ('flux', 'turbo', 'kontext', etc.).
 * @param {number} seed - The seed value for reproducible results.
 * @param {string|null} [image=null] - Optional base64 data URL of the image for editing tasks.
 * @returns {Promise<string>} The enhanced prompt.
 */
async function pimpPromptRaw(prompt, model, seed, image = null) {
    try {
        prompt = urldecode(prompt);
    } catch (error) {
        logError("Error decoding prompt:", error);
    }

    const isEditingTask = !!image;
    const taskType = isEditingTask ? "Editing" : "Generation";
    logPimp(`Pimping prompt for [${model}] ([${taskType}]): "${prompt}"`);
    
    const startTime = Date.now();

    // 1. Get the full instruction set for the model
    const instructionSet = getModelInstructions(model);
    if (!instructionSet) {
        logError(`Unsupported model provided: "${model}". Returning original prompt.`);
        return prompt;
    }

    // 2. Select the correct system prompt based on the task type
    const systemPrompt = isEditingTask 
        ? instructionSet.editingPrompt 
        : instructionSet.generationPrompt;

    // 3. Handle cases where the task is not supported by the model
    if (!systemPrompt) {
        logError(`Model '${model}' does not support the requested task type: '${taskType}'. Returning original prompt.`);
        return prompt;
    }

    try {
        const apiUrl = `https://text.pollinations.ai/openai`;
        
        // 4. Construct the API payload, which differs for text vs. image tasks
        const messages = [{ role: "system", content: systemPrompt }];
        const userMessageContent = [];

        if (isEditingTask) {
            userMessageContent.push({ type: "text", text: `User's instruction: "${prompt}"` });
            userMessageContent.push({ type: "image_url", image_url: { url: image } });
        } else {
            userMessageContent.push({ type: "text", text: "Prompt: " + prompt });
        }
        messages.push({ role: 'user', content: userMessageContent });
        
        const body = JSON.stringify({
            messages: messages,
            seed: seed,
            model: "openai",
            temperature: 0.5,
            max_tokens: 400
        });

        const headers = {
            'Content-Type': 'application/json',
            'Referer': 'image.pollinations.ai'
        };
        
        if (process.env.POLLINATIONS_KEY) {
            headers['Authorization'] = `Bearer ${process.env.POLLINATIONS_KEY}`;
        }

        const enhancedPrompt = await Promise.race([
            fetch(apiUrl, {
                method: 'POST',
                headers: headers,
                body: body
            }).then(res => {
                if (res.status !== 200) {
                    const errorBody = res.text(); // Read body to get more details
                    throw new Error(`Error enhancing prompt: ${res.status} - ${res.statusText}. Body: ${errorBody}`);
                }
                return res.text();
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 7000)) // Increased timeout for vision
        ]);

        const endTime = Date.now();
        logPerf(`Prompt pimping took ${endTime - startTime}ms`);
        
        return enhancedPrompt.trim();

    } catch (error) {
        logError("Error during prompt enhancement:", error.message);
        return prompt;
    }
}

// Memoize function now handles multiple arguments robustly.
const memoize = (fn) => {
    const cache = new Map();
    return async (...args) => {
        // Exclude image from cache key for simplicity, or create a hash if needed for production
        const cacheKey = JSON.stringify(args.filter(arg => typeof arg !== 'string' || !arg.startsWith('data:image')));
        logPimp("cache key", cacheKey);
        if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
        }
        const result = await fn(...args);
        cache.set(cacheKey, result);
        return result;
    };
};

// Export the new memoized function
export const pimpPrompt = memoize(pimpPromptRaw);


// --- Main function for testing purposes ---
async function main() {
    console.log("--- Testing Prompt Enhancer (Generation & Editing) ---\n");

    const seed = 42;
    // A tiny, valid base64 encoded 1x1 red pixel GIF for testing.
    const testImageBase64 = "data:image/gif;base64,R0lGODlhAQABAIABAP8AAP///yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

    // --- GENERATION TESTS (No Image) ---
    console.log("--- RUNNING GENERATION TESTS ---");
    const generationTests = [
        { model: 'flux', prompt: 'a cozy bookstore' },
        { model: 'turbo', prompt: 'a person on a city street' },
        { model: 'kontext', prompt: 'a girl reading a book' },
        { model: 'gptimage', prompt: 'a menu for a tapas bar' },
    ];
    for (const { model, prompt } of generationTests) {
        console.log(`\n=================================\nModel: ${model} (Generation)\nOriginal Prompt: "${prompt}"\n---------------------------------`);
        const enhancedPrompt = await pimpPrompt(prompt, model, seed);
        console.log("Enhanced Prompt:\n" + enhancedPrompt);
    }

    // --- EDITING TESTS (With Image) ---
    console.log("\n\n--- RUNNING EDITING TESTS ---");
    const editingTests = [
        { model: 'kontext', prompt: 'make the background a sunny beach' },
        { model: 'gptimage', prompt: 'change the style to japanese ukiyo-e woodblock print' },
        { model: 'flux', prompt: 'this should fail gracefully' } // Failure case
    ];
    for (const { model, prompt } of editingTests) {
        console.log(`\n=================================\nModel: ${model} (Editing)\nOriginal Prompt: "${prompt}"\n---------------------------------`);
        // Pass the base64 image as the fourth argument
        const enhancedPrompt = await pimpPrompt(prompt, model, seed, testImageBase64);
        console.log("Enhanced/Returned Prompt:\n" + enhancedPrompt);
    }
}

// To run the tests, uncomment the line below and run `node your_file_name.js`
main();
