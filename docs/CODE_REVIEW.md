# Code Review and Improvement Guide

## Overview

This document provides a comprehensive analysis of the Cheshire Terminal Twitter Space client codebase, identifying potential issues and suggesting improvements. It's intended for developers who want to contribute to the project or understand the code structure better.

## Core Components Overview

The codebase consists of several key components:

1. **Core Classes** 
   - `Space.ts` - Main class for managing Twitter Spaces
   - `SpaceParticipant.ts` - Handles participant behavior and state
   
2. **Plugin System**
   - `DeepgramTranscriptionPlugin.ts` - Real-time transcription
   - `RecordToDiskPlugin.ts` - Audio recording
   - `HlsRecordPlugin.ts` - Stream recording
   - `SttTtsPlugin.ts` - Speech-to-text and text-to-speech
   - `IdleMonitorPlugin.ts` - Detects idle periods
   - `MonitorAudioPlugin.ts` - Monitors audio levels
   
3. **WebRTC Integration**
   - `JanusClient.ts` - Connection to Twitter's Janus WebRTC server
   - `JanusAudio.ts` - Audio processing utilities
   
4. **Chat Functionality**
   - `ChatClient.ts` - Handles messages and reactions
   
5. **Utilities**
   - `utils.ts` - Helper functions
   - `logger.ts` - Logging utilities

## Component-Specific Analysis

### 1. DeepgramTranscriptionPlugin.ts

#### Observations:
- Handles real-time transcription using Deepgram's API
- Creates separate WebSocket connections for each user
- Error handling is present but could be improved

#### Recommended Improvements:

**WebSocket Connection Management:**
```typescript
// Improvement: Better WebSocket management with exponential backoff
private async initializeDeepgramForUser(userId: string): Promise<void> {
  try {
    // Track retry attempts
    const retryCount = this.reconnectionAttempts.get(userId) || 0;
    if (retryCount > MAX_RECONNECTION_ATTEMPTS) {
      console.error(`[DeepgramPlugin] Max reconnection attempts reached for ${userId}`);
      return;
    }
    
    // Existing code...
    
    // Reset retry count on successful connection
    this.reconnectionAttempts.set(userId, 0);
  } catch (error) {
    // Update retry count
    const retryCount = (this.reconnectionAttempts.get(userId) || 0) + 1;
    this.reconnectionAttempts.set(userId, retryCount);
    
    // Calculate backoff time
    const backoffTime = Math.min(1000 * Math.pow(2, retryCount), MAX_BACKOFF_MS);
    
    console.error(`[DeepgramPlugin] Failed to initialize (attempt ${retryCount}/${MAX_RECONNECTION_ATTEMPTS}). Retrying in ${backoffTime}ms`);
    
    // Schedule retry with exponential backoff
    setTimeout(() => {
      this.initializeDeepgramForUser(userId).catch(console.error);
    }, backoffTime);
  }
}
```

**Memory Management:**
```typescript
// Improvement: Limit transcript history size
private addTranscript(userId: string, transcript: string): void {
  const userTranscripts = this.transcripts.get(userId) || [];
  
  // Add new transcript
  userTranscripts.push({
    text: transcript,
    timestamp: new Date().toISOString()
  });
  
  // Limit history size (keep last 100 transcripts per user)
  if (userTranscripts.length > 100) {
    userTranscripts.shift(); // Remove oldest
  }
  
  this.transcripts.set(userId, userTranscripts);
  
  // Optionally flush to disk if we have a lot of transcripts
  this.maybeFlushToDisk();
}

private maybeFlushToDisk(): void {
  const totalTranscripts = Array.from(this.transcripts.values())
    .reduce((sum, arr) => sum + arr.length, 0);
    
  if (totalTranscripts > 1000 && this.autoSave) {
    this.saveTranscriptsToFile()
      .catch(err => console.error('[DeepgramPlugin] Failed to auto-save transcripts:', err));
  }
}
```

