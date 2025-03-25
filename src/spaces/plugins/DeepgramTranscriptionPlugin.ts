import type { Plugin } from '../types';
import { Space } from '../core/Space';
import { DeepgramService } from '../../services/deepgram/deepgram-service';
import WebSocket from 'ws';
import { AudioDataWithUser } from '../types';

export class DeepgramTranscriptionPlugin implements Plugin {
  private deepgram: DeepgramService;
  private space: Space | null = null;
  private transcripts: Map<string, string[]> = new Map();
  private wsConnections: Map<string, WebSocket> = new Map();
  private usernames: Map<string, string> = new Map();

  constructor() {
    this.deepgram = new DeepgramService(process.env.DEEPGRAM_API_KEY || '');
  }

  onAttach(params: { space: Space; pluginConfig?: Record<string, any> }): void {
    this.space = params.space;
    console.log('[DeepgramPlugin] Plugin attached to space');
    
    // Set up event listeners for user joining/leaving
    if (this.space) {
      this.space.on('userJoined', this.handleUserJoined.bind(this));
      this.space.on('userLeft', this.handleUserLeft.bind(this));
    }
  }

  init(): void {
    console.log('[DeepgramPlugin] Initializing transcription service...');
    
    // Validate API key
    if (!process.env.DEEPGRAM_API_KEY) {
      console.error('[DeepgramPlugin] ERROR: Missing DEEPGRAM_API_KEY environment variable');
    }
  }

  onJanusReady(): void {
    console.log('[DeepgramPlugin] Janus client ready');
  }

  private handleUserJoined(user: { userId: string; displayName: string }): void {
    const { userId, displayName } = user;
    this.usernames.set(userId, displayName);
    this.transcripts.set(userId, []);
    console.log(`[DeepgramPlugin] Started tracking transcripts for ${displayName} (${userId})`);
  }

  private handleUserLeft(user: { userId: string; displayName: string }): void {
    const { userId, displayName } = user;
    
    // Close and clean up WebSocket connection
    const ws = this.wsConnections.get(userId);
    if (ws) {
      try {
        ws.close();
      } catch (error) {
        console.error(`[DeepgramPlugin] Error closing WebSocket for ${displayName}:`, error);
      }
      this.wsConnections.delete(userId);
    }
    
    this.transcripts.delete(userId);
    this.usernames.delete(userId);
    console.log(`[DeepgramPlugin] Stopped tracking transcripts for ${displayName} (${userId})`);
  }

