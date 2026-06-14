"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool = "select" | "pan" | "frame" | "text" | "balloon" | "narration" | "comment";

type FrameObj     = { id: string; kind: "frame";     x: number; y: number; w: number; h: number; imageUrl?: string };
type TextObj      = { id: string; kind: "text";      x: number; y: number; w: number; h: number; content: string; fontSize: number; textColor?: string; bgColor?: string; fontFamily?: string };
type BalloonObj   = {
  id: string; kind: "balloon";
  x: number; y: number; w: number; h: number;
  content: string;
  stemDx: number; stemDy: number;   // stem tip offset from ellipse center
  stemTargetId?: string;             // if set, stem tip snaps to edge of this balloon
  stemBend: number;                  // lateral bend of stem sides (0 = straight)
  stemOriginAng?: number;            // override angle where stem exits body (used when stemTargetId is set)
  mergedPairId?: string;             // if set, rendered as compound shape with this balloon
  textColor?: string; bgColor?: string; borderColor?: string; fontFamily?: string;
};
type NarrationObj = { id: string; kind: "narration"; x: number; y: number; w: number; h: number; content: string; fontSize: number; bgColor: string; textColor: string; borderColor?: string; fontFamily?: string };
type PageObj = FrameObj | TextObj | BalloonObj | NarrationObj;

