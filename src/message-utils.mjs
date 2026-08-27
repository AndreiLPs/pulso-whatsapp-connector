const hiddenJids = /(@g\.us|@broadcast|@newsletter)$/;

export function isPrivateChat(jid = "") {
  return Boolean(jid && jid.includes("@") && !hiddenJids.test(jid) && jid !== "status@broadcast");
}

export function messageText(message = {}) {
  const content = message?.message || {};
  return String(
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    ""
  ).trim().slice(0, 4000);
}

export function messageTimestamp(message = {}) {
  const raw = message.messageTimestamp;
  const value = typeof raw === "number" ? raw : Number(raw?.low ?? raw ?? 0);
  return value > 0 ? value * 1000 : Date.now();
}

export function maskedContact(jid = "") {
  const digits = jid.split("@")[0].replace(/\D/g, "");
  return digits.length >= 4 ? `Contato •••• ${digits.slice(-4)}` : "Contato do WhatsApp";
}
