import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { disconnectCode, reconnectDelay, shouldReconnect } from "./connection-utils.mjs";
import { isPrivateChat, maskedContact, messageText, messageTimestamp } from "./message-utils.mjs";

const port = Math.max(1, Number(process.env.PORT || 8080));
const sharedSecret = String(process.env.CONNECTOR_SHARED_SECRET || "");
const ttlMs = Math.max(2, Math.min(20, Number(process.env.SESSION_TTL_MINUTES || 10))) * 60_000;
const sessions = new Map();
const logger = pino({ level: process.env.LOG_LEVEL || "warn" });

if (sharedSecret.length < 24) throw new Error("CONNECTOR_SHARED_SECRET deve ter pelo menos 24 caracteres.");

function authorized(request) {
  const supplied = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied), b = Buffer.from(sharedSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error("BODY_TOO_LARGE");
  }
  return raw ? JSON.parse(raw) : {};
}

function contactName(session, jid, fallback = "") {
  const saved = session.contacts.get(jid);
  const label = String(saved?.name || saved?.notify || saved?.verifiedName || fallback || "").trim();
  return label && !/^\+?\d+$/.test(label) ? label.slice(0, 100) : maskedContact(jid);
}

function chatToken(session, jid) {
  if (!session.chatTokens.has(jid)) session.chatTokens.set(jid, randomUUID());
  return session.chatTokens.get(jid);
}

function addMessage(session, message) {
  const jid = String(message?.key?.remoteJid || "");
  const text = messageText(message);
  if (!isPrivateChat(jid) || !text) return;
  const list = session.messages.get(jid) || [];
  list.push({ id: String(message.key?.id || ""), fromMe: Boolean(message.key?.fromMe), text, timestamp: messageTimestamp(message) });
  list.sort((a, b) => a.timestamp - b.timestamp);
  session.messages.set(jid, list.slice(-500));
  if (message.pushName && !session.contacts.has(jid)) session.contacts.set(jid, { notify: String(message.pushName) });
}

function sessionPublic(session) {
  const chats = [...session.messages.entries()].map(([id, messages]) => ({
    id: chatToken(session, id),
    name: contactName(session, id),
    messageCount: messages.length,
    lastMessageAt: messages.at(-1)?.timestamp || 0,
    preview: messages.at(-1)?.text.slice(0, 100) || "",
  })).sort((a, b) => b.lastMessageAt - a.lastMessageAt).slice(0, 500);
  return { id: session.id, status: session.status, qrDataUrl: session.qrDataUrl, expiresAt: new Date(session.expiresAt).toISOString(), chats, error: session.error || "" };
}

