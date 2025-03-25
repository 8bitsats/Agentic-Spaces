# Cheshire Terminal Twitter Space Client

A powerful, extensible client for Twitter Spaces with advanced AI capabilities, real-time transcription, and moderation tools.

![Cheshire Terminal Banner](https://i.imgur.com/placeholder-for-banner.png)

## ✨ Features

- **Host Twitter Spaces**: Create and manage Twitter Spaces programmatically
- **Real-time Transcription**: Integrated Deepgram API for accurate speech-to-text
- **AI Integration**: Connect with Grok and other AI models for intelligent interactions
- **Audio Processing**: Record, analyze, and manipulate audio streams
- **Plugin System**: Extensible architecture to add custom functionality
- **Interactive Mode**: Support for audience participation and speaker management

## 🚀 Quick Start

### Prerequisites

- Node.js v16+
- Twitter account credentials
- Deepgram API key
- (Optional) Grok API key for AI integration

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/agent-twitter-client
cd agent-twitter-client

# Install dependencies
npm install
```

### Configuration

Create a `.env` file in the root directory with the following content:

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

# Optional: Proxy configuration
PROXY_URL=your_proxy_url  # HTTP(s) proxy for requests
```

### Starting a Space

Run the following command to start a Twitter Space:

```bash
node -r ts-node/register src/spaces/startSpace.ts
```

## 📖 Documentation

For complete documentation, please visit our [GitBook Documentation](https://docs.cheshireterminal.com).

- [Architecture Overview](https://docs.cheshireterminal.com/architecture)
- [Setup Guide](https://docs.cheshireterminal.com/setup)
- [API Reference](https://docs.cheshireterminal.com/api-reference)
- [Plugin Development](https://docs.cheshireterminal.com/plugins)
- [Integration Guides](https://docs.cheshireterminal.com/integrations)

## 🧩 Core Components

- **Space Module**: Core functionality for creating and managing Twitter Spaces
- **Deepgram Plugin**: Real-time transcription of speech using Deepgram's API
- **Janus Client**: WebRTC communication layer for audio streaming
- **Plugin System**: Extensible architecture for custom functionality
- **Recording Tools**: Capture and save audio streams
- **Scraper**: Twitter API interaction and authentication

## 🔧 Development

### Project Structure

```
src/
├── platform/            # Platform-specific implementations
├── services/            # External service integrations
│   └── deepgram/        # Deepgram service integration
├── spaces/              # Twitter Spaces functionality
│   ├── core/            # Core Space components
│   └── plugins/         # Space plugins
├── types/               # TypeScript type definitions
├── auth.ts              # Authentication utilities
├── scraper.ts           # Twitter scraping utilities
└── ...
```

### Building

```bash
npm run build
```

### Running Tests

```bash
npm test
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- Twitter API
- Deepgram for speech-to-text capabilities
- Janus WebRTC Gateway
- All contributors who have helped shape this project