  onAudioData(data: AudioDataWithUser): void {
    const { userId } = data;
    
    // Initialize transcript array for this user if not exists
    if (!this.transcripts.has(userId)) {
      this.transcripts.set(userId, []);
      
      // Get username if possible
      if (this.space) {
        const speakers = this.space.getSpeakers();
        const speaker = speakers.find(s => s.userId === userId);
        if (speaker) {
          this.usernames.set(userId, speaker.userId); // We don't have displayName here, so use userId
        }
      }
      
      try {
        this.initializeDeepgramForUser(userId);
      } catch (error) {
        console.error(`------------------------------------
[DeepgramPlugin] Failed to initialize Deepgram for user ${userId}:
------------------------------------
`);
        console.error(error);
        console.error(`------------------------------------
`);
        // Retry initialization after a short delay
        setTimeout(() => {
          try {
            this.initializeDeepgramForUser(userId);
          } catch (error) {
            console.error(`------------------------------------
[DeepgramPlugin] Failed to reinitialize Deepgram for user ${userId}:
------------------------------------
`);
            console.error(error);
            console.error(`------------------------------------
`);
          }
        }, 1000); // Retry after 1 second
      }
    }

    // Send audio data to Deepgram if we have an active connection
    const ws = this.wsConnections.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(Buffer.from(data.samples.buffer));
      } catch (error) {
        console.error(`------------------------------------
[DeepgramPlugin] Error sending audio data for user ${userId}:
------------------------------------
`);
        console.error(error);
        console.error(`------------------------------------
`);
        // Attempt to reconnect immediately
        try {
          this.reconnectDeepgramForUser(userId);
        } catch (error) {
          console.error(`------------------------------------
[DeepgramPlugin] Failed to reconnect Deepgram for user ${userId}:
------------------------------------
`);
          console.error(error);
          console.error(`------------------------------------
`);
          // Schedule another reconnection attempt
          setTimeout(() => {
            try {
              this.reconnectDeepgramForUser(userId);
            } catch (error) {
              console.error(`------------------------------------
[DeepgramPlugin] Failed to reinitialize Deepgram for user ${userId}:
------------------------------------
`);
              console.error(error);
              console.error(`------------------------------------
`);
            }
          }, 5000); // Retry after 5 seconds
        }
      }
    } else {
      console.log(`------------------------------------
[DeepgramPlugin] No active connection for user ${userId}. Reconnecting...
------------------------------------
`);
      try {
        this.reconnectDeepgramForUser(userId);
      } catch (error) {
        console.error(`------------------------------------
[DeepgramPlugin] Failed to reconnect Deepgram for user ${userId}:
------------------------------------
`);
        console.error(error);
        console.error(`------------------------------------
`);
        // Schedule another reconnection attempt
        setTimeout(() => {
          try {
            this.reconnectDeepgramForUser(userId);
          } catch (error) {
            console.error(`------------------------------------
[DeepgramPlugin] Failed to reinitialize Deepgram for user ${userId}:
------------------------------------
`);
            console.error(error);
            console.error(`------------------------------------
`);
          }
        }, 3000); // Retry after 3 seconds
      }
    }
  }

  private async reconnectDeepgramForUser(userId: string): Promise<void> {
    // Close existing connection if there is one
    const existingWs = this.wsConnections.get(userId);
    if (existingWs) {
      try {
        existingWs.close();
      } catch (e) {
        // Ignore errors during close
      }
      this.wsConnections.delete(userId);
    }
    
    // Initialize a new connection
    try {
      await this.initializeDeepgramForUser(userId);
    } catch (error) {
      console.error(`[DeepgramPlugin] Failed to reconnect Deepgram for user ${userId}:`, error);
    }
  }

  private async initializeDeepgramForUser(userId: string): Promise<void> {
    try {
      const username = this.usernames.get(userId) || userId;
      console.log(`[DeepgramPlugin] Initializing Deepgram for ${username}`);
      
      const ws = await this.deepgram.connectLiveTranscription(
        {
          language: 'en-US',
          punctuate: true,
          encoding: 'linear16',
          channels: 1,
          sampleRate: 48000, // Twitter Spaces uses 48kHz
          model: 'nova-2', // Use the latest model for better accuracy
        },
        (transcript) => {
          // Store transcript
          const userTranscripts = this.transcripts.get(userId) || [];
          userTranscripts.push(transcript);
          this.transcripts.set(userId, userTranscripts);

          // Log transcript with username
          const username = this.usernames.get(userId) || userId;
          console.log(`[DeepgramPlugin] ${username}: ${transcript}`);
        },
      );

      this.wsConnections.set(userId, ws);
      console.log(`[DeepgramPlugin] Successfully connected to Deepgram for ${username}`);
    } catch (error) {
      console.error(`[DeepgramPlugin] Failed to initialize Deepgram for user ${userId}:`, error);
    }
  }

  cleanup(): void {
    console.log('[DeepgramPlugin] Cleaning up transcription service...');
    
    // Remove event listeners
    if (this.space) {
      this.space.removeListener('userJoined', this.handleUserJoined.bind(this));
      this.space.removeListener('userLeft', this.handleUserLeft.bind(this));
    }
    
    // Close all WebSocket connections
    for (const [userId, ws] of this.wsConnections.entries()) {
      try {
        ws.close();
        console.log(`[DeepgramPlugin] Closed WebSocket for user ${userId}`);
      } catch (error) {
        console.error(`[DeepgramPlugin] Error closing WebSocket for user ${userId}:`, error);
      }
    }
    
    this.wsConnections.clear();
    this.transcripts.clear();
    this.usernames.clear();
    this.space = null;
  }

  // Helper method to get transcripts for a user
  getTranscriptsForUser(userId: string): string[] {
    return this.transcripts.get(userId) || [];
  }

  // Helper method to get all transcripts
  getAllTranscripts(): Map<string, string[]> {
    return new Map(this.transcripts);
  }

  // Helper method to export all transcripts as a formatted string
  exportTranscripts(): string {
    let output = '# Transcription Export\n\n';
    
    for (const [userId, userTranscripts] of this.transcripts.entries()) {
      const username = this.usernames.get(userId) || userId;
      output += `## ${username}\n\n`;
      
      for (const transcript of userTranscripts) {
        output += `- "${transcript}"\n`;
      }
      
      output += '\n';
    }
    
    return output;
  }

}
