import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Replace with your SheetDB API URL: https://sheetdb.io/api/v1/YOUR_ID
const SHEETDB_URL = import.meta.env.VITE_SHEETDB_URL || "";
const REFRESH_MS  = 30_000;

// ─── Constants ────────────────────────────────────────────────────────────────
const ENGINEERS   = ["Jeeva", "Bala", "Anjali", "Vikranth"];
const COMMODITIES = ["Rubber", "Plastic", "Wheel Assy", "Wheel Assy Child Parts", "Washer / Clamps"];
const ACTIVITIES  = ["ECN/DR Changes", "Capacity Increase", "VAVE", "Replace Mould", "Localization"];
const STATUSES    = ["Pending", "In Progress", "Implemented", "On Hold"];
const PRIORITIES  = ["Critical", "High", "Medium", "Low"];
const MONTHS      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const priorityColor = { Critical:"#ff4444", High:"#ff8800", Medium:"#f5c518", Low:"#22c55e" };
const statusColor   = { Pending:"#f59e0b", "In Progress":"#38bdf8", Implemented:"#22c55e", "On Hold":"#94a3b8" };
const engColors     = ["#38bdf8","#a78bfa","#34d399","#fb923c"];
const urgencyMeta   = {
  overdue:  { bg:"#ff444418", border:"#ff4444", label:"OVERDUE",  text:"#ff4444" },
  critical: { bg:"#ff880018", border:"#ff8800", label:"CRITICAL", text:"#ff8800" },
  warning:  { bg:"#f5c51818", border:"#f5c518", label:"WARNING",  text:"#f5c518" },
  ok:       { bg:"#22c55e18", border:"#22c55e", label:"ON TRACK", text:"#22c55e" },
  done:     { bg:"#1e293b",   border:"#334155", label:"DONE",     text:"#64748b" },
  none:     { bg:"#1e293b",   border:"#334155", label:"NO DATE",  text:"#64748b" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date(); today.setHours(0,0,0,0);
const daysFrom = d => { if(!d) return null; const t=new Date(d); return isNaN(t)?null:Math.ceil((t-today)/86400000); };
const urgencyOf = row => {
  if(row.status==="Implemented") return "done";
  const d = daysFrom(row.target);
  if(d===null) return "none";
  if(d<0)  return "overdue";
  if(d<7)  return "critical";
  if(d<15) return "warning";
  return "ok";
};
const monthOf = d => { if(!d) return null; const t=new Date(d); return isNaN(t)?null:t.getMonth(); };

// ─── SVG Donut ────────────────────────────────────────────────────────────────
function Donut({ data, size=110 }) {
  const total = data.reduce((a,b)=>a+b.v,0)||1;
  const r=38, cx=50, cy=50, circ=2*Math.PI*r;
  let offset=0;
  const segs = data.map(d=>{ const s={...d,pct:d.v/total,offset}; offset+=s.pct; return s; });
  return (
    <svg viewBox="0 0 100 100" style={{width:size,height:size}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={13}/>
      {segs.map((s,i)=>(
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={13}
          strokeDasharray={`${s.pct*circ} ${circ}`} strokeDashoffset={-s.offset*circ}
          style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",filter:`drop-shadow(0 0 3px ${s.color})`}}/>
      ))}
      <text x={cx} y={cy-5} textAnchor="middle" fill="#e2e8f0" fontSize="15" fontWeight="bold">{total}</text>
      <text x={cx} y={cy+9} textAnchor="middle" fill="#64748b" fontSize="7">TASKS</text>
    </svg>
  );
}

// ─── Bar Chart (horizontal) ───────────────────────────────────────────────────
function HBar({ label, impl, pend, total, color, onClick, active }) {
  const pct = total ? Math.round((impl/total)*100) : 0;
  return (
    <div onClick={onClick} style={{cursor:"pointer", padding:"5px 6px", borderRadius:7, background: active?"#1e3a5f22":"transparent", border: active?"1px solid #38bdf855":"1px solid transparent", marginBottom:4}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
        <span style={{color: active?"#38bdf8":"#94a3b8",fontWeight:active?700:400}}>{label}</span>
        <span style={{color:"#64748b"}}><span style={{color:"#22c55e"}}>✓{impl}</span> <span style={{color:"#f59e0b"}}>◷{pend}</span></span>
      </div>
      <div style={{background:"#1e293b",borderRadius:3,height:7,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:3,transition:"width .5s"}}/>
      </div>
    </div>
  );
}

// ─── Month Bar Chart ──────────────────────────────────────────────────────────
function MonthChart({ tasks }) {
  const data = MONTHS.map((m,i)=>({
    m, impl: tasks.filter(t=>t.status==="Implemented"&&monthOf(t.actual)===i).length,
    pend:    tasks.filter(t=>t.status!=="Implemented"&&monthOf(t.target)===i).length,
  }));
  const max = Math.max(...data.map(d=>d.impl+d.pend),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:3,height:60,padding:"0 2px"}}>
      {data.map(d=>(
        <div key={d.m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:50,gap:1}}>
            {d.impl>0 && <div style={{width:"100%",height:`${(d.impl/max)*50}px`,background:"#22c55e",borderRadius:"2px 2px 0 0",minHeight:2}}/>}
            {d.pend>0 && <div style={{width:"100%",height:`${(d.pend/max)*50}px`,background:"#f59e0b",borderRadius: d.impl?"0":"2px 2px 0 0",minHeight:2}}/>}
          </div>
          <span style={{fontSize:7,color:"#334155"}}>{d.m}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Category (Activity) Chart ────────────────────────────────────────────────
function ActivityChart({ tasks }) {
  const data = ACTIVITIES.map(a=>({
    a: a.length>12?a.slice(0,11)+"…":a,
    impl: tasks.filter(t=>t.activity===a&&t.status==="Implemented").length,
    pend: tasks.filter(t=>t.activity===a&&t.status!=="Implemented").length,
  }));
  const max = Math.max(...data.map(d=>d.impl+d.pend),1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {data.map(d=>(
        <div key={d.a}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#64748b",marginBottom:2}}>
            <span>{d.a}</span>
            <span><span style={{color:"#22c55e"}}>{d.impl}</span>/<span style={{color:"#f59e0b"}}>{d.pend}</span></span>
          </div>
          <div style={{background:"#1e293b",borderRadius:3,height:5,overflow:"hidden",display:"flex"}}>
            <div style={{width:`${(d.impl/max)*100}%`,background:"#22c55e",transition:"width .5s"}}/>
            <div style={{width:`${(d.pend/max)*100}%`,background:"#f59e0b",transition:"width .5s"}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({msg}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:16,background:"#060c18"}}>
      <div style={{width:40,height:40,border:"3px solid #1e3a5f",borderTop:"3px solid #38bdf8",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <p style={{color:"#64748b",fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>{msg}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── Setup Guide ──────────────────────────────────────────────────────────────
function SetupGuide() {
  return (
    <div style={{minHeight:"100vh",background:"#060c18",color:"#e2e8f0",fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{maxWidth:600,background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:14,padding:32}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#38bdf8",marginBottom:8}}>⚙ AUTOFLOW — SheetDB Setup</h1>
        <p style={{color:"#94a3b8",marginBottom:24,lineHeight:1.7}}>Connect your Google Sheet via SheetDB for full two-way sync.</p>
        {[
          ["1","Create Google Sheet","Row 1 headers exactly: partNo, partName, engineer, commodity, activity, priority, status, target, actual"],
          ["2","Sign up at sheetdb.io","Go to sheetdb.io → Create API → paste your Google Sheet URL → Copy the API URL"],
          ["3","Add to .env file","VITE_SHEETDB_URL=https://sheetdb.io/api/v1/YOUR_API_ID"],
          ["4","Deploy to Vercel","Settings → Environment Variables → add VITE_SHEETDB_URL → Redeploy"],
        ].map(([n,t,d])=>(
          <div key={n} style={{display:"flex",gap:14,marginBottom:18}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:"#38bdf8",color:"#060c18",fontWeight:800,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{n}</div>
            <div><div style={{fontWeight:700,color:"#e2e8f0",marginBottom:3}}>{t}</div><div style={{color:"#64748b",fontSize:12,lineHeight:1.6}}>{d}</div></div>
          </div>
        ))}
        <div style={{background:"#0f2540",border:"1px solid #1e3a5f",borderRadius:8,padding:12,marginTop:8}}>
          <div style={{fontSize:10,fontWeight:700,color:"#38bdf8",marginBottom:6,letterSpacing:1}}>REQUIRED SHEET HEADERS (Row 1)</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {["partNo","partName","engineer","commodity","activity","priority","status","target","actual"].map(h=>(
              <code key={h} style={{background:"#1e3a5f",borderRadius:4,padding:"2px 7px",fontSize:11,color:"#e2e8f0"}}>{h}</code>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
const EMPTY_FORM = { partNo:"", partName:"", engineer:ENGINEERS[0], commodity:COMMODITIES[0], activity:ACTIVITIES[0], priority:"Medium", status:"Pending", target:"", actual:"" };

function AddModal({ onClose, onSave, saving }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inp = { width:"100%", background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"7px 10px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#64748b", marginBottom:3, letterSpacing:.8, textTransform:"uppercase" };
  return (
    <div style={{position:"fixed",inset:0,background:"#000b",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:14,padding:24,width:500,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <span style={{fontSize:15,fontWeight:800,color:"#38bdf8"}}>+ New Task</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={lbl}>Part Number</label><input style={inp} value={form.partNo} onChange={e=>set("partNo",e.target.value)} placeholder="e.g. RBR-013"/></div>
          <div><label style={lbl}>Part Name</label><input style={inp} value={form.partName} onChange={e=>set("partName",e.target.value)} placeholder="e.g. Exhaust Gasket"/></div>
          {[["Engineer","engineer",ENGINEERS],["Commodity","commodity",COMMODITIES],["Activity","activity",ACTIVITIES],["Priority","priority",PRIORITIES],["Status","status",STATUSES]].map(([l,k,opts])=>(
            <div key={k}><label style={lbl}>{l}</label>
              <select style={{...inp,cursor:"pointer"}} value={form[k]} onChange={e=>set(k,e.target.value)}>
                {opts.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
          <div><label style={lbl}>Target Date</label><input type="date" style={inp} value={form.target} onChange={e=>set("target",e.target.value)}/></div>
          <div><label style={lbl}>Actual Date</label><input type="date" style={inp} value={form.actual} onChange={e=>set("actual",e.target.value)}/></div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onClose} style={{background:"#1e3a5f",border:"none",borderRadius:8,padding:"7px 16px",color:"#94a3b8",cursor:"pointer",fontSize:12,fontWeight:600}}>Cancel</button>
          <button onClick={()=>onSave(form)} disabled={saving||!form.partNo||!form.partName}
            style={{background: saving||!form.partNo||!form.partName?"#334155":"#38bdf8",border:"none",borderRadius:8,padding:"7px 16px",color: saving||!form.partNo||!form.partName?"#64748b":"#060c18",cursor:"pointer",fontSize:12,fontWeight:700}}>
            {saving?"Saving…":"✓ Add Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [search, setSearch]           = useState("");
  const [fEng, setFEng]               = useState("All");
  const [fCom, setFCom]               = useState("All");
  const [fAct, setFAct]               = useState("All");
  const [fStat, setFStat]             = useState("All");
  const [activeTab, setActiveTab]     = useState("table");
  const [showModal, setShowModal]     = useState(false);
  const [activeEng, setActiveEng]     = useState(null); // click-to-filter engineer
  const timerRef = useRef(null);

  // ── FETCH (SheetDB GET) ───────────────────────────────────────────────────
  const fetchData = useCallback(async (isManual=false) => {
    if (!SHEETDB_URL) { setLoading(false); return; }
    if (isManual) setLoading(true);
    try {
      const res = await fetch(SHEETDB_URL, { cache:"no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // SheetDB returns array of objects keyed by header names
      const parsed = json.map((row, i) => ({
        id:        row.partNo + "_" + i,
        partNo:    row.partNo    || "",
        partName:  row.partName  || "",
        engineer:  row.engineer  || "",
        commodity: row.commodity || "",
        activity:  row.activity  || "",
        priority:  row.priority  || "Medium",
        status:    row.status    || "Pending",
        target:    row.target    || "",
        actual:    row.actual    || "",
      })).filter(r => r.partNo);
      setTasks(parsed);
      setError(null);
      setLastFetched(new Date());
    } catch(e) {
      setError(`Refresh failed — showing last data. (${e.message})`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(() => fetchData(), REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // ── UPDATE ROW (SheetDB PATCH) ────────────────────────────────────────────
  const updateField = async (row, field, val) => {
    // Optimistic UI update
    setTasks(prev => prev.map(t => t.id===row.id ? {...t,[field]:val} : t));
    try {
      await fetch(`${SHEETDB_URL}/partNo/${encodeURIComponent(row.partNo)}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ data: { [field]: val } }),
      });
    } catch(e) {
      setError("Failed to save change to sheet — will retry on next refresh.");
      // Revert on failure
      setTasks(prev => prev.map(t => t.id===row.id ? {...t,[field]:row[field]} : t));
    }
  };

  // ── ADD ROW (SheetDB POST) ────────────────────────────────────────────────
  const addTask = async (form) => {
    setSaving(true);
    try {
      const res = await fetch(SHEETDB_URL, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ data: [form] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowModal(false);
      await fetchData(true); // refresh to get the new row
    } catch(e) {
      setError(`Failed to add task: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── DELETE ROW (SheetDB DELETE) ───────────────────────────────────────────
  const deleteRow = async (row) => {
    if (!window.confirm(`Delete ${row.partNo} — ${row.partName}?`)) return;
    setTasks(prev => prev.filter(t => t.id !== row.id));
    try {
      await fetch(`${SHEETDB_URL}/partNo/${encodeURIComponent(row.partNo)}`, { method:"DELETE" });
    } catch(e) {
      setError("Delete failed — refreshing.");
      fetchData();
    }
  };

  // ── Filtered rows (for table/gantt) ──────────────────────────────────────
  const filtered = useMemo(() => tasks.filter(t => {
    const q = search.toLowerCase();
    if (q && !t.partNo.toLowerCase().includes(q) && !t.partName.toLowerCase().includes(q)) return false;
    if (fEng  !== "All" && t.engineer  !== fEng)  return false;
    if (fCom  !== "All" && t.commodity !== fCom)  return false;
    if (fAct  !== "All" && t.activity  !== fAct)  return false;
    if (fStat !== "All" && t.status    !== fStat) return false;
    return true;
  }), [tasks, search, fEng, fCom, fAct, fStat]);

  // ── Engineer-click filtered tasks (for charts) ────────────────────────────
  const chartTasks = useMemo(() =>
    activeEng ? tasks.filter(t => t.engineer === activeEng) : tasks,
  [tasks, activeEng]);

  // ── KPIs (based on chartTasks so clicking engineer updates all metrics) ──
  const total     = chartTasks.length;
  const implCount = chartTasks.filter(t => t.status==="Implemented").length;
  const implRate  = total ? Math.round((implCount/total)*100) : 0;
  const ytdTarget = 90;

  const donutData = STATUSES.map(s => ({
    label:s, v:chartTasks.filter(t=>t.status===s).length, color:statusColor[s]
  }));
  const priCount = PRIORITIES.reduce((a,p) => ({
    ...a, [p]: chartTasks.filter(t=>t.priority===p).length
  }), {});

  const engBarData = ENGINEERS.map((e,i) => ({
    name:e, color:engColors[i],
    impl: tasks.filter(t=>t.engineer===e&&t.status==="Implemented").length,
    pend: tasks.filter(t=>t.engineer===e&&t.status!=="Implemented").length,
    total: tasks.filter(t=>t.engineer===e).length,
  }));

  const matrix = useMemo(() => COMMODITIES.map(c => ({
    name:c,
    cols: ACTIVITIES.map(a => ({
      name:a,
      impl: chartTasks.filter(t=>t.commodity===c&&t.activity===a&&t.status==="Implemented").length,
      pend: chartTasks.filter(t=>t.commodity===c&&t.activity===a&&t.status!=="Implemented").length,
    })),
  })), [chartTasks]);

  const sidebarItems = useMemo(() =>
    tasks.filter(t=>t.status!=="Implemented")
      .map(t=>({...t,urg:urgencyOf(t),days:daysFrom(t.target)}))
      .sort((a,b)=>({overdue:0,critical:1,warning:2,ok:3,none:4}[a.urg]-{overdue:0,critical:1,warning:2,ok:3,none:4}[b.urg])),
  [tasks]);

  if (!SHEETDB_URL) return <SetupGuide />;
  if (loading && tasks.length===0) return <Spinner msg="Connecting to SheetDB…" />;

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    app:    { minHeight:"100vh", background:"#060c18", color:"#e2e8f0", fontFamily:"'DM Sans','Segoe UI',sans-serif", fontSize:13 },
    hdr:    { background:"#0a1628", borderBottom:"1px solid #1e3a5f", padding:"10px 16px", display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" },
    logo:   { fontSize:14, fontWeight:800, letterSpacing:1, color:"#38bdf8", whiteSpace:"nowrap" },
    srchW:  { position:"relative", flex:"1 1 150px" },
    srch:   { width:"100%", background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"6px 10px 6px 28px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" },
    sel:    { background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"6px 8px", color:"#e2e8f0", fontSize:12, outline:"none", cursor:"pointer" },
    btnP:   { background:"#38bdf8", border:"none", borderRadius:8, padding:"6px 13px", color:"#060c18", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" },
    btnG:   { background:"#1e3a5f", border:"none", borderRadius:8, padding:"6px 12px", color:"#94a3b8", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" },
    body:   { display:"flex", height:"calc(100vh - 54px)", overflow:"hidden" },
    left:   { width:215, minWidth:200, background:"#0a1628", borderRight:"1px solid #1e3a5f", overflowY:"auto", padding:11, display:"flex", flexDirection:"column", gap:10 },
    center: { flex:1, overflowY:"auto", padding:13, display:"flex", flexDirection:"column", gap:11 },
    right:  { width:228, minWidth:210, background:"#0a1628", borderLeft:"1px solid #1e3a5f", overflowY:"auto", padding:11, display:"flex", flexDirection:"column", gap:8 },
    card:   { background:"#0f1f38", border:"1px solid #1e3a5f", borderRadius:10, padding:11 },
    cTitle: { fontSize:9, fontWeight:700, letterSpacing:2, color:"#64748b", textTransform:"uppercase", marginBottom:7 },
    tabBar: { display:"flex", gap:2, borderBottom:"1px solid #1e3a5f" },
    tab:    a => ({ padding:"7px 14px", background:"none", border:"none", borderBottom:a?"2px solid #38bdf8":"2px solid transparent", color:a?"#38bdf8":"#64748b", fontWeight:a?700:400, cursor:"pointer", fontSize:12, marginBottom:-1 }),
    tbl:    { width:"100%", borderCollapse:"collapse", fontSize:11 },
    th:     { textAlign:"left", padding:"7px 9px", fontSize:9, fontWeight:700, letterSpacing:1.5, color:"#64748b", textTransform:"uppercase", borderBottom:"1px solid #1e3a5f", whiteSpace:"nowrap" },
    td:     { padding:"6px 9px", borderBottom:"1px solid #0f2540", verticalAlign:"middle" },
    barW:   { background:"#1e293b", borderRadius:3, height:5, overflow:"hidden", marginTop:3 },
    bar:    (p,c) => ({ width:`${Math.min(p,100)}%`, height:"100%", background:c, borderRadius:3, transition:"width .5s" }),
    iSel:   (c) => ({ background:`${c}18`, border:`1px solid ${c}`, borderRadius:6, padding:"2px 7px", color:c, fontSize:10, cursor:"pointer", outline:"none", fontWeight:600 }),
  };

  return (
    <div style={S.app}>
      {/* ── HEADER ── */}
      <div style={S.hdr}>
        <span style={S.logo}>⚙ AUTOFLOW</span>
        <div style={S.srchW}>
          <svg style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",opacity:.4}} width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input style={S.srch} placeholder="Search Part # or Name…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {[["Engineer",ENGINEERS,fEng,setFEng],["Commodity",COMMODITIES,fCom,setFCom],["Activity",ACTIVITIES,fAct,setFAct],["Status",STATUSES,fStat,setFStat]].map(([l,o,v,set])=>(
          <select key={l} style={S.sel} value={v} onChange={e=>set(e.target.value)}>
            <option value="All">All {l}s</option>
            {o.map(x=><option key={x}>{x}</option>)}
          </select>
        ))}
        <button style={S.btnG} onClick={()=>{setSearch("");setFEng("All");setFCom("All");setFAct("All");setFStat("All");setActiveEng(null);}}>↺ Reset</button>
        <button style={S.btnP} onClick={()=>setShowModal(true)}>+ Add Task</button>
        <button style={S.btnG} onClick={()=>fetchData(true)}>{loading?"…":"⟳"}</button>
        {lastFetched && <span style={{fontSize:10,color:"#334155"}}>Updated {lastFetched.toLocaleTimeString()}</span>}
      </div>

      {error && (
        <div style={{background:"#ff444412",borderBottom:"1px solid #ff444444",padding:"7px 16px",display:"flex",justifyContent:"space-between"}}>
          <span style={{color:"#ff8888",fontSize:12}}>⚠ {error}</span>
          <button onClick={()=>setError(null)} style={{background:"none",border:"none",color:"#ff4444",cursor:"pointer",fontSize:16}}>×</button>
        </div>
      )}

      {/* ── BODY ── */}
      <div style={S.body}>

        {/* LEFT PANEL */}
        <div style={S.left}>

          {/* Summary KPI */}
          <div style={S.card}>
            <div style={S.cTitle}>{activeEng ? `${activeEng}'s Tasks` : "Task Summary"}</div>
            <div style={{fontSize:24,fontWeight:800,color:"#38bdf8",lineHeight:1}}>{implCount}<span style={{color:"#334155",fontSize:15}}>/{total}</span></div>
            <div style={{color:"#64748b",fontSize:10,marginTop:1}}>Implemented / Total</div>
            <div style={S.barW}><div style={S.bar(implRate,"#38bdf8")}/></div>
          </div>

          {/* Implementation Rate */}
          <div style={S.card}>
            <div style={S.cTitle}>Implementation Rate</div>
            <div style={{fontSize:22,fontWeight:800,color:"#22c55e"}}>{implRate}%</div>
            <div style={S.barW}><div style={S.bar(implRate,"#22c55e")}/></div>
          </div>

          {/* YTD */}
          <div style={S.card}>
            <div style={S.cTitle}>YTD Achievement</div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#94a3b8",marginBottom:3}}>
              <span>Target {ytdTarget}%</span><span>Actual {implRate}%</span>
            </div>
            <div style={{...S.barW,position:"relative",height:5}}>
              <div style={{...S.bar(ytdTarget,"#334155"),position:"absolute"}}/>
              <div style={{...S.bar(implRate,implRate>=ytdTarget?"#22c55e":"#ff8800"),position:"absolute"}}/>
            </div>
          </div>

          {/* Priority */}
          <div style={S.card}>
            <div style={S.cTitle}>Priority</div>
            {PRIORITIES.map(p=>(
              <div key={p} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{display:"flex",alignItems:"center",gap:5}}>
                  {p==="Critical"&&<span style={{width:6,height:6,borderRadius:"50%",background:"#ff4444",display:"inline-block",animation:"pulse 1s infinite"}}/>}
                  <span style={{color:"#94a3b8",fontSize:11}}>{p}</span>
                </span>
                <span style={{fontWeight:700,color:priorityColor[p],fontSize:12}}>{priCount[p]||0}</span>
              </div>
            ))}
          </div>

          {/* Donut */}
          <div style={{...S.card,display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={S.cTitle}>Status Split {activeEng&&`· ${activeEng}`}</div>
            <Donut data={donutData}/>
            <div style={{width:"100%",marginTop:5}}>
              {donutData.map(d=>(
                <div key={d.label} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{display:"flex",alignItems:"center",gap:5}}>
                    <span style={{width:7,height:7,borderRadius:2,background:d.color,display:"inline-block"}}/>
                    <span style={{color:"#94a3b8",fontSize:10}}>{d.label}</span>
                  </span>
                  <span style={{fontWeight:700,color:d.color,fontSize:11}}>{d.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Engineer bar — clickable */}
          <div style={S.card}>
            <div style={S.cTitle}>By Engineer <span style={{color:"#38bdf855",fontSize:8}}>(click to filter)</span></div>
            {engBarData.map((e,i)=>(
              <HBar key={e.name} label={e.name} impl={e.impl} pend={e.pend} total={e.total}
                color={e.color} active={activeEng===e.name}
                onClick={()=>setActiveEng(activeEng===e.name?null:e.name)}/>
            ))}
            {activeEng && <div style={{fontSize:9,color:"#38bdf8",marginTop:4,cursor:"pointer",textAlign:"center"}} onClick={()=>setActiveEng(null)}>× Clear filter</div>}
          </div>

          {/* Month chart */}
          <div style={S.card}>
            <div style={S.cTitle}>Monthly {activeEng&&`· ${activeEng}`}</div>
            <MonthChart tasks={chartTasks}/>
            <div style={{display:"flex",gap:10,marginTop:4,justifyContent:"center"}}>
              <span style={{fontSize:9,color:"#22c55e"}}>▮ Implemented</span>
              <span style={{fontSize:9,color:"#f59e0b"}}>▮ Pending</span>
            </div>
          </div>

          {/* Activity chart */}
          <div style={S.card}>
            <div style={S.cTitle}>By Activity {activeEng&&`· ${activeEng}`}</div>
            <ActivityChart tasks={chartTasks}/>
          </div>

        </div>

        {/* CENTER */}
        <div style={S.center}>
          <div style={S.tabBar}>
            {[["table","Tracking Table"],["matrix","Commodity Matrix"],["gantt","Timeline / Gantt"]].map(([k,l])=>(
              <button key={k} style={S.tab(activeTab===k)} onClick={()=>setActiveTab(k)}>{l}</button>
            ))}
          </div>

          {/* TRACKING TABLE */}
          {activeTab==="table" && (
            <div style={{...S.card,padding:0,overflowX:"auto"}}>
              <table style={S.tbl}>
                <thead>
                  <tr>{["Part #","Part Name","Engineer","Commodity","Activity","Priority","Status","Target","Days",""].map(h=>(
                    <th key={h} style={S.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filtered.map(row=>{
                    const urg=urgencyOf(row), days=daysFrom(row.target);
                    return (
                      <tr key={row.id} style={{background:urg==="overdue"||urg==="critical"?"#ff44440a":"transparent"}}>
                        <td style={S.td}><code style={{color:"#38bdf8",fontSize:10}}>{row.partNo}</code></td>
                        <td style={{...S.td,maxWidth:130,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{row.partName}</td>
                        <td style={S.td}><span style={{color:"#94a3b8"}}>{row.engineer}</span></td>
                        <td style={{...S.td,fontSize:10}}>{row.commodity}</td>
                        <td style={{...S.td,fontSize:10}}>{row.activity}</td>
                        <td style={S.td}>
                          <select style={S.iSel(priorityColor[row.priority]||"#94a3b8")}
                            value={row.priority} onChange={e=>updateField(row,"priority",e.target.value)}>
                            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          <select style={S.iSel(statusColor[row.status]||"#94a3b8")}
                            value={row.status} onChange={e=>updateField(row,"status",e.target.value)}>
                            {STATUSES.map(s=><option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={{...S.td,fontSize:10,color:"#94a3b8"}}>{row.target||"—"}</td>
                        <td style={{...S.td,fontWeight:700,fontSize:11,color:days===null?"#64748b":days<0?"#ff4444":days<7?"#ff8800":days<15?"#f5c518":"#22c55e"}}>
                          {days===null?"—":days<0?`${Math.abs(days)}d late`:`${days}d`}
                        </td>
                        <td style={S.td}>
                          <button onClick={()=>deleteRow(row)} style={{background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:14,padding:2}} title="Delete">🗑</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length===0 && <div style={{padding:24,textAlign:"center",color:"#64748b"}}>No tasks match the current filters.</div>}
            </div>
          )}

          {/* COMMODITY MATRIX */}
          {activeTab==="matrix" && (
            <div style={{...S.card,padding:0,overflowX:"auto"}}>
              <div style={{padding:"10px 14px",fontSize:10,color:"#64748b"}}>
                {activeEng ? `Showing data for: ${activeEng}` : "All engineers — click an engineer on the left to filter"}
              </div>
              <table style={{...S.tbl,fontSize:10}}>
                <thead>
                  <tr>
                    <th style={{...S.th,padding:"8px 14px"}}>Commodity ╲ Activity</th>
                    {ACTIVITIES.map(a=><th key={a} style={{...S.th,textAlign:"center"}}>{a}</th>)}
                    <th style={{...S.th,textAlign:"center"}}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(row=>{
                    const rT=row.cols.reduce((a,c)=>a+c.impl+c.pend,0);
                    const rI=row.cols.reduce((a,c)=>a+c.impl,0);
                    return (
                      <tr key={row.name}>
                        <td style={{...S.td,fontWeight:600,color:"#38bdf8",whiteSpace:"nowrap",padding:"8px 14px"}}>{row.name}</td>
                        {row.cols.map(c=>(
                          <td key={c.name} style={{...S.td,textAlign:"center",padding:5}}>
                            {c.impl+c.pend===0
                              ? <span style={{color:"#334155"}}>—</span>
                              : <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                                  {c.impl>0&&<span style={{background:"#22c55e22",border:"1px solid #22c55e",borderRadius:4,padding:"1px 6px",color:"#22c55e"}}>✓{c.impl}</span>}
                                  {c.pend>0&&<span style={{background:"#f59e0b22",border:"1px solid #f59e0b",borderRadius:4,padding:"1px 6px",color:"#f59e0b"}}>◷{c.pend}</span>}
                                </div>
                            }
                          </td>
                        ))}
                        <td style={{...S.td,textAlign:"center",fontWeight:700,color:rI===rT?"#22c55e":"#f59e0b"}}>{rI}/{rT}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* GANTT */}
          {activeTab==="gantt" && (
            <div style={S.card}>
              <div style={S.cTitle}>Timeline — Elapsed Progress {activeEng&&`· ${activeEng}`}</div>
              {(activeEng ? filtered.filter(t=>t.engineer===activeEng) : filtered).map(row=>{
                const start=new Date("2025-01-01"), end=row.target?new Date(row.target):new Date("2025-12-31");
                const elapsed=Math.min(Math.max((today-start)/Math.max(end-start,1),0),1);
                const urg=urgencyOf(row);
                const bc=urg==="overdue"||urg==="critical"?"#ff4444":urg==="warning"?"#f5c518":"#22c55e";
                return (
                  <div key={row.id} style={{marginBottom:9}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2,fontSize:10}}>
                      <span><code style={{color:"#38bdf8"}}>{row.partNo}</code> — {row.partName}</span>
                      <span style={{color:"#64748b"}}>{row.engineer} · {row.target||"—"}</span>
                    </div>
                    <div style={{background:"#0f2540",borderRadius:4,height:11,position:"relative",overflow:"hidden"}}>
                      <div style={{width:`${elapsed*100}%`,height:"100%",background:bc,transition:"width .5s",boxShadow:`0 0 5px ${bc}88`}}/>
                      <div style={{position:"absolute",right:5,top:0,height:"100%",display:"flex",alignItems:"center",fontSize:9,color:"#64748b"}}>{Math.round(elapsed*100)}%</div>
                    </div>
                  </div>
                );
              })}
              {filtered.length===0&&<div style={{color:"#64748b",textAlign:"center",padding:20}}>No tasks match filters.</div>}
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={S.right}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth={2}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span style={{fontWeight:700,fontSize:11,letterSpacing:1,color:"#38bdf8"}}>URGENCY DECK</span>
          </div>
          {sidebarItems.length===0&&<div style={{color:"#64748b",fontSize:11,textAlign:"center",marginTop:20}}>All tasks implemented 🎉</div>}
          {sidebarItems.map(t=>{
            const b=urgencyMeta[t.urg]||urgencyMeta.ok;
            return (
              <div key={t.id} style={{background:b.bg,border:`1px solid ${b.border}`,borderRadius:8,padding:9}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{background:b.border,color:"#000",fontSize:8,fontWeight:800,borderRadius:3,padding:"2px 5px",letterSpacing:.8}}>{b.label}</span>
                  <span style={{fontSize:9,color:priorityColor[t.priority],fontWeight:700}}>{t.priority}</span>
                </div>
                <div style={{fontSize:11,fontWeight:600,color:"#e2e8f0",marginBottom:2}}>{t.partName}</div>
                <div style={{fontSize:10,color:"#64748b"}}>{t.partNo} · {t.engineer}</div>
                <div style={{fontSize:10,color:b.text,marginTop:3,fontWeight:700}}>
                  {t.days===null?"No date":t.days<0?`${Math.abs(t.days)}d overdue`:`${t.days}d left`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ADD MODAL */}
      {showModal && <AddModal onClose={()=>setShowModal(false)} onSave={addTask} saving={saving}/>}

      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#060c18}
        ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:3px}
        select option{background:#0a1628}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
