/**
 * SocketService — room + legacy socket tracking, presence, notifyUser, emitToRoom.
 */

import { Server as HttpServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import { panel } from "../lib/globalprimsaclient";
import { ALLOWED_ORIGINS } from "../lib/allowedOrigins";

type LoggerLike = {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
};

type NotificationPayload = {
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    data?: Record<string, any>;
    timestamp?: string;
};


class SocketService {
    private io: IOServer | null = null;
    private onlineUsersLegacy: Map<number | string, string> = new Map();
    private userRooms: Map<string, Set<string>> = new Map();
    private logger: LoggerLike;

    public EVENTS = {
        REGISTER_USER: 'registerUser',
        JOIN_USER: 'joinUser',
        LEAVE_USER: 'leaveUser',
        DISCONNECT: 'disconnect',
        NOTIFICATION: 'notification',
        PRESENCE: 'presence',
        GRIEVANCE_UPDATED: 'grievance:updated',
    } as const;

    constructor(logger?: LoggerLike) {
        this.logger = logger ?? console;
    }

    /**
     * Attach Socket.IO to an existing HTTP server.
     */
    initialize(server: HttpServer) {
        if (this.io) {
            this.logger.info && this.logger.info('Socket service already initialized');
            return this.io;
        }

        try {
            this.io = new IOServer(server, {
                cors: {
                    origin: ALLOWED_ORIGINS, // API wale hi origins, '*' nahi
                    methods: ['GET', 'POST'],
                    credentials: true,
                },
                pingTimeout: 60000,
                pingInterval: 25000,
            });

            this.setupSocketHandlers();
            this.logger.info && this.logger.info('Socket service initialized successfully');
            return this.io;
        } catch (error) {
            this.logger.error && this.logger.error('Failed to initialize socket service:', error);
            throw error;
        }
    }

    /**
     * Set up per-socket handlers
     */
    private setupSocketHandlers() {
        if (!this.io) return;

        this.io.on('connection', (socket: Socket) => {
            this.logger.info && this.logger.info(`Client connected: ${socket.id}`);

            // Legacy registration handler (for older clients)
            socket.on(this.EVENTS.REGISTER_USER, (userId: number | string) => {
                try {
                    if (userId == null) return;
                    this.onlineUsersLegacy.set(userId, socket.id);
                    this.logger.info && this.logger.info(`(legacy) User ${userId} registered with socket ${socket.id}`);
                } catch (err) {
                    this.logger.error && this.logger.error('Error in registerUser handler:', err);
                }
            });

            // Modern join/leave handlers (multi-device support)
            socket.on(this.EVENTS.JOIN_USER, (userId: string) => {
                this.handleJoinUser(socket, userId);
            });

            socket.on(this.EVENTS.LEAVE_USER, (userId: string) => {
                this.handleLeaveUser(socket, userId);
            });

            // inside connection handler (server)
            socket.on('joinRoom', (roomName: string) => {
                try {
                    if (!roomName) return;
                    socket.join(roomName);
                    // optional: log
                    console.log(`Socket ${socket.id} joined room ${roomName}`);
                } catch (err) {
                    console.error('joinRoom error', err);
                }
            });


            // Disconnect
            socket.on('disconnect', (reason?: string) => {
                this.handleDisconnect(socket, reason);
            });

            socket.on('error', (error) => {
                this.logger.error && this.logger.error(`Socket error for client ${socket.id}:`, error);
            });
        });


        this.io.on('error', (error) => {
            this.logger.error && this.logger.error('Socket.IO server error:', error);
        });
    }

    private handleJoinUser(socket: Socket, userId?: string) {
        try {
            if (!userId) {
                this.logger.warn && this.logger.warn(`Invalid user ID provided by client ${socket.id}`);
                return;
            }

            const room = `user:${userId}`;
            socket.join(room);

            if (!this.userRooms.has(userId)) {
                this.userRooms.set(userId, new Set());
            }
            this.userRooms.get(userId)!.add(socket.id);

            // Keep legacy map's first socket
            if (!this.onlineUsersLegacy.has(userId)) {
                this.onlineUsersLegacy.set(userId, socket.id);
            }

            this.emitPresence(userId, true);
            this.logger.info && this.logger.info(`Socket ${socket.id} joined room ${room}`);
        } catch (error) {
            this.logger.error && this.logger.error(`Error joining user room for client ${socket.id}:`, error);
        }
    }

    private handleLeaveUser(socket: Socket, userId?: string) {
        try {
            if (!userId) {
                this.logger.warn && this.logger.warn(`Invalid user ID provided by client ${socket.id}`);
                return;
            }

            const room = `user:${userId}`;
            socket.leave(room);

            if (this.userRooms.has(userId)) {
                this.userRooms.get(userId)!.delete(socket.id);
                if (this.userRooms.get(userId)!.size === 0) {
                    this.userRooms.delete(userId);
                    this.emitPresence(userId, false);
                }
            }

            const legacySocketId = this.onlineUsersLegacy.get(userId);
            if (legacySocketId === socket.id) {
                this.onlineUsersLegacy.delete(userId);
            }

            this.logger.info && this.logger.info(`Socket ${socket.id} left room ${room}`);
        } catch (error) {
            this.logger.error && this.logger.error(`Error leaving user room for client ${socket.id}:`, error);
        }
    }

    private handleDisconnect(socket: Socket, reason?: string) {
        try {
            // Clean modern map
            this.userRooms.forEach((sockets, userId) => {
                if (sockets.has(socket.id)) {
                    sockets.delete(socket.id);
                    if (sockets.size === 0) {
                        this.userRooms.delete(userId);
                        this.emitPresence(userId, false);
                    } else {
                        this.emitPresence(userId, true);
                    }
                }
            });

            // Clean legacy map
            for (const [userId, sId] of Array.from(this.onlineUsersLegacy.entries())) {
                if (sId === socket.id) {
                    this.onlineUsersLegacy.delete(userId);
                    break;
                }
            }

            this.logger.info && this.logger.info(`Client disconnected: ${socket.id} ${reason ? '- ' + reason : ''}`);
        } catch (error) {
            this.logger.error && this.logger.error(`Error handling disconnect for client ${socket.id}:`, error);
        }
    }

    private emitPresence(userId: string, online: boolean) {
        if (!this.isInitialized()) return;

        try {
            const count = this.userRooms.get(userId)?.size || 0;
            this.io!.to(`user:${userId}`).emit(this.EVENTS.PRESENCE, {
                userId,
                online,
                connections: count,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            this.logger.error && this.logger.error(`Error emitting presence for user ${userId}:`, error);
        }
    }

    /**
     * notifyUser
     * - tries multi-device room first, then legacy socket
     */
    public notifyUser(userId: number | string, payload: NotificationPayload) {
        if (!this.isInitialized()) {
            this.logger.warn && this.logger.warn('Attempted to emit notification before socket service initialization');
            return;
        }

        const uidStr = String(userId);
        const message = {
            ...payload,
            timestamp: payload.timestamp ?? new Date().toISOString(),
        };

        try {
            const sanitized = this.sanitizeForEmit(message);

            if (this.userRooms.has(uidStr)) {
                this.io!.to(`user:${uidStr}`).emit(this.EVENTS.NOTIFICATION, sanitized);
                this.logger.debug && this.logger.debug(`(room) Notification emitted to user ${uidStr}:`, sanitized);
            }

            const legacySocket = this.onlineUsersLegacy.get(userId);
            if (legacySocket && this.io!.sockets.sockets.get(legacySocket)) {
                this.io!.to(legacySocket).emit(this.EVENTS.NOTIFICATION, sanitized);
                this.logger.debug && this.logger.debug(`(legacy) Notification emitted to socket ${legacySocket}:`, sanitized);
            }
        } catch (error) {
            this.logger.error && this.logger.error(`Error emitting notification to user ${userId}:`, error);
        }
    }

    /**
     * sanitizeForEmit
     */
    private sanitizeForEmit<T>(obj: T): T {
        const convert = (value: any): any => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            if (value instanceof Date) {
                return value.toISOString();
            }
            if (Array.isArray(value)) {
                return value.map(v => convert(v));
            }
            if (value && typeof value === 'object') {
                const out: any = {};
                for (const [k, v] of Object.entries(value)) {
                    out[k] = convert(v);
                }
                return out;
            }
            return value;
        };

        return convert(obj) as T;
    }

    /**
     * emitToRoom
     */
    public async emitToRoom(roomName: string, payload: NotificationPayload) {
  if (!this.isInitialized()) {
    this.logger.warn && this.logger.warn('emitToRoom called before initialization');
    return;
  }

  const normalized = {
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };

  // Sirf live emit — notification DB me save karna ho to panel.notification.create() alag se karo (user_id ke saath)
  try {
    const emitPayloadRaw = {
      id: null,
      title: payload.title,
      message: payload.message,
      type: payload.type ?? 'info',
      data: payload.data ?? null,
      created_at: normalized.timestamp,
    };

    const emitPayload = this.sanitizeForEmit(emitPayloadRaw);

    this.io!.to(roomName).emit(this.EVENTS.NOTIFICATION, emitPayload);
    this.logger.debug && this.logger.debug(`Emitted to room ${roomName}:`, emitPayload);
  } catch (err) {
    this.logger.error && this.logger.error(`Error emitting to room ${roomName}:`, err);
  }
}


    public isInitialized() {
        const initialized = !!this.io;
        if (!initialized) {
            this.logger.warn && this.logger.warn('Socket service not initialized');
        }
        return initialized;
    }

    /**
     * broadcastToRoom
     * Lightweight emit — no DB persistence. Use for high-frequency domain events.
     */
    public broadcastToRoom(roomName: string, event: string, data: any) {
        if (!this.isInitialized()) return;
        try {
            const sanitized = this.sanitizeForEmit({ ...data, timestamp: new Date().toISOString() });
            this.io!.to(roomName).emit(event, sanitized);
        } catch (err) {
            this.logger.error && this.logger.error(`broadcastToRoom error for ${roomName}:`, err);
        }
    }

    /**
     * emitGlobal
     * Emits an event to ALL connected clients.
     */
    public emitGlobal(event: string, data: any) {
        if (!this.isInitialized()) return;
        try {
            const sanitized = this.sanitizeForEmit({ ...data, timestamp: new Date().toISOString() });
            this.io!.emit(event, sanitized);
        } catch (err) {
            this.logger.error && this.logger.error(`emitGlobal error for ${event}:`, err);
        }
    }

    public getUserConnections(userId: number | string) {
        return this.userRooms.get(String(userId))?.size || 0;
    }

    public disconnectAll() {
        if (this.isInitialized()) {
            this.io!.disconnectSockets(true);
            this.userRooms.clear();
            this.onlineUsersLegacy.clear();
            this.logger.info && this.logger.info('All socket connections closed');
        }
    }
}

const socketService = new SocketService();
export default socketService;