**Structured Logging:**
```typescript
// Improvement: Better logging with levels and consistent format
private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  const prefix = `[DeepgramPlugin][${timestamp}][${level.toUpperCase()}]`;
  
  switch (level) {
    case 'debug':
      if (this.debugEnabled) console.debug(prefix, message, ...args);
      break;
    case 'info':
      console.log(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    case 'error':
      console.error(prefix, message, ...args);
      break;
  }
  
  // Optionally log to a file as well
  this.logToFile(level, message, args);
}
```

### 2. JanusClient.ts

#### Observations:
- Handles WebRTC connection to Twitter's Janus server
- Complex connection management with multiple states
- Has retry logic for connection failures

#### Recommended Improvements:

**Enhanced Event Handling:**
```typescript
// Improvement: Complete the handleJanusEvent method
private handleJanusEvent(evt: any): void {
  if (!evt.janus) {
    return;
  }
  
  this.logger.debug('[JanusClient] Event received:', evt.janus);
  
  // Emit the event for waitForJanusEventWithPredicate
  this.emit('janus', evt);
  
  if (evt.janus === 'keepalive') {
    // Keepalive, nothing to do
    return;
  }
  
  if (evt.janus === 'event') {
    // Process various event types
    if (evt.plugindata?.data?.videoroom === 'event') {
      // Handle videoroom events (publishers, etc.)
      if (Array.isArray(evt.plugindata?.data?.publishers)) {
        this.logger.debug(
          '[JanusClient] Publishers list updated:',
          evt.plugindata.data.publishers.length
        );
        
        // Notify about new publishers
        this.emit('publishers', evt.plugindata.data.publishers);
      }
      
      // Handle kicked/leaving events
      if (evt.plugindata?.data?.leaving) {
        this.logger.debug(
          '[JanusClient] Participant leaving:',
          evt.plugindata.data.leaving
        );
        this.emit('participantLeft', evt.plugindata.data.leaving);
      }
    }
  }
  
  if (evt.janus === 'error') {
    this.logger.error('[JanusClient] Janus error:', evt.error?.code, evt.error?.reason);
    this.emit('error', new Error(`Janus error: ${evt.error?.code} - ${evt.error?.reason}`));
  }
  
  if (evt.janus === 'webrtcup') {
    this.logger.info('[JanusClient] WebRTC connection established');
    this.emit('webrtcUp', evt);
  }
  
  if (evt.janus === 'hangup') {
    this.logger.info('[JanusClient] WebRTC hangup:', evt.reason);
    this.emit('hangup', evt);
  }
}
```

**Timeout for Waiting on Events:**
```typescript
// Improvement: Add a cleanup mechanism for unresolved promises
private waitForJanusEventWithRetries(
  predicate: (evt: any) => boolean,
  timeoutMs = 5000,
  retries = 3,
  description = 'event'
): Promise<any> {
  return new Promise((resolve, reject) => {
    let attemptCount = 0;
    let timeoutId: NodeJS.Timeout;
    
    const attemptWait = () => {
      attemptCount++;
      
      const onEvent = (evt: any) => {
        if (predicate(evt)) {
          cleanup();
          resolve(evt);
        }
      };
      
      const onTimeout = () => {
        cleanup();
        
        if (attemptCount >= retries) {
          reject(new Error(`[JanusClient] Timed out waiting for ${description} after ${retries} attempts`));
        } else {
          this.logger.warn(`[JanusClient] Timeout waiting for ${description}, retry ${attemptCount}/${retries}`);
          attemptWait(); // Try again
        }
      };
      
      const cleanup = () => {
        this.removeListener('janus', onEvent);
        clearTimeout(timeoutId);
      };
      
      // Set up listener and timeout
      this.on('janus', onEvent);
      timeoutId = setTimeout(onTimeout, timeoutMs);
    };
    
    attemptWait();
  });
}
```

