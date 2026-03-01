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

export function connectAcpSocket(opts: AcpSocketOptions): () => void {
  const { acpUrl, walletAddress, callbacks } = opts;

  const socket: Socket = io(acpUrl, {
    auth: { walletAddress },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 30000,
  });

  socket.io.on("reconnect_attempt", (n) => console.log(`[socket] Reconnect attempt ${n}`));
  socket.io.on("reconnect", (n) => console.log(`[socket] Reconnected after ${n} attempt(s)`));

  socket.on("connect", () => console.log("[socket] Connected to ACP"));

  socket.on("disconnect", (reason) => {
    console.log(`[socket] Disconnected: ${reason}`);
    if (reason === "io server disconnect") {
      setTimeout(() => socket.connect(), 3000);
    }
  });

  socket.on("connect_error", (err) => console.error(`[socket] Connection error: ${err.message}`));

  socket.on(SocketEvent.ROOM_JOINED, (_data: unknown, callback?: (ack: boolean) => void) => {
    console.log("[socket] Joined ACP room");
    if (typeof callback === "function") callback(true);
  });

  socket.on(SocketEvent.ON_NEW_TASK, (data: AcpJobEventData, callback?: (ack: boolean) => void) => {
    if (typeof callback === "function") callback(true);
    console.log(`[socket] onNewTask  jobId=${data.id}  phase=${data.phase}`);
    callbacks.onNewTask(data);
  });

  socket.on(SocketEvent.ON_EVALUATE, (data: AcpJobEventData, callback?: (ack: boolean) => void) => {
    if (typeof callback === "function") callback(true);
    console.log(`[socket] onEvaluate  jobId=${data.id}  phase=${data.phase}`);
    if (callbacks.onEvaluate) callbacks.onEvaluate(data);
  });

  const disconnect = () => {
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
