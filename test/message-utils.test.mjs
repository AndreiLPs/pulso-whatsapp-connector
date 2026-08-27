import assert from "node:assert/strict";
import test from "node:test";
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