**ICE Connection Recovery:**
```typescript
// Improvement: More robust ICE recovery
private handleIceConnectionStateChange(): void {
  if (!this.pc) return;
  
  const state = this.pc.iceConnectionState;
  this.logger.debug('[JanusClient] ICE connection state:', state);
  
  if (state === 'failed') {
    this.logger.warn('[JanusClient] ICE connection failed, attempting recovery...');
    
    // Try ICE restart
    this.restartIce()
      .then(() => this.logger.info('[JanusClient] ICE restart initiated'))
      .catch(err => {
        this.logger.error('[JanusClient] ICE restart failed:', err);
        
        // If ICE restart fails, try full reconnection after a delay
        setTimeout(() => {
          this.logger.warn('[JanusClient] Attempting full reconnection...');
          this.reconnect()
            .then(() => this.logger.info('[JanusClient] Reconnection successful'))
            .catch(reconnectErr => {
              this.logger.error('[JanusClient] Reconnection failed:', reconnectErr);
              this.emit('error', new Error(`[JanusClient] Reconnection failed: ${reconnectErr.message}`));
            });
        }, 2000);
      });
  } else if (state === 'disconnected') {
    this.logger.warn('[JanusClient] ICE connection disconnected');
    
    // Start a timer to check if we recover automatically
    clearTimeout(this.iceRecoveryTimer);
    this.iceRecoveryTimer = setTimeout(() => {
      if (this.pc?.iceConnectionState === 'disconnected') {
        this.logger.warn('[JanusClient] ICE still disconnected after timeout, attempting restart');
        this.restartIce().catch(console.error);
      }
    }, 5000);
  } else if (state === 'connected' || state === 'completed') {
    this.logger.info('[JanusClient] ICE connection established');
    clearTimeout(this.iceRecoveryTimer);
  }
}
```

### 3. Space.ts

#### Observations:
- Central class for managing a Twitter Space
- Handles speaker management, plugins, and WebRTC integration
- Complex initialization sequence

#### Recommended Improvements:

**Enhanced Error Handling:**
```typescript
// Improvement: Enhanced error handling in approveSpeaker
public async approveSpeaker(userId: string, sessionUUID: string): Promise<void> {
  if (!this.isInitialized || !this.broadcastInfo) {
    const error = new Error('[Space] Not initialized or missing broadcastInfo');
    this.emit('error', error);
    throw error;
  }
  
  if (!this.authToken) {
    const error = new Error('[Space] No auth token available');
    this.emit('error', error);
    throw error;
  }

  // Validate inputs
  if (!userId || !sessionUUID) {
    const error = new Error(`[Space] Invalid userId or sessionUUID: ${userId}, ${sessionUUID}`);
    this.emit('error', error);
    throw error;
  }

  try {
    // Store in our local speaker map
    this.speakers.set(userId, { userId, sessionUUID });

    // 1) Call Twitter's /request/approve
    await this.callApproveEndpoint(
      this.broadcastInfo,
      this.authToken,
      userId,
      sessionUUID,
    );

    // 2) Subscribe to their audio in Janus
    await this.janusClient?.subscribeSpeaker(userId);
    
    this.emit('speakerApproved', { userId, sessionUUID });
    this.logger.info(`[Space] Speaker approved: ${userId}`);
  } catch (error) {
    this.speakers.delete(userId); // Cleanup if failed
    this.logger.error(`[Space] Failed to approve speaker ${userId}:`, error);
    this.emit('error', error);
    throw error;
  }
}
```

