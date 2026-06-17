"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

type Comic = { id: string; title: string; roomId: string; updatedAt: string };

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [comics, setComics] = useState<Comic[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/comics").then(r => r.json()).then(setComics);
    }
  }, [status]);

  async function createComic() {
    setCreating(true);
    const res = await fetch("/api/comics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const comic: Comic = await res.json();
    router.push(`/comic-editor?room=${comic.roomId}`);
  }

  async function deleteComic(id: string) {
    await fetch(`/api/comics/${id}`, { method: "DELETE" });
    setComics(prev => prev.filter(c => c.id !== id));
  }

  async function saveTitle(id: string) {
    const res = await fetch(`/api/comics/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editingTitle }),
    });
    const updated: Comic = await res.json();
    setComics(prev => prev.map(c => c.id === id ? updated : c));
    setEditingId(null);
  }

  if (status === "loading" || status === "unauthenticated") return null;

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", fontFamily: "sans-serif" }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 24px", background: "#1e293b",
        borderBottom: "1px solid #334155",
      }}>
        <span style={{ fontFamily: "Bangers, cursive", fontSize: 24, letterSpacing: 3, color: "#3b82f6" }}>
          COMIC FORGE
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "#64748b", fontSize: 13 }}>{session?.user?.email}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            padding: "4px 12px", background: "transparent",
            border: "1px solid #334155", borderRadius: 6,
            color: "#94a3b8", fontSize: 12, cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </header>

      {/* Body */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <h1 style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 600, margin: 0 }}>Your Comics</h1>
          <span style={{ flex: 1 }} />
          <button
            onClick={createComic}
            disabled={creating}
            style={{
              padding: "8px 20px", background: "#1d4ed8",
              border: "none", borderRadius: 8,
              color: "#e2e8f0", fontSize: 13,
              fontFamily: "Bangers, cursive", letterSpacing: 1,
              cursor: creating ? "default" : "pointer",
            }}
          >
            {creating ? "Creating…" : "+ New Comic"}
          </button>
        </div>

        {comics.length === 0 ? (
          <div style={{
            border: "2px dashed #334155", borderRadius: 12,
            padding: "60px 24px", textAlign: "center", color: "#475569",
          }}>
            <p style={{ fontSize: 16, marginBottom: 12 }}>No comics yet.</p>
            <button
              onClick={createComic}
              style={{
                padding: "8px 20px", background: "#1d4ed8",
                border: "none", borderRadius: 8,
                color: "#e2e8f0", fontSize: 13,
                fontFamily: "Bangers, cursive", letterSpacing: 1, cursor: "pointer",
              }}
            >
              Create your first comic
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {comics.map(comic => (
              <div
                key={comic.id}
                style={{
                  background: "#1e293b", border: "1px solid #334155",
                  borderRadius: 10, overflow: "hidden",
                  display: "flex", flexDirection: "column",
                }}
              >
                {/* Thumbnail placeholder */}
                <div
                  onClick={() => router.push(`/comic-editor?room=${comic.roomId}`)}
                  style={{
                    height: 140, background: "#0f172a",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "#1e3a8a", fontSize: 40,
                  }}
                >
                  📄
                </div>

                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {editingId === comic.id ? (
                    <form onSubmit={e => { e.preventDefault(); saveTitle(comic.id); }} style={{ display: "flex", gap: 6 }}>
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={e => setEditingTitle(e.target.value)}
                        onBlur={() => saveTitle(comic.id)}
                        style={{
                          flex: 1, padding: "4px 8px",
                          background: "#0f172a", border: "1px solid #334155",
                          borderRadius: 6, color: "#e2e8f0", fontSize: 13,
                        }}
                      />
                    </form>
                  ) : (
                    <span
                      style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 500, cursor: "text" }}
                      onDoubleClick={() => { setEditingId(comic.id); setEditingTitle(comic.title); }}
                      title="Double-click to rename"
                    >
                      {comic.title}
                    </span>
                  )}

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "#475569", fontSize: 11, flex: 1 }}>
                      {new Date(comic.updatedAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => router.push(`/comic-editor?room=${comic.roomId}`)}
                      style={{
                        padding: "3px 10px", background: "#1d4ed8",
                        border: "none", borderRadius: 5,
                        color: "#e2e8f0", fontSize: 11,
                        fontFamily: "Bangers, cursive", letterSpacing: 1, cursor: "pointer",
                      }}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => deleteComic(comic.id)}
                      style={{
                        padding: "3px 8px", background: "transparent",
                        border: "1px solid #334155", borderRadius: 5,
                        color: "#64748b", fontSize: 11, cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