type Page = { id: string; objects: PageObj[] };
type CommentPin = { id: string; pageId: string; x: number; y: number; text: string; resolved: boolean };
type AssetItem  = { id: string; name: string; url: string; thumb: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const STEM_DELTA_ON_TARGET = 0.13; // arc half-width on target where stem merges (slightly wider than stem base)
const STEM_CONNECT_TIP_DELTA = 0.045; // half-width of stem tip where it enters a connected balloon

const FONTS: { label: string; value: string }[] = [
  { label: "Bangers",         value: "Bangers, cursive" },
  { label: "Comic Neue",      value: "Comic Neue, sans-serif" },
  { label: "Permanent Marker",value: "Permanent Marker, cursive" },
  { label: "Caveat",          value: "Caveat, cursive" },
  { label: "Anton",           value: "Anton, sans-serif" },
  { label: "Oswald",          value: "Oswald, sans-serif" },
  { label: "Special Elite",   value: "Special Elite, cursive" },
];

const PAGE_W   = 850;
const PAGE_H   = 1100;
const PAGE_GAP = 64;
const PADDING  = 48;

// ── Main component ────────────────────────────────────────────────────────────

export default function ComicEditorClient() {
  const [pages, setPages] = useState<Page[]>([{ id: "page-1", objects: [] }]);
  const [activePageId, setActivePageId] = useState("page-1");
  const [tool, setTool] = useState<Tool>("select");
  const toolRef = useRef<Tool>("select");
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const zoomRef = useRef(0.8);
  const mainRef = useRef<HTMLDivElement>(null);

  const [assets, setAssets]         = useState<AssetItem[]>([]);
  const [rightPanel, setRightPanel] = useState<"assets" | "comments">("assets");
  const [comments, setComments]     = useState<CommentPin[]>([]);

  const fileInputRef      = useRef<HTMLInputElement>(null);
  const frameFileInputRef = useRef<HTMLInputElement>(null);
  const pendingFrameRef   = useRef<{ pageId: string; frameId: string } | null>(null);

  // Pan state
  const isPanningRef = useRef(false);
  const panStartRef  = useRef({ x: 0, y: 0, sl: 0, st: 0 });

  // ── Wheel zoom / scroll ───────────────────────────────────────────────────
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey) {
        const prev = zoomRef.current;
        const next = Math.min(4, Math.max(0.1, prev * Math.exp(-e.deltaY * 0.005)));
        zoomRef.current = next;
        setZoom(next);
      } else {
        el.scrollLeft += e.deltaX;
        el.scrollTop  += e.deltaY;
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
  }, []);

  function handleZoom(f: number) {
    setZoom(z => { const n = Math.min(4, Math.max(0.1, z * f)); zoomRef.current = n; return n; });
  }

  // ── Page helpers ──────────────────────────────────────────────────────────
  function updatePage(pageId: string, fn: (objs: PageObj[]) => PageObj[]) {
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, objects: fn(p.objects) } : p));
  }

  const addObject = useCallback((pageId: string, obj: PageObj) => {
    updatePage(pageId, objs => [...objs, obj]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateObject = useCallback((pageId: string, id: string, patch: Partial<PageObj>) => {
    updatePage(pageId, objs => objs.map(o => o.id === id ? { ...o, ...patch } as PageObj : o));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteObject = useCallback((pageId: string, id: string) => {
    updatePage(pageId, objs => objs.filter(o => o.id !== id));
    setSelectedId(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Delete key ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      if (selectedId) deleteObject(activePageId, selectedId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, activePageId, deleteObject]);

  // ── Asset bank upload ─────────────────────────────────────────────────────
  const handleAssetUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(file => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const tw = 120, th = Math.round(img.height * (120 / img.width));
        const cv = document.createElement("canvas");
        cv.width = tw; cv.height = th;
        cv.getContext("2d")!.drawImage(img, 0, 0, tw, th);
        setAssets(prev => [...prev, { id: crypto.randomUUID(), name: file.name, url, thumb: cv.toDataURL("image/jpeg", 0.7) }]);
      };
      img.src = url;
    });
    e.target.value = "";
  }, []);

  // ── Frame-specific image upload ───────────────────────────────────────────
  const handleFrameUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const pending = pendingFrameRef.current;
    if (!file || !pending) return;
    const url = URL.createObjectURL(file);
    updateObject(pending.pageId, pending.frameId, { imageUrl: url } as Partial<FrameObj>);
    e.target.value = "";
    pendingFrameRef.current = null;
  }, [updateObject]);

  function openFramePicker(pageId: string, frameId: string) {
    pendingFrameRef.current = { pageId, frameId };
    frameFileInputRef.current?.click();
  }

  // ── Pan handlers ──────────────────────────────────────────────────────────
  function onMainPointerDown(e: React.PointerEvent) {
    if (toolRef.current !== "pan") return;
    isPanningRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panStartRef.current = { x: e.clientX, y: e.clientY, sl: mainRef.current!.scrollLeft, st: mainRef.current!.scrollTop };
    e.preventDefault();
  }
  function onMainPointerMove(e: React.PointerEvent) {
    if (!isPanningRef.current) return;
    mainRef.current!.scrollLeft = panStartRef.current.sl - (e.clientX - panStartRef.current.x);
    mainRef.current!.scrollTop  = panStartRef.current.st - (e.clientY - panStartRef.current.y);
  }
  function onMainPointerUp() { isPanningRef.current = false; }

  // ── Spreads ───────────────────────────────────────────────────────────────
  function getSpreads(): Page[][] {
    if (!pages.length) return [];
    const out: Page[][] = [[pages[0]]];
    for (let i = 1; i < pages.length; i += 2) out.push(pages.slice(i, i + 2));
    return out;
  }

  const spreads   = getSpreads();
  const scaledW   = PAGE_W * zoom;
  const scaledH   = PAGE_H * zoom;
  const contentH  = spreads.length * (scaledH + PAGE_GAP) + PADDING * 2;
  const maxSpreadW = spreads.length > 0
    ? Math.max(...spreads.map(s => s.length === 1 ? scaledW : scaledW * 2 + 4))
    : scaledW;
  const contentW  = maxSpreadW + PADDING * 2;

  const activeComments = comments.filter(c => c.pageId === activePageId && !c.resolved);

  // Derive selected object for the properties panel
  const activePage = pages.find(p => p.id === activePageId);
  const selectedPageObj = activePage?.objects.find(o => o.id === selectedId) ?? null;
  const isColorable = selectedPageObj && (selectedPageObj.kind === "narration" || selectedPageObj.kind === "text" || selectedPageObj.kind === "balloon");
  const hasBorder = selectedPageObj && (selectedPageObj.kind === "narration" || selectedPageObj.kind === "balloon");
  function getObjColor(key: "bgColor" | "textColor" | "borderColor", fallback: string): string {
    if (!selectedPageObj) return fallback;
    return ((selectedPageObj as unknown) as Record<string, string>)[key] ?? fallback;
  }
  function getObjFont(): string {
    if (!selectedPageObj) return FONTS[0].value;
    return ((selectedPageObj as unknown) as Record<string, string>)["fontFamily"] ?? FONTS[0].value;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bangers&family=Comic+Neue:wght@400;700&family=Permanent+Marker&family=Caveat:wght@400;700&family=Anton&family=Oswald:wght@400;700&family=Special+Elite&display=swap" />
      <style suppressHydrationWarning>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f172a", color: "#e2e8f0", fontFamily: "Comic Neue, sans-serif" }}>

        {/* Top bar */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: "#1e293b", borderBottom: "1px solid #334155", flexShrink: 0 }}>
          <span style={{ fontFamily: "Bangers, cursive", fontSize: 22, letterSpacing: 2, color: "#3b82f6" }}>COMIC FORGE</span>
        </header>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Left toolbar */}
          <aside style={{ width: 60, background: "#1e293b", borderRight: "1px solid #334155", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 6, flexShrink: 0 }}>
            {([
              ["select",    "↖",  "Select / Move"],
              ["pan",       "✋", "Pan"],
              ["frame",     "⬜", "Draw Frame"],
              ["text",      "T",  "Text Box"],
              ["balloon",   "💬", "Speech Balloon"],
              ["narration", "▭",  "Narration / Caption Box"],
              ["comment",   "📌", "Add Comment"],
            ] as [Tool, string, string][]).map(([t, icon, label]) => (
              <button key={t} title={label} onClick={() => setTool(t)} style={toolBtnStyle(tool === t)}>{icon}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button title="Add page" onClick={() => setPages(p => [...p, { id: `page-${Date.now()}`, objects: [] }])} style={toolBtnStyle(false, "#059669")}>+📄</button>
            <button title="Zoom in"  onClick={() => handleZoom(1.2)}   style={toolBtnStyle(false)}>+</button>
            <button title="Zoom out" onClick={() => handleZoom(1/1.2)} style={toolBtnStyle(false)}>−</button>
          </aside>

          {/* Canvas scroll area */}
          <main
            ref={mainRef}
            style={{ flex: 1, overflow: "auto", background: "#0f172a", cursor: tool === "pan" ? "grab" : "default", position: "relative" }}
            onPointerDown={onMainPointerDown}
            onPointerMove={onMainPointerMove}
            onPointerUp={onMainPointerUp}
            onPointerLeave={onMainPointerUp}
          >
            <div style={{ width: contentW, height: contentH, position: "relative" }}>
              {spreads.map((spread, si) => {
                const spreadY = PADDING + si * (scaledH + PAGE_GAP);
                const spreadW = spread.length === 1 ? scaledW : scaledW * 2 + 4;
                return (
                  <div key={si} style={{ position: "absolute", top: spreadY, left: "50%", transform: "translateX(-50%)", display: "flex", gap: spread.length > 1 ? 4 : 0, width: spreadW }}>
                    {spread.map(page => (
                      <div key={page.id} style={{ width: scaledW, height: scaledH, flexShrink: 0 }} onClick={() => setActivePageId(page.id)}>
                        <PageCanvas
                          page={page}
                          isActive={page.id === activePageId}
                          zoom={zoom}
                          toolRef={toolRef}
                          selectedId={page.id === activePageId ? selectedId : null}
                          onSelect={id => { setActivePageId(page.id); setSelectedId(id); }}
                          onDeselect={() => setSelectedId(null)}
                          onAddObject={obj => addObject(page.id, obj)}
                          onUpdateObject={(id, patch) => updateObject(page.id, id, patch)}
                          onDeleteObject={id => deleteObject(page.id, id)}
                          onOpenFramePicker={frameId => openFramePicker(page.id, frameId)}
                          comments={comments.filter(c => c.pageId === page.id && !c.resolved)}
                          onCommentAdd={(x, y, text) => setComments(prev => [...prev, { id: crypto.randomUUID(), pageId: page.id, x, y, text, resolved: false }])}
                          onCommentResolve={id => setComments(prev => prev.map(c => c.id === id ? { ...c, resolved: true } : c))}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </main>

          {/* Right panel */}
          <aside style={{ width: 220, background: "#1e293b", borderLeft: "1px solid #334155", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>

            {/* Properties inspector */}
            {isColorable && (
              <div style={{ padding: "10px 12px", borderBottom: "1px solid #334155", flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#64748b", fontFamily: "Bangers, cursive", letterSpacing: 1, textTransform: "uppercase" }}>Properties</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>Background</span>
                  <input type="color" value={getObjColor("bgColor", "#ffffff")}
                    onChange={e => updateObject(activePageId, selectedPageObj!.id, { bgColor: e.target.value } as Partial<PageObj>)}
                    style={{ width: 32, height: 26, border: "1px solid #334155", borderRadius: 4, padding: 1, cursor: "pointer", background: "none" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>Text color</span>
                  <input type="color" value={getObjColor("textColor", "#0f172a")}
                    onChange={e => updateObject(activePageId, selectedPageObj!.id, { textColor: e.target.value } as Partial<PageObj>)}
                    style={{ width: 32, height: 26, border: "1px solid #334155", borderRadius: 4, padding: 1, cursor: "pointer", background: "none" }} />
                </div>
                {hasBorder && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>Border color</span>
                    <input type="color" value={getObjColor("borderColor", "#1e293b")}
                      onChange={e => updateObject(activePageId, selectedPageObj!.id, { borderColor: e.target.value } as Partial<PageObj>)}
                      style={{ width: 32, height: 26, border: "1px solid #334155", borderRadius: 4, padding: 1, cursor: "pointer", background: "none" }} />
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>Font</span>
                  <select
                    value={getObjFont()}
                    onChange={e => updateObject(activePageId, selectedPageObj!.id, { fontFamily: e.target.value } as Partial<PageObj>)}
                    style={{ background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, cursor: "pointer", width: "100%" }}
                  >
                    {FONTS.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div style={{ display: "flex", borderBottom: "1px solid #334155", flexShrink: 0 }}>
              {(["assets", "comments"] as const).map(tab => (
                <button key={tab} onClick={() => setRightPanel(tab)} style={{
                  flex: 1, padding: "8px 4px", background: "none", border: "none",
                  borderBottom: rightPanel === tab ? "2px solid #3b82f6" : "2px solid transparent",
                  color: rightPanel === tab ? "#e2e8f0" : "#64748b",
                  fontFamily: "Bangers, cursive", fontSize: 13, letterSpacing: 1, cursor: "pointer",
                  textTransform: "uppercase",
                }}>
                  {tab === "assets" ? `🖼 Assets${assets.length ? ` (${assets.length})` : ""}` : `💬 Notes${activeComments.length ? ` (${activeComments.length})` : ""}`}
                </button>
              ))}
            </div>

            {rightPanel === "assets" && (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <button onClick={() => fileInputRef.current?.click()} style={{ margin: 10, padding: 8, background: "#0f172a", border: "1px dashed #334155", borderRadius: 8, color: "#64748b", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  + Upload images
                </button>
                {assets.length === 0 && (
                  <p style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: "0 12px" }}>
                    Upload images then drag them onto a frame, or click a frame to upload directly.
                  </p>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 10px 10px" }}>
                  {assets.map(asset => (
                    <div key={asset.id} style={{ position: "relative", borderRadius: 6, overflow: "hidden", border: "1px solid #334155", background: "#0f172a" }}>
                      <img
                        src={asset.thumb} alt={asset.name} draggable
                        onDragStart={e => e.dataTransfer.setData("assetUrl", asset.url)}
                        style={{ width: "100%", display: "block", aspectRatio: "1", objectFit: "cover", cursor: "grab" }}
                      />
                      <div style={{ padding: "4px 6px", display: "flex", alignItems: "center", gap: 2 }}>
                        <span style={{ fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={asset.name}>{asset.name}</span>
                        <button onClick={() => setAssets(prev => prev.filter(a => a.id !== asset.id))} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 12, padding: "0 2px" }}>×</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rightPanel === "comments" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {activeComments.length === 0 && (
                  <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 20 }}>Click 📌 then click the page to pin a note.</p>
                )}
                {activeComments.map(pin => (
                  <div key={pin.id} style={{ background: "#0f172a", border: "1px solid #3b82f6", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>You</span>
                      <button onClick={() => setComments(prev => prev.map(c => c.id === pin.id ? { ...c, resolved: true } : c))} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11, padding: 0 }}>✓</button>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: "#e2e8f0", lineHeight: 1.4 }}>{pin.text}</p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>

        {/* Status bar */}
        <footer style={{ background: "#1e293b", borderTop: "1px solid #334155", padding: "4px 16px", display: "flex", gap: 16, fontSize: 11, color: "#64748b", flexShrink: 0 }}>
          <span>Tool: <strong style={{ color: "#3b82f6" }}>{tool}</strong></span>
          <span>Zoom: <strong style={{ color: "#10b981" }}>{Math.round(zoom * 100)}%</strong></span>
          <span>Pages: <strong style={{ color: "#94a3b8" }}>{pages.length}</strong></span>
          <span style={{ color: "#475569" }}>Draw frame → drop or click to add image</span>
        </footer>
      </div>

      <input ref={fileInputRef}      type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleAssetUpload} />
      <input ref={frameFileInputRef} type="file" accept="image/*"          style={{ display: "none" }} onChange={handleFrameUpload} />
    </>
  );
}

// ── PageCanvas ────────────────────────────────────────────────────────────────

interface PageCanvasProps {
  page: Page;
  isActive: boolean;
  zoom: number;
  toolRef: React.MutableRefObject<Tool>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onAddObject: (obj: PageObj) => void;
  onUpdateObject: (id: string, patch: Partial<PageObj>) => void;
  onDeleteObject: (id: string) => void;
  onOpenFramePicker: (frameId: string) => void;
  comments: CommentPin[];
  onCommentAdd: (x: number, y: number, text: string) => void;
  onCommentResolve: (id: string) => void;
}

type DrawPreview = { x: number; y: number; w: number; h: number };
type MoveState   = { id: string; startObjX: number; startObjY: number; startMX: number; startMY: number };
type ResizeState = { id: string; handle: string; origX: number; origY: number; origW: number; origH: number; startMX: number; startMY: number };

function PageCanvas({
  page, isActive, zoom, toolRef,
  selectedId, onSelect, onDeselect,
  onAddObject, onUpdateObject, onDeleteObject,
  onOpenFramePicker, comments, onCommentAdd, onCommentResolve,
}: PageCanvasProps) {
  const pageRef    = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing]         = useState<DrawPreview | null>(null);
  const drawStartRef  = useRef<{ x: number; y: number } | null>(null);
  const moveStateRef  = useRef<MoveState | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText]   = useState("");
  const [pendingStemId, setPendingStemId] = useState<string | null>(null);
  const [stemPreviewTip, setStemPreviewTip] = useState<{ x: number; y: number } | null>(null);
  const stemDragRef = useRef<{ id: string; scx: number; scy: number } | null>(null);
  const stemBendDragRef = useRef<{ id: string; ang: number; origBend: number; startMX: number; startMY: number } | null>(null);
  const stemOriginDragRef = useRef<{ id: string; cx: number; cy: number } | null>(null);
  const [shiftSelectedId, setShiftSelectedId] = useState<string | null>(null);

  function pagePoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = pageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  function hitTest(px: number, py: number): PageObj | null {
    for (let i = page.objects.length - 1; i >= 0; i--) {
      const o = page.objects[i];
      if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) return o;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "BUTTON" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

    const t = toolRef.current;
    if (t === "pan") return;

    const p = pagePoint(e);

    // Phase 2: place stem tip after drawing balloon
    if (pendingStemId) {
      const src = page.objects.find(o => o.id === pendingStemId) as BalloonObj | undefined;
      if (src) {
        const scx = src.x + src.w / 2, scy = src.y + src.h / 2;
        const targetBalloon = page.objects.find(o =>
          o.kind === "balloon" && o.id !== pendingStemId &&
          p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h
        ) as BalloonObj | undefined;
        if (targetBalloon) {
          onUpdateObject(pendingStemId, { stemDx: 0, stemDy: 0, stemTargetId: targetBalloon.id } as Partial<BalloonObj>);
        } else {
          onUpdateObject(pendingStemId, { stemDx: p.x - scx, stemDy: p.y - scy } as Partial<BalloonObj>);
        }
      }
      setPendingStemId(null);
      setStemPreviewTip(null);
      return;
    }

    if (t === "comment") {
      setCommentDraft(p);
      return;
    }

    if (t === "select") {
      const hit = hitTest(p.x, p.y);
      if (hit) {
        if (e.shiftKey && selectedId && selectedId !== hit.id) {
          // Shift+click: set second selection for merge
          setShiftSelectedId(hit.id);
        } else {
          onSelect(hit.id);
          setShiftSelectedId(null);
          moveStateRef.current = { id: hit.id, startObjX: hit.x, startObjY: hit.y, startMX: p.x, startMY: p.y };
          pageRef.current!.setPointerCapture(e.pointerId);
        }
      } else {
        onDeselect();
        setShiftSelectedId(null);
        setEditingId(null);
      }
      return;
    }

    // Drawing tools
    drawStartRef.current = p;
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
    pageRef.current!.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = pagePoint(e);

    if (pendingStemId) {
      setStemPreviewTip(p);
      return;
    }

    if (stemDragRef.current) {
      const { id, scx, scy } = stemDragRef.current;
      const target = page.objects.find(o =>
        o.kind === "balloon" && o.id !== id &&
        p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h
      ) as BalloonObj | undefined;
      if (target) {
        onUpdateObject(id, { stemDx: 0, stemDy: 0, stemTargetId: target.id } as Partial<BalloonObj>);
      } else {
        onUpdateObject(id, { stemDx: p.x - scx, stemDy: p.y - scy, stemTargetId: undefined } as Partial<BalloonObj>);
      }
      return;
    }

    if (stemBendDragRef.current) {
      const { id, ang, origBend, startMX, startMY } = stemBendDragRef.current;
      const dx = p.x - startMX, dy = p.y - startMY;
      const perpX = Math.cos(ang + Math.PI / 2), perpY = Math.sin(ang + Math.PI / 2);
      onUpdateObject(id, { stemBend: origBend + dx * perpX + dy * perpY } as Partial<BalloonObj>);
      return;
    }

    if (stemOriginDragRef.current) {
      const { id, cx, cy } = stemOriginDragRef.current;
      onUpdateObject(id, { stemOriginAng: Math.atan2(p.y - cy, p.x - cx) } as Partial<BalloonObj>);
      return;
    }

    if (moveStateRef.current) {
      const { id, startObjX, startObjY, startMX, startMY } = moveStateRef.current;
      onUpdateObject(id, { x: startObjX + p.x - startMX, y: startObjY + p.y - startMY } as Partial<PageObj>);
      return;
    }

    if (resizeStateRef.current) {
      const { id, handle, origX, origY, origW, origH, startMX, startMY } = resizeStateRef.current;
      const dx = p.x - startMX, dy = p.y - startMY;
      let { x, y, w, h } = { x: origX, y: origY, w: origW, h: origH };
      if (handle.includes("e")) w = Math.max(20, origW + dx);
      if (handle.includes("s")) h = Math.max(20, origH + dy);
      if (handle.includes("w")) { x = origX + dx; w = Math.max(20, origW - dx); }
      if (handle.includes("n")) { y = origY + dy; h = Math.max(20, origH - dy); }
      onUpdateObject(id, { x, y, w, h } as Partial<PageObj>);
      return;
    }

    if (drawStartRef.current) {
      const dx = p.x - drawStartRef.current.x;
      const dy = p.y - drawStartRef.current.y;
      setDrawing({
        x: dx < 0 ? p.x : drawStartRef.current.x,
        y: dy < 0 ? p.y : drawStartRef.current.y,
        w: Math.abs(dx), h: Math.abs(dy),
      });
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && pendingStemId) {
        setPendingStemId(null);
        setStemPreviewTip(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingStemId]);

  function startStemDrag(balloonId: string, e: React.PointerEvent) {
    e.stopPropagation();
    const obj = page.objects.find(o => o.id === balloonId) as BalloonObj | undefined;
    if (!obj) return;
    stemDragRef.current = { id: balloonId, scx: obj.x + obj.w / 2, scy: obj.y + obj.h / 2 };
    pageRef.current!.setPointerCapture(e.pointerId);
  }

  function startStemBendDrag(balloonId: string, ang: number, e: React.PointerEvent) {
    e.stopPropagation();
    const obj = page.objects.find(o => o.id === balloonId) as BalloonObj | undefined;
    if (!obj) return;
    const p = pagePoint(e);
    stemBendDragRef.current = { id: balloonId, ang, origBend: obj.stemBend, startMX: p.x, startMY: p.y };
    pageRef.current!.setPointerCapture(e.pointerId);
  }

  function startStemOriginDrag(balloonId: string, e: React.PointerEvent) {
    e.stopPropagation();
    const obj = page.objects.find(o => o.id === balloonId) as BalloonObj | undefined;
    if (!obj) return;
    stemOriginDragRef.current = { id: balloonId, cx: obj.x + obj.w / 2, cy: obj.y + obj.h / 2 };
    pageRef.current!.setPointerCapture(e.pointerId);
  }

  function onPointerUp(e: React.PointerEvent) {
    stemDragRef.current = null;
    stemBendDragRef.current = null;
    stemOriginDragRef.current = null;
    moveStateRef.current = null;
    resizeStateRef.current = null;

    if (drawStartRef.current && drawing) {
      const t = toolRef.current;
      if (drawing.w > 15 && drawing.h > 15) {
        const id = crypto.randomUUID();
        if (t === "frame") {
          onAddObject({ id, kind: "frame", ...drawing });
          onSelect(id);
        } else if (t === "text") {
          onAddObject({ id, kind: "text", ...drawing, content: "Type here…", fontSize: 16 });
          onSelect(id);
          setEditingId(id);
        } else if (t === "balloon") {
          const stemDy = drawing.h / 2 + 40;
          onAddObject({ id, kind: "balloon", ...drawing, content: "…", stemDx: 0, stemDy, stemBend: 0 });
          onSelect(id);
          setPendingStemId(id);
          setStemPreviewTip({ x: drawing.x + drawing.w / 2, y: drawing.y + drawing.h / 2 + stemDy });
        } else if (t === "narration") {
          onAddObject({ id, kind: "narration", ...drawing, content: "Narrator text…", fontSize: 14, bgColor: "#fef9c3", textColor: "#1e293b" });
          onSelect(id);
          setEditingId(id);
        }
      }
      drawStartRef.current = null;
      setDrawing(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const url = e.dataTransfer.getData("assetUrl");
    if (!url) return;
    const rect = pageRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left) / zoom;
    const py = (e.clientY - rect.top)  / zoom;
    const frame = page.objects.find(
      o => o.kind === "frame" && px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h
    ) as FrameObj | undefined;
    if (frame) {
      onUpdateObject(frame.id, { imageUrl: url } as Partial<FrameObj>);
    } else {
      // Create a new frame at the drop point filled with the image
      const id = crypto.randomUUID();
      onAddObject({ id, kind: "frame", x: px - 100, y: py - 75, w: 200, h: 150, imageUrl: url });
      onSelect(id);
    }
  }

  function startResize(id: string, handle: string, e: React.PointerEvent) {
    e.stopPropagation();
    const obj = page.objects.find(o => o.id === id);
    if (!obj) return;
    const p = pagePoint(e);
    resizeStateRef.current = { id, handle, origX: obj.x, origY: obj.y, origW: obj.w, origH: obj.h, startMX: p.x, startMY: p.y };
    pageRef.current!.setPointerCapture(e.pointerId);
  }

  const selectedObj = selectedId ? page.objects.find(o => o.id === selectedId) : null;

  const drawCursor: Record<Tool, string> = {
    select: "default", pan: "grab",
    frame: "crosshair", text: "crosshair", balloon: "crosshair", narration: "crosshair", comment: "cell",
  };

  function submitComment() {
    if (!commentDraft || !commentText.trim()) return;
    onCommentAdd(commentDraft.x, commentDraft.y, commentText.trim());
    setCommentDraft(null);
    setCommentText("");
  }

  return (
    // Outer shell — allocates scaled space, clips the page
    <div style={{ width: PAGE_W * zoom, height: PAGE_H * zoom, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.6)", outline: isActive ? "2px solid #3b82f6" : "2px solid #334155", outlineOffset: 2, position: "relative" }}>
      {/* Page div — PAGE_W × PAGE_H, scaled with CSS */}
      <div
        ref={pageRef}
        style={{
          width: PAGE_W, height: PAGE_H,
          position: "absolute", top: 0, left: 0,
          transform: `scale(${zoom})`, transformOrigin: "top left",
          background: "#ffffff",
          cursor: drawCursor[toolRef.current] ?? "default",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
      >
        {/* Objects — balloon sources render after their targets so fill covers correctly */}
        {(() => {
          const allBalloons = page.objects.filter(o => o.kind === "balloon") as BalloonObj[];
          const sorted = [...page.objects].sort((a, b) => {
            if (a.kind === "balloon" && b.kind === "balloon") {
              if ((a as BalloonObj).stemTargetId === b.id) return 1;
              if ((b as BalloonObj).stemTargetId === a.id) return -1;
            }
            return 0;
          });
          // Track balloons already rendered as compound partner (skip them)
          const renderedAsPartner = new Set<string>();
          return sorted.map(obj => {
            if (renderedAsPartner.has(obj.id)) return null;
            const isSel = obj.id === selectedId;
            if (obj.kind === "frame") return (
              <FrameRenderer key={obj.id} frame={obj} isSelected={isSel} onOpenPicker={() => onOpenFramePicker(obj.id)} />
            );
            if (obj.kind === "text") return (
              <TextRenderer key={obj.id} obj={obj} isSelected={isSel} isEditing={editingId === obj.id}
                onDoubleClick={() => setEditingId(obj.id)}
                onContentChange={content => onUpdateObject(obj.id, { content } as Partial<TextObj>)}
                onBlur={() => setEditingId(null)} />
            );
            if (obj.kind === "narration") return (
              <NarrationRenderer key={obj.id} obj={obj} isSelected={isSel} isEditing={editingId === obj.id}
                onDoubleClick={() => setEditingId(obj.id)}
                onContentChange={content => onUpdateObject(obj.id, { content } as Partial<NarrationObj>)}
                onBlur={() => setEditingId(null)} />
            );
            if (obj.kind === "balloon") {
              const balloon = obj as BalloonObj;
              const incomingConnections = allBalloons.filter(b => b.stemTargetId === obj.id);
              // Find merged partner (if any), mark partner as rendered
              let mergedPartner: BalloonObj | undefined;
              if (balloon.mergedPairId) {
                mergedPartner = allBalloons.find(b => b.id === balloon.mergedPairId && b.mergedPairId === balloon.id);
                if (mergedPartner) renderedAsPartner.add(mergedPartner.id);
              }
              return (
                <BalloonRenderer key={obj.id} obj={balloon} allBalloons={allBalloons} isSelected={isSel} isEditing={editingId === obj.id}
                  incomingConnections={incomingConnections}
                  mergedPartner={mergedPartner}
                  mergedPartnerEditing={mergedPartner ? editingId === mergedPartner.id : false}
                  onDoubleClick={() => setEditingId(obj.id)}
                  onPartnerDoubleClick={() => mergedPartner && setEditingId(mergedPartner.id)}
                  onContentChange={content => onUpdateObject(obj.id, { content } as Partial<BalloonObj>)}
                  onPartnerContentChange={content => mergedPartner && onUpdateObject(mergedPartner.id, { content } as Partial<BalloonObj>)}
                  onBlur={() => setEditingId(null)}
                  onStemDragStart={e => startStemDrag(obj.id, e)}
                  onStemBendDragStart={(ang, e) => startStemBendDrag(obj.id, ang, e)}
                  onStemOriginDragStart={e => startStemOriginDrag(obj.id, e)} />
              );
            }
            return null;
          });
        })()}

        {/* Draw preview */}
        {drawing && drawing.w > 2 && drawing.h > 2 && (
          toolRef.current === "balloon" ? (
            <svg style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: PAGE_H, pointerEvents: "none", overflow: "visible" }}>
              <ellipse cx={drawing.x + drawing.w / 2} cy={drawing.y + drawing.h / 2} rx={drawing.w / 2} ry={drawing.h / 2}
                fill="rgba(59,130,246,0.06)" stroke="#3b82f6" strokeWidth={2} strokeDasharray="6,3" />
            </svg>
          ) : (
            <div style={{ position: "absolute", left: drawing.x, top: drawing.y, width: drawing.w, height: drawing.h, border: "2px dashed #3b82f6", background: "rgba(59,130,246,0.06)", pointerEvents: "none" }} />
          )
        )}

        {/* Stem placement preview */}
        {pendingStemId && stemPreviewTip && (() => {
          const src = page.objects.find(o => o.id === pendingStemId) as BalloonObj | undefined;
          if (!src) return null;
          const scx = src.x + src.w / 2, scy = src.y + src.h / 2;
          const ang = Math.atan2(stemPreviewTip.y - scy, stemPreviewTip.x - scx);
          const ex = scx + (src.w / 2) * Math.cos(ang), ey = scy + (src.h / 2) * Math.sin(ang);
          const isOverBalloon = page.objects.some(o =>
            o.kind === "balloon" && o.id !== pendingStemId &&
            stemPreviewTip.x >= o.x && stemPreviewTip.x <= o.x + o.w &&
            stemPreviewTip.y >= o.y && stemPreviewTip.y <= o.y + o.h
          );
          return (
            <svg style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: PAGE_H, pointerEvents: "none", overflow: "visible", zIndex: 90 }}>
              <line x1={ex} y1={ey} x2={stemPreviewTip.x} y2={stemPreviewTip.y} stroke="#3b82f6" strokeWidth={2} strokeDasharray="5,3" />
              <circle cx={stemPreviewTip.x} cy={stemPreviewTip.y} r={5} fill={isOverBalloon ? "#10b981" : "#3b82f6"} />
            </svg>
          );
        })()}

        {/* Stem placement hint */}
        {pendingStemId && (
          <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", background: "#1d4ed8", color: "#fff", fontSize: 12, padding: "4px 12px", borderRadius: 20, pointerEvents: "none", zIndex: 100, whiteSpace: "nowrap", fontFamily: "Comic Neue, sans-serif" }}>
            Click to place stem tip — click another bubble to connect
          </div>
        )}

        {/* Selection handles */}
        {selectedObj && (
          <SelectionHandles obj={selectedObj} onStartResize={(handle, e) => startResize(selectedObj.id, handle, e)} />
        )}

        {/* Merge / unmerge controls */}
        {(() => {
          const selBalloon = selectedId ? page.objects.find(o => o.id === selectedId && o.kind === "balloon") as BalloonObj | undefined : undefined;
          const shiftBalloon = shiftSelectedId ? page.objects.find(o => o.id === shiftSelectedId && o.kind === "balloon") as BalloonObj | undefined : undefined;

          // Two balloons shift-selected → offer merge
          if (selBalloon && shiftBalloon) {
            const midX = (selBalloon.x + selBalloon.w / 2 + shiftBalloon.x + shiftBalloon.w / 2) / 2;
            const midY = Math.min(selBalloon.y, shiftBalloon.y) - 36;
            const alreadyMerged = selBalloon.mergedPairId === shiftBalloon.id;
            return (
              <div style={{ position: "absolute", left: midX - 44, top: midY, zIndex: 200, display: "flex", gap: 6 }}>
                {alreadyMerged ? (
                  <button
                    style={btnStyle("#ef4444")}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      onUpdateObject(selBalloon.id, { mergedPairId: undefined } as Partial<BalloonObj>);
                      onUpdateObject(shiftBalloon.id, { mergedPairId: undefined } as Partial<BalloonObj>);
                      setShiftSelectedId(null);
                    }}
                  >⊘ Unmerge</button>
                ) : (
                  <button
                    style={btnStyle("#7c3aed")}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      onUpdateObject(selBalloon.id, { mergedPairId: shiftBalloon.id } as Partial<BalloonObj>);
                      onUpdateObject(shiftBalloon.id, { mergedPairId: selBalloon.id } as Partial<BalloonObj>);
                      setShiftSelectedId(null);
                    }}
                  >⊕ Merge</button>
                )}
              </div>
            );
          }

          // Single merged balloon selected → offer unmerge
          if (selBalloon?.mergedPairId && !shiftBalloon) {
            return (
              <div style={{ position: "absolute", left: selBalloon.x + selBalloon.w / 2 - 44, top: selBalloon.y - 36, zIndex: 200 }}>
                <button
                  style={btnStyle("#ef4444")}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation();
                    const partnerId = selBalloon.mergedPairId!;
                    onUpdateObject(selBalloon.id, { mergedPairId: undefined } as Partial<BalloonObj>);
                    onUpdateObject(partnerId, { mergedPairId: undefined } as Partial<BalloonObj>);
                  }}
                >⊘ Unmerge</button>
              </div>
            );
          }

          return null;
        })()}

        {/* Comment pins */}
        {comments.map(pin => (
          <CommentPin key={pin.id} pin={pin} onResolve={() => onCommentResolve(pin.id)} />
        ))}

        {/* Comment draft */}
        {commentDraft && (
          <div style={{ position: "absolute", left: commentDraft.x, top: commentDraft.y, background: "#1e293b", border: "1px solid #3b82f6", borderRadius: 8, padding: 10, zIndex: 200, display: "flex", flexDirection: "column", gap: 6, minWidth: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
            <textarea
              autoFocus value={commentText} onChange={e => setCommentText(e.target.value)} rows={3}
              placeholder="Add a note…"
              style={{ background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 4, padding: 6, fontSize: 13, resize: "none", outline: "none" }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); }
                if (e.key === "Escape") { setCommentDraft(null); setCommentText(""); }
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={submitComment} style={btnStyle("#3b82f6")}>Post</button>
              <button onClick={() => { setCommentDraft(null); setCommentText(""); }} style={btnStyle("#334155")}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FrameRenderer ─────────────────────────────────────────────────────────────

function FrameRenderer({ frame, isSelected, onOpenPicker }: { frame: FrameObj; isSelected: boolean; onOpenPicker: () => void }) {
  return (
    <div
      style={{
        position: "absolute", left: frame.x, top: frame.y, width: frame.w, height: frame.h,
        border: `3px solid ${isSelected ? "#3b82f6" : "#1e293b"}`,
        overflow: "hidden", background: frame.imageUrl ? "transparent" : "#f8fafc",
      }}
    >
      {frame.imageUrl ? (
        <img src={frame.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onOpenPicker(); }}
          style={{
            width: "100%", height: "100%", background: "none", border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
            color: "#94a3b8",
          }}
        >
          <span style={{ fontSize: Math.min(frame.w, frame.h) * 0.18, lineHeight: 1 }}>+</span>
          {frame.h > 60 && <span style={{ fontSize: Math.min(12, frame.h * 0.1), fontFamily: "Comic Neue, sans-serif" }}>click or drop image</span>}
        </button>
      )}
    </div>
  );
}

// ── TextRenderer ──────────────────────────────────────────────────────────────

function TextRenderer({ obj, isSelected, isEditing, onDoubleClick, onContentChange, onBlur }: {
  obj: TextObj; isSelected: boolean; isEditing: boolean;
  onDoubleClick: () => void; onContentChange: (c: string) => void; onBlur: () => void;
}) {
  const textColor = obj.textColor ?? "#0f172a";
  const font = obj.fontFamily ?? "Bangers, cursive";
  return (
    <div
      style={{ position: "absolute", left: obj.x, top: obj.y, width: obj.w, minHeight: obj.h, border: isSelected ? "1.5px solid #3b82f6" : "1.5px dashed #94a3b8", padding: 6, background: obj.bgColor ?? "transparent" }}
      onDoubleClick={onDoubleClick}
    >
      {isEditing ? (
        <textarea
          autoFocus value={obj.content} onChange={e => onContentChange(e.target.value)} onBlur={onBlur}
          style={{
            width: "100%", minHeight: obj.h - 12, border: "none", outline: "none", resize: "none",
            background: "transparent", fontFamily: font, fontSize: obj.fontSize, color: textColor, lineHeight: 1.3,
          }}
        />
      ) : (
        <div style={{ fontFamily: font, fontSize: obj.fontSize, color: textColor, lineHeight: 1.3, whiteSpace: "pre-wrap", pointerEvents: "none" }}>
          {obj.content}
        </div>
      )}
    </div>
  );
}

// ── NarrationRenderer ─────────────────────────────────────────────────────────

function NarrationRenderer({ obj, isSelected, isEditing, onDoubleClick, onContentChange, onBlur }: {
  obj: NarrationObj; isSelected: boolean; isEditing: boolean;
  onDoubleClick: () => void; onContentChange: (c: string) => void; onBlur: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute", left: obj.x, top: obj.y, width: obj.w, minHeight: obj.h,
        border: `2px solid ${obj.borderColor ?? obj.textColor}`,
        background: obj.bgColor, padding: "5px 8px",
      }}
      onDoubleClick={onDoubleClick}
    >
      {(() => { const font = obj.fontFamily ?? "Bangers, cursive"; return isEditing ? (
        <textarea autoFocus value={obj.content} onChange={e => onContentChange(e.target.value)} onBlur={onBlur}
          style={{ width: "100%", minHeight: obj.h - 10, border: "none", outline: "none", resize: "none", background: "transparent", fontFamily: font, fontSize: obj.fontSize, color: obj.textColor, lineHeight: 1.35 }}
        />
      ) : (
        <div style={{ fontFamily: font, fontSize: obj.fontSize, color: obj.textColor, lineHeight: 1.35, whiteSpace: "pre-wrap", pointerEvents: "none" }}>
          {obj.content}
        </div>
      ); })()}
    </div>
  );
}

// ── BalloonRenderer ───────────────────────────────────────────────────────────

function BalloonRenderer({ obj, allBalloons, isSelected, isEditing, incomingConnections, mergedPartner, mergedPartnerEditing, onDoubleClick, onPartnerDoubleClick, onContentChange, onPartnerContentChange, onBlur, onStemDragStart, onStemBendDragStart, onStemOriginDragStart }: {
  obj: BalloonObj; allBalloons: BalloonObj[]; isSelected: boolean; isEditing: boolean;
  incomingConnections: BalloonObj[];
  mergedPartner?: BalloonObj; mergedPartnerEditing: boolean;
  onDoubleClick: () => void; onPartnerDoubleClick: () => void;
  onContentChange: (c: string) => void; onPartnerContentChange: (c: string) => void; onBlur: () => void;
  onStemDragStart: (e: React.PointerEvent) => void;
  onStemBendDragStart: (ang: number, e: React.PointerEvent) => void;
  onStemOriginDragStart: (e: React.PointerEvent) => void;
}) {
  const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
  const rx = obj.w / 2, ry = obj.h / 2;
  const bubbleFill = obj.bgColor ?? "#ffffff";
  const textColor  = obj.textColor ?? "#0f172a";
  const font       = obj.fontFamily ?? "Bangers, cursive";

  // Resolve stem tip & connected target
  let tipX = cx + obj.stemDx, tipY = cy + obj.stemDy;
  let connectedTarget: BalloonObj | null = null;

  let stemEntryAng = 0, stemEntryTcx = 0, stemEntryTcy = 0, stemEntryTRx = 0, stemEntryTRy = 0;
  if (obj.stemTargetId) {
    const target = allBalloons.find(b => b.id === obj.stemTargetId);
    if (target) {
      connectedTarget = target;
      const tcx = target.x + target.w / 2, tcy = target.y + target.h / 2;
      const toAng = Math.atan2(cy - tcy, cx - tcx); // angle from A's center toward B
      // Center of the entry opening on A's surface
      tipX = tcx + (target.w / 2) * Math.cos(toAng);
      tipY = tcy + (target.h / 2) * Math.sin(toAng);
      stemEntryAng = toAng;
      stemEntryTcx = tcx; stemEntryTcy = tcy;
      stemEntryTRx = target.w / 2; stemEntryTRy = target.h / 2;
    }
  }

  if ((tipX - cx) ** 2 + (tipY - cy) ** 2 < 4) { tipX = cx; tipY = cy + ry + 40; }

  const stemAng = Math.atan2(tipY - cy, tipX - cx);
  // For connected balloons, allow independent control of where the stem exits the body
  const stemBaseAng = (connectedTarget && obj.stemOriginAng !== undefined) ? obj.stemOriginAng : stemAng;
  const delta = 0.10;
  const b1x = cx + rx * Math.cos(stemBaseAng + delta), b1y = cy + ry * Math.sin(stemBaseAng + delta);
  const b2x = cx + rx * Math.cos(stemBaseAng - delta), b2y = cy + ry * Math.sin(stemBaseAng - delta);

  // Perpendicular to the direction from origin midpoint toward tip
  const stemMidX = (b1x + b2x) / 2, stemMidY = (b1y + b2y) / 2;
  const stemDirAng = Math.atan2(tipY - stemMidY, tipX - stemMidX);
  const perpX = Math.cos(stemDirAng + Math.PI / 2), perpY = Math.sin(stemDirAng + Math.PI / 2);
  const bend = obj.stemBend;

  // Build main arc (32 polyline segments) — gap at stemBaseAng
  const N = 32;
  const arcSpan = 2 * Math.PI - 2 * delta;
  const startAng = stemBaseAng + delta;
  const arcPts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const a = startAng + (i / N) * arcSpan;
    arcPts.push((i === 0 ? `M ` : `L `) + `${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`);
  }
  const arcOnlyD = arcPts.join(" "); // arc from b1 to b2, no stem

  // Two edge points on A's surface for the connected opening (same angular width as stem base)
  let stemConnTipRx = 0, stemConnTipRy = 0, stemConnTipLx = 0, stemConnTipLy = 0;
  if (connectedTarget) {
    stemConnTipRx = stemEntryTcx + stemEntryTRx * Math.cos(stemEntryAng + STEM_CONNECT_TIP_DELTA);
    stemConnTipRy = stemEntryTcy + stemEntryTRy * Math.sin(stemEntryAng + STEM_CONNECT_TIP_DELTA);
    stemConnTipLx = stemEntryTcx + stemEntryTRx * Math.cos(stemEntryAng - STEM_CONNECT_TIP_DELTA);
    stemConnTipLy = stemEntryTcy + stemEntryTRy * Math.sin(stemEntryAng - STEM_CONNECT_TIP_DELTA);
  }

  // Bezier control points — for connected, aim at the two opening edges; for normal, aim at single tip
  const cp1x = connectedTarget
    ? (b2x + stemConnTipRx) / 2 + bend * perpX
    : (b2x + tipX) / 2 + bend * perpX;
  const cp1y = connectedTarget
    ? (b2y + stemConnTipRy) / 2 + bend * perpY
    : (b2y + tipY) / 2 + bend * perpY;
  const cp2x = connectedTarget
    ? (stemConnTipLx + b1x) / 2 + bend * perpX
    : (tipX + b1x) / 2 + bend * perpX;
  const cp2y = connectedTarget
    ? (stemConnTipLy + b1y) / 2 + bend * perpY
    : (tipY + b1y) / 2 + bend * perpY;
  const bhx = (cp1x + cp2x) / 2, bhy = (cp1y + cp2y) / 2;

  // Normal (non-connected) full path with stem
  const pts = [...arcPts];
  pts.push(`Q ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)}`);
  pts.push(`Q ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)}`);
  pts.push("Z");
  const pathD = pts.join(" ");
  const stroke = obj.borderColor ?? "#1e293b";

  // ── Compound (merged pair) rendering ─────────────────────────────────────
  if (mergedPartner) {
    const Bcx = mergedPartner.x + mergedPartner.w / 2, Bcy = mergedPartner.y + mergedPartner.h / 2;
    const Brx = mergedPartner.w / 2, Bry = mergedPartner.h / 2;

    const insideB = (px: number, py: number) => ((px - Bcx) / Brx) ** 2 + ((py - Bcy) / Bry) ** 2 < 1;
    const insideA = (px: number, py: number) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1;

    // Binary-search for the precise angle where arc crosses the ellipse boundary.
    function findCrossing(
      loAng: number, hiAng: number,
      ecx: number, ecy: number, erx: number, ery: number,
      inside: (px: number, py: number) => boolean,
      wantInside: boolean
    ): number {
      for (let k = 0; k < 10; k++) {
        const mid = (loAng + hiAng) / 2;
        const mpx = ecx + erx * Math.cos(mid), mpy = ecy + ery * Math.sin(mid);
        if (inside(mpx, mpy) === wantInside) hiAng = mid; else loAng = mid;
      }
      return (loAng + hiAng) / 2;
    }

    // Exterior arc of A: walk the stem-gap arc, skip points inside B; snap to exact crossing
    const NE = 128;
    const extA: string[] = [];
    let penA = false;
    for (let i = 0; i <= NE; i++) {
      const a = startAng + (i / NE) * arcSpan;
      const px = cx + rx * Math.cos(a), py = cy + ry * Math.sin(a);
      const inside = insideB(px, py);
      if (!inside) {
        if (!penA && i > 0) {
          // entering visible zone — find exact crossing and start there
          const prevA = startAng + ((i - 1) / NE) * arcSpan;
          const ca = findCrossing(prevA, a, cx, cy, rx, ry, insideB, false);
          extA.push(`M ${(cx + rx * Math.cos(ca)).toFixed(2)},${(cy + ry * Math.sin(ca)).toFixed(2)}`);
        }
        extA.push(`${penA ? "L" : "M"} ${px.toFixed(2)},${py.toFixed(2)}`);
        penA = true;
      } else {
        if (penA && i > 0) {
          // leaving visible zone — snap to exact crossing
          const prevA = startAng + ((i - 1) / NE) * arcSpan;
          const ca = findCrossing(prevA, a, cx, cy, rx, ry, insideB, true);
          extA.push(`L ${(cx + rx * Math.cos(ca)).toFixed(2)},${(cy + ry * Math.sin(ca)).toFixed(2)}`);
        }
        penA = false;
      }
    }

    // Exterior arc of B: full 2π, skip points inside A; snap to exact crossing
    const extB: string[] = [];
    let penB = false;
    for (let i = 0; i <= NE; i++) {
      const a = (i / NE) * 2 * Math.PI;
      const px = Bcx + Brx * Math.cos(a), py = Bcy + Bry * Math.sin(a);
      const inside = insideA(px, py);
      if (!inside) {
        if (!penB && i > 0) {
          const prevA = ((i - 1) / NE) * 2 * Math.PI;
          const ca = findCrossing(prevA, a, Bcx, Bcy, Brx, Bry, insideA, false);
          extB.push(`M ${(Bcx + Brx * Math.cos(ca)).toFixed(2)},${(Bcy + Bry * Math.sin(ca)).toFixed(2)}`);
        }
        extB.push(`${penB ? "L" : "M"} ${px.toFixed(2)},${py.toFixed(2)}`);
        penB = true;
      } else {
        if (penB && i > 0) {
          const prevA = ((i - 1) / NE) * 2 * Math.PI;
          const ca = findCrossing(prevA, a, Bcx, Bcy, Brx, Bry, insideA, true);
          extB.push(`L ${(Bcx + Brx * Math.cos(ca)).toFixed(2)},${(Bcy + Bry * Math.sin(ca)).toFixed(2)}`);
        }
        penB = false;
      }
    }

    // Stem: closed fill (white wedge) + open stroke sides
    const stemFillD = `M ${b2x.toFixed(2)},${b2y.toFixed(2)} Q ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)} Q ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)} Z`;
    const stemStrokeD = `M ${b2x.toFixed(2)},${b2y.toFixed(2)} Q ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)} Q ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)}`;

    const renderText = (b: BalloonObj, bCx: number, bCy: number, bRx: number, bRy: number,
      editing: boolean, dblClick: () => void, change: (c: string) => void) => (
      <div key={b.id}
        style={{ position: "absolute", left: bCx - bRx + 12, top: bCy - bRy + 10, width: b.w - 24, height: b.h - 20, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: editing ? "auto" : "none" }}
        onDoubleClick={dblClick}
      >
        {editing ? (
          <textarea autoFocus value={b.content} onChange={e => change(e.target.value)} onBlur={onBlur}
            style={{ width: "100%", height: "100%", border: "none", outline: "none", resize: "none", background: "transparent", fontFamily: font, fontSize: 16, color: textColor, textAlign: "center", lineHeight: 1.3 }} />
        ) : (
          <div style={{ fontFamily: font, fontSize: 16, color: textColor, textAlign: "center", lineHeight: 1.3, whiteSpace: "pre-wrap" }}>{b.content}</div>
        )}
      </div>
    );

    return (
      <>
        <svg style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: PAGE_H, overflow: "visible", pointerEvents: "none" }}>
          {/* Fill both ellipses (no stroke) */}
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={bubbleFill} stroke="none" />
          <ellipse cx={Bcx} cy={Bcy} rx={Brx} ry={Bry} fill={bubbleFill} stroke="none" />
          {/* Stem fill */}
          <path d={stemFillD} fill={bubbleFill} stroke="none" />
          {/* Exterior arcs only */}
          <path d={extA.join(" ")} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={extB.join(" ")} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {/* Stem sides */}
          <path d={stemStrokeD} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {isSelected && (
            <>
              <circle cx={tipX} cy={tipY} r={6} fill="#3b82f6" stroke="white" strokeWidth={2}
                style={{ cursor: "crosshair", pointerEvents: "all" }}
                onPointerDown={e => { e.stopPropagation(); onStemDragStart(e); }} />
              <circle cx={bhx} cy={bhy} r={5} fill="#10b981" stroke="white" strokeWidth={2}
                style={{ cursor: "move", pointerEvents: "all" }}
                onPointerDown={e => { e.stopPropagation(); onStemBendDragStart(stemAng, e); }} />
            </>
          )}
        </svg>
        {renderText(obj, cx, cy, rx, ry, isEditing, onDoubleClick, onContentChange)}
        {renderText(mergedPartner, Bcx, Bcy, Brx, Bry, mergedPartnerEditing, onPartnerDoubleClick, onPartnerContentChange)}
      </>
    );
  }

  // ── Standard (non-merged) rendering ──────────────────────────────────────
  return (
    <>
      <svg style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: PAGE_H, overflow: "visible", pointerEvents: "none" }}>
        {connectedTarget ? (
          // B: body arc (stroked) + stem fill-only + two curved side strokes — never stroke A's surface
          <>
            {/* B's body arc with gap where stem exits */}
            <path d={arcOnlyD} fill={bubbleFill} stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" />
            {/* Stem fill — covers the whole stem area without stroking A's edge */}
            <path
              d={`M ${b2x.toFixed(2)},${b2y.toFixed(2)} Q ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${stemConnTipRx.toFixed(2)},${stemConnTipRy.toFixed(2)} L ${stemConnTipLx.toFixed(2)},${stemConnTipLy.toFixed(2)} Q ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)} Z`}
              fill={bubbleFill} stroke="none"
            />
            {/* Two curved stem sides — stroked, not crossing A's surface */}
            <path
              d={`M ${b2x.toFixed(2)},${b2y.toFixed(2)} Q ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${stemConnTipRx.toFixed(2)},${stemConnTipRy.toFixed(2)} M ${stemConnTipLx.toFixed(2)},${stemConnTipLy.toFixed(2)} Q ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)}`}
              fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <path d={pathD} fill={bubbleFill} stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" />
            {/* Erase this balloon's border where a child balloon's stem enters */}
            {allBalloons.filter(b => b.stemTargetId === obj.id).map(b => {
              const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
              const entryAng = Math.atan2(bcy - cy, bcx - cx);
              const erPts: string[] = [];
              for (let i = 0; i <= 10; i++) {
                const a = (entryAng - STEM_CONNECT_TIP_DELTA) + (i / 10) * (2 * STEM_CONNECT_TIP_DELTA);
                erPts.push((i === 0 ? "M " : "L ") + `${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`);
              }
              return <path key={b.id} d={erPts.join(" ")} fill="none" stroke={bubbleFill} strokeWidth={10} strokeLinecap="butt" />;
            })}
          </>
        )}


        {isSelected && (
          <>
            <circle cx={tipX} cy={tipY} r={6} fill="#3b82f6" stroke="white" strokeWidth={2}
              style={{ cursor: "crosshair", pointerEvents: "all" }}
              onPointerDown={e => { e.stopPropagation(); onStemDragStart(e); }}
            />
            <circle cx={bhx} cy={bhy} r={5} fill="#10b981" stroke="white" strokeWidth={2}
              style={{ cursor: "move", pointerEvents: "all" }}
              onPointerDown={e => { e.stopPropagation(); onStemBendDragStart(stemAng, e); }}
            />
            {connectedTarget && (
              <circle
                cx={cx + rx * Math.cos(stemBaseAng)} cy={cy + ry * Math.sin(stemBaseAng)}
                r={6} fill="#f97316" stroke="white" strokeWidth={2}
                style={{ cursor: "grab", pointerEvents: "all" }}
                onPointerDown={e => { e.stopPropagation(); onStemOriginDragStart(e); }}
              />
            )}
          </>
        )}
      </svg>

      <div
        style={{
          position: "absolute",
          left: cx - rx + 12, top: cy - ry + 10,
          width: obj.w - 24, height: obj.h - 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: isEditing ? "auto" : "none",
        }}
        onDoubleClick={onDoubleClick}
      >
        {isEditing ? (
          <textarea
            autoFocus value={obj.content} onChange={e => onContentChange(e.target.value)} onBlur={onBlur}
            style={{ width: "100%", height: "100%", border: "none", outline: "none", resize: "none", background: "transparent", fontFamily: "Bangers, cursive", fontSize: 16, color: textColor, textAlign: "center", lineHeight: 1.3 }}
          />
        ) : (
          <div style={{ fontFamily: font, fontSize: 16, color: textColor, textAlign: "center", lineHeight: 1.3, whiteSpace: "pre-wrap" }}>
            {obj.content}
          </div>
        )}
      </div>
    </>
  );
}

// ── SelectionHandles ──────────────────────────────────────────────────────────

const HANDLES = ["nw","n","ne","e","se","s","sw","w"] as const;
type HandleDir = typeof HANDLES[number];

function handlePosition(obj: PageObj, h: HandleDir): { left: number; top: number } {
  const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
  const x = h.includes("w") ? obj.x : h.includes("e") ? obj.x + obj.w : cx;
  const y = h.includes("n") ? obj.y : h.includes("s") ? obj.y + obj.h : cy;
  return { left: x - 5, top: y - 5 };
}

const HANDLE_CURSORS: Record<HandleDir, string> = {
  nw: "nw-resize", n: "n-resize", ne: "ne-resize",
  e: "e-resize", se: "se-resize", s: "s-resize", sw: "sw-resize", w: "w-resize",
};

function SelectionHandles({ obj, onStartResize }: {
  obj: PageObj;
  onStartResize: (handle: string, e: React.PointerEvent) => void;
}) {
  return (
    <>
      {/* Bounding box */}
      <div style={{ position: "absolute", left: obj.x - 1, top: obj.y - 1, width: obj.w + 2, height: obj.h + 2, border: "1.5px solid #3b82f6", pointerEvents: "none" }} />
      {/* Handles */}
      {HANDLES.map(h => {
        const pos = handlePosition(obj, h);
        return (
          <div
            key={h}
            style={{ position: "absolute", ...pos, width: 10, height: 10, background: "#fff", border: "2px solid #3b82f6", borderRadius: 2, cursor: HANDLE_CURSORS[h], zIndex: 100 }}
            onPointerDown={e => { e.stopPropagation(); onStartResize(h, e); }}
          />
        );
      })}
    </>
  );
}

// ── CommentPin ────────────────────────────────────────────────────────────────

function CommentPin({ pin, onResolve }: { pin: CommentPin; onResolve: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "absolute", left: pin.x - 10, top: pin.y - 10, zIndex: 50 }}>
      <div
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{ width: 20, height: 20, borderRadius: "50% 50% 50% 0", background: "#3b82f6", border: "2px solid #1d4ed8", cursor: "pointer", transform: "rotate(-45deg)" }}
      />
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

// ── Style helpers ─────────────────────────────────────────────────────────────

function btnStyle(bg: string): React.CSSProperties {
  return { background: bg, border: "none", color: "#fff", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "Comic Neue, sans-serif" };
}

function toolBtnStyle(active: boolean, bg?: string): React.CSSProperties {
  return { width: 40, height: 40, borderRadius: 8, background: active ? "#1d4ed8" : (bg ?? "#0f172a"), border: `1px solid ${active ? "#3b82f6" : "#334155"}`, color: active ? "#fff" : "#94a3b8", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" };
}
