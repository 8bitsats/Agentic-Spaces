# Deepgram Integration Guide

## Overview

The Cheshire Terminal Twitter Space client features robust speech-to-text functionality powered by Deepgram. This integration enables real-time transcription of speakers in a Twitter Space, providing accurate text representations of audio content that can be used for various purposes including:

- Creating live captions/subtitles
- Generating searchable transcripts
- Feeding AI assistants with conversation context
- Archiving Space content in text format
- Analyzing conversation sentiment and topics

## How It Works

The Deepgram integration is implemented as a plugin (`DeepgramTranscriptionPlugin`) that connects to Deepgram's real-time API via WebSockets. When a speaker's audio is received, the plugin:

1. Creates a dedicated WebSocket connection to Deepgram for each speaker
2. Streams PCM audio data to Deepgram in real-time
3. Receives transcription results from Deepgram
4. Associates transcripts with the correct speaker
5. Makes transcriptions available through its API

## Configuration

### Prerequisites

To use the Deepgram integration, you need:

1. A Deepgram account
2. An API key with appropriate permissions
3. The Deepgram Node.js SDK (included in dependencies)

### Environment Setup

Set your Deepgram API key in your environment variables:

```
DEEPGRAM_API_KEY=your_deepgram_api_key
```

This can be added to your `.env` file in the project root.

### Plugin Configuration

The Deepgram plugin can be customized when added to a Space:

```typescript
import { Space } from './core/Space';
import { DeepgramTranscriptionPlugin } from './plugins/DeepgramTranscriptionPlugin';

const space = new Space(scraper, { debug: true });
const transcriptionPlugin = new DeepgramTranscriptionPlugin();

// Add the plugin with configuration options
space.use(transcriptionPlugin, {
  language: 'en-US',           // Language code
  model: 'nova-2',             // Deepgram model to use
  enableDiarization: true,     // Speaker identification
  enablePunctuation: true,     // Add punctuation
  enableSmartFormat: true,     // Smart formatting for numbers, dates, etc.
  debug: true                  // Enable detailed logging
});
```

## Technical Details

### Architecture

The Deepgram integration consists of three main components:

1. **DeepgramService**: A low-level service that manages WebSocket connections to Deepgram's API
2. **DeepgramTranscriptionPlugin**: The plugin that integrates with the Space and processes audio
3. **Space Event System**: The mechanism by which audio data is delivered to the plugin

### DeepgramService

This service handles the direct communication with Deepgram's API:

```typescript
// src/services/deepgram/deepgram-service.ts
export class DeepgramService {
  private apiKey: string;
  private ws: WebSocket | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public async connectLiveTranscription(
    options: DeepgramOptions = {},
    onTranscript: (text: string) => void,
  ): Promise<WebSocket> {
    // Establishes WebSocket connection to Deepgram
    // Configures audio processing parameters
    // Sets up event handlers for transcript data
  }

  public disconnect(): void {
    // Closes the WebSocket connection
  }
}
```

### DeepgramTranscriptionPlugin

The plugin manages individual speaker transcriptions and interfaces with the Space:

```typescript
// src/spaces/plugins/DeepgramTranscriptionPlugin.ts
export class DeepgramTranscriptionPlugin implements Plugin {
  private deepgram: DeepgramService;
  private space: Space | null = null;
  private transcripts: Map<string, string[]> = new Map();
  private wsConnections: Map<string, WebSocket> = new Map();
  private usernames: Map<string, string> = new Map();

  // Plugin lifecycle methods and audio handling
  // ...

  // Public methods for accessing transcripts
  getTranscriptsForUser(userId: string): string[] {
    return this.transcripts.get(userId) || [];
  }

  getAllTranscripts(): Map<string, string[]> {
    return new Map(this.transcripts);
  }

  exportTranscripts(): string {
    // Exports all transcripts in a formatted string
  }
}
```

## Per-Speaker Transcription

One of the key features of the Cheshire Terminal implementation is per-speaker transcription:

- Each speaker gets their own dedicated WebSocket connection to Deepgram
- Audio is isolated and processed separately for each speaker
- Transcripts are associated with the correct speaker
- Clean speaker separation improves transcription accuracy

Implementation details:

```typescript
// When a user joins
async onUserJoined(userId: string, username: string): Promise<void> {
  this.transcripts.set(userId, []);
  this.usernames.set(userId, username);
  console.log(`[DeepgramPlugin] Started tracking transcripts for ${username}`);
}

// When audio data is received
async onAudioData(data: AudioDataWithUser): Promise<void> {
  const { userId } = data;
  
  // Create a connection if one doesn't exist
  if (!this.wsConnections.has(userId)) {
    this.initializeDeepgramForUser(userId);
  }

  // Send audio data to Deepgram
  const ws = this.wsConnections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(Buffer.from(data.samples.buffer));
  }
}
```