async function destroySession(id, unlink = true) {
  const session = sessions.get(id);
  if (!session || session.destroying) return;
  session.destroying = true;
  clearTimeout(session.timer);
  clearTimeout(session.reconnectTimer);
  try {
    if (unlink && session.status === "connected") await Promise.race([session.socket?.logout(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  } catch (error) { logger.warn({ sessionId: id, error: String(error) }, "logout failed"); }
  try { session.socket?.end(undefined); } catch {}
  session.messages.clear(); session.contacts.clear(); session.chatTokens.clear();
  await rm(session.directory, { recursive: true, force: true }).catch(() => {});
  sessions.delete(id);
}

function startSocket(session) {
  if (!sessions.has(session.id) || session.destroying) return;
  const socket = makeWASocket({ auth: session.authState, logger, browser: Browsers.macOS("Desktop"), markOnlineOnConnect: false, syncFullHistory: true, generateHighQualityLinkPreview: false });
  session.socket = socket;
  socket.ev.on("creds.update", session.saveCreds);
  socket.ev.on("contacts.set", ({ contacts }) => contacts.forEach((contact) => session.contacts.set(contact.id, contact)));
  socket.ev.on("contacts.upsert", (contacts) => contacts.forEach((contact) => session.contacts.set(contact.id, contact)));
  socket.ev.on("messaging-history.set", ({ messages, contacts }) => {
    contacts?.forEach((contact) => session.contacts.set(contact.id, contact));
    messages?.forEach((message) => addMessage(session, message));
  });
  socket.ev.on("messages.upsert", ({ messages }) => messages.forEach((message) => addMessage(session, message)));
  socket.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
    if (!sessions.has(session.id) || session.destroying || session.socket !== socket) return;
    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 420 });
      if (session.socket === socket && !session.destroying) { session.status = "qr"; session.qrDataUrl = qrDataUrl; session.error = ""; }
    }
    if (connection === "open") { session.status = "connected"; session.qrDataUrl = ""; session.error = ""; session.reconnectAttempts = 0; }
    if (connection === "close") {
      const code = disconnectCode(lastDisconnect?.error);
      const attempts = session.reconnectAttempts;
      logger.warn({ sessionId: session.id, code, attempts, reason: String(lastDisconnect?.error || "") }, "whatsapp connection closed");
      if (shouldReconnect(code, attempts)) {
        session.reconnectAttempts += 1;
        session.status = "reconnecting";
        session.qrDataUrl = "";
        session.error = "";
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = setTimeout(() => {
          try { startSocket(session); }
          catch (error) {
            logger.error({ sessionId: session.id, error: String(error) }, "whatsapp reconnect failed");
            session.status = "error";
            session.error = "Não foi possível restabelecer a conexão. Gere um novo QR Code.";
          }
        }, reconnectDelay(code, attempts));
      } else if (code === DisconnectReason.loggedOut) await destroySession(session.id, false);
      else { session.status = "error"; session.error = "A conexão foi interrompida. Gere um novo QR Code."; }
    }
  });
}

async function createSession() {
  const id = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "pulso-wa-"));
  const { state, saveCreds } = await useMultiFileAuthState(directory);
  const session = { id, directory, status: "starting", qrDataUrl: "", error: "", expiresAt: Date.now() + ttlMs, socket: null, authState: state, saveCreds, messages: new Map(), contacts: new Map(), chatTokens: new Map(), destroying: false, timer: null, reconnectTimer: null, reconnectAttempts: 0 };
  sessions.set(id, session);
  session.timer = setTimeout(() => destroySession(id, true), ttlMs);
  startSocket(session);
  return session;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://connector.local");
    if (url.pathname === "/health" && request.method === "GET") return json(response, 200, { ok: true, activeSessions: sessions.size });
    if (!authorized(request)) return json(response, 401, { error: "UNAUTHORIZED" });
    if (url.pathname === "/sessions" && request.method === "POST") return json(response, 201, sessionPublic(await createSession()));
    const match = url.pathname.match(/^\/sessions\/([^/]+)(?:\/chats\/([^/]+))?$/);
    if (!match) return json(response, 404, { error: "NOT_FOUND" });
    const session = sessions.get(decodeURIComponent(match[1]));
    if (!session) return json(response, 404, { error: "SESSION_NOT_FOUND" });
    if (request.method === "GET" && !match[2]) return json(response, 200, sessionPublic(session));
    if (request.method === "GET" && match[2]) {
      const token = decodeURIComponent(match[2]);
      const jid = [...session.chatTokens.entries()].find(([, value]) => value === token)?.[0] || "";
      const messages = session.messages.get(jid);
      if (!messages) return json(response, 404, { error: "CHAT_NOT_FOUND" });
      return json(response, 200, { id: jid, name: contactName(session, jid), messages });
    }
    if (request.method === "DELETE" && !match[2]) { await destroySession(session.id, true); return json(response, 200, { ok: true }); }
    if (request.method === "POST") await body(request);
    return json(response, 405, { error: "METHOD_NOT_ALLOWED" });
  } catch (error) { logger.error({ error: String(error) }, "request failed"); return json(response, 500, { error: "CONNECTOR_ERROR" }); }
});

server.listen(port, "0.0.0.0", () => logger.info({ port }, "Pulso WhatsApp connector ready"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await Promise.all([...sessions.keys()].map((id) => destroySession(id, true))); server.close(() => process.exit(0)); });
