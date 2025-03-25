# Plugin Development Guide

The Cheshire Terminal Twitter Space client features a robust plugin system that allows developers to extend its functionality. This guide will walk you through creating custom plugins for the platform.

## Plugin Architecture

Plugins in Cheshire Terminal follow an event-driven architecture. Each plugin:

- Implements the `Plugin` interface
- Registers for lifecycle events
- Processes audio data
- Can interact with the Space instance

## Plugin Lifecycle

A plugin's lifecycle consists of the following stages:

1. **Attachment** (`onAttach`): Plugin is added to a Space
2. **Initialization** (`init`): Space is initialized and ready
3. **Janus Ready** (`onJanusReady`): WebRTC connection is established
4. **Event Processing**: The plugin responds to events (audio data, user joins/leaves, etc.)
5. **Cleanup** (`cleanup`): Plugin resources are released

## Creating Your First Plugin

### 1. Basic Plugin Structure

Create a new TypeScript file in the `src/spaces/plugins` directory:

```typescript
import type { Plugin } from '../types';
import { Space } from '../core/Space';
import { AudioDataWithUser } from '../types';

export class MyCustomPlugin implements Plugin {
  private space: Space | null = null;
  
  // Called when the plugin is attached to a Space
  onAttach(params: { space: Space; pluginConfig?: Record<string, any> }): void {
    this.space = params.space;
    console.log('[MyCustomPlugin] Plugin attached to space');
    
    // Access configuration if provided
    const config = params.pluginConfig || {};
    console.log('[MyCustomPlugin] Configuration:', config);
  }
  
  // Called when the Space is fully initialized
  init(): void {
    console.log('[MyCustomPlugin] Initializing...');
    // Set up your plugin's state and resources
  }
  
  // Called when Janus WebRTC client is ready
  onJanusReady(): void {
    console.log('[MyCustomPlugin] Janus client ready');
    // WebRTC setup is complete
  }
  
  // Process audio data from speakers
  onAudioData(data: AudioDataWithUser): void {
    // Process PCM audio frames
    // data.samples contains the audio data as Int16Array
    // data.userId identifies the speaker
  }
  
  // Release resources when done
  cleanup(): void {
    console.log('[MyCustomPlugin] Cleaning up resources');
    // Close any open connections, free resources
    this.space = null;
  }
}
```

### 2. Registering Your Plugin

To use your plugin, you need to register it with a Space instance:

```typescript
import { Space } from './core/Space';
import { Scraper } from '../scraper';
import { MyCustomPlugin } from './plugins/MyCustomPlugin';

// Create a Space
const space = new Space(scraper, { debug: true });

// Create and add your plugin with optional configuration
const myPlugin = new MyCustomPlugin();
space.use(myPlugin, {
  // Optional configuration
  setting1: 'value1',
  setting2: true,
  threshold: 0.75
});
```

## Processing Audio Data

One of the most common use cases for plugins is processing audio data from speakers:

```typescript
onAudioData(data: AudioDataWithUser): void {
  // Extract information about the audio
  const { 
    userId,         // The speaker's user ID
    samples,        // PCM audio data (Int16Array)
    sampleRate,     // Audio sample rate (usually 48000)
    bitsPerSample,  // Bits per sample (usually 16)
    channelCount,   // Number of channels (usually 1 for mono)
    numberOfFrames  // Number of frames in this chunk
  } = data;
  
  // Example: Calculate audio volume
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += Math.abs(samples[i]);
  }
  const averageVolume = sum / samples.length;
  
  if (averageVolume > 1000) {
    console.log(`[MyCustomPlugin] High volume from user ${userId}: ${averageVolume}`);
  }
}
```

## Event-Driven Integration

Subscribe to Space events to react to different activities:

```typescript
onAttach(params: { space: Space; pluginConfig?: Record<string, any> }): void {
  this.space = params.space;
  
  // User joined the Space
  this.space.on('userJoined', (user) => {
    console.log(`[MyCustomPlugin] User joined: ${user.displayName} (${user.userId})`);
  });
  
  // User left the Space
  this.space.on('userLeft', (user) => {
    console.log(`[MyCustomPlugin] User left: ${user.displayName} (${user.userId})`);
  });
  
  // Someone sent a reaction
  this.space.on('guestReaction', (reaction) => {
    console.log(`[MyCustomPlugin] Reaction: ${reaction.emoji} from ${reaction.displayName}`);
  });
  
  // Someone requested to speak
  this.space.on('speakerRequest', (request) => {
    console.log(`[MyCustomPlugin] Speaker request from ${request.displayName}`);
  });
}
```

## Plugin Configuration

Accept configuration options in your plugin:

