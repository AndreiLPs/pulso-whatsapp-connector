import assert from "node:assert/strict";
import test from "node:test";
import { disconnectCode, reconnectDelay, shouldReconnect } from "../src/connection-utils.mjs";
import { isPrivateChat, maskedContact, messageText } from "../src/message-utils.mjs";

test("accepts private chats and rejects groups, newsletters and status", () => {
  assert.equal(isPrivateChat("5511999999999@s.whatsapp.net"), true);
  assert.equal(isPrivateChat("1203630@g.us"), false);
  assert.equal(isPrivateChat("status@broadcast"), false);
});

test("extracts only readable text and masks fallback contacts", () => {
  assert.equal(messageText({ message: { extendedTextMessage: { text: "Olá" } } }), "Olá");
  assert.equal(maskedContact("5511999991234@s.whatsapp.net"), "Contato •••• 1234");
});

test("reconnects after WhatsApp restart and transient disconnects", () => {
  assert.equal(disconnectCode({ output: { statusCode: 515 } }), 515);
  assert.equal(shouldReconnect(515, 0), true);
  assert.equal(shouldReconnect(408, 2), true);
  assert.equal(reconnectDelay(515, 0), 300);
});

test("does not reconnect terminal sessions or loop indefinitely", () => {
  assert.equal(shouldReconnect(401, 0), false);
  assert.equal(shouldReconnect(440, 0), false);
  assert.equal(shouldReconnect(408, 5), false);
});