**Improved Resource Management:**
```typescript
// Improvement: More robust cleanup in stop method
public async stop(): Promise<void> {
  this.logger.info('[Space] Stopping...');
  
  // Emit beforeStop event so plugins can perform cleanup
  this.emit('beforeStop');
  
  // Set a timeout to force termination if cleanup takes too long
  const forceTerminationTimeout = setTimeout(() => {
    this.logger.warn('[Space] Forced termination due to stop timeout');
    this.cleanupResources(true);
  }, 10000); // 10 seconds timeout
  
  try {
    // Try graceful cleanup first
    await this.finalizeSpace().catch((err) => {
      this.logger.error('[Space] finalizeSpace error =>', err);
    });

    // Disconnect chat if present
    if (this.chatClient) {
      await this.chatClient.disconnect().catch(err => {
        this.logger.error('[Space] Chat disconnect error =>', err);
      });
      this.chatClient = undefined;
    }

    // Stop Janus if running
    if (this.janusClient) {
      await this.janusClient.stop().catch(err => {
        this.logger.error('[Space] Janus stop error =>', err);
      });
      this.janusClient = undefined;
    }

    // Cleanup all plugins
    for (const { plugin } of this.plugins) {
      try {
        await Promise.race([
          plugin.cleanup?.(),
          new Promise(r => setTimeout(r, 3000)) // 3s timeout per plugin
        ]);
      } catch (err) {
        this.logger.error(`[Space] Plugin ${plugin.constructor.name} cleanup error:`, err);
      }
    }
    this.plugins.clear();

    this.isInitialized = false;
    clearTimeout(forceTerminationTimeout);
    this.logger.info('[Space] Successfully stopped');
  } catch (error) {
    this.logger.error('[Space] Error during graceful stop:', error);
    // Force cleanup as a fallback
    this.cleanupResources(true);
    clearTimeout(forceTerminationTimeout);
  }
}

// Helper method for forced cleanup
private cleanupResources(forced: boolean = false): void {
  if (forced) {
    this.logger.warn('[Space] Performing forced resource cleanup');
  }
  
  if (this.chatClient) {
    try {
      this.chatClient.disconnect();
    } catch (e) {
      // Ignore errors in forced cleanup
    }
    this.chatClient = undefined;
  }
  
  if (this.janusClient) {
    try {
      this.janusClient.stop();
    } catch (e) {
      // Ignore errors in forced cleanup
    }
    this.janusClient = undefined;
  }
  
  this.plugins.clear();
  this.isInitialized = false;
}
```

**Plugin Management Improvements:**
```typescript
// Improvement: Type-safe plugin resolution
public getPlugin<T extends Plugin>(pluginType: new (...args: any[]) => T): T | undefined {
  for (const { plugin } of this.plugins) {
    if (plugin instanceof pluginType) {
      return plugin as T;
    }
  }
  return undefined;
}

// Usage example:
const transcriptionPlugin = space.getPlugin(DeepgramTranscriptionPlugin);
if (transcriptionPlugin) {
  const transcripts = transcriptionPlugin.getAllTranscripts();
}
```

### 4. SttTtsPlugin.ts

#### Observations:
- Handles speech-to-text and text-to-speech functionality
- Manages audio playback queues
- Integrates with ElevenLabs or other TTS providers

#### Recommended Improvements:

