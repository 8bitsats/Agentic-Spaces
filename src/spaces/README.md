]# Twitter Spaces Functionality

This directory contains code for interacting with Twitter Spaces API.

## Starting a Space

The `startSpace.ts` script demonstrates how to create and manage a Twitter Space using this library.

### Prerequisites

- Node.js installed
- Twitter credentials configured in `.env` file
- TypeScript installed

### How to Run

1. Make sure your `.env` file is properly configured with Twitter credentials:
   ```
   TWITTER_USERNAME=yourusername
   TWITTER_PASSWORD=yourpassword
   TWITTER_EMAIL=youremail@example.com
   ```

2. Compile and run the TypeScript file:
   ```bash
   # From the project root directory
   npx ts-node src/spaces/startSpace.ts
   ```

3. Once running, the script will:
   - Log into Twitter using your credentials
   - Create a new Space with the title "My First Twitter Space"
   - Tweet out a link to the Space
   - Approve any speaker requests automatically
   - Record the audio of the Space
   - Respond to reactions with a thumbs up emoji

4. Press Ctrl+C to gracefully end the Space when you're done.

## Features

- **Interactive Mode**: Allows listeners to request to speak
- **Auto-Approve**: Automatically approves speaker requests
- **Recording**: Records the Space's audio
- **Reaction Handling**: Responds to user reactions
- **Graceful Shutdown**: Properly closes the Space when terminated

## Advanced Usage

For more advanced usage, see the `test.ts` file which demonstrates additional plugins and features:
- Speech-to-text conversion
- Text-to-speech responses
- Idle detection
- HLS recording