```typescript
interface MyPluginConfig {
  outputDir?: string;
  sensitivity?: number;
  enableFeatureX?: boolean;
}

export class MyCustomPlugin implements Plugin {
  private config: MyPluginConfig = {
    outputDir: './output',
    sensitivity: 0.5,
    enableFeatureX: false
  };
  
  onAttach(params: { space: Space; pluginConfig?: Record<string, any> }): void {
    this.space = params.space;
    
    // Merge provided config with defaults
    if (params.pluginConfig) {
      this.config = {
        ...this.config,
        ...params.pluginConfig
      };
    }
    
    console.log('[MyCustomPlugin] Configured with:', this.config);
  }
}
```

## Advanced Plugin Examples

### Audio Processing Plugin

```typescript
export class AudioEffectsPlugin implements Plugin {
  private processors: Map<string, AudioProcessor> = new Map();
  
  onAudioData(data: AudioDataWithUser): void {
    // Get or create processor for this user
    let processor = this.processors.get(data.userId);
    if (!processor) {
      processor = new AudioProcessor(data.sampleRate);
      this.processors.set(data.userId, processor);
    }
    
    // Process the audio (e.g., add echo, noise reduction, etc.)
    const processedSamples = processor.process(data.samples);
    
    // You can emit the processed audio if needed
    if (this.space) {
      this.space.emit('processedAudio', {
        ...data,
        samples: processedSamples
      });
    }
  }
}
```

### Integration With External APIs

```typescript
export class SentimentAnalysisPlugin implements Plugin {
  private transcripts: Map<string, string[]> = new Map();
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  // Store transcripts from a Deepgram plugin
  async processTranscript(userId: string, transcript: string): Promise<void> {
    // Store the transcript
    const userTranscripts = this.transcripts.get(userId) || [];
    userTranscripts.push(transcript);
    this.transcripts.set(userId, userTranscripts);
    
    // If we have enough text, analyze sentiment
    if (transcript.split(' ').length > 10) {
      const sentiment = await this.analyzeSentiment(transcript);
      console.log(`[SentimentPlugin] User ${userId} sentiment: ${sentiment.score}`);
    }
  }
  
  // Call external sentiment analysis API
  private async analyzeSentiment(text: string): Promise<{ score: number }> {
    // Implementation of API call
    return { score: 0.75 }; // Positive sentiment example
  }
}
```

## Best Practices

1. **Resource Management**:
   - Always clean up resources in the `cleanup` method
   - Use proper error handling for async operations
   - Consider memory usage when processing audio streams

2. **Performance**:
   - Audio processing is CPU-intensive; optimize your algorithms
   - Avoid blocking the main thread with heavy computations
   - Consider using Web Workers for intensive processing

3. **Error Handling**:
   - Implement robust error handling, especially for network operations
   - Degrade gracefully when services are unavailable
   - Log errors for troubleshooting

4. **Configuration**:
   - Provide sensible defaults for all configuration options
   - Validate configuration values to prevent runtime errors
   - Document expected configuration formats

5. **Compatibility**:
   - Test your plugin with different versions of the client
   - Handle variations in audio formats and sample rates
   - Consider platform-specific differences

## Plugin Communication

Plugins can communicate with each other through the Space event system:

```typescript
// Plugin A: Emit custom events
this.space.emit('customEvent', { data: 'some-data' });

// Plugin B: Listen for custom events
this.space.on('customEvent', (data) => {
  console.log('[PluginB] Received event:', data);
});
```

## Debugging Plugins

To debug your plugins effectively:

1. Enable debug mode when creating the Space:
   ```typescript
   const space = new Space(scraper, { debug: true });
   ```

2. Use the logger for consistent output:
   ```typescript
   import { Logger } from '../logger';
   
   export class MyPlugin implements Plugin {
     private logger: Logger;
     
     onAttach(params: { space: Space; pluginConfig?: Record<string, any> }): void {
       this.space = params.space;
       const debugEnabled = params.pluginConfig?.debug ?? false;
       this.logger = new Logger(debugEnabled);
       
       this.logger.debug('[MyPlugin] Debug information');
       this.logger.info('[MyPlugin] Important information');
       this.logger.warn('[MyPlugin] Warning message');
       this.logger.error('[MyPlugin] Error message');
     }
   }
   ```

3. Test incrementally with simplified cases before handling complex scenarios.

## Publishing Your Plugin

To share your plugin with the community:

1. Create a dedicated repository for your plugin
2. Include clear documentation and examples
3. Specify compatibility with Cheshire Terminal versions
4. Include installation instructions

Users can then install your plugin via npm:

```bash
npm install cheshire-plugin-myfeature
```

And import it in their code:

```typescript
import { MyFeaturePlugin } from 'cheshire-plugin-myfeature';

// Use it with a Space
space.use(new MyFeaturePlugin(), { /* config */ });
```

## Conclusion

The plugin system is the heart of Cheshire Terminal's extensibility. By creating custom plugins, you can add unique features tailored to your specific use cases. Whether you want to analyze audio, integrate with external services, or transform the Space experience, the plugin system provides a structured way to extend functionality.

For more advanced plugin examples, check out the [core plugins](https://github.com/yourusername/agent-twitter-client/tree/main/src/spaces/plugins) included with Cheshire Terminal.
