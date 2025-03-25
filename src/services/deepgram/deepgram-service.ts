import WebSocket from 'ws';

interface DeepgramOptions {
  language?: string;
  punctuate?: boolean;
  encoding?: string;
  channels?: number;
  sampleRate?: number;
  model?: string;
}

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
    const defaultOptions = {
      language: 'en-US',
      punctuate: true,
      encoding: 'linear16',
      channels: 1,
      sampleRate: 48000, // Updated to match Twitter Spaces sample rate
    };

    const mergedOptions = { ...defaultOptions, ...options };
    const queryParams = Object.entries(mergedOptions).reduce(
      (acc, [key, value]) => {
        acc[key] = String(value);
        return acc;
      },
      {} as Record<string, string>,
    );
    const queryString = new URLSearchParams(queryParams).toString();
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${queryString}`, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      console.log('Deepgram WebSocket connection established');
    });

    this.ws.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.channel?.alternatives?.[0]?.transcript) {
          onTranscript(response.channel.alternatives[0].transcript);
        }
      } catch (error) {
        console.error('Error parsing Deepgram response:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('Deepgram WebSocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('Deepgram WebSocket connection closed');
    });

    return this.ws;
  }

  public async textToSpeech(
    text: string,
    options: DeepgramOptions = {},
  ): Promise<ArrayBuffer> {
    const defaultOptions = {
      model: 'aura-asteria-en',
    };

    const mergedOptions = { ...defaultOptions, ...options };

    const response = await fetch('https://api.deepgram.com/v1/speak', {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        ...mergedOptions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Deepgram TTS failed: ${response.statusText}`);
    }

    return await response.arrayBuffer();
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