**Improved TTS Queue Management:**
```typescript
// Improvement: Better TTS queue management
private async processTtsQueue(): Promise<void> {
  if (this.processingQueue) return; // Prevent multiple simultaneous processing
  
  this.processingQueue = true;
  
  try {
    while (this.ttsQueue.length > 0) {
      const text = this.ttsQueue.shift();
      if (!text) continue;
      
      try {
        this.logger.debug(`[SttTtsPlugin] Processing TTS: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        
        const startTime = Date.now();
        const mp3Buf = await this.elevenLabsTts(text);
        const pcm = await this.convertMp3ToPcm(mp3Buf, 48000);
        await this.streamToJanus(pcm, 48000);
        
        this.logger.debug(`[SttTtsPlugin] TTS processing complete (${Date.now() - startTime}ms)`);
      } catch (err) {
        this.logger.error('[SttTtsPlugin] TTS processing error:', err);
        // Continue with next item in queue
      }
    }
  } finally {
    this.processingQueue = false;
    this.isSpeaking = false;
  }
}
```

**Rate Limiting Implementation:**
```typescript
// Improvement: Add rate limiting for API calls
private async elevenLabsTts(text: string): Promise<Buffer> {
  // Check rate limit
  if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
    const waitTime = this.rateLimitedUntil - Date.now();
    this.logger.warn(`[SttTtsPlugin] Rate limited, waiting ${waitTime}ms`);
    await new Promise(r => setTimeout(r, waitTime));
  }
  
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: this.voiceSettings,
        }),
      },
    );
    
    // Check for rate limiting
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
      this.rateLimitedUntil = Date.now() + retryAfter * 1000;
      this.logger.warn(`[SttTtsPlugin] Rate limited for ${retryAfter} seconds`);
      throw new Error(`Rate limited for ${retryAfter} seconds`);
    }
    
    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    this.logger.error('[SttTtsPlugin] ElevenLabs TTS error:', error);
    throw error;
  }
}
```

### 5. HlsRecordPlugin.ts

#### Observations:
- Records the HLS stream
- Waits for HLS URL to be ready
- Downloads and saves segments

#### Recommended Improvements:

**Better HLS URL Checking:**
```typescript
// Improvement: Better error handling and retries for HLS URL
private async waitForHlsReady(
  hlsUrl: string,
  maxRetries: number,
): Promise<boolean> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      this.logger?.debug(`[HlsRecordPlugin] Checking HLS URL (attempt #${attempt + 1})...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
      
      const resp = await fetch(hlsUrl, { 
        method: 'HEAD',
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      
      if (resp.ok) {
        this.logger?.debug(`[HlsRecordPlugin] HLS is ready (attempt #${attempt + 1})`);
        return true;
      } else {
        this.logger?.debug(
          `[HlsRecordPlugin] HLS status=${resp.status}, retrying...`,
        );
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger?.debug('[HlsRecordPlugin] HLS check timed out');
      } else {
        this.logger?.debug(
          '[HlsRecordPlugin] HLS fetch error =>',
          (error as Error).message,
        );
      }
    }
    
    attempt++;
    await new Promise((r) => setTimeout(r, 2000));
  }
  
  return false;
}
```

**Segment Download Improvements:**
```typescript
// Improvement: Enhanced segment downloading with retry and validation
private async downloadAndSaveSegment(
  segmentUrl: string,
  localPath: string,
  retries = 3
): Promise<boolean> {
  let attempt = 0;
  
  while (attempt < retries) {
    try {
      // Download with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(segmentUrl, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      
      // Validate segment data
      if (buffer.byteLength < 100) { // Too small to be valid
        throw new Error('Segment data too small, likely invalid');
      }
      
      // Save to disk
      await fs.promises.writeFile(localPath, Buffer.from(buffer));
      
      this.logger?.debug(
        `[HlsRecordPlugin] Saved segment: ${localPath} (${buffer.byteLength} bytes)`,
      );
      
      return true;
    } catch (error) {
      attempt++;
      this.logger?.warn(
        `[HlsRecordPlugin] Segment download failed (attempt ${attempt}/${retries}): ${error.message}`,
      );
      
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // Increasing backoff
      }
    }
  }
  
  this.logger?.error(
    `[HlsRecordPlugin] Failed to download segment after ${retries} attempts: ${segmentUrl}`,
  );
  return false;
}
```

## Global Improvement Recommendations

### 1. Centralized Error Handling

Create a standard error system:

```typescript
// src/errors.ts
export enum ErrorCode {
  // Auth errors (1000-1999)
  AUTH_FAILED = 1000,
  AUTH_TOKEN_EXPIRED = 1001,
  
  // Network errors (2000-2999)
  NETWORK_ERROR = 2000,
  FETCH_FAILED = 2001,
  WEBSOCKET_ERROR = 2002,
  ICE_CONNECTION_FAILED = 2003,
  
  // Space errors (3000-3999)
  SPACE_INITIALIZATION_FAILED = 3000,
  SPEAKER_APPROVAL_FAILED = 3001,
  SPEAKER_REMOVAL_FAILED = 3002,
  
  // Plugin errors (4000-4999)
  PLUGIN_INITIALIZATION_FAILED = 4000,
  TRANSCRIPTION_FAILED = 4001,
  RECORDING_FAILED = 4002,
  
  // Unknown error
  UNKNOWN_ERROR = 9999
}

