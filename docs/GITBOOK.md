# Cheshire Terminal Documentation

Welcome to the official documentation for Cheshire Terminal, the advanced Twitter Spaces client with AI integration, real-time transcription, and plugin support.

## Table of Contents

- [Introduction](#introduction)
- [Getting Started](#getting-started)
- [Core Features](#core-features)
- [Architecture](#architecture)
- [Plugin Development](#plugin-development)
- [Integrations](#integrations)
- [Tutorials](#tutorials)
- [Contributing](#contributing)
- [FAQ](#faq)

## Introduction

Cheshire Terminal is a powerful, extensible client for Twitter Spaces that enhances the standard experience with advanced capabilities:

- Programmatic control of Twitter Spaces
- Real-time transcription using Deepgram
- AI integration with Grok and other models
- Extensible plugin system
- Audio recording and processing
- Enhanced moderation tools

This documentation will guide you through setting up, using, and extending Cheshire Terminal for your specific needs.

## Getting Started

### Prerequisites

Before using Cheshire Terminal, you'll need:

- Node.js v16 or higher
- A Twitter account with valid credentials
- A Deepgram API key (for transcription features)
- Optional: Grok or OpenAI API key (for AI integration)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/agent-twitter-client
cd agent-twitter-client

# Install dependencies
npm install
```

### Configuration

Create a `.env` file in the project root with your credentials:

```
# Twitter credentials
TWITTER_USERNAME=your_twitter_username
TWITTER_PASSWORD=your_twitter_password
TWITTER_EMAIL=your_twitter_email

# API keys
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET_KEY=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token 
TWITTER_BEARER_TOKEN=your_bearer_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret

# Deepgram API Key
DEEPGRAM_API_KEY=your_deepgram_api_key

# Optional: AI integration
OPENAI_API_KEY=your_openai_api_key
XAI_API_KEY=your_grok_api_key
```

### Running Your First Space

To start a Twitter Space:

```bash
node -r ts-node/register src/spaces/startSpace.ts
```

This will create a Space with default settings. The terminal will display:
- The URL of your created Space
- A confirmation that a tweet has been sent
- Status updates as users join or request to speak

## Core Features

### Space Management

Cheshire Terminal provides complete control over Twitter Spaces:

- Create Spaces with custom titles and descriptions
- Approve or deny speaker requests
- Send emoji reactions
- Monitor Space status and participants
- End Spaces gracefully

### Real-time Transcription

The Deepgram integration provides accurate, per-speaker transcription:

- Individual transcription for each speaker
- Support for multiple languages
- Advanced model options
- Export capabilities for archiving

### Plugin System

Extend functionality with the plugin system:

- Audio processing plugins
- Integration with external services
- Custom event handlers
- Data analysis tools

### AI Integration

Connect with AI services for enhanced capabilities:

- Sentiment analysis
- Content summarization
- Automated responses
- Moderation assistance

## Architecture

Cheshire Terminal follows a modular architecture with several key components:

### Twitter Integration Layer

- Authentication and session management
- API interaction with Twitter
- Speaker approval and management
- Chat and reaction handling

### WebRTC Stack

- Janus WebRTC connection management
- Audio encoding and decoding
- STUN/TURN configuration for NAT traversal
- PCM audio frame processing

### Plugin System

- Event-driven plugin architecture
- Lifecycle management for plugins
- Audio data routing to plugins
- Inter-plugin communication

### Deepgram Service

- WebSocket connection management
- Real-time audio streaming
- Transcription processing
- Speaker attribution

For more detailed information, see the [Architecture Documentation](ARCHITECTURE.md).

## Plugin Development

Cheshire Terminal's plugin system allows you to extend its functionality in numerous ways. Plugins can:

- Process audio streams
- React to Space events
- Integrate with external services
- Add custom commands or features

See the [Plugin Development Guide](PLUGIN_DEVELOPMENT.md) for detailed instructions on creating custom plugins.

## Integrations

### Deepgram Integration

Cheshire Terminal integrates with Deepgram's speech-to-text API for real-time transcription:

- Per-speaker transcription
- Multiple language support
- Advanced model options
- Customizable accuracy settings

For more information, see the [Deepgram Integration Guide](DEEPGRAM_INTEGRATION.md).

### Grok Integration

The Grok integration provides AI capabilities:

- Analyze conversation context
- Generate responses
- Summarize discussions
- Provide content moderation assistance

## Tutorials

### Creating a Recording Plugin

Learn how to create a plugin that records Space audio to disk:

```typescript
import { Plugin } from '../types';
import { Space } from '../core/Space';
import { AudioDataWithUser } from '../types';
import * as fs from 'fs';

export class CustomRecordingPlugin implements Plugin {
  private fileStream: fs.WriteStream | null = null;
  
  init(params: { space: Space; pluginConfig?: Record<string, any> }): void {
    const outputPath = params.pluginConfig?.outputPath || './recording.raw';
    this.fileStream = fs.createWriteStream(outputPath);
    console.log(`Recording to ${outputPath}`);
  }
  
  onAudioData(data: AudioDataWithUser): void {
    if (this.fileStream) {
      const buffer = Buffer.from(data.samples.buffer);
      this.fileStream.write(buffer);
    }
  }
  
  cleanup(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
  }
}
```

### Creating a Sentiment Analysis Plugin

```typescript
import { Plugin } from '../types';
import { DeepgramTranscriptionPlugin } from './DeepgramTranscriptionPlugin';

export class SentimentPlugin implements Plugin {
  private transcriptionPlugin: DeepgramTranscriptionPlugin | null = null;
  
  onAttach(params: { space: Space; pluginConfig?: Record<string, any> }): void {
    // Find the transcription plugin
    for (const plugin of params.space.getPlugins()) {
      if (plugin instanceof DeepgramTranscriptionPlugin) {
        this.transcriptionPlugin = plugin;
        break;
      }
    }
    
    // Listen for new transcripts
    params.space.on('transcript', this.analyzeTranscript.bind(this));
  }
  
  private async analyzeTranscript(data: { userId: string, text: string }): Promise<void> {
    // Perform sentiment analysis
    const sentiment = await this.calculateSentiment(data.text);
    console.log(`Sentiment for ${data.userId}: ${sentiment.score}`);
  }
  
  private async calculateSentiment(text: string): Promise<{ score: number }> {
    // Implementation of sentiment analysis
    return { score: 0.75 }; // Positive sentiment
  }
}
```

## Contributing

We welcome contributions to Cheshire Terminal! Here's how you can help:

1. **Report bugs**: Open issues for any bugs or problems you encounter
2. **Suggest features**: Share your ideas for new features
3. **Submit pull requests**: Contribute code improvements or new features
4. **Write documentation**: Help improve or expand the documentation
5. **Create plugins**: Develop and share plugins with the community

Please see our [Contributing Guidelines](CONTRIBUTING.md) for more information.

## FAQ

### Q: Does Cheshire Terminal work with any Twitter account?

A: Yes, any Twitter account with the ability to create Spaces can use Cheshire Terminal.

### Q: Can I use Cheshire Terminal for commercial purposes?

A: Yes, Cheshire Terminal is licensed under the MIT license, which permits commercial use.

### Q: How much does it cost to use the transcription feature?

A: The transcription feature uses Deepgram's API, which has its own pricing model. Cheshire Terminal itself is free, but you'll need to pay for Deepgram usage according to their pricing.

### Q: Can Cheshire Terminal record Spaces?

A: Yes, Cheshire Terminal includes plugins for recording audio to disk in various formats.

### Q: Is it possible to use Cheshire Terminal with other audio platforms besides Twitter Spaces?

A: Currently, Cheshire Terminal is specifically designed for Twitter Spaces. However, the modular architecture means it could potentially be adapted for other platforms in the future.

### Q: How can I troubleshoot connection issues?

A: Check the following:
- Verify your Twitter credentials are correct
- Ensure your network allows WebRTC connections
- Check that your API keys are valid
- Look for detailed error messages in the console output
- Enable debug mode for more verbose logging

## Further Reading

For a deeper dive into the technology and vision behind Cheshire Terminal, check out our [feature article](ARTICLE.md) on the project's development and future directions.
