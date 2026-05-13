"use client";

import { Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";

type Message = { role: "user" | "assistant"; content: string };

export function ChatInterface({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ask me about circuit routing, DB placement, load assumptions, emergency lighting, or any floor design decision." }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question) return;
    setMessages((value) => [...value, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, question })
    });
    const payload = await response.json();
    setMessages((value) => [...value, { role: "assistant", content: payload.answer ?? payload.error ?? "No response." }]);
    setBusy(false);
  }

  return (
    <div className="glass-panel flex min-h-[680px] flex-col rounded-lg p-4">
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[82%]" : "mr-auto max-w-[82%]"}>
            <div className={message.role === "user" ? "rounded-lg border border-cyan-300/40 bg-cyan-300/12 px-4 py-3" : "rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3"}>
              <p className="whitespace-pre-wrap text-sm leading-6 text-cyan-50/88">{message.content}</p>
            </div>
          </div>
        ))}
        {busy ? <p className="mono-font text-xs text-cyan-100/55">Elec Nova Tech AI is reasoning...</p> : null}
      </div>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded border border-cyan-300/20 bg-black/30 px-3 text-white outline-none focus:border-cyan-200/60"
          placeholder="Ask about the current design..."
        />
        <NeonButton type="submit" disabled={busy}>
          <Send className="h-4 w-4" />
          Send
        </NeonButton>
      </form>
    </div>
  );
}
