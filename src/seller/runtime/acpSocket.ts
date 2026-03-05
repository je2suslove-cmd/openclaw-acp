import { io, type Socket } from "socket.io-client";
import { SocketEvent, type AcpJobEventData } from "./types.js";

export interface AcpSocketCallbacks {
  onNewTask: (data: AcpJobEventData) => void;
  onEvaluate?: (data: AcpJobEventData) => void;
}

export interface AcpSocketOptions {
  acpUrl: string;
  walletAddress: string;
  callbacks: AcpSocketCallbacks;
}

// Railway idle timeout = 30s → heartbeat every 25s keeps the connection alive
const HEARTBEAT_MS = 25_000;
// Backoff for "io server disconnect" (server-initiated): 3s → 6s → 12s → … → 60s
const MANUAL_RECONNECT_INIT_MS = 3_000;
const MANUAL_RECONNECT_MAX_MS = 60_000;

export function connectAcpSocket(opts: AcpSocketOptions): () => void {
  const { acpUrl, walletAddress, callbacks } = opts;

  const socket: Socket = io(acpUrl, {
    auth: { walletAddress },
    transports: ["websocket"], // websocket only — no polling fallback
    upgrade: false, // prevent engine.io from upgrading (polling→ws); ws-only from the start
    pingTimeout: 60000, // wait 60s for pong before declaring connection dead
    pingInterval: 20000, // server→client ping every 20s (overridden by server handshake if server sets its own)
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 60000,
    randomizationFactor: 0.5,
  });

  // ─── 1. Heartbeat: emit ping every 25s to prevent Railway idle-timeout
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket.connected) socket.emit("ping", { ts: Date.now() });
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ─── 2. Reconnect backoff state (only used for "io server disconnect")
  let manualReconnectDelay = MANUAL_RECONNECT_INIT_MS;

  // ─── 3. Job queue: buffer ON_NEW_TASK events until ROOM_JOINED fires
  //    Prevents processing jobs before the ACP room is ready after reconnect.
  let roomReady = false;
  const jobQueue: Array<() => void> = [];

  function flushJobQueue() {
    if (jobQueue.length > 0)
      console.log(`[socket] Flushing ${jobQueue.length} queued job(s) after room join`);
    while (jobQueue.length > 0) jobQueue.shift()!();
  }

  socket.io.on("reconnect_attempt", (n) => console.log(`[socket] Reconnect attempt ${n}`));
  socket.io.on("reconnect", (n) => {
    console.log(`[socket] Reconnected after ${n} attempt(s)`);
    manualReconnectDelay = MANUAL_RECONNECT_INIT_MS; // reset backoff on successful reconnect
  });

  socket.on("connect", () => {
    console.log("[socket] Connected to ACP");
    manualReconnectDelay = MANUAL_RECONNECT_INIT_MS; // reset backoff
    startHeartbeat();
  });

  socket.on("disconnect", (reason) => {
    console.log(`[socket] Disconnected: ${reason}`);
    stopHeartbeat();
    roomReady = false; // buffer incoming jobs until ROOM_JOINED re-fires

    if (reason === "io server disconnect") {
      // socket.io auto-reconnect does NOT apply to server-initiated disconnects.
      // Use exponential backoff for manual reconnect.
      const delay = manualReconnectDelay;
      console.log(`[socket] Server disconnect — reconnecting in ${delay}ms`);
      setTimeout(() => socket.connect(), delay);
      manualReconnectDelay = Math.min(manualReconnectDelay * 2, MANUAL_RECONNECT_MAX_MS);
    }
  });

  socket.on("connect_error", (err) => console.error(`[socket] Connection error: ${err.message}`));

  socket.on(SocketEvent.ROOM_JOINED, (_data: unknown, callback?: (ack: boolean) => void) => {
    console.log("[socket] Joined ACP room");
    if (typeof callback === "function") callback(true);
    roomReady = true;
    flushJobQueue(); // process any jobs that arrived before room was ready
  });

  socket.on(SocketEvent.ON_NEW_TASK, (data: AcpJobEventData, callback?: (ack: boolean) => void) => {
    if (typeof callback === "function") callback(true);
    console.log(`[socket] onNewTask  jobId=${data.id}  phase=${data.phase}`);

    if (roomReady) {
      callbacks.onNewTask(data);
    } else {
      // Room not yet joined after reconnect — queue and replay after ROOM_JOINED
      console.log(`[socket] Room not ready — queuing job ${data.id}`);
      jobQueue.push(() => callbacks.onNewTask(data));
    }
  });

  socket.on(SocketEvent.ON_EVALUATE, (data: AcpJobEventData, callback?: (ack: boolean) => void) => {
    if (typeof callback === "function") callback(true);
    console.log(`[socket] onEvaluate  jobId=${data.id}  phase=${data.phase}`);
    if (callbacks.onEvaluate) callbacks.onEvaluate(data);
  });

  const disconnect = () => {
    stopHeartbeat();
    socket.off("connect");
    socket.off("disconnect");
    socket.off("connect_error");
    socket.off(SocketEvent.ROOM_JOINED);
    socket.off(SocketEvent.ON_NEW_TASK);
    socket.off(SocketEvent.ON_EVALUATE);
    socket.disconnect();
    process.off("SIGINT", handleSigInt);
    process.off("SIGTERM", handleSigTerm);
  };

  const handleSigInt = () => {
    disconnect();
    process.exit(0);
  };
  const handleSigTerm = () => {
    disconnect();
    process.exit(0);
  };
  process.on("SIGINT", handleSigInt);
  process.on("SIGTERM", handleSigTerm);

  return disconnect;
}
