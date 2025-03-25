# Cheshire Terminal Architecture

## System Overview

The Cheshire Terminal is a sophisticated Twitter Spaces client that enables programmatic control over audio spaces. This document outlines the architectural components, data flow, and integration points.

![Architecture Diagram](https://i.imgur.com/placeholder-for-architecture.png)

## Core Components

### 1. Twitter Authentication & API Layer

The authentication system uses a custom-built scraper that:
- Handles Twitter login flow with username/password
- Manages sessions and tokens
- Interacts with both official and undocumented Twitter APIs
- Maintains compatibility with Twitter's frequent API changes

### 2. Space Management Module

The Space module is the central component responsible for:
- Creating and configuring new Twitter Spaces
- Managing speaker permissions
- Handling chat interactions
- Processing audience reactions
- Monitoring space state (participants, duration, etc.)

### 3. Janus WebRTC Client

The WebRTC layer handles all real-time audio communication:
- Establishes connection to Twitter's Janus WebRTC gateway
- Creates and joins audio rooms
- Manages ICE/STUN/TURN for NAT traversal
- Handles publisher/subscriber relationships
- Processes incoming/outgoing audio streams
- Provides PCM audio frames to plugins

### 4. Plugin System

The extensible plugin architecture allows for:
- Modular functionality addition without core code changes
- Event-based interactions with the Space
- Audio stream processing and transformation
- Integration with external services

### 5. Deepgram Integration

The Deepgram integration provides real-time transcription:
- Creates individual WebSocket connections per speaker
- Streams audio in real-time to Deepgram's API
- Processes and stores transcription results
- Associates transcripts with correct speakers
- Exports transcription data in various formats

### 6. AI Integration (Grok/XAI)

The AI integration layer:
- Connects to Grok and other AI services
- Processes transcriptions for context
- Generates responses and content
- Manages conversation context
- Controls AI participation in spaces

## Data Flow

1. **Authentication Flow**:
   - User credentials → Authentication module → Twitter API → Session tokens
   - Tokens stored and used for subsequent API calls

2. **Space Creation Flow**:
   - Space configuration → Twitter API → Broadcast details
   - Broadcast details → Janus setup → WebRTC initialization

3. **Audio Processing Flow**:
   - Speaker audio → Janus WebRTC → PCM frames
   - PCM frames → Plugin system → Audio processors/recorders
   - PCM frames → Deepgram WebSockets → Transcription API → Text transcripts

4. **AI Integration Flow**:
   - Transcripts → Context management → AI model
   - AI response → Text-to-Speech (optional) → Audio output

## Technical Specifications

### Language & Runtime
- TypeScript/JavaScript
- Node.js runtime
- WebRTC for real-time communication

### External Dependencies
- Janus WebRTC Gateway (Twitter-hosted)
- Deepgram API for speech recognition
- Grok/OpenAI APIs for AI capabilities
- Twitter API for platform integration

### Storage
- Local file system for recordings and logs
- In-memory data structures for session state
- Optional integration with external databases

## Security Considerations

- **Authentication**: Credentials are stored only in environment variables, never persisted
- **API Keys**: All API keys are managed through environment variables
- **WebRTC**: All audio communication uses encrypted channels
- **Transcription**: Speaker data is only stored temporarily unless explicitly saved

## Scalability

The current architecture supports:
- Single space hosting per instance
- Multiple concurrent listeners/speakers per space
- Extensible plugin system for additional functionality

For multi-space hosting, consider:
- Running multiple instances
- Implementing a coordinator service
- Using a message queue for cross-instance communication

## Future Architecture Considerations

Planned architectural improvements include:
- Microservice decomposition for better scalability
- Database integration for persistent storage
- Containerization for easier deployment
- WebSocket API for external client integration
- Federation capabilities for distributed hosting
