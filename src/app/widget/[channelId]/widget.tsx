"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Msg {
  id: string;
  sender: "CONTACT" | "BOT" | "HUMAN" | "SYSTEM";
  text: string;
}

function visitorId(): string {
  try {
    let v = localStorage.getItem("ag_visitor");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("ag_visitor", v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

export function ChatWidget({ channelId }: { channelId: string }) {
  const [vid, setVid] = useState<string>("");
  const [consented, setConsented] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [brand, setBrand] = useState({ name: "Chat", color: "#4f46e5" as string });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVid(visitorId());
    try {
      setConsented(localStorage.getItem("ag_consent") === "1");
    } catch {}
  }, []);

  const poll = useCallback(async () => {
    if (!vid) return;
    const r = await fetch(`/api/webchat/${channelId}?visitorId=${vid}`);
    if (!r.ok) return;
    const data = await r.json();
    setBrand(data.brand);
    setMessages(data.messages);
  }, [channelId, vid]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const r = await fetch(`/api/webchat/${channelId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId: vid, text, consent: true, metadata: { page: document.referrer.slice(0, 300) } }),
    });
    setBusy(false);
    if (!r.ok) return setError(r.status === 429 ? "You're sending messages too fast." : "Message failed, please retry.");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, sender: "CONTACT", text }]);
    setText("");
    setTimeout(poll, 800);
  }

  const s = { brand: brand.color };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui", background: "#fff", color: "#111" }}>
      <header style={{ background: s.brand, color: "#fff", padding: "12px 16px", fontWeight: 600 }}>{brand.name}</header>
      {!consented ? (
        <div style={{ padding: 16, fontSize: 14 }}>
          <p>You&apos;re chatting with an AI assistant. Messages are processed to answer you and may be reviewed by our team. You can ask us to delete your data at any time by typing “delete my data”.</p>
          <button
            style={{ background: s.brand, color: "#fff", border: 0, padding: "8px 14px", borderRadius: 8 }}
            onClick={() => {
              setConsented(true);
              try {
                localStorage.setItem("ag_consent", "1");
              } catch {}
            }}
          >
            I agree, start chat
          </button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === "CONTACT" ? "flex-end" : "flex-start",
                  background: m.sender === "CONTACT" ? s.brand : "#f1f1f5",
                  color: m.sender === "CONTACT" ? "#fff" : "#111",
                  padding: "8px 12px",
                  borderRadius: 12,
                  maxWidth: "80%",
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                }}
              >
                {m.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          {error && <div style={{ color: "#b91c1c", fontSize: 12, padding: "0 12px" }}>{error}</div>}
          <form onSubmit={send} style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee" }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Type a message…" style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
            <button disabled={busy} style={{ background: s.brand, color: "#fff", border: 0, padding: "0 16px", borderRadius: 8 }}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}
