import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTeamDate } from "@/lib/constants";

const formatTime = (value) => {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${formatTeamDate(value, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} IST`;
};

export default function TeamChat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/team-chat", { params: { limit: 200 } });
      setMessages(data);
    } catch (e) { toast.error(errMsg(e)); }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async (event) => {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.post("/team-chat", { text: text.trim() });
      setText("");
      await load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSending(false); }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col px-5 py-6 lg:px-8" data-testid="team-chat-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="text-sm text-muted-foreground">Workspace communication</div><h1 className="display mt-1 text-3xl font-black tracking-tight">Team chat</h1><p className="mt-1 text-sm text-muted-foreground">Keep your team aligned on leads, calls, and daily priorities.</p></div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"><Users size={15} className="text-[#4bd4f0]" /> Group conversation</div>
      </div>

      <section className="crm-card mt-7 flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="team-chat-box">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4"><div className="rounded-full bg-[#123c51] p-2 text-[#4bd4f0]"><MessageCircle size={18} /></div><div><h2 className="font-bold">Team conversation</h2><p className="text-xs text-muted-foreground">Messages are visible to your organization or assigned team.</p></div></div>
        <div className="min-h-[360px] flex-1 space-y-4 overflow-y-auto p-5" data-testid="team-chat-messages">
          {!messages.length && <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-muted-foreground">No messages yet. Start the conversation.</div>}
          {messages.map((message) => { const own = message.sender_id === user?.id; return <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}><div className={`max-w-[min(680px,85%)] rounded-lg border px-4 py-3 ${own ? "border-[#1e718a] bg-[#123c51]" : "border-border bg-[#121f35]"}`}><div className="mb-1 flex items-center gap-2 text-xs"><span className="font-bold text-[#b9eff8]">{own ? "You" : message.sender_name}</span><span className="text-muted-foreground">{message.sender_role.replace("_", " ")}</span><span className="ml-auto text-muted-foreground">{formatTime(message.created_at)}</span></div><div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{message.text}</div></div></div>; })}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="border-t border-border bg-[#0c182b] p-4"><div className="flex items-end gap-3"><Textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(event); } }} placeholder="Write a message..." className="min-h-[48px] resize-none border-border bg-[#101f35]" maxLength={2000} /><Button type="submit" disabled={!text.trim() || sending} className="h-12 bg-[#247e9d] text-white hover:bg-[#15556b]"><Send size={16} className="mr-2" />Send</Button></div><div className="mt-2 text-right text-[11px] text-muted-foreground">Press Enter to send · Shift + Enter for a new line</div></form>
      </section>
    </div>
  );
}
