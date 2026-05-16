import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SHEET_CSV_URL = import.meta.env.VITE_SHEET_CSV_URL || "";

// 30 seconds — reliable for Google Sheets, feels live
const REFRESH_INTERVAL_MS = 30_000;

// CORS proxy — prevents Google from blocking browser requests
const CORS_PROXY = "https://corsproxy.io/?url=";

// ─── Constants ────────────────────────────────────────────────────────────────
const ENGINEERS   = ["Jeeva", "Bala", "Anjali", "Vikranth"];
const COMMODITIES = ["Rubber", "Plastic", "Wheel Assy", "Wheel Assy Child Parts", "Washer / Clamps"];
const ACTIVITIES  = ["ECN/DR Changes", "Capacity Increase", "VAVE", "Replace Mould", "Localization"];
const STATUSES    = ["Pending", "In Progress", "Implemented", "On Hold"];
const PRIORITIES  = ["Critical", "High", "Medium", "Low"];

const COL = { partNo:0, partName:1, engineer:2, commodity:3, activity:4, priority:5, status:6, target:7, actual:8 };

// ─── CSV Parser ───────────────────────────────────────────────────────────────
function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  return lines.slice(1).map((line, i) => {
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return {
      id:        i + 1,
      partNo:    cols[COL.partNo]    || "",
      partName:  cols[COL.partName]  || "",
      engineer:  cols[COL.engineer]  || "",
      commodity: cols[COL.commodity] || "",
      activity:  cols[COL.activity]  || "",
      priority:  cols[COL.priority]  || "Medium",
      status:    cols[COL.status]    || "Pending",
      target:    cols[COL.target]    || "",
      actual:    cols[COL.actual]    || "",
    };
  }).filter(r => r.partNo);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date();
today.setHours(0, 0, 0, 0);

const daysFrom = (d) => {
  if (!d) return null;
  const t = new Date(d);
  if (isNaN(t)) return null;
  return Math.ceil((t - today) / 86400000);
};

const urgencyOf = (row) => {
  if (row.status === "Implemented") return "done";
  const d = daysFrom(row.target);
  if (d === null) return "none";
  if (d < 0)     return "overdue";
  if (d < 7)     return "critical";
  if (d < 15)    return "warning";
  return "ok";
};

const priorityColor = { Critical:"#ff4444", High:"#ff8800", Medium:"#f5c518", Low:"#22c55e" };
const statusColor   = { Pending:"#f59e0b", "In Progress":"#38bdf8", Implemented:"#22c55e", "On Hold":"#94a3b8" };
const urgencyMeta   = {
  overdue:  { bg:"#ff444415", border:"#ff4444", label:"OVERDUE",  text:"#ff4444" },
  critical: { bg:"#ff880015", border:"#ff8800", label:"CRITICAL", text:"#ff8800" },
  warning:  { bg:"#f5c51815", border:"#f5c518", label:"WARNING",  text:"#f5c518" },
  ok:       { bg:"#22c55e15", border:"#22c55e", label:"ON TRACK", text:"#22c55e" },
  done:     { bg:"#1e293b",   border:"#334155", label:"DONE",     text:"#64748b" },
  none:     { bg:"#1e293b",   border:"#334155", label:"NO DATE",  text:"#64748b" },
};

