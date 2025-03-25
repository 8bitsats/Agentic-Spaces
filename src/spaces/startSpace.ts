// src/spaces/startSpace.ts

import 'dotenv/config';
import { Space, SpaceConfig } from './core/Space';
import { Scraper } from '../scraper';
import { RecordToDiskPlugin } from './plugins/RecordToDiskPlugin';
import { DeepgramTranscriptionPlugin } from './plugins/DeepgramTranscriptionPlugin';
import path from 'path';
import fs from 'fs';

// Maximum duration in milliseconds before auto-shutdown (4 hours)
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;

/**
 * Simple example of how to start a Twitter Space
 */
async function main() {
  console.log('[StartSpace] Initializing...');
  
  // Track space start time for duration limiting
  const startTime = Date.now();
  let spaceActive = false;
  let shutdownTimer: NodeJS.Timeout | null = null;

  // Check required environment variables with specific messages
  const requiredEnvVars = [
    { name: 'TWITTER_USERNAME', message: 'Twitter username is required for authentication' },
    { name: 'TWITTER_PASSWORD', message: 'Twitter password is required for authentication' },
    { name: 'DEEPGRAM_API_KEY', message: 'Deepgram API key is required for transcription' },
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar.name]) {
      console.error(`[StartSpace] Error: ${envVar.message}`);
      process.exit(1);
    }
  }

  // Validate Deepgram API key format (simple check)
  const deepgramKey = process.env.DEEPGRAM_API_KEY || '';
  if (deepgramKey.length < 20) {
    console.error('[StartSpace] Error: Deepgram API key appears invalid (too short)');
    process.exit(1);
  }

  // 1) Login to Twitter with the scraper
  const scraper = new Scraper();
  try {
    console.log('[StartSpace] Attempting to login to Twitter...');
    await scraper.login(
      process.env.TWITTER_USERNAME!,
      process.env.TWITTER_PASSWORD!,
    );
    console.log('[StartSpace] Successfully logged in to Twitter');
  } catch (error) {
    console.error('[StartSpace] Failed to login to Twitter:', error);
    // Try to extract a more user-friendly error message
    const errorMessage = extractTwitterErrorMessage(error);
    console.error(`[StartSpace] Login error details: ${errorMessage}`);
    process.exit(1);
  }

  // 2) Create a Space instance with error event handler
  const space = new Space(scraper, { debug: true });
  
  // Create variable for cleanup function to use in process handlers
  let cleanupAndExit: () => Promise<void>;

  // Set up cleanup function for various exit scenarios
  cleanupAndExit = async () => {
    if (!spaceActive) return; // Prevent multiple cleanup attempts
    
    spaceActive = false;
    console.log('\n[StartSpace] Performing cleanup...');
    
    // Clear the auto-shutdown timer if it exists
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
    
    try {
      await space.stop();
      console.log('[StartSpace] Space stopped successfully.');
    } catch (stopError) {
      console.error('[StartSpace] Error stopping Space:', stopError);
    }
    
    // Allow some time for cleanup to complete before exiting
    setTimeout(() => process.exit(0), 2000);
  };

  // 3) Add plugins
  // Create recordings directory if it doesn't exist
  const recordingsDir = path.join(process.cwd(), 'recordings');
  try {
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
      console.log(`[StartSpace] Created recordings directory: ${recordingsDir}`);
    }
  } catch (error) {
    console.error('[StartSpace] Error creating recordings directory:', error);
    console.log('[StartSpace] Will attempt to continue without recording...');
  }

  try {
    // Configure recording plugin with timestamp-based filename and metadata
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recordingFilename = `space_${timestamp}.raw`;
    const recordingPath = path.join(recordingsDir, recordingFilename);
    
    // Create metadata file with space information
    const metadataPath = path.join(recordingsDir, `space_${timestamp}_metadata.json`);
    
    // Add recording plugin
    const recordPlugin = new RecordToDiskPlugin();
    space.use(recordPlugin, {
      filePath: recordingPath,
      debug: true,
    });
    
    console.log(`[StartSpace] Recording audio to: ${recordingPath}`);
  } catch (error) {
    console.error('[StartSpace] Error setting up recording plugin:', error);
    console.log('[StartSpace] Continuing without recording capability');
  }

  try {
    // Add transcription plugin with error handling
    const transcriptionPlugin = new DeepgramTranscriptionPlugin();
    space.use(transcriptionPlugin);
    console.log('[StartSpace] Transcription plugin initialized');
    
    // Set up transcript saving at the end of the space
    space.on('beforeStop', async () => {
      try {
        const transcripts = transcriptionPlugin.exportTranscripts();
        if (transcripts) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const transcriptPath = path.join(recordingsDir, `transcripts_${timestamp}.md`);
          fs.writeFileSync(transcriptPath, transcripts);
          console.log(`[StartSpace] Saved transcripts to: ${transcriptPath}`);
        }
      } catch (error) {
        console.error('[StartSpace] Error saving transcripts:', error);
      }
    });
  } catch (error) {
    console.error('[StartSpace] Error setting up transcription plugin:', error);
    console.log('[StartSpace] Continuing without transcription capability');
  }

  // 4) Define Space configuration with a catchy title
  const config: SpaceConfig = {
    mode: 'INTERACTIVE', // Allow users to request to speak
    title: 'Agents After Dark: Agents Assemble!!!',
    description: 'Join us for a lively discussion with AI agents! Bring your questions, ideas, and curiosity!',
    languages: ['en'],
    record: true, // Record the Space
  };

  // 5) Handle speaker requests
  space.on('speakerRequest', async (req) => {
    console.log('[StartSpace] Speaker request =>', req);
    try {
      await space.approveSpeaker(req.userId, req.sessionUUID);
      console.log(
        `[StartSpace] Approved speaker: ${req.displayName} (${req.userId})`,
      );
    } catch (error) {
      console.error(
        `[StartSpace] Failed to approve speaker ${req.userId}:`,
        error,
      );
      // Try to approve again after a delay if it's a temporary issue
      setTimeout(() => {
        try {
          space.approveSpeaker(req.userId, req.sessionUUID)
            .then(() => console.log(`[StartSpace] Retry approved speaker: ${req.displayName}`))
            .catch((e) => console.error('[StartSpace] Retry approval also failed:', e));
        } catch (retryError) {
          // Just log it, we've tried our best
        }
      }, 5000);
    }
  });

  // 6) Handle reactions
  space.on('guestReaction', (evt) => {
    console.log('[StartSpace] Guest reaction =>', evt);
    try {
      // Respond with a random emoji
      const emojis = ['👍', '❤️', '🔥', '🎉', '👏', '🚀', '✨', '🤖'];
      const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
      space.reactWithEmoji(randomEmoji);
    } catch (error) {
      console.error('[StartSpace] Failed to send reaction:', error);
    }
  });

  // Handle user joined event
  space.on('userJoined', (user) => {
    console.log(
      `[StartSpace] User joined: ${user.displayName} (${user.userId})`,
    );
  });

  // Handle user left event
  space.on('userLeft', (user) => {
    console.log(`[StartSpace] User left: ${user.displayName} (${user.userId})`);
  });

  // 7) Handle errors with reconnection attempts for recoverable errors
  space.on('error', (err) => {
    const errMsg = err?.message || 'Unknown error';
    console.error('[StartSpace] Space Error =>', errMsg);
    
    // Check if it's a connection error that might be recoverable
    if (errMsg.includes('ICE connection failed') || 
        errMsg.includes('connection') || 
        errMsg.includes('network')) {
      console.log('[StartSpace] Attempting to recover from connection issue...');
      // Space has internal reconnection mechanisms, but we could add more here
    }
  });

  // Set up heartbeat to check space is still active
  const heartbeatInterval = setInterval(() => {
    if (!spaceActive) {
      clearInterval(heartbeatInterval);
      return;
    }
    
    // Check if we've exceeded maximum duration
    const currentDuration = Date.now() - startTime;
    if (currentDuration > MAX_DURATION_MS) {
      console.log(`[StartSpace] Maximum duration of ${MAX_DURATION_MS/3600000} hours reached`);
      console.log('[StartSpace] Initiating automatic shutdown...');
      clearInterval(heartbeatInterval);
      cleanupAndExit();
      return;
    }
    
    // Log heartbeat every 5 minutes
    if (currentDuration % (5 * 60 * 1000) < 1000) {
      const hours = Math.floor(currentDuration / 3600000);
      const minutes = Math.floor((currentDuration % 3600000) / 60000);
      console.log(`[StartSpace] Heartbeat: Space active for ${hours}h ${minutes}m`);
    }
  }, 1000);

  // 8) Initialize the Space
  console.log('[StartSpace] Initializing Space...');
  try {
    const broadcastInfo = await space.initialize(config);
    spaceActive = true;
    
    // Set auto-shutdown timer
    shutdownTimer = setTimeout(() => {
      console.log(`[StartSpace] Auto-shutdown after ${MAX_DURATION_MS/3600000} hours`);
      cleanupAndExit();
    }, MAX_DURATION_MS);
    
    const spaceUrl = broadcastInfo.share_url.replace('broadcasts', 'spaces');
    console.log('[StartSpace] Space created =>', spaceUrl);
    
    // Save space metadata
    try {
      const metadata = {
        spaceUrl,
        title: config.title,
        description: config.description,
        startTime: new Date().toISOString(),
        hostUsername: process.env.TWITTER_USERNAME,
      };
      const metadataPath = path.join(recordingsDir, `space_${Date.now()}_metadata.json`);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`[StartSpace] Saved space metadata to: ${metadataPath}`);
    } catch (error) {
      console.error('[StartSpace] Error saving space metadata:', error);
    }

    // 9) Tweet out the Space link with flair
    console.log('[StartSpace] Sending tweet with Space link...');
    try {
      const tweetText = `🤖 LIVE NOW! 🎙️ ${config.title} 🌟\n\nJoin me and other AI agents for an exciting Space discussion! 🚀✨ Let's talk tech, creativity, and the future! 🧠💡\n\n${spaceUrl}`;
      
      await scraper.sendTweet(tweetText);
      console.log('[StartSpace] Tweet sent with flair!');
    } catch (tweetError) {
      console.error('[StartSpace] Failed to send tweet:', tweetError);
      // Try an alternative tweet format in case character limit was exceeded
      try {
        const shortTweet = `🤖 LIVE NOW! ${config.title}\n\nJoin our Space discussion! ${spaceUrl}`;
        await scraper.sendTweet(shortTweet);
        console.log('[StartSpace] Sent alternative shorter tweet');
      } catch (shortTweetError) {
        console.error('[StartSpace] Also failed to send shorter tweet:', shortTweetError);
      }
      console.log('[StartSpace] Continuing to run Space despite tweet failure');
    }

    console.log('[StartSpace] Space is running... press Ctrl+C to exit.');
  } catch (initError) {
    console.error('[StartSpace] Failed to initialize Space:', initError);
    process.exit(1);
  }

  // 10) Graceful shutdown handlers
  process.on('SIGINT', async () => {
    console.log('\n[StartSpace] Caught interrupt signal (Ctrl+C)');
    await cleanupAndExit();
  });

  process.on('SIGTERM', async () => {
    console.log('\n[StartSpace] Caught termination signal');
    await cleanupAndExit();
  });

  // Catch uncaught exceptions to ensure cleanup
  process.on('uncaughtException', async (error) => {
    console.error('\n[StartSpace] Uncaught exception:', error);
    await cleanupAndExit();
  });
}

/**
 * Extract a more user-friendly error message from Twitter login errors
 */
function extractTwitterErrorMessage(error: any): string {
  try {
    if (typeof error === 'string') {
      return error;
    }
    
    // Check if it's a JSON string error
    if (error.message && error.message.includes('{')) {
      const errorJson = error.message.substring(
        error.message.indexOf('{'),
        error.message.lastIndexOf('}') + 1
      );
      const parsedError = JSON.parse(errorJson);
      
      if (parsedError.errors && parsedError.errors.length > 0) {
        const firstError = parsedError.errors[0];
        return `${firstError.message} (Code: ${firstError.code})`;
      }
    }
    
    return error.message || String(error);
  } catch (e) {
    return String(error);
  }
}

// Run the main function
main().catch((err) => {
  console.error('[StartSpace] Unhandled error in main function =>', err);
  process.exit(1);
});
