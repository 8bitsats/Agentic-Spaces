// src/core/JanusClient.ts

import { EventEmitter } from 'events';
import wrtc from '@roamhq/wrtc';
const { RTCPeerConnection, MediaStream } = wrtc;
import { JanusAudioSink, JanusAudioSource } from './JanusAudio';
import type { AudioDataWithUser, TurnServersInfo } from '../types';
import { Logger } from '../logger';

interface JanusConfig {
  /**
   * The base URL for the Janus gateway (e.g. "https://gw-prod-hydra-eu-west-3.pscp.tv/s=prod:XX/v1/gateway")
   */
  webrtcUrl: string;

  /**
   * The unique room ID (e.g., the broadcast or space ID)
   */
  roomId: string;

  /**
   * The token/credential used to authorize requests to Janus (often a signed JWT).
   */
  credential: string;

  /**
   * The user identifier (host or speaker). Used as 'display' in the Janus plugin.
   */
  userId: string;

  /**
   * The name of the stream (often the same as roomId for convenience).
   */
  streamName: string;

  /**
   * ICE / TURN server information returned by Twitter's /turnServers endpoint.
   */
  turnServers: TurnServersInfo;

  /**
   * Logger instance for consistent debug/info/error logs.
   */
  logger: Logger;

  /**
   * Optional room secret for creating a room.
   */
  roomSecret?: string;

  /**
   * Optional room PIN for creating a room.
   */
  roomPin?: string;
}

interface JanusEvent {
  janus: string;
  transaction?: string;
  session_id?: number;
  sender?: number;
  plugindata?: {
    plugin: string;
    data: any;
  };
}

interface JanusSuccessResponse {
  janus: 'success';
  transaction: string;
  data: {
    id: number;
  };
}

interface JanusKeepalive {
  janus: 'keepalive';
  transaction: string;
}

interface JanusVideoroomEvent {
  janus: 'event';
  plugindata: {
    plugin: 'janus.plugin.videoroom';
    data: {
      videoroom: string;
      room?: string;
      id?: number;
      ptype?: string;
      publishers?: Array<{
        id: number;
        display: string;
      }>;
      reason?: string;
    };
  };
}

/**
 * Manages the Janus session for a Twitter AudioSpace:
 *  - Creates a Janus session and plugin handle
 *  - Joins the Janus videoroom as publisher/subscriber
 *  - Subscribes to other speakers
 *  - Sends local PCM frames as Opus
 *  - Polls for Janus events
 *
 * It can be used by both the host (who creates a room) or a guest speaker (who joins an existing room).
 */
export class JanusClient extends EventEmitter {
  private logger: Logger;

  private sessionId?: number;
  private handleId?: number;
  private publisherId?: number;

  private pc?: RTCPeerConnection;
  private localAudioSource?: JanusAudioSource;

  private pollActive = false;
  private iceConnectionRetries = 0;
  private maxIceRetries = 3;

  // Tracks promises waiting for specific Janus events
  private eventWaiters: Array<{
    predicate: (evt: JanusEvent) => boolean;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];

  // Tracks subscriber handle+pc for each userId we subscribe to
  private subscribers = new Map<
    string,
    {
      handleId: number;
      pc: RTCPeerConnection;
    }
  >();

  constructor(private readonly config: JanusConfig) {
    super();
    this.logger = config.logger;
  }

  /**
   * Initializes this JanusClient for the host scenario:
   *  1) createSession()
   *  2) attachPlugin()
   *  3) createRoom()
   *  4) joinRoom()
   *  5) configure local PeerConnection (send audio, etc.)
   */
  public async initialize(): Promise<void> {
    this.logger.debug('[JanusClient] initialize() called');

    try {
      this.sessionId = await this.createSession();
      this.handleId = await this.attachPlugin();

      // Start polling for Janus events
      this.pollActive = true;
      this.startPolling();

      // Create a new Janus room (only for the host scenario)
      await this.createRoom();

      // Join that room as publisher
      this.publisherId = await this.joinRoom();

      // Set up our RTCPeerConnection for local audio
      this.setupPeerConnection();

      // Add local audio track
      this.enableLocalAudio();

      // Create an offer and configure the publisher in Janus
      await this.configurePublisher();

      this.logger.info('[JanusClient] Initialization complete');
    } catch (error) {
      this.logger.error('[JanusClient] Initialization failed:', error);
      this.emit('error', new Error(`[JanusClient] Initialization failed: ${error}`));
      throw error;
    }
  }

