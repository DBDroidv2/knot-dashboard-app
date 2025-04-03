const express = require('express');
const axios = require('axios');
const { exec } = require('child_process'); // Import exec

const router = express.Router();

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
  // Expecting messages array and optional model name from frontend
  const { messages, model: requestedModel } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body: messages array is required.' });
  }

  // Determine the model to use
  const modelToUse = requestedModel || 'PetrosStav/gemma3-tools:4b'; // Default if not provided

  try {
    console.log(`[AI Chat] Requesting Ollama with model: ${modelToUse}`); // Log the model being used
    const ollamaResponse = await axios.post('http://localhost:11434/api/chat', {
      model: modelToUse,
      messages: messages,
      stream: false // Get the full response at once to check for tool calls
    });

    const responseData = ollamaResponse.data;
    console.log("[AI Chat] Full response received from Ollama:", JSON.stringify(responseData, null, 2)); // Log the full response
    const aiMessage = responseData.message;

    // Check for tool calls
    if (aiMessage && aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      // Assuming the first tool call is the one we want and it's for terminal execution
      // You might need more robust checking based on the actual tool structure gemma3 provides
      const toolCall = aiMessage.tool_calls[0];
      if (toolCall.function && toolCall.function.name === 'execute_command' && toolCall.function.arguments) {
        let commandToExecute;
        try {
          // Arguments might be a JSON string
          const args = JSON.parse(toolCall.function.arguments);
          commandToExecute = args.command; // Assuming the argument object has a 'command' property
        } catch (parseError) {
          console.error("Failed to parse tool call arguments:", parseError);
          // Fallback or error handling if arguments aren't as expected
          commandToExecute = null;
        }


        if (commandToExecute) {
          console.log(`[AI Tool Call] Executing command: ${commandToExecute}`);
          // SECURITY WARNING: Executing arbitrary commands is dangerous!
          exec(commandToExecute, { timeout: 10000 }, (execError, stdout, stderr) => { // Added timeout
            if (execError) {
              console.error(`[Exec Error] ${execError.message}`);
              // Send error back to frontend
              res.json({
                commandExecuted: commandToExecute,
                stdout: stdout,
                stderr: `Execution Error: ${execError.message}`, // Include execution error message
                modelUsed: modelToUse,
                type: 'tool_result' // Indicate this is a tool result
              });
              return;
            }
            console.log(`[Exec Success] stdout: ${stdout}`);
            if (stderr) {
              console.error(`[Exec Success] stderr: ${stderr}`);
            }
            // Send command output back to frontend
            res.json({
              commandExecuted: commandToExecute,
              stdout: stdout,
              stderr: stderr,
              modelUsed: modelToUse,
              type: 'tool_result' // Indicate this is a tool result
            });
          });
          return; // Stop processing here as we are handling the command execution
        } else {
           console.warn("[AI Tool Call] Could not extract command from tool call arguments:", toolCall.function.arguments);
           // Fallback to sending a message indicating failure to parse command
           res.json({ message: { role: 'assistant', content: "I tried to execute a command but couldn't understand the instruction." }, modelUsed: modelToUse });
        }
      } else {
         console.warn("[AI Tool Call] Received tool call, but not in the expected format:", toolCall);
         // Fallback if tool call isn't the expected 'execute_command'
         res.json({ message: { role: 'assistant', content: "I received a tool instruction I didn't recognize." }, modelUsed: modelToUse });
      }
    } else if (aiMessage && aiMessage.content) {
      // Regular chat message response
      res.json({ message: aiMessage, modelUsed: modelToUse });
    } else {
      // Unexpected response format from Ollama
      console.error('Ollama response missing message content or tool_calls:', responseData);
      return res.status(500).json({ error: 'Received unexpected response format from AI model.' });
    }

  } catch (error) {
    // Enhanced error logging for Ollama communication
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        console.error('[AI Chat Error] Ollama API responded with error:', error.response.status, error.response.data);
        res.status(500).json({ error: `Ollama API Error: ${error.response.statusText || 'Failed response'}` });
      } else if (error.request) {
        // The request was made but no response was received
        console.error('[AI Chat Error] No response received from Ollama:', error.request);
        res.status(500).json({ error: 'No response received from Ollama API.' });
      } else {
        // Something happened in setting up the request that triggered an Error
        console.error('[AI Chat Error] Error setting up Ollama request:', error.message);
        res.status(500).json({ error: 'Error configuring request to Ollama API.' });
      }
    } else {
      // Non-Axios error (e.g., unexpected issue in our code)
      console.error('[AI Chat Error] Unexpected error:', error);
      res.status(500).json({ error: 'An unexpected internal server error occurred.' });
    }
  }
});

module.exports = router;