## Advanced Deepgram Features

The integration supports several advanced Deepgram features:

### 1. Model Selection

Choose different Deepgram models based on your needs:

```typescript
// Use the latest Nova-2 model for best accuracy
space.use(transcriptionPlugin, {
  model: 'nova-2'
});

// Use enhanced model for noisy environments
space.use(transcriptionPlugin, {
  model: 'nova-2-general-enhanced'
});
```

### 2. Language Support

Support for multiple languages:

```typescript
// Spanish transcription
space.use(transcriptionPlugin, {
  language: 'es'
});

// French transcription
space.use(transcriptionPlugin, {
  language: 'fr'
});
```

### 3. Smart Formatting

Intelligent formatting of numbers, dates, and more:

```typescript
space.use(transcriptionPlugin, {
  enableSmartFormat: true
});
```

## Exporting and Using Transcripts

The plugin provides several methods to access and use transcriptions:

### 1. Real-time Access

```typescript
// Get transcripts for a specific user
const userTranscripts = transcriptionPlugin.getTranscriptsForUser('userId123');

// Get all transcripts
const allTranscripts = transcriptionPlugin.getAllTranscripts();

// Export formatted transcripts
const formattedTranscript = transcriptionPlugin.exportTranscripts();
```

### 2. Saving Transcripts

Save transcriptions to a file:

```typescript
import fs from 'fs';

// Export and save at the end of the Space
space.on('end', () => {
  const transcript = transcriptionPlugin.exportTranscripts();
  fs.writeFileSync(`transcripts/space_${Date.now()}.md`, transcript);
  console.log('Transcript saved successfully!');
});
```

### 3. Integration with AI

Feed transcriptions to AI models:

```typescript
import { GrokService } from './services/grok/grok-service';

// Initialize Grok
const grok = new GrokService(process.env.XAI_API_KEY || '');

// Process new transcripts
transcriptionPlugin.on('newTranscript', async (data) => {
  const { userId, username, transcript } = data;
  
  // Send to Grok for analysis
  const analysis = await grok.analyzeText(transcript);
  
  console.log(`[AI Analysis] ${username}: ${analysis.summary}`);
});
```

## Performance Considerations

### 1. Memory Usage

Each WebSocket connection and transcript store consumes memory. For spaces with many speakers:

- Consider implementing transcript rotation (keeping only the N most recent)
- Implement periodic flushing to persistent storage
- Monitor memory usage during long sessions

### 2. Network Bandwidth

Real-time audio streaming requires significant bandwidth:

- 16-bit PCM at 48kHz = ~93 KB/s per speaker
- Consider implementing voice activity detection to reduce data sent
- Monitor connection quality and implement adaptive strategies

### 3. API Usage and Costs

Deepgram charges based on audio minutes processed:

- Implement controls to limit which speakers are transcribed
- Consider enabling transcription only for active speakers
- Monitor usage to prevent unexpected charges

## Troubleshooting

### Common Issues

1. **No Transcription Appearing**
   - Check your API key validity and permissions
   - Verify audio frames are being sent to the plugin
   - Ensure the WebSocket connection is established successfully

2. **High Latency in Transcription**
   - Check network conditions
   - Reduce audio quality if necessary
   - Consider using a different Deepgram region

3. **Poor Transcription Accuracy**
   - Try different Deepgram models
   - Ensure audio quality is sufficient
   - Check that speakers have clear audio setup

### Debugging

Enable debug mode for detailed logging:

```typescript
space.use(transcriptionPlugin, {
  debug: true
});
```

This will output detailed information about:
- WebSocket connections
- Audio data received and sent
- Transcript chunks received
- Error conditions and reconnection attempts

## Future Enhancements

Planned enhancements to the Deepgram integration include:

1. **Multi-language Support**: Automatic language detection and multi-language transcription
2. **Speaker Diarization**: Enhanced speaker identification using Deepgram's diarization features
3. **Sentiment Analysis**: Real-time sentiment analysis of transcriptions
4. **Topic Detection**: Automatic identification of conversation topics
5. **Improved Error Recovery**: More robust handling of connection failures and API limits

## Conclusion

The Deepgram integration in Cheshire Terminal provides powerful real-time transcription capabilities for Twitter Spaces. By leveraging Deepgram's advanced speech-to-text technology and combining it with per-speaker isolation, the system delivers accurate transcriptions that enhance the Space experience for hosts, participants, and developers.

For more information about Deepgram's capabilities, visit the [Deepgram Documentation](https://developers.deepgram.com/docs).