// ─── SVG Donut ────────────────────────────────────────────────────────────────
function Donut({ data }) {
  const total = data.reduce((a, b) => a + b.v, 0) || 1;
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = data.map((d) => {
    const seg = { ...d, pct: d.v / total, offset };
    offset += seg.pct;
    return seg;
  });
  return (
    <svg viewBox="0 0 100 100" style={{ width: 110, height: 110 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={14} />
      {segs.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none"
          stroke={s.color} strokeWidth={14}
          strokeDasharray={`${s.pct * circ} ${circ}`}
          strokeDashoffset={-s.offset * circ}
          style={{ transform:"rotate(-90deg)", transformOrigin:"50% 50%", filter:`drop-shadow(0 0 3px ${s.color})` }} />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="bold">{total}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize="7">TASKS</text>
    </svg>
  );
}

// ─── Loading Spinner ──────────────────────────────────────────────────────────
function Spinner({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", gap:16, background:"#060c18" }}>
      <div style={{ width:40, height:40, border:"3px solid #1e3a5f", borderTop:"3px solid #38bdf8", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
      <p style={{ color:"#64748b", fontFamily:"'DM Sans',sans-serif", fontSize:14 }}>{msg}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Setup Guide ─────────────────────────────────────────────────────────────
function SetupGuide() {
  return (
    <div style={{ minHeight:"100vh", background:"#060c18", color:"#e2e8f0", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ maxWidth:580, background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:14, padding:32 }}>
        <h1 style={{ fontSize:22, fontWeight:800, color:"#38bdf8", marginBottom:8 }}>⚙ AUTOFLOW — Setup Required</h1>
        <p style={{ color:"#94a3b8", marginBottom:24, lineHeight:1.6 }}>No Google Sheet connected. Follow these steps once.</p>
        {[
          ["1","Create your Google Sheet","Row 1 headers: partNo, partName, engineer, commodity, activity, priority, status, target, actual"],
          ["2","Publish as CSV","File → Share → Publish to web → CSV → Publish → Copy URL"],
          ["3","Add to .env file","VITE_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/YOUR_ID/pub?output=csv"],
          ["4","Deploy to Vercel","Settings → Environment Variables → add VITE_SHEET_CSV_URL → Redeploy"],
        ].map(([num, title, desc]) => (
          <div key={num} style={{ display:"flex", gap:14, marginBottom:20 }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:"#38bdf8", color:"#060c18", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{num}</div>
            <div>
              <div style={{ fontWeight:700, color:"#e2e8f0", marginBottom:4 }}>{title}</div>
              <div style={{ color:"#64748b", fontSize:12, lineHeight:1.6 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [search, setSearch]           = useState("");
  const [fEng, setFEng]               = useState("All");
  const [fCom, setFCom]               = useState("All");
  const [fAct, setFAct]               = useState("All");
  const [fStat, setFStat]             = useState("All");
  const [activeTab, setActiveTab]     = useState("table");
  const timerRef = useRef(null);

  // ── KEY FIX: fetchData never clears existing data on failure ──────────────
  const fetchData = useCallback(async (isManual = false) => {
    if (!SHEET_CSV_URL) { setLoading(false); return; }
    if (isManual) setLoading(true);

    let text = null;

    // Try 1: direct fetch
    try {
      const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
      if (res.ok) text = await res.text();
    } catch (_) { /* blocked by CORS, try proxy next */ }

    // Try 2: CORS proxy fallback
    if (!text) {
      try {
        const res2 = await fetch(CORS_PROXY + encodeURIComponent(SHEET_CSV_URL), { cache: "no-store" });
        if (res2.ok) text = await res2.text();
      } catch (_) { /* proxy also failed */ }
    }

    if (text) {
      const parsed = parseCSV(text);
      if (parsed.length > 0) {
        // ✅ SUCCESS — update data
        setTasks(parsed);
        setError(null);
        setLastFetched(new Date());
      } else {
        // ✅ Got response but empty — keep old data, show warning
        setError("Sheet returned empty data — check headers. Showing last loaded data.");
      }
    } else {
      // ✅ Both fetches failed — keep old data on screen, just show small warning
      setError("Could not reach Google Sheet — showing last loaded data. Will retry.");
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(() => fetchData(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // ── Filtered rows ──
  const filtered = useMemo(() => tasks.filter(t => {
    const q = search.toLowerCase();
    if (q && !t.partNo.toLowerCase().includes(q) && !t.partName.toLowerCase().includes(q)) return false;
    if (fEng  !== "All" && t.engineer  !== fEng)  return false;
    if (fCom  !== "All" && t.commodity !== fCom)  return false;
    if (fAct  !== "All" && t.activity  !== fAct)  return false;
    if (fStat !== "All" && t.status    !== fStat) return false;
    return true;
  }), [tasks, search, fEng, fCom, fAct, fStat]);

  // ── KPIs ──
  const total     = tasks.length;
  const implCount = tasks.filter(t => t.status === "Implemented").length;
  const implRate  = total ? Math.round((implCount / total) * 100) : 0;
  const ytdTarget = 90;

  const donutData = STATUSES.map(s => ({ label:s, v:tasks.filter(t=>t.status===s).length, color:statusColor[s] }));
  const priCount  = PRIORITIES.reduce((a,p) => ({ ...a, [p]: tasks.filter(t=>t.priority===p).length }), {});
  const engBar    = ENGINEERS.map(e => ({
    name: e,
    impl: tasks.filter(t=>t.engineer===e && t.status==="Implemented").length,
    pend: tasks.filter(t=>t.engineer===e && t.status!=="Implemented").length,
  }));
  const maxBar = Math.max(...engBar.map(e=>e.impl+e.pend), 1);

  const matrix = useMemo(() => COMMODITIES.map(c => ({
    name: c,
    cols: ACTIVITIES.map(a => ({
      name: a,
      impl: tasks.filter(t=>t.commodity===c&&t.activity===a&&t.status==="Implemented").length,
      pend: tasks.filter(t=>t.commodity===c&&t.activity===a&&t.status!=="Implemented").length,
    })),
  })), [tasks]);

  const sidebarItems = useMemo(() =>
    tasks.filter(t => t.status !== "Implemented")
      .map(t => ({ ...t, urg: urgencyOf(t), days: daysFrom(t.target) }))
      .sort((a,b) => { const o={overdue:0,critical:1,warning:2,ok:3,none:4}; return o[a.urg]-o[b.urg]; }),
  [tasks]);

  if (!SHEET_CSV_URL) return <SetupGuide />;
  if (loading && tasks.length === 0) return <Spinner msg="Loading from Google Sheets…" />;

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    app:      { minHeight:"100vh", background:"#060c18", color:"#e2e8f0", fontFamily:"'DM Sans','Segoe UI',sans-serif", fontSize:13 },
    header:   { background:"#0a1628", borderBottom:"1px solid #1e3a5f", padding:"11px 18px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" },
    logo:     { fontSize:15, fontWeight:800, letterSpacing:1, color:"#38bdf8", whiteSpace:"nowrap", marginRight:4 },
    searchWrap:{ position:"relative", flex:"1 1 160px" },
    searchIn: { width:"100%", background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"6px 10px 6px 30px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" },
    sel:      { background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"6px 9px", color:"#e2e8f0", fontSize:12, outline:"none", cursor:"pointer" },
    btnPri:   { background:"#38bdf8", border:"none", borderRadius:8, padding:"6px 13px", color:"#060c18", fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" },
    btnGhost: { background:"#1e3a5f", border:"none", borderRadius:8, padding:"6px 13px", color:"#94a3b8", fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" },
    body:     { display:"flex", height:"calc(100vh - 54px)", overflow:"hidden" },
    left:     { width:210, minWidth:190, background:"#0a1628", borderRight:"1px solid #1e3a5f", overflowY:"auto", padding:12, display:"flex", flexDirection:"column", gap:12 },
    center:   { flex:1, overflowY:"auto", padding:14, display:"flex", flexDirection:"column", gap:12 },
    right:    { width:230, minWidth:210, background:"#0a1628", borderLeft:"1px solid #1e3a5f", overflowY:"auto", padding:12, display:"flex", flexDirection:"column", gap:8 },
    card:     { background:"#0f1f38", border:"1px solid #1e3a5f", borderRadius:10, padding:12 },
    cardTitle:{ fontSize:9, fontWeight:700, letterSpacing:2, color:"#64748b", textTransform:"uppercase", marginBottom:8 },
    tabBar:   { display:"flex", gap:2, borderBottom:"1px solid #1e3a5f" },
    tab:      (a) => ({ padding:"8px 15px", background:"none", border:"none", borderBottom:a?"2px solid #38bdf8":"2px solid transparent", color:a?"#38bdf8":"#64748b", fontWeight:a?700:400, cursor:"pointer", fontSize:12, marginBottom:-1 }),
    table:    { width:"100%", borderCollapse:"collapse", fontSize:11 },
    th:       { textAlign:"left", padding:"7px 10px", fontSize:9, fontWeight:700, letterSpacing:1.5, color:"#64748b", textTransform:"uppercase", borderBottom:"1px solid #1e3a5f", whiteSpace:"nowrap" },
    td:       { padding:"7px 10px", borderBottom:"1px solid #0f2540", verticalAlign:"middle" },
    barWrap:  { background:"#1e293b", borderRadius:3, height:5, overflow:"hidden", marginTop:4 },
    bar:      (pct, c) => ({ width:`${Math.min(pct,100)}%`, height:"100%", background:c, borderRadius:3, transition:"width .5s" }),
  };

  return (
    <div style={s.app}>
      {/* HEADER */}
      <div style={s.header}>
        <span style={s.logo}>⚙ AUTOFLOW</span>
        <div style={s.searchWrap}>
          <svg style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", opacity:.4 }} width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input style={s.searchIn} placeholder="Search Part # or Name…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        {[["Engineer",ENGINEERS,fEng,setFEng],["Commodity",COMMODITIES,fCom,setFCom],["Activity",ACTIVITIES,fAct,setFAct],["Status",STATUSES,fStat,setFStat]].map(([lbl,opts,val,set])=>(
          <select key={lbl} style={s.sel} value={val} onChange={e=>set(e.target.value)}>
            <option value="All">All {lbl}s</option>
            {opts.map(o=><option key={o}>{o}</option>)}
          </select>
        ))}
        <button style={s.btnGhost} onClick={()=>{setSearch("");setFEng("All");setFCom("All");setFAct("All");setFStat("All");}}>↺ Reset</button>
        <button style={s.btnPri} onClick={()=>fetchData(true)}>
          {loading?"…":"⟳"} Refresh
        </button>
        {lastFetched && <span style={{ fontSize:10, color:"#334155" }}>Updated {lastFetched.toLocaleTimeString()}</span>}
      </div>

      {/* ERROR BANNER — non-destructive, data stays on screen */}
      {error && (
        <div style={{ background:"#ff444415", border:"1px solid #ff444455", borderRadius:0, padding:"8px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#ff8888", fontSize:12 }}>⚠ {error}</span>
          <button onClick={()=>setError(null)} style={{ background:"none", border:"none", color:"#ff4444", cursor:"pointer", fontSize:16, lineHeight:1 }}>×</button>
        </div>
      )}

      {/* BODY */}
      <div style={s.body}>

        {/* LEFT PANEL */}
        <div style={s.left}>
          <div style={s.card}>
            <div style={s.cardTitle}>Task Summary</div>
            <div style={{ fontSize:26, fontWeight:800, color:"#38bdf8", lineHeight:1 }}>{implCount}<span style={{ color:"#334155", fontSize:16 }}>/{total}</span></div>
            <div style={{ color:"#64748b", fontSize:10, marginTop:2 }}>Implemented / Total</div>
            <div style={s.barWrap}><div style={s.bar(implRate,"#38bdf8")}/></div>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>Implementation Rate</div>
            <div style={{ fontSize:24, fontWeight:800, color:"#22c55e" }}>{implRate}%</div>
            <div style={s.barWrap}><div style={s.bar(implRate,"#22c55e")}/></div>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>YTD Achievement</div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#94a3b8", marginBottom:4 }}>
              <span>Target {ytdTarget}%</span><span>Actual {implRate}%</span>
            </div>
            <div style={{ ...s.barWrap, position:"relative", height:5 }}>
              <div style={{ ...s.bar(ytdTarget,"#334155"), position:"absolute" }}/>
              <div style={{ ...s.bar(implRate, implRate>=ytdTarget?"#22c55e":"#ff8800"), position:"absolute" }}/>
            </div>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>Priority</div>
            {PRIORITIES.map(p=>(
              <div key={p} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                  {p==="Critical" && <span style={{ width:6, height:6, borderRadius:"50%", background:"#ff4444", display:"inline-block", animation:"pulse 1s infinite" }}/>}
                  <span style={{ color:"#94a3b8", fontSize:11 }}>{p}</span>
                </span>
                <span style={{ fontWeight:700, color:priorityColor[p], fontSize:12 }}>{priCount[p]||0}</span>
              </div>
            ))}
          </div>

          <div style={{ ...s.card, alignItems:"center", display:"flex", flexDirection:"column" }}>
            <div style={s.cardTitle}>Status Split</div>
            <Donut data={donutData} />
            <div style={{ width:"100%", marginTop:6 }}>
              {donutData.map(d=>(
                <div key={d.label} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ width:7, height:7, borderRadius:2, background:d.color, display:"inline-block" }}/>
                    <span style={{ color:"#94a3b8", fontSize:10 }}>{d.label}</span>
                  </span>
                  <span style={{ fontWeight:700, color:d.color, fontSize:11 }}>{d.v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>By Engineer</div>
            {engBar.map(e=>(
              <div key={e.name} style={{ marginBottom:8 }}>
                <div style={{ fontSize:10, color:"#94a3b8", marginBottom:2 }}>{e.name}</div>
                <div style={{ display:"flex", gap:2, height:8, borderRadius:4, overflow:"hidden" }}>
                  <div style={{ width:`${(e.impl/maxBar)*100}%`, background:"#22c55e", minWidth:e.impl?2:0 }}/>
                  <div style={{ width:`${(e.pend/maxBar)*100}%`, background:"#f59e0b", minWidth:e.pend?2:0 }}/>
                </div>
                <div style={{ display:"flex", gap:8, fontSize:9, color:"#64748b", marginTop:2 }}>
                  <span style={{ color:"#22c55e" }}>✓{e.impl}</span>
                  <span style={{ color:"#f59e0b" }}>◷{e.pend}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTER */}
        <div style={s.center}>
          <div style={s.tabBar}>
            {[["table","Tracking Table"],["matrix","Commodity Matrix"],["gantt","Timeline / Gantt"]].map(([k,lbl])=>(
              <button key={k} style={s.tab(activeTab===k)} onClick={()=>setActiveTab(k)}>{lbl}</button>
            ))}
          </div>

          {activeTab==="table" && (
            <div style={{ ...s.card, padding:0, overflowX:"auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>{["Part #","Part Name","Engineer","Commodity","Activity","Priority","Status","Target","Days Left"].map(h=>(
                    <th key={h} style={s.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filtered.map(row=>{
                    const urg  = urgencyOf(row);
                    const days = daysFrom(row.target);
                    return (
                      <tr key={row.id} style={{ background: urg==="overdue"||urg==="critical"?"#ff44440a":"transparent" }}>
                        <td style={s.td}><code style={{ color:"#38bdf8", fontSize:10 }}>{row.partNo}</code></td>
                        <td style={{ ...s.td, maxWidth:140 }}>{row.partName}</td>
                        <td style={s.td}><span style={{ color:"#94a3b8" }}>{row.engineer}</span></td>
                        <td style={{ ...s.td, fontSize:10 }}>{row.commodity}</td>
                        <td style={{ ...s.td, fontSize:10 }}>{row.activity}</td>
                        <td style={s.td}>
                          <span style={{ background:`${priorityColor[row.priority]}22`, border:`1px solid ${priorityColor[row.priority]}`, borderRadius:5, padding:"2px 7px", color:priorityColor[row.priority], fontSize:10, fontWeight:600 }}>
                            {row.priority}
                          </span>
                        </td>
                        <td style={s.td}>
                          <span style={{ background:`${statusColor[row.status]}22`, border:`1px solid ${statusColor[row.status]}`, borderRadius:5, padding:"2px 7px", color:statusColor[row.status], fontSize:10, fontWeight:600 }}>
                            {row.status}
                          </span>
                        </td>
                        <td style={{ ...s.td, fontSize:10, color:"#94a3b8" }}>{row.target||"—"}</td>
                        <td style={{ ...s.td, fontWeight:700, fontSize:11, color: days===null?"#64748b":days<0?"#ff4444":days<7?"#ff8800":days<15?"#f5c518":"#22c55e" }}>
                          {days===null?"—":days<0?`${Math.abs(days)}d late`:`${days}d`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length===0 && <div style={{ padding:24, textAlign:"center", color:"#64748b" }}>No tasks match the current filters.</div>}
            </div>
          )}

          {activeTab==="matrix" && (
            <div style={{ ...s.card, padding:0, overflowX:"auto" }}>
              <table style={{ ...s.table, fontSize:10 }}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, padding:"9px 14px" }}>Commodity ╲ Activity</th>
                    {ACTIVITIES.map(a=><th key={a} style={{ ...s.th, textAlign:"center" }}>{a}</th>)}
                    <th style={{ ...s.th, textAlign:"center" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(row=>{
                    const rowTotal = row.cols.reduce((a,c)=>a+c.impl+c.pend,0);
                    const rowImpl  = row.cols.reduce((a,c)=>a+c.impl,0);
                    return (
                      <tr key={row.name}>
                        <td style={{ ...s.td, fontWeight:600, color:"#38bdf8", whiteSpace:"nowrap", padding:"9px 14px" }}>{row.name}</td>
                        {row.cols.map(c=>(
                          <td key={c.name} style={{ ...s.td, textAlign:"center", padding:5 }}>
                            {c.impl+c.pend===0
                              ? <span style={{ color:"#334155" }}>—</span>
                              : <div style={{ display:"flex", flexDirection:"column", gap:2, alignItems:"center" }}>
                                  {c.impl>0 && <span style={{ background:"#22c55e22", border:"1px solid #22c55e", borderRadius:4, padding:"1px 6px", color:"#22c55e" }}>✓{c.impl}</span>}
                                  {c.pend>0 && <span style={{ background:"#f59e0b22", border:"1px solid #f59e0b", borderRadius:4, padding:"1px 6px", color:"#f59e0b" }}>◷{c.pend}</span>}
                                </div>
                            }
                          </td>
                        ))}
                        <td style={{ ...s.td, textAlign:"center", fontWeight:700, color:rowImpl===rowTotal?"#22c55e":"#f59e0b" }}>
                          {rowImpl}/{rowTotal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab==="gantt" && (
            <div style={s.card}>
              <div style={s.cardTitle}>Timeline — Elapsed Progress per Task</div>
              {filtered.map(row=>{
                const start   = new Date("2025-01-01");
                const end     = row.target ? new Date(row.target) : new Date("2025-12-31");
                const span    = Math.max(end - start, 1);
                const elapsed = Math.min(Math.max((today - start) / span, 0), 1);
                const urg     = urgencyOf(row);
                const barC    = urg==="overdue"||urg==="critical"?"#ff4444":urg==="warning"?"#f5c518":"#22c55e";
                return (
                  <div key={row.id} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2, fontSize:10 }}>
                      <span><code style={{ color:"#38bdf8" }}>{row.partNo}</code> — {row.partName}</span>
                      <span style={{ color:"#64748b" }}>{row.engineer} · {row.target||"—"}</span>
                    </div>
                    <div style={{ background:"#0f2540", borderRadius:4, height:12, position:"relative", overflow:"hidden" }}>
                      <div style={{ width:`${elapsed*100}%`, height:"100%", background:barC, transition:"width .5s", boxShadow:`0 0 6px ${barC}88` }}/>
                      <div style={{ position:"absolute", right:6, top:0, height:"100%", display:"flex", alignItems:"center", fontSize:9, color:"#64748b" }}>{Math.round(elapsed*100)}%</div>
                    </div>
                  </div>
                );
              })}
              {filtered.length===0 && <div style={{ color:"#64748b", textAlign:"center", padding:20 }}>No tasks match filters.</div>}
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={s.right}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth={2}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span style={{ fontWeight:700, fontSize:11, letterSpacing:1, color:"#38bdf8" }}>URGENCY DECK</span>
          </div>
          {sidebarItems.length===0 && <div style={{ color:"#64748b", fontSize:11, textAlign:"center", marginTop:20 }}>All tasks implemented 🎉</div>}
          {sidebarItems.map(t=>{
            const b = urgencyMeta[t.urg] || urgencyMeta.ok;
            return (
              <div key={t.id} style={{ background:b.bg, border:`1px solid ${b.border}`, borderRadius:8, padding:9 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ background:b.border, color:"#000", fontSize:8, fontWeight:800, borderRadius:3, padding:"2px 5px", letterSpacing:.8 }}>{b.label}</span>
                  <span style={{ fontSize:9, color:priorityColor[t.priority], fontWeight:700 }}>{t.priority}</span>
                </div>
                <div style={{ fontSize:11, fontWeight:600, color:"#e2e8f0", marginBottom:2 }}>{t.partName}</div>
                <div style={{ fontSize:10, color:"#64748b" }}>{t.partNo} · {t.engineer}</div>
                <div style={{ fontSize:10, color:b.text, marginTop:4, fontWeight:700 }}>
                  {t.days===null?"No date set":t.days<0?`${Math.abs(t.days)}d overdue`:`${t.days}d left`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:#060c18; }
        ::-webkit-scrollbar-thumb { background:#1e3a5f; border-radius:3px; }
        select option { background:#0a1628; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.2} }
        @keyframes spin  { to { transform:rotate(360deg); } }
      `}</style>
    </div>
  );
}
