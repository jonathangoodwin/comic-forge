"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Tool = "select" | "panel" | "textbox" | "balloon" | "image" | "comment";

type CommentPin = {
  id: string;
  x: number;
  y: number;
  text: string;
  author: string;
  createdAt: number;
  resolved: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_W = 850;
const PAGE_H = 1100;

// ── Speech balloon SVG path builder ──────────────────────────────────────────

function buildBalloonPath(w: number, h: number, tx: number, ty: number, r = 18) {
  const x = 0, y = 0;
  const bx = w / 2;
  const tw = 22;
  const t1x = bx - tw / 2;
  const t2x = bx + tw / 2;

  return [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `L ${t2x} ${y + h}`,
    `L ${tx} ${ty}`,
    `L ${t1x} ${y + h}`,
    `L ${x + r} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `Z`,
  ].join(" ");
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ComicEditorClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [comments, setComments] = useState<CommentPin[]>([]);
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(true);
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeToolRef = useRef<Tool>("select");

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // ── Init Fabric canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    import("fabric").then(({ fabric }) => {
      const canvas = new fabric.Canvas(canvasRef.current!, {
        width: PAGE_W,
        height: PAGE_H,
        backgroundColor: "#ffffff",
        selection: true,
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      const border = new fabric.Rect({
        left: 0, top: 0, width: PAGE_W - 1, height: PAGE_H - 1,
        fill: "transparent", stroke: "#334155", strokeWidth: 1,
        selectable: false, evented: false, hoverCursor: "default",
      });
      canvas.add(border);
      canvas.sendToBack(border);

      canvas.on("mouse:down", (opt: any) => {
        const tool = activeToolRef.current;
        const pointer = canvas.getPointer(opt.e);

        if (tool === "panel") {
          addPanel(canvas, fabric, pointer.x, pointer.y);
          setActiveTool("select");
        } else if (tool === "textbox") {
          addTextBox(canvas, fabric, pointer.x, pointer.y);
          setActiveTool("select");
        } else if (tool === "balloon") {
          addSpeechBalloon(canvas, fabric, pointer.x, pointer.y);
          setActiveTool("select");
        } else if (tool === "comment") {
          setCommentDraft({ x: pointer.x, y: pointer.y });
          setActiveTool("select");
        }
      });

      const handlePaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            if (!blob) continue;
            addImageFromUrl(canvas, fabric, URL.createObjectURL(blob));
          }
        }
      };
      window.addEventListener("paste", handlePaste);

      return () => {
        canvas.dispose();
        window.removeEventListener("paste", handlePaste);
      };
    });
  }, []);

  function addPanel(canvas: any, fabric: any, x: number, y: number) {
    const rect = new fabric.Rect({
      left: x, top: y, width: 200, height: 160,
      fill: "#ffffff", stroke: "#1e293b", strokeWidth: 3,
      rx: 2, ry: 2,
      data: { type: "panel" },
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  }

  function addTextBox(canvas: any, fabric: any, x: number, y: number) {
    const tb = new fabric.Textbox("Type here...", {
      left: x, top: y, width: 180,
      fontSize: 16,
      fontFamily: "Bangers, cursive",
      fill: "#0f172a",
      backgroundColor: "rgba(255,255,255,0.85)",
      borderColor: "#3b82f6",
      padding: 6,
      data: { type: "textbox" },
    });
    canvas.add(tb);
    canvas.setActiveObject(tb);
    tb.enterEditing();
    canvas.renderAll();
  }

  function addSpeechBalloon(canvas: any, fabric: any, x: number, y: number) {
    const bw = 180, bh = 90;
    const tailTipX = bw / 2;
    const tailTipY = bh + 50;

    const balloon = new fabric.Path(buildBalloonPath(bw, bh, tailTipX, tailTipY), {
      left: x, top: y,
      fill: "#ffffff", stroke: "#0f172a", strokeWidth: 2.5,
      data: { type: "balloon", tailTipX, tailTipY, bw, bh },
    });

    const text = new fabric.Textbox("...", {
      left: x + 12, top: y + 12,
      width: bw - 24,
      fontSize: 15,
      fontFamily: "Bangers, cursive",
      fill: "#0f172a",
      textAlign: "center",
      data: { type: "balloon-text" },
    });

    const handle = new fabric.Circle({
      left: x + tailTipX - 6, top: y + tailTipY - 6,
      radius: 6,
      fill: "#3b82f6", stroke: "#1d4ed8", strokeWidth: 1.5,
      hasControls: false, hasBorders: false,
      data: { type: "balloon-handle", bw, bh },
    });

    handle.on("moving", () => {
      const hx = handle.left! + 6 - balloon.left!;
      const hy = handle.top! + 6 - balloon.top!;
      balloon.set({ path: (fabric.util as any).parsePath(buildBalloonPath(bw, bh, hx, hy)) });
      balloon.setCoords();
      canvas.renderAll();
    });

    balloon.on("moving", () => {
      handle.set({ left: balloon.left! + tailTipX - 6, top: balloon.top! + tailTipY - 6 });
      text.set({ left: balloon.left! + 12, top: balloon.top! + 12 });
      handle.setCoords();
      text.setCoords();
      canvas.renderAll();
    });

    canvas.add(balloon, text, handle);
    canvas.setActiveObject(text);
    text.enterEditing();
    canvas.renderAll();
  }

  function addImageFromUrl(canvas: any, fabric: any, url: string) {
    fabric.Image.fromURL(url, (img: any) => {
      if (img.width > 300) img.scaleToWidth(300);
      img.set({ left: 80, top: 80, data: { type: "image" } });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    }, { crossOrigin: "anonymous" });
  }

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !fabricRef.current) return;
    import("fabric").then(({ fabric }) => {
      addImageFromUrl(fabricRef.current, fabric, URL.createObjectURL(file));
    });
    e.target.value = "";
  }, []);

  function submitComment() {
    if (!commentDraft || !commentText.trim()) return;
    setComments(prev => [...prev, {
      id: crypto.randomUUID(),
      x: commentDraft.x, y: commentDraft.y,
      text: commentText.trim(),
      author: "You",
      createdAt: Date.now(),
      resolved: false,
    }]);
    setCommentDraft(null);
    setCommentText("");
  }

  function handleZoom(factor: number) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const z = Math.min(3, Math.max(0.25, zoom * factor));
    canvas.setZoom(z);
    canvas.setWidth(PAGE_W * z);
    canvas.setHeight(PAGE_H * z);
    setZoom(z);
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getActiveObjects().forEach((obj: any) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.renderAll();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace")) {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        deleteSelected();
      }
      if (e.key === "Escape") setActiveTool("select");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toolCursor: Record<Tool, string> = {
    select: "default", panel: "crosshair", textbox: "text",
    balloon: "crosshair", image: "default", comment: "cell",
  };

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bangers&family=Comic+Neue:wght@400;700&display=swap" />
      <style suppressHydrationWarning>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f172a", color: "#e2e8f0", fontFamily: "Comic Neue, sans-serif" }}>

        {/* Top bar */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0 }}>
          <span style={{ fontFamily: "Bangers, cursive", fontSize: 22, letterSpacing: 2, color: "#3b82f6" }}>COMIC FORGE</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "#64748b" }}>Add <code>NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY</code> to .env.local for live sync</span>
          <button onClick={() => setShowComments(v => !v)} style={btnStyle(showComments ? "#059669" : "#334155")}>
            💬 Comments{comments.filter(c => !c.resolved).length > 0 ? ` (${comments.filter(c => !c.resolved).length})` : ""}
          </button>
        </header>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Left toolbar */}
          <aside style={{ width: 60, background: "#1e293b", borderRight: "1px solid #334155", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 6, flexShrink: 0 }}>
            {([
              ["select", "↖", "Select / Move"],
              ["panel", "⬜", "Add Panel"],
              ["textbox", "T", "Text Box"],
              ["balloon", "💬", "Speech Balloon"],
              ["image", "🖼", "Upload Image"],
              ["comment", "📌", "Add Comment"],
            ] as [Tool, string, string][]).map(([tool, icon, label]) => (
              <button key={tool} title={label}
                onClick={() => { if (tool === "image") { fileInputRef.current?.click(); return; } setActiveTool(tool); }}
                style={toolBtnStyle(activeTool === tool)}
              >{icon}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button title="Zoom in" onClick={() => handleZoom(1.2)} style={toolBtnStyle(false)}>+</button>
            <button title="Zoom out" onClick={() => handleZoom(1 / 1.2)} style={toolBtnStyle(false)}>−</button>
            <button title="Delete selected (Del)" onClick={deleteSelected} style={toolBtnStyle(false, "#ef4444")}>🗑</button>
          </aside>

          {/* Canvas area */}
          <main style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 24, background: "#0f172a" }}>
            <div style={{ position: "relative", boxShadow: "0 8px 40px rgba(0,0,0,0.6)", cursor: toolCursor[activeTool] }}>
              <canvas ref={canvasRef} />

              {showComments && comments.map(pin => (
                <CommentPinMarker key={pin.id} pin={pin} zoom={zoom}
                  onResolve={() => setComments(prev => prev.map(c => c.id === pin.id ? { ...c, resolved: true } : c))}
                />
              ))}

              {commentDraft && (
                <div style={{ position: "absolute", left: commentDraft.x * zoom, top: commentDraft.y * zoom, background: "#1e293b", border: "1px solid #3b82f6", borderRadius: 8, padding: 10, zIndex: 100, display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
                  <textarea autoFocus value={commentText} onChange={e => setCommentText(e.target.value)}
                    placeholder="Add a comment..." rows={3}
                    style={{ background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 4, padding: 6, fontSize: 13, resize: "none", outline: "none" }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); } if (e.key === "Escape") { setCommentDraft(null); setCommentText(""); } }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={submitComment} style={btnStyle("#3b82f6")}>Post</button>
                    <button onClick={() => { setCommentDraft(null); setCommentText(""); }} style={btnStyle("#334155")}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* Comments panel */}
          {showComments && (
            <aside style={{ width: 260, background: "#1e293b", borderLeft: "1px solid #334155", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #334155", fontFamily: "Bangers, cursive", fontSize: 16, letterSpacing: 1, color: "#10b981" }}>COMMENTS</div>
              <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {comments.length === 0 && (
                  <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 20 }}>
                    Click the 📌 tool then click on the canvas to add a comment.
                  </p>
                )}
                {comments.map(pin => (
                  <div key={pin.id} style={{ background: "#0f172a", border: `1px solid ${pin.resolved ? "#334155" : "#3b82f6"}`, borderRadius: 8, padding: 10, opacity: pin.resolved ? 0.5 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>{pin.author}</span>
                      {!pin.resolved && (
                        <button onClick={() => setComments(prev => prev.map(c => c.id === pin.id ? { ...c, resolved: true } : c))}
                          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11, padding: 0 }}>✓ Resolve</button>
                      )}
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: "#e2e8f0", lineHeight: 1.4 }}>{pin.text}</p>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>

        {/* Status bar */}
        <footer style={{ background: "#1e293b", borderTop: "1px solid #334155", padding: "4px 16px", display: "flex", gap: 16, fontSize: 11, color: "#64748b", flexShrink: 0 }}>
          <span>Tool: <strong style={{ color: "#3b82f6" }}>{activeTool}</strong></span>
          <span>Zoom: <strong style={{ color: "#10b981" }}>{Math.round(zoom * 100)}%</strong></span>
          <span>Page: <strong style={{ color: "#94a3b8" }}>8.5 × 11 in</strong></span>
          <span style={{ flex: 1 }} />
          <span>Font: <strong style={{ color: "#94a3b8", fontFamily: "Bangers, cursive" }}>Bangers</strong> (SIL OFL 1.1) + Comic Neue</span>
        </footer>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
    </>
  );
}

function CommentPinMarker({ pin, zoom, onResolve }: { pin: CommentPin; zoom: number; onResolve: () => void }) {
  const [open, setOpen] = useState(false);
  if (pin.resolved) return null;
  return (
    <div style={{ position: "absolute", left: pin.x * zoom - 10, top: pin.y * zoom - 10, zIndex: 50 }}>
      <div onClick={() => setOpen(v => !v)} style={{ width: 20, height: 20, borderRadius: "50% 50% 50% 0", background: "#3b82f6", border: "2px solid #1d4ed8", cursor: "pointer", transform: "rotate(-45deg)", boxShadow: "0 2px 8px rgba(59,130,246,0.5)" }} />
      {open && (
        <div style={{ position: "absolute", left: 24, top: 0, background: "#1e293b", border: "1px solid #3b82f6", borderRadius: 8, padding: 10, minWidth: 180, zIndex: 60 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#e2e8f0" }}>{pin.text}</p>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onResolve} style={btnStyle("#059669")}>Resolve</button>
            <button onClick={() => setOpen(false)} style={btnStyle("#334155")}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return { background: bg, border: "none", color: "#fff", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "Comic Neue, sans-serif" };
}

function toolBtnStyle(active: boolean, bg?: string): React.CSSProperties {
  return { width: 40, height: 40, borderRadius: 8, background: active ? "#1d4ed8" : (bg || "#0f172a"), border: `1px solid ${active ? "#3b82f6" : "#334155"}`, color: active ? "#fff" : "#94a3b8", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" };
}