export class CheshireError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'CheshireError';
  }
  
  static fromError(error: unknown, defaultCode = ErrorCode.UNKNOWN_ERROR): CheshireError {
    if (error instanceof CheshireError) {
      return error;
    }
    
    const message = error instanceof Error 
      ? error.message 
      : String(error);
      
    return new CheshireError(defaultCode, message, error instanceof Error ? error : undefined);
  }
}
```

### 2. Structured Logging System

Enhance the Logger class:

```typescript
// src/logger.ts
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
}

export interface LoggingOptions {
  level?: LogLevel;
  console?: boolean;
  file?: string;
  maxFileSize?: number;
}

export class Logger {
  private level: LogLevel;
  private component: string;
  private console: boolean;
  private fileStream?: fs.WriteStream;
  
  constructor(component: string, options: LoggingOptions = {}) {
    this.component = component;
    this.level = options.level ?? LogLevel.INFO;
    this.console = options.console ?? true;
    
    if (options.file) {
      this.fileStream = fs.createWriteStream(options.file, { flags: 'a' });
    }
  }
  
  private log(level: LogLevel, message: string, ...data: any[]): void {
    if (level < this.level) return;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data: data.length > 0 ? data : undefined
    };
    
    // Output to console if enabled
    if (this.console) {
      const prefix = `[${entry.timestamp}][${LogLevel[level]}][${this.component}]`;
      
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(prefix, message, ...data);
          break;
        case LogLevel.INFO:
          console.info(prefix, message, ...data);
          break;
        case LogLevel.WARN:
          console.warn(prefix, message, ...data);
          break;
        case LogLevel.ERROR:
          console.error(prefix, message, ...data);
          break;
      }
    }
    
    // Write to file if configured
    if (this.fileStream) {
      this.fileStream.write(JSON.stringify(entry) + '\n');
    }
  }
  
  debug(message: string, ...data: any[]): void {
    this.log(LogLevel.DEBUG, message, ...data);
  }
  
  info(message: string, ...data: any[]): void {
    this.log(LogLevel.INFO, message, ...data);
  }
  
  warn(message: string, ...data: any[]): void {
    this.log(LogLevel.WARN, message, ...data);
  }
  
  error(message: string, ...data: any[]): void {
    this.log(LogLevel.ERROR, message, ...data);
  }
  
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
    }
  }
}
```

### 3. Configuration System

Implement a centralized configuration system:

```typescript
// src/config.ts
export interface CheshireConfig {
  twitter: {
    username: string;
    password: string;
    email?: string;
    apiKey?: string;
    apiSecretKey?: string;
    accessToken?: string;
    accessTokenSecret?: string;
    bearerToken?: string;
  };
  deepgram: {
    apiKey: string;
    model?: string;
    language?: string;
    punctuate?: boolean;
  };
  ai?: {
    openai?: {
      apiKey: string;
      model?: string;
    };
    grok?: {
      apiKey: string;
    };
  };
  recordings?: {
    path: string;
    format?: 'raw' | 'wav' | 'mp3';
    maxDuration?: number;
  };
  session?: {
    maxDuration?: number;
    autoShutdown?: boolean;
  };
}

export function loadConfig(): CheshireConfig {
  // Load from .env file
  const config: CheshireConfig = {
    twitter: {
      username: process.env.TWITTER_USERNAME || '',
      password: process.env.TWITTER_PASSWORD || '',
      email: process.env.TWITTER_EMAIL,
      apiKey: process.env.TWITTER_API_KEY,
      apiSecretKey: process.env.TWITTER_API_SECRET_KEY,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
      bearerToken: process.env.TWITTER_BEARER_TOKEN,
    },
    deepgram: {
      apiKey: process.env.DEEPGRAM_API_KEY || '',
      model: process.env.DEEPGRAM_MODEL || 'nova-2',
      language: process.env.DEEPGRAM_LANGUAGE || 'en-US',
      punctuate: process.env.DEEPGRAM_PUNCTUATE !== 'false',
    },
  };
  
  // Add optional configs
  if (process.env.OPENAI_API_KEY) {
    config.ai = {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4',
      },
    };
  }
  
  if (process.env.XAI_API_KEY) {
    if (!config.ai) config.ai = {};
    config.ai.grok = {
