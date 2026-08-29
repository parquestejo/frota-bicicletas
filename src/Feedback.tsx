import { createContext, useCallback, useContext, useMemo, useState } from "react";

type FeedbackKind = "success" | "error" | "info";
type FeedbackMessage = { id: number; kind: FeedbackKind; text: string };
type FeedbackApi = {
  notify: (text: string, kind?: FeedbackKind) => void;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const notify = useCallback((text: string, kind: FeedbackKind = "info") => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current, { id, kind, text }].slice(-4));
    window.setTimeout(
      () => setMessages((current) => current.filter((message) => message.id !== id)),
      kind === "error" ? 7000 : 4500,
    );
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="feedback-region" aria-live="polite" aria-atomic="false">
        {messages.map((message) => (
          <div className={`feedback-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"} key={message.id}>
            <span>{message.text}</span>
            <button type="button" aria-label="Fechar mensagem" onClick={() => setMessages((current) => current.filter((item) => item.id !== message.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback deve ser utilizado dentro de FeedbackProvider");
  return context;
}