  /**
   * Sets up the WebRTC peer connection with proper configuration
   */
  private setupPeerConnection(): void {
    // Create a more robust RTCPeerConnection configuration
    const iceServers = [
      {
        urls: this.config.turnServers.uris,
        username: this.config.turnServers.username,
        credential: this.config.turnServers.password,
      },
      // Add some fallback public STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    this.logger.debug('[JanusClient] Setting up peer connection with ICE servers:', 
                     JSON.stringify(iceServers));

    this.pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all', // Try both relay and direct connections
      iceCandidatePoolSize: 10,   // Increase candidate pool for better chances
      bundlePolicy: 'max-bundle', // Bundle all media on a single transport
    });

    this.setupPeerEvents();
  }

  /**
   * Initializes this JanusClient for a guest speaker scenario:
   *  1) createSession()
   *  2) attachPlugin()
   *  3) join existing room as publisher (no createRoom call)
   *  4) configure local PeerConnection
   *  5) subscribe to any existing publishers
   */
  public async initializeGuestSpeaker(sessionUUID: string): Promise<void> {
    this.logger.debug('[JanusClient] initializeGuestSpeaker() called');

    try {
      // 1) Create a new Janus session
      this.sessionId = await this.createSession();
      this.handleId = await this.attachPlugin();

      // Start polling
      this.pollActive = true;
      this.startPolling();

      // 2) Join the existing room as a publisher (no createRoom)
      const evtPromise = this.waitForJanusEventWithPredicate(
        (e) =>
          e.janus === 'event' &&
          e.plugindata?.plugin === 'janus.plugin.videoroom' &&
          e.plugindata?.data?.videoroom === 'joined',
        10000,
        'Guest Speaker joined event',
      );

      const body = {
        request: 'join',
        room: this.config.roomId,
        ptype: 'publisher',
        display: this.config.userId,
        periscope_user_id: this.config.userId,
      };
      await this.sendJanusMessage(this.handleId, body);

      // Wait for the joined event
      const evt = await evtPromise;
      const data = evt.plugindata?.data;
      this.publisherId = data.id; // Our own publisherId
      this.logger.debug(
        '[JanusClient] guest joined => publisherId=',
        this.publisherId,
      );

      // If there are existing publishers, we can subscribe to them
      const publishers = data.publishers || [];
      this.logger.debug('[JanusClient] existing publishers =>', publishers);

      // 3) Create RTCPeerConnection for sending local audio
      this.setupPeerConnection();
      this.enableLocalAudio();

      // 4) configurePublisher => generate offer, wait for answer
      await this.configurePublisher(sessionUUID);

      // 5) Subscribe to each existing publisher
      await Promise.all(
        publishers.map((pub: any) => this.subscribeSpeaker(pub.display, pub.id)),
      );

      this.logger.info('[JanusClient] Guest speaker negotiation complete');
    } catch (error) {
      this.logger.error('[JanusClient] Guest speaker initialization failed:', error);
      this.emit('error', new Error(`[JanusClient] Guest speaker initialization failed: ${error}`));
      throw error;
    }
  }

  /**
   * Subscribes to a speaker's audio feed by userId and/or feedId.
   * If feedId=0, we wait for a "publishers" event to discover feedId.
   */
  public async subscribeSpeaker(
    userId: string,
    feedId: number = 0,
  ): Promise<void> {
    this.logger.debug('[JanusClient] subscribeSpeaker => userId=', userId);

    try {
      // 1) Attach a separate plugin handle for subscriber
      const subscriberHandleId = await this.attachPlugin();
      this.logger.debug('[JanusClient] subscriber handle =>', subscriberHandleId);

      // If feedId was not provided, wait for an event listing publishers
      if (feedId === 0) {
        const publishersEvt = await this.waitForJanusEventWithPredicate(
          (e) =>
            e.janus === 'event' &&
            e.plugindata?.plugin === 'janus.plugin.videoroom' &&
            e.plugindata?.data?.videoroom === 'event' &&
            Array.isArray(e.plugindata?.data?.publishers) &&
            e.plugindata?.data?.publishers.length > 0,
          8000,
          'discover feed_id from "publishers"',
        );

        const list = publishersEvt.plugindata.data.publishers as any[];
        const pub = list.find(
          (p) => p.display === userId || p.periscope_user_id === userId,
        );
        if (!pub) {
          throw new Error(
            `[JanusClient] subscribeSpeaker => No publisher found for userId=${userId}`,
          );
        }
        feedId = pub.id;
        this.logger.debug('[JanusClient] found feedId =>', feedId);
      }

      // Notify listeners that we've discovered a feed
      this.emit('subscribedSpeaker', { userId, feedId });

      // 2) Join the room as a "subscriber"
      const joinBody = {
        request: 'join',
        room: this.config.roomId,
        periscope_user_id: this.config.userId,
        ptype: 'subscriber',
        streams: [
          {
            feed: feedId,
            mid: '0',
            send: true, // indicates we might send audio?
          },
        ],
      };
      await this.sendJanusMessage(subscriberHandleId, joinBody);

      // 3) Wait for "attached" + jsep.offer
      const attachedEvt = await this.waitForJanusEventWithPredicate(
        (e) =>
          e.janus === 'event' &&
          e.sender === subscriberHandleId &&
          e.plugindata?.plugin === 'janus.plugin.videoroom' &&
          e.plugindata?.data?.videoroom === 'attached' &&
          e.jsep?.type === 'offer',
        8000,
        'subscriber attached + offer',
      );
      this.logger.debug('[JanusClient] subscriber => "attached" with offer');

      // 4) Create a new RTCPeerConnection for receiving audio from this feed
      const offer = attachedEvt.jsep;
      const subPc = new RTCPeerConnection({
        iceServers: [
          {
            urls: this.config.turnServers.uris,
            username: this.config.turnServers.username,
            credential: this.config.turnServers.password,
          },
          // Add fallback STUN servers
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      subPc.ontrack = (evt) => {
        this.logger.debug(
          '[JanusClient] subscriber track => kind=%s, readyState=%s, muted=%s',
          evt.track.kind,
          evt.track.readyState,
          evt.track.muted,
        );
        // Attach a JanusAudioSink to capture PCM
        const sink = new JanusAudioSink(evt.track, { logger: this.logger });

        // For each audio frame, forward it to 'audioDataFromSpeaker'
        sink.on('audioData', (frame) => {
          if (this.logger.isDebugEnabled()) {
            let maxVal = 0;
            for (let i = 0; i < frame.samples.length; i++) {
              const val = Math.abs(frame.samples[i]);
              if (val > maxVal) maxVal = val;
            }
            this.logger.debug(
              `[AudioSink] userId=${userId}, maxAmplitude=${maxVal}`,
            );
          }

          this.emit('audioDataFromSpeaker', {
            userId,
            bitsPerSample: frame.bitsPerSample,
            sampleRate: frame.sampleRate,
            numberOfFrames: frame.numberOfFrames,
            channelCount: frame.channelCount,
            samples: frame.samples,
          } as AudioDataWithUser);
        });
      };

      // Set up ICE error handling for subscriber connections too
      subPc.oniceconnectionstatechange = () => {
        this.logger.debug(
          `[JanusClient] Subscriber ICE state for ${userId} => ${subPc.iceConnectionState}`
        );
        
        if (subPc.iceConnectionState === 'failed') {
          this.logger.warn(`[JanusClient] Subscriber ICE connection failed for ${userId}`);
          // We don't want to fail the entire application for a single subscriber failure
          // Just emit a warning
          this.emit('warning', new Error(`[JanusClient] Subscriber ICE connection failed for ${userId}`));
        }
      };

      // 5) Answer the subscription offer
      await subPc.setRemoteDescription(offer);
      const answer = await subPc.createAnswer();
      await subPc.setLocalDescription(answer);

      // 6) Send "start" request to begin receiving
      await this.sendJanusMessage(
        subscriberHandleId,
        {
          request: 'start',
          room: this.config.roomId,
          periscope_user_id: this.config.userId,
        },
        answer,
      );

      this.logger.debug('[JanusClient] subscriber => done (user=', userId, ')');

      // Track this subscription handle+pc by userId
      this.subscribers.set(userId, { handleId: subscriberHandleId, pc: subPc });
      
    } catch (error) {
      this.logger.error(`[JanusClient] Failed to subscribe to speaker ${userId}:`, error);
      // Don't propagate this error to prevent crashing the app - just log it
      this.emit('warning', new Error(`[JanusClient] Failed to subscribe to speaker ${userId}: ${error}`));
    }
  }

  /**
   * Pushes local PCM frames to Janus. If the localAudioSource isn't active, it enables it.
   */
  public pushLocalAudio(samples: Int16Array, sampleRate: number, channels = 1) {
    if (!this.localAudioSource) {
      this.logger.warn('[JanusClient] No localAudioSource => enabling now...');
      this.enableLocalAudio();
    }
    
    try {
      this.localAudioSource?.pushPcmData(samples, sampleRate, channels);
    } catch (error) {
      this.logger.error('[JanusClient] Error pushing local audio:', error);
    }
  }

  /**
   * Ensures a local audio track is added to the RTCPeerConnection for publishing.
   */
  public enableLocalAudio(): void {
    if (!this.pc) {
      this.logger.warn(
        '[JanusClient] enableLocalAudio => No RTCPeerConnection',
      );
      return;
    }
    if (this.localAudioSource) {
      this.logger.debug('[JanusClient] localAudioSource already active');
      return;
    }
    
    try {
      // Create a JanusAudioSource that feeds PCM frames
      this.localAudioSource = new JanusAudioSource({ logger: this.logger });
      const track = this.localAudioSource.getTrack();
      const localStream = new MediaStream();
      localStream.addTrack(track);
      this.pc.addTrack(track, localStream);
    } catch (error) {
      this.logger.error('[JanusClient] Failed to enable local audio:', error);
    }
  }

  /**
   * Attempts to restart ICE negotiation when ICE connection fails
   */
  private async restartIce(): Promise<void> {
    if (!this.pc || !this.handleId) {
      this.logger.warn('[JanusClient] Cannot restart ICE: no PC or handleId');
      return;
    }

    try {
      this.logger.info('[JanusClient] Attempting to restart ICE negotiation...');
      
      // Create a new offer with iceRestart: true
      const offer = await this.pc.createOffer({ 
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      
      await this.pc.setLocalDescription(offer);
      
      // Send the new offer to Janus
      await this.sendJanusMessage(
        this.handleId,
        {
          request: 'configure',
          room: this.config.roomId,
          periscope_user_id: this.config.userId,
          stream_name: this.config.streamName,
          vidman_token: this.config.credential,
        },
        offer
      );
      
      this.logger.info('[JanusClient] ICE restart initiated');
      
    } catch (error) {
      this.logger.error('[JanusClient] ICE restart failed:', error);
    }
  }

  /**
   * Stops the Janus client: ends polling, closes the RTCPeerConnection, etc.
   * Does not destroy or leave the room automatically; call destroyRoom() or leaveRoom() if needed.
   */
  public async stop(): Promise<void> {
    this.logger.info('[JanusClient] Stopping...');
    this.pollActive = false;
    
    // Close all subscriber connections
    for (const [userId, sub] of this.subscribers.entries()) {
      try {
        sub.pc.close();
        this.logger.debug(`[JanusClient] Closed subscriber connection for ${userId}`);
      } catch (error) {
        this.logger.error(`[JanusClient] Error closing subscriber for ${userId}:`, error);
      }
    }
    this.subscribers.clear();
    
    // Close main publisher connection
    if (this.pc) {
      try {
        this.pc.close();
      } catch (error) {
        this.logger.error('[JanusClient] Error closing main peer connection:', error);
      }
      this.pc = undefined;
    }
    
    this.logger.info('[JanusClient] All WebRTC connections closed');
  }

  /**
   * Returns the current Janus sessionId, if any.
   */
  public getSessionId(): number | undefined {
    return this.sessionId;
  }

  /**
   * Returns the Janus handleId for the publisher, if any.
   */
  public getHandleId(): number | undefined {
    return this.handleId;
  }

  /**
   * Returns the Janus publisherId (internal participant ID), if any.
   */
  public getPublisherId(): number | undefined {
    return this.publisherId;
  }

  /**
   * Creates a new Janus session via POST /janus (with "janus":"create").
   */
  private async createSession(): Promise<number> {
    try {
      const transaction = this.randomTid();
      
      const resp = await fetch(this.config.webrtcUrl, {
        method: 'POST',
        headers: {
          Authorization: this.config.credential,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          janus: 'create',
          transaction,
        }),
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        const error = new Error(`[JanusClient] Session creation failed: ${resp.status} - ${errorText}`);
        this.logger.error(error.message);
        this.emit('error', error);
        throw error;
      }
      
      const json = await resp.json();
      if (json.janus !== 'success') {
        const error = new Error(`[JanusClient] Invalid session response: ${JSON.stringify(json)}`);
        this.logger.error(error.message);
        this.emit('error', error);
        throw error;
      }
      
      this.logger.debug('[JanusClient] Session created, ID:', json.data.id);
      return json.data.id;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('[JanusClient] Failed to create session:', errorMessage);
      this.emit('error', new Error(`[JanusClient] Session creation failed: ${errorMessage}`));
      throw error;
    }
  }

  /**
   * Attaches to the videoroom plugin via /janus/{sessionId} (with "janus":"attach").
   */
  private async attachPlugin(): Promise<number> {
    if (!this.sessionId) {
      throw new Error('[JanusClient] attachPlugin => no sessionId');
    }
    const transaction = this.randomTid();
    
    try {
      const resp = await fetch(`${this.config.webrtcUrl}/${this.sessionId}`, {
        method: 'POST',
        headers: {
          Authorization: this.config.credential,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          janus: 'attach',
          plugin: 'janus.plugin.videoroom',
          transaction,
        }),
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        const error = new Error(`[JanusClient] attachPlugin failed: ${resp.status} - ${errorText}`);
        this.logger.error(error.message);
        this.emit('error', error);
        throw error;
      }
      
      const json = await resp.json();
      if (json.janus !== 'success') {
        const error = new Error(`[JanusClient] attachPlugin invalid response: ${JSON.stringify(json)}`);
        this.logger.error(error.message);
        this.emit('error', error);
        throw error;
      }
      
      this.logger.debug('[JanusClient] Plugin attached, handle ID:', json.data.id);
      return json.data.id;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('[JanusClient] Failed to attach to plugin:', errorMessage);
      this.emit('error', new Error(`[JanusClient] Plugin attachment failed: ${errorMessage}`));
      throw error;
    }
  }

  /**
   * Creates a Janus room for the host scenario.
   * For a guest, this step is skipped (the room already exists).
   */
  private async createRoom(): Promise<void> {
    if (!this.handleId) {
      throw new Error('[JanusClient] createRoom => no handleId');
    }
    const transaction = this.randomTid();
    
    try {
      const resp = await fetch(`${this.config.webrtcUrl}/${this.sessionId}`, {
        method: 'POST',
        headers: {
          Authorization: this.config.credential,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          janus: 'message',
          transaction,
          body: {
            request: 'create',
            permanent: false,
            room: this.config.roomId,
            description: 'Twitter Spaces',
            bitrate: 500000,
            publishers: 100,
            secret: this.config.roomSecret,
            pin: this.config.roomPin,
          },
        }),
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        const error = new Error(`[JanusClient] Room creation failed: ${resp.status} - ${errorText}`);
        this.logger.error(error.message);
        this.emit('error', error);
        throw error;
      }
      
      const json = await resp.json();
      if (json.janus !== 'success') {
        const error = new Error(`[JanusClient] Invalid room response: ${JSON.stringify(json)}`);
        this.logger.error(error.message);
        this.emit('error', error);
        throw error;
      }
      
      this.logger.debug('[JanusClient] Room created, ID:', this.config.roomId);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('[JanusClient] Failed to create room:', errorMessage);
      this.emit('error', new Error(`[JanusClient] Room creation failed: ${errorMessage}`));
      throw error;
    }
  }

  /**
   * Joins the created room as a publisher, for the host scenario.
   */
  private async joinRoom(): Promise<number> {
    if (!this.sessionId || !this.handleId) {
      throw new Error('[JanusClient] no session/handle for joinRoom()');
    }

    this.logger.debug('[JanusClient] joinRoom => start');

    try {
      // Wait for the 'joined' event from videoroom
      const evtPromise = this.waitForJanusEventWithPredicate(
        (e) =>
          e.janus === 'event' &&
          e.plugindata?.plugin === 'janus.plugin.videoroom' &&
          e.plugindata?.data?.videoroom === 'joined',
        12000,
        'Host Joined Event',
      );

      const body = {
        request: 'join',
        room: this.config.roomId,
        ptype: 'publisher',
        display: this.config.userId,
        periscope_user_id: this.config.userId,
      };
      
      await this.sendJanusMessage(this.handleId, body);

      const evt = await evtPromise;
      const publisherId = evt.plugindata.data.id;
      this.logger.debug('[JanusClient] joined room => publisherId=', publisherId);
      return publisherId;
      
    } catch (error) {
      this.logger.error('[JanusClient] Failed to join room:', error);
      throw error;
    }
  }

  /**
   * Creates an SDP offer and sends "configure" to Janus with it.
   * Used by both host and guest after attach + join.
   */
  private async configurePublisher(sessionUUID: string = ''): Promise<void> {
    if (!this.pc || !this.sessionId || !this.handleId) {
      return;
    }

    try {
      this.logger.debug('[JanusClient] createOffer...');
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      
      await this.pc.setLocalDescription(offer);

      this.logger.debug('[JanusClient] sending configure with JSEP...');
      await this.sendJanusMessage(
        this.handleId,
        {
          request: 'configure',
          room: this.config.roomId,
          periscope_user_id: this.config.userId,
          session_uuid: sessionUUID,
          stream_name: this.config.streamName,
          vidman_token: this.config.credential,
        },
        offer
      );
      
      this.logger.debug('[JanusClient] waiting for answer...');
      
    } catch (error) {
      this.logger.error('[JanusClient] Failed to configure publisher:', error);
      throw error;
    }
  }

  /**
   * Sends a "janus":"message" to the Janus handle, optionally with jsep.
   */
  private async sendJanusMessage(
    handleId: number,
    body: any,
    jsep?: any,
  ): Promise<void> {
    if (!this.sessionId) {
      throw new Error('[JanusClient] No session for sendJanusMessage');
    }
    
    const transaction = this.randomTid();
    
    try {
      const resp = await fetch(
        `${this.config.webrtcUrl}/${this.sessionId}/${handleId}`,
        {
          method: 'POST',
          headers: {
            Authorization: this.config.credential,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            janus: 'message',
            transaction,
            body,
            jsep,
          }),
        },
      );
      
      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(
          `[JanusClient] sendJanusMessage failed: status=${resp.status}, error=${errorText}`,
        );
      }
      
    } catch (error) {
      this.logger.error('[JanusClient] Failed to send Janus message:', error);
      throw error;
    }
  }

  /**
   * Starts polling /janus/{sessionId}?maxev=1 for events. We parse keepalives, answers, etc.
   */
  private startPolling(): void {
    this.logger.debug('[JanusClient] Starting polling...');
    const doPoll = async () => {
      if (!this.pollActive || !this.sessionId) {
        this.logger.debug('[JanusClient] Polling stopped');
        return;
      }
      
      try {
        const url = `${this.config.webrtcUrl}/${
          this.sessionId
        }?maxev=1&_=${Date.now()}`;
        
        const resp = await fetch(url, {
          headers: { Authorization: this.config.credential },
        });
        
        if (resp.ok) {
          const event = await resp.json();
          this.handleJanusEvent(event);
        } else {
          this.logger.warn('[JanusClient] poll error =>', resp.status);
          
          // If we get poll errors consistently, we might need to recreate the session
          if (resp.status === 404) {
            this.logger.error('[JanusClient] Session not found (404), polling stopped');
            this.pollActive = false;
            this.emit('error', new Error('[JanusClient] Session not found (404)'));
            return;
          }
        }
      } catch (err) {
        this.logger.error('[JanusClient] poll exception =>', err);
      }
      
      // Continue polling
      setTimeout(doPoll, 500);
    };
    
    doPoll();
  }

  /**
   * Processes each Janus event received from the poll cycle.
   */
  private handleJanusEvent(evt: JanusEvent): void {
    if (!evt.janus) {
      return;
    }
    
    this.logger.debug('[JanusClient] Received Janus event:', evt.janus);

    switch (evt.janus) {
      case 'keepalive':
        this.logger.debug('[JanusClient] Keepalive received');
        break;

      case 'event':
        if (evt.plugindata?.plugin === 'janus.plugin.videoroom') {
          const data = evt.plugindata.data;
          switch (data.videoroom) {
            case 'joined':
              this.logger.info('[JanusClient] Joined room as', data.ptype);
              break;

            case 'attached':
              this.logger.info('[JanusClient] Attached to stream:', data.id);
              break;

            case 'event':
              if (Array.isArray(data.publishers)) {
                this.logger.info('[JanusClient] Publishers list updated:', data.publishers.length);
                this.emit('publishersUpdated', data.publishers);
              }
              break;

            case 'webrtcup':
              this.logger.info('[JanusClient] WebRTC connection established');
              break;

            case 'hangup':
              this.logger.warn('[JanusClient] Connection hung up:', data.reason);
              this.emit('hangup', data);
              break;

            default:
              this.logger.debug('[JanusClient] Unknown videoroom event:', data.videoroom);
          }
        }
        break;

      case 'success':
        this.logger.debug('[JanusClient] Success response received');
        break;

      default:
        this.logger.warn('[JanusClient] Unknown Janus event type:', evt.janus);
    }
  }

  private randomTid(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private setupPeerEvents(): void {
    this.pc?.addEventListener('iceconnectionstatechange', () => {
      this.logger.debug('[JanusClient] ICE connection state:', this.pc?.iceConnectionState);
      if (this.pc?.iceConnectionState === 'disconnected') {
        this.logger.warn('[JanusClient] ICE connection disconnected, attempting restart...');
        this.restartIce();
      }
    });

    this.pc?.addEventListener('icegatheringstatechange', () => {
      this.logger.debug('[JanusClient] ICE gathering state:', this.pc?.iceGatheringState);
    });

    this.pc?.addEventListener('connectionstatechange', () => {
      this.logger.debug('[JanusClient] Connection state:', this.pc?.connectionState);
    });
  }

  private async waitForJanusEventWithPredicate(
    predicate: (evt: JanusEvent) => boolean,
    timeout: number = 5000,
    description: string = 'waitForJanusEvent',
  ): Promise<JanusEvent> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`[JanusClient] Timeout waiting for ${description} event`));
      }, timeout);

      const eventHandler = (event: JanusEvent) => {
        if (predicate(event)) {
          clearTimeout(timeoutId);
          this.removeListener('janus', eventHandler);
          resolve(event);
        }
      };

      this.on('janus', eventHandler);
    });
  }
}
