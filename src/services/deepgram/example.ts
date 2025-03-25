import { DeepgramService } from './deepgram-service';

async function example() {
  // Initialize the service with your API key
  const deepgram = new DeepgramService(process.env.DEEPGRAM_API_KEY || '');

  // Example 1: Live transcription
  await deepgram.connectLiveTranscription(
    {
      language: 'en-US',
      punctuate: true,
      model: 'general',
    },
    (transcript) => {
      console.log('Received transcript:', transcript);
    },
  );

  // Example 2: Text-to-Speech
  try {
    const audioBuffer = await deepgram.textToSpeech(
      'Hello, this is a test of the Deepgram text to speech service.',
      { model: 'aura-asteria-en' },
    );
    console.log('Received audio buffer of size:', audioBuffer.byteLength);
    // In a real application, you would typically:
    // 1. Convert the buffer to an audio format
    // 2. Play it through the speakers
    // 3. Or save it to a file
  } catch (error) {
    console.error('TTS Error:', error);
  }

  // Don't forget to disconnect when done
  deepgram.disconnect();
}

// Only run if this file is being run directly
if (require.main === module) {
  example().catch(console.error);
}
