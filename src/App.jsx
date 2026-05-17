import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SHEETDB_URL = import.meta.env.VITE_SHEETDB_URL || "";
const REFRESH_MS  = 30_000;

// ─── FIXED lookup lists (order + color only — NOT used for graph data) ────────
const STATUSES   = ["Pending", "In Progress", "Implemented", "On Hold"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const priorityColor = { Critical:"#ff4444", High:"#ff8800", Medium:"#f5c518", Low:"#22c55e" };
const statusColor   = { Pending:"#f59e0b", "In Progress":"#38bdf8", Implemented:"#22c55e", "On Hold":"#94a3b8" };

// Auto-assign colors to any engineer found in the sheet
const ENG_PALETTE = ["#38bdf8","#a78bfa","#34d399","#fb923c","#f472b6","#facc15","#60a5fa","#4ade80"];
const getEngColor = (name, list) => ENG_PALETTE[list.indexOf(name) % ENG_PALETTE.length];

const urgencyMeta = {
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
  const d=daysFrom(row.target);
  if(d===null) return "none";
  if(d<0)  return "overdue";
  if(d<7)  return "critical";
  if(d<15) return "warning";
  return "ok";
};
const monthOf = d => { if(!d) return null; const t=new Date(d); return isNaN(t)?null:t.getMonth(); };

// Derive unique sorted values from actual sheet data
const unique = (arr) => [...new Set(arr.filter(Boolean))].sort();

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
      <text x={cx} y={cy-5} textAnchor="middle" fill="#e2e8f0" fontSize="15" fontWeight="bold">
        {data.reduce((a,b)=>a+b.v,0)}
      </text>
      <text x={cx} y={cy+9} textAnchor="middle" fill="#64748b" fontSize="7">TASKS</text>
    </svg>
  );
}

// ─── Engineer Bar (always from ALL tasks) ─────────────────────────────────────
function HBar({ label, impl, pend, total, color, onClick, active }) {
  const pct = total ? Math.round((impl/total)*100) : 0;
  return (
    <div onClick={onClick} style={{cursor:"pointer",padding:"5px 6px",borderRadius:7,
      background:active?"#1e3a5f33":"transparent",
      border:active?"1px solid #38bdf855":"1px solid transparent",marginBottom:4}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
        <span style={{color:active?"#38bdf8":"#94a3b8",fontWeight:active?700:400}}>{label}</span>
        <span><span style={{color:"#22c55e"}}>✓{impl} </span><span style={{color:"#f59e0b"}}>◷{pend}</span></span>
      </div>
      <div style={{background:"#1e293b",borderRadius:3,height:7,overflow:"hidden",display:"flex"}}>
        <div style={{width:`${pct}%`,height:"100%",background:color,transition:"width .5s",borderRadius:3}}/>
      </div>
    </div>
  );
}

// ─── Month Chart — driven by passed tasks (live from sheet) ──────────────────
function MonthChart({ tasks }) {
  const data = MONTHS.map((m,i)=>({
    m,
    impl: tasks.filter(t=>t.status==="Implemented" && monthOf(t.actual)===i).length,
    pend: tasks.filter(t=>t.status!=="Implemented" && monthOf(t.target)===i).length,
  }));
  const max = Math.max(...data.map(d=>d.impl+d.pend),1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:3,height:72,padding:"0 2px"}}>
      {data.map(d=>{
        const total=d.impl+d.pend;
        return (
          <div key={d.m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            {total>0
              ? <span style={{fontSize:7,color:"#94a3b8",fontWeight:700,marginBottom:1,lineHeight:1}}>{total}</span>
              : <span style={{fontSize:7,color:"transparent",marginBottom:1,lineHeight:1}}>0</span>
            }
            <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:46,gap:1}}>
              {d.impl>0&&<div style={{width:"100%",height:`${(d.impl/max)*46}px`,background:"#22c55e",borderRadius:"2px 2px 0 0",minHeight:2}}/>}
              {d.pend>0&&<div style={{width:"100%",height:`${(d.pend/max)*46}px`,background:"#f59e0b",borderRadius:d.impl?"0":"2px 2px 0 0",minHeight:2}}/>}
            </div>
            <span style={{fontSize:7,color:"#334155"}}>{d.m}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Activity Chart — driven by passed tasks (live from sheet) ───────────────
function ActivityChart({ tasks, activities }) {
  // activities list derived from actual sheet data
  const data = activities.map(a=>({
    a: a.length>14?a.slice(0,13)+"…":a,
    full: a,
    impl: tasks.filter(t=>t.activity===a&&t.status==="Implemented").length,
    pend: tasks.filter(t=>t.activity===a&&t.status!=="Implemented").length,
  }));
  const max = Math.max(...data.map(d=>d.impl+d.pend),1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {data.map(d=>(
        <div key={d.full}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#64748b",marginBottom:2}}>
            <span title={d.full}>{d.a}</span>
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
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      height:"100vh",gap:16,background:"#060c18"}}>
      <div style={{width:40,height:40,border:"3px solid #1e3a5f",borderTop:"3px solid #38bdf8",
        borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <p style={{color:"#64748b",fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>{msg}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── Setup Guide ──────────────────────────────────────────────────────────────
function SetupGuide() {
  return (
    <div style={{minHeight:"100vh",background:"#060c18",color:"#e2e8f0",
      fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{maxWidth:600,background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:14,padding:32}}>
        <h1 style={{fontSize:22,fontWeight:800,color:"#38bdf8",marginBottom:8}}>⚙ AUTOFLOW — SheetDB Setup</h1>
        <p style={{color:"#94a3b8",marginBottom:24,lineHeight:1.7}}>
          Connect your Google Sheet via SheetDB for full two-way sync. All engineers, commodities and activities are read live from your sheet — nothing is hardcoded.
        </p>
        {[
          ["1","Create Google Sheet","Row 1 headers: partNo, partName, engineer, commodity, activity, priority, status, target, actual"],
          ["2","Sign up at sheetdb.io","Create API → paste your Google Sheet edit URL → copy the API URL"],
          ["3","Add to .env","VITE_SHEETDB_URL=https://sheetdb.io/api/v1/YOUR_API_ID"],
          ["4","Deploy to Vercel","Settings → Environment Variables → add VITE_SHEETDB_URL → Redeploy"],
        ].map(([n,t,d])=>(
          <div key={n} style={{display:"flex",gap:14,marginBottom:18}}>
            <div style={{width:26,height:26,borderRadius:"50%",background:"#38bdf8",color:"#060c18",
              fontWeight:800,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{n}</div>
            <div>
              <div style={{fontWeight:700,color:"#e2e8f0",marginBottom:3}}>{t}</div>
              <div style={{color:"#64748b",fontSize:12,lineHeight:1.6}}>{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Add Task Modal ───────────────────────────────────────────────────────────
function AddModal({ onClose, onSave, saving, engineers, commodities, activities }) {
  const EMPTY = { partNo:"", partName:"", engineer:engineers[0]||"", commodity:commodities[0]||"",
    activity:activities[0]||"", priority:"Medium", status:"Pending", target:"", actual:"" };
  const [form, setForm] = useState(EMPTY);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inp = { width:"100%", background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8,
    padding:"7px 10px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#64748b",
    marginBottom:3, letterSpacing:.8, textTransform:"uppercase" };
  return (
    <div style={{position:"fixed",inset:0,background:"#000b",zIndex:1000,display:"flex",
      alignItems:"center",justifyContent:"center"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:14,padding:24,
        width:500,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <span style={{fontSize:15,fontWeight:800,color:"#38bdf8"}}>+ New Task</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:20}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={lbl}>Part Number</label>
            <input style={inp} value={form.partNo} onChange={e=>set("partNo",e.target.value)} placeholder="e.g. RBR-013"/></div>
          <div><label style={lbl}>Part Name</label>
            <input style={inp} value={form.partName} onChange={e=>set("partName",e.target.value)} placeholder="e.g. Exhaust Gasket"/></div>
          {/* Dynamic dropdowns from sheet data */}
          {[["Engineer","engineer",engineers],["Commodity","commodity",commodities],
            ["Activity","activity",activities],["Priority","priority",PRIORITIES],["Status","status",STATUSES]].map(([l,k,opts])=>(
            <div key={k}><label style={lbl}>{l}</label>
              <select style={{...inp,cursor:"pointer"}} value={form[k]} onChange={e=>set(k,e.target.value)}>
                {opts.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
          <div><label style={lbl}>Target Date</label>
            <input type="date" style={inp} value={form.target} onChange={e=>set("target",e.target.value)}/></div>
          <div><label style={lbl}>Actual Date</label>
            <input type="date" style={inp} value={form.actual} onChange={e=>set("actual",e.target.value)}/></div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onClose} style={{background:"#1e3a5f",border:"none",borderRadius:8,
            padding:"7px 16px",color:"#94a3b8",cursor:"pointer",fontSize:12,fontWeight:600}}>Cancel</button>
          <button onClick={()=>onSave(form)} disabled={saving||!form.partNo||!form.partName}
            style={{background:saving||!form.partNo||!form.partName?"#334155":"#38bdf8",
            border:"none",borderRadius:8,padding:"7px 16px",
            color:saving||!form.partNo||!form.partName?"#64748b":"#060c18",
            cursor:"pointer",fontSize:12,fontWeight:700}}>
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
  const [activeEng, setActiveEng]     = useState(null);
  const timerRef = useRef(null);

  // ── FETCH ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (isManual=false) => {
    if (!SHEETDB_URL) { setLoading(false); return; }
    if (isManual) setLoading(true);
    try {
      const res = await fetch(SHEETDB_URL, { cache:"no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const parsed = json.map((row,i)=>({
        id:        row.partNo+"_"+i,
        partNo:    (row.partNo    ||"").trim(),
        partName:  (row.partName  ||"").trim(),
        engineer:  (row.engineer  ||"").trim(),
        commodity: (row.commodity ||"").trim(),
        activity:  (row.activity  ||"").trim(),
        priority:  (row.priority  ||"Medium").trim(),
        status:    (row.status    ||"Pending").trim(),
        target:    (row.target    ||"").trim(),
        actual:    (row.actual    ||"").trim(),
      })).filter(r=>r.partNo);
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
    timerRef.current = setInterval(()=>fetchData(), REFRESH_MS);
    return ()=>clearInterval(timerRef.current);
  }, [fetchData]);

  // ── DYNAMIC LISTS — derived 100% from sheet data, update on every fetch ──
  const engineers   = useMemo(()=>unique(tasks.map(t=>t.engineer)),   [tasks]);
  const commodities = useMemo(()=>unique(tasks.map(t=>t.commodity)),  [tasks]);
  const activities  = useMemo(()=>unique(tasks.map(t=>t.activity)),   [tasks]);
  const statuses    = useMemo(()=>{
    // keep fixed order but only show statuses that exist in data
    const inData = unique(tasks.map(t=>t.status));
    const ordered = STATUSES.filter(s=>inData.includes(s));
    // add any new ones from sheet not in our fixed list
    inData.forEach(s=>{ if(!ordered.includes(s)) ordered.push(s); });
    return ordered;
  }, [tasks]);

  // ── UPDATE ────────────────────────────────────────────────────────────────
  const updateField = async (row, field, val) => {
    setTasks(prev=>prev.map(t=>t.id===row.id?{...t,[field]:val}:t));
    try {
      await fetch(`${SHEETDB_URL}/partNo/${encodeURIComponent(row.partNo)}`, {
        method:"PATCH", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({data:{[field]:val}}),
      });
    } catch(e) {
      setError("Save failed — reverting.");
      setTasks(prev=>prev.map(t=>t.id===row.id?{...t,[field]:row[field]}:t));
    }
  };

  // ── ADD ───────────────────────────────────────────────────────────────────
  const addTask = async (form) => {
    setSaving(true);
    try {
      const res = await fetch(SHEETDB_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({data:[form]}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowModal(false);
      await fetchData(true);
    } catch(e) {
      setError(`Failed to add: ${e.message}`);
    } finally { setSaving(false); }
  };

  // ── DELETE ────────────────────────────────────────────────────────────────
  const deleteRow = async (row) => {
    if (!window.confirm(`Delete ${row.partNo} — ${row.partName}?`)) return;
    setTasks(prev=>prev.filter(t=>t.id!==row.id));
    try {
      await fetch(`${SHEETDB_URL}/partNo/${encodeURIComponent(row.partNo)}`,{method:"DELETE"});
    } catch(e) { setError("Delete failed — refreshing."); fetchData(); }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // DATA SLICES
  // ──────────────────────────────────────────────────────────────────────────

  // Table/Gantt — header dropdown filters
  const filteredRows = useMemo(()=>tasks.filter(t=>{
    const q=search.toLowerCase();
    if(q&&!t.partNo.toLowerCase().includes(q)&&!t.partName.toLowerCase().includes(q)) return false;
    if(fEng!=="All"&&t.engineer!==fEng)   return false;
    if(fCom!=="All"&&t.commodity!==fCom)  return false;
    if(fAct!=="All"&&t.activity!==fAct)   return false;
    if(fStat!=="All"&&t.status!==fStat)   return false;
    return true;
  }),[tasks,search,fEng,fCom,fAct,fStat]);

  // Left panel charts — engineer click filter
  const engTasks = useMemo(()=>
    activeEng ? tasks.filter(t=>t.engineer===activeEng) : tasks,
  [tasks,activeEng]);

  // Engineer bar — always ALL tasks (never filtered)
  const engBarData = useMemo(()=>engineers.map(e=>({
    name:e,
    color: getEngColor(e, engineers),
    impl:  tasks.filter(t=>t.engineer===e&&t.status==="Implemented").length,
    pend:  tasks.filter(t=>t.engineer===e&&t.status!=="Implemented").length,
    total: tasks.filter(t=>t.engineer===e).length,
  })),[tasks,engineers]);

  // Commodity Matrix — always ALL tasks, static
  const matrix = useMemo(()=>commodities.map(c=>({
    name:c,
    cols: activities.map(a=>({
      name:a,
      impl: tasks.filter(t=>t.commodity===c&&t.activity===a&&t.status==="Implemented").length,
      pend: tasks.filter(t=>t.commodity===c&&t.activity===a&&t.status!=="Implemented").length,
    })),
  })),[tasks,commodities,activities]);

  // KPIs — engTasks
  const total     = engTasks.length;
  const implCount = engTasks.filter(t=>t.status==="Implemented").length;
  const implRate  = total?Math.round((implCount/total)*100):0;

  // Donut — engTasks, only statuses present in engTasks
  const donutData = useMemo(()=>{
    const inData = unique(engTasks.map(t=>t.status));
    const ordered = STATUSES.filter(s=>inData.includes(s));
    inData.forEach(s=>{if(!ordered.includes(s))ordered.push(s);});
    return ordered.map(s=>({
      label:s, v:engTasks.filter(t=>t.status===s).length,
      color: statusColor[s]||"#64748b"
    }));
  },[engTasks]);

  // Priority counts — engTasks
  const priCount = useMemo(()=>{
    const inData = unique(engTasks.map(t=>t.priority));
    const ordered = PRIORITIES.filter(p=>inData.includes(p));
    inData.forEach(p=>{if(!ordered.includes(p))ordered.push(p);});
    return ordered.map(p=>({
      label:p, v:engTasks.filter(t=>t.priority===p).length,
      color: priorityColor[p]||"#94a3b8"
    }));
  },[engTasks]);

  // Urgency sidebar — always all tasks
  const sidebarItems = useMemo(()=>
    tasks.filter(t=>t.status!=="Implemented")
      .map(t=>({...t,urg:urgencyOf(t),days:daysFrom(t.target)}))
      .sort((a,b)=>({overdue:0,critical:1,warning:2,ok:3,none:4}[a.urg]-{overdue:0,critical:1,warning:2,ok:3,none:4}[b.urg])),
  [tasks]);

  if (!SHEETDB_URL) return <SetupGuide />;
  if (loading && tasks.length===0) return <Spinner msg="Loading from Google Sheet via SheetDB…" />;

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    app:  { minHeight:"100vh", background:"#060c18", color:"#e2e8f0", fontFamily:"'DM Sans','Segoe UI',sans-serif", fontSize:13 },
    hdr:  { background:"#0a1628", borderBottom:"1px solid #1e3a5f", padding:"10px 16px", display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" },
    logo: { fontSize:14, fontWeight:800, letterSpacing:1, color:"#38bdf8", whiteSpace:"nowrap" },
    srchW:{ position:"relative", flex:"1 1 150px" },
    srch: { width:"100%", background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"6px 10px 6px 28px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" },
    sel:  { background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8, padding:"6px 8px", color:"#e2e8f0", fontSize:12, outline:"none", cursor:"pointer" },
    btnP: { background:"#38bdf8", border:"none", borderRadius:8, padding:"6px 13px", color:"#060c18", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" },
    btnG: { background:"#1e3a5f", border:"none", borderRadius:8, padding:"6px 12px", color:"#94a3b8", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" },
    body: { display:"flex", height:"calc(100vh - 54px)", overflow:"hidden" },
    left: { width:215, minWidth:200, background:"#0a1628", borderRight:"1px solid #1e3a5f", overflowY:"auto", padding:11, display:"flex", flexDirection:"column", gap:10 },
    ctr:  { flex:1, overflowY:"auto", padding:13, display:"flex", flexDirection:"column", gap:11 },
    rght: { width:228, minWidth:210, background:"#0a1628", borderLeft:"1px solid #1e3a5f", overflowY:"auto", padding:11, display:"flex", flexDirection:"column", gap:8 },
    card: { background:"#0f1f38", border:"1px solid #1e3a5f", borderRadius:10, padding:11 },
    cT:   { fontSize:9, fontWeight:700, letterSpacing:2, color:"#64748b", textTransform:"uppercase", marginBottom:7 },
    tabB: { display:"flex", gap:2, borderBottom:"1px solid #1e3a5f" },
    tab:  a=>({ padding:"7px 14px", background:"none", border:"none", borderBottom:a?"2px solid #38bdf8":"2px solid transparent", color:a?"#38bdf8":"#64748b", fontWeight:a?700:400, cursor:"pointer", fontSize:12, marginBottom:-1 }),
    tbl:  { width:"100%", borderCollapse:"collapse", fontSize:11 },
    th:   { textAlign:"left", padding:"7px 9px", fontSize:9, fontWeight:700, letterSpacing:1.5, color:"#64748b", textTransform:"uppercase", borderBottom:"1px solid #1e3a5f", whiteSpace:"nowrap" },
    td:   { padding:"6px 9px", borderBottom:"1px solid #0f2540", verticalAlign:"middle" },
    barW: { background:"#1e293b", borderRadius:3, height:5, overflow:"hidden", marginTop:3 },
    bar:  (p,c)=>({ width:`${Math.min(p,100)}%`, height:"100%", background:c, borderRadius:3, transition:"width .5s" }),
    iSel: c=>({ background:`${c}18`, border:`1px solid ${c}`, borderRadius:6, padding:"2px 7px", color:c, fontSize:10, cursor:"pointer", outline:"none", fontWeight:600 }),
    iTxt: { background:"#0a1628", border:"1px solid transparent", borderRadius:6, padding:"2px 6px", color:"#38bdf8", fontSize:11, outline:"none", width:"100%", minWidth:60, fontFamily:"inherit", transition:"border-color .15s", cursor:"text" },
  };

  return (
    <div style={S.app}>
      {/* HEADER */}
      <div style={S.hdr}>
        <span style={S.logo}>⚙ AUTOFLOW</span>
        <div style={S.srchW}>
          <svg style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",opacity:.4}} width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input style={S.srch} placeholder="Search Part # or Name…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {/* All dropdowns populated from live sheet data */}
        <select style={S.sel} value={fEng} onChange={e=>setFEng(e.target.value)}>
          <option value="All">All Engineers</option>
          {engineers.map(x=><option key={x}>{x}</option>)}
        </select>
        <select style={S.sel} value={fCom} onChange={e=>setFCom(e.target.value)}>
          <option value="All">All Commodities</option>
          {commodities.map(x=><option key={x}>{x}</option>)}
        </select>
        <select style={S.sel} value={fAct} onChange={e=>setFAct(e.target.value)}>
          <option value="All">All Activities</option>
          {activities.map(x=><option key={x}>{x}</option>)}
        </select>
        <select style={S.sel} value={fStat} onChange={e=>setFStat(e.target.value)}>
          <option value="All">All Statuses</option>
          {statuses.map(x=><option key={x}>{x}</option>)}
        </select>
        <button style={S.btnG} onClick={()=>{setSearch("");setFEng("All");setFCom("All");setFAct("All");setFStat("All");setActiveEng(null);}}>↺ Reset</button>
        <button style={S.btnP} onClick={()=>setShowModal(true)}>+ Add Task</button>
        <button style={S.btnG} onClick={()=>fetchData(true)}>{loading?"…":"⟳"}</button>
        {lastFetched&&<span style={{fontSize:10,color:"#334155"}}>Updated {lastFetched.toLocaleTimeString()}</span>}
      </div>

      {error&&(
        <div style={{background:"#ff444412",borderBottom:"1px solid #ff444433",padding:"7px 16px",display:"flex",justifyContent:"space-between"}}>
          <span style={{color:"#ff8888",fontSize:12}}>⚠ {error}</span>
          <button onClick={()=>setError(null)} style={{background:"none",border:"none",color:"#ff4444",cursor:"pointer",fontSize:16}}>×</button>
        </div>
      )}

      <div style={S.body}>

        {/* LEFT PANEL */}
        <div style={S.left}>

          <div style={S.card}>
            <div style={S.cT}>{activeEng?`${activeEng}'s Tasks`:"All Tasks"}</div>
            <div style={{fontSize:24,fontWeight:800,color:"#38bdf8",lineHeight:1}}>
              {implCount}<span style={{color:"#334155",fontSize:15}}>/{total}</span>
            </div>
            <div style={{color:"#64748b",fontSize:10,marginTop:1}}>Implemented / Total</div>
            <div style={S.barW}><div style={S.bar(implRate,"#38bdf8")}/></div>
          </div>

          <div style={S.card}>
            <div style={S.cT}>Implementation Rate</div>
            <div style={{fontSize:22,fontWeight:800,color:"#22c55e"}}>{implRate}%</div>
            <div style={S.barW}><div style={S.bar(implRate,"#22c55e")}/></div>
          </div>

          <div style={S.card}>
            <div style={S.cT}>YTD Achievement</div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#94a3b8",marginBottom:3}}>
              <span>Target 90%</span><span>Actual {implRate}%</span>
            </div>
            <div style={{...S.barW,position:"relative",height:5}}>
              <div style={{...S.bar(90,"#334155"),position:"absolute"}}/>
              <div style={{...S.bar(implRate,implRate>=90?"#22c55e":"#ff8800"),position:"absolute"}}/>
            </div>
          </div>

          {/* Priority — only priorities present in sheet */}
          <div style={S.card}>
            <div style={S.cT}>Priority {activeEng&&<span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            {priCount.map(p=>(
              <div key={p.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{display:"flex",alignItems:"center",gap:5}}>
                  {p.label==="Critical"&&<span style={{width:6,height:6,borderRadius:"50%",background:"#ff4444",display:"inline-block",animation:"pulse 1s infinite"}}/>}
                  <span style={{color:"#94a3b8",fontSize:11}}>{p.label}</span>
                </span>
                <span style={{fontWeight:700,color:p.color,fontSize:12}}>{p.v}</span>
              </div>
            ))}
          </div>

          {/* Donut — only statuses present in sheet */}
          <div style={{...S.card,display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={S.cT}>Status Split {activeEng&&<span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
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

          {/* Engineer bar — ALWAYS all tasks, engineers from sheet */}
          <div style={S.card}>
            <div style={S.cT}>By Engineer <span style={{color:"#38bdf855",fontSize:8,textTransform:"none"}}>(click to filter charts)</span></div>
            {engBarData.map(e=>(
              <HBar key={e.name} label={e.name} impl={e.impl} pend={e.pend} total={e.total}
                color={e.color} active={activeEng===e.name}
                onClick={()=>setActiveEng(activeEng===e.name?null:e.name)}/>
            ))}
            {activeEng&&<div style={{fontSize:9,color:"#38bdf8",marginTop:4,cursor:"pointer",textAlign:"center"}} onClick={()=>setActiveEng(null)}>× Clear filter</div>}
          </div>

          {/* Monthly chart — engTasks */}
          <div style={S.card}>
            <div style={S.cT}>Monthly {activeEng&&<span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            <MonthChart tasks={engTasks}/>
            <div style={{display:"flex",gap:10,marginTop:4,justifyContent:"center"}}>
              <span style={{fontSize:9,color:"#22c55e"}}>▮ Implemented</span>
              <span style={{fontSize:9,color:"#f59e0b"}}>▮ Pending/Other</span>
            </div>
          </div>

          {/* Activity chart — engTasks, activities from sheet */}
          <div style={S.card}>
            <div style={S.cT}>By Activity {activeEng&&<span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            <ActivityChart tasks={engTasks} activities={activities}/>
          </div>

        </div>

        {/* CENTER */}
        <div style={S.ctr}>
          <div style={S.tabB}>
            {[["table","Tracking Table"],["matrix","Commodity Matrix (Static)"],["gantt","Timeline / Gantt"]].map(([k,l])=>(
              <button key={k} style={S.tab(activeTab===k)} onClick={()=>setActiveTab(k)}>{l}</button>
            ))}
          </div>

          {/* TRACKING TABLE */}
          {activeTab==="table"&&(
            <div style={{...S.card,padding:0,overflowX:"auto"}}>
              <table style={S.tbl}>
                <thead>
                  <tr>{["Part #","Part Name","Engineer","Commodity","Activity","Priority","Status","Target","Overdue Days","Delete"].map(h=>(
                    <th key={h} style={S.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filteredRows.map(row=>{
                    const urg=urgencyOf(row),days=daysFrom(row.target);
                    return (
                      <tr key={row.id} style={{background:urg==="overdue"||urg==="critical"?"#ff44440a":"transparent"}}>
                        {/* Part # — inline editable */}
                        <td style={S.td}>
                          <input style={S.iTxt} value={row.partNo}
                            onChange={e=>setTasks(prev=>prev.map(t=>t.id===row.id?{...t,partNo:e.target.value}:t))}
                            onBlur={e=>updateField(row,"partNo",e.target.value)}/>
                        </td>
                        {/* Part Name */}
                        <td style={{...S.td,maxWidth:150}}>
                          <input style={{...S.iTxt,width:"100%",minWidth:90}} value={row.partName}
                            onChange={e=>setTasks(prev=>prev.map(t=>t.id===row.id?{...t,partName:e.target.value}:t))}
                            onBlur={e=>updateField(row,"partName",e.target.value)}/>
                        </td>
                        {/* Engineer */}
                        <td style={S.td}>
                          <input style={{...S.iTxt,minWidth:80}} value={row.engineer}
                            onChange={e=>setTasks(prev=>prev.map(t=>t.id===row.id?{...t,engineer:e.target.value}:t))}
                            onBlur={e=>updateField(row,"engineer",e.target.value)}/>
                        </td>
                        {/* Commodity */}
                        <td style={{...S.td,fontSize:10}}>
                          <select style={S.iSel("#94a3b8")} value={row.commodity}
                            onChange={e=>updateField(row,"commodity",e.target.value)}>
                            {commodities.map(c=><option key={c}>{c}</option>)}
                          </select>
                        </td>
                        {/* Activity */}
                        <td style={{...S.td,fontSize:10}}>
                          <select style={S.iSel("#94a3b8")} value={row.activity}
                            onChange={e=>updateField(row,"activity",e.target.value)}>
                            {activities.map(a=><option key={a}>{a}</option>)}
                          </select>
                        </td>
                        {/* Priority */}
                        <td style={S.td}>
                          <select style={S.iSel(priorityColor[row.priority]||"#94a3b8")}
                            value={row.priority} onChange={e=>updateField(row,"priority",e.target.value)}>
                            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
                          </select>
                        </td>
                        {/* Status */}
                        <td style={S.td}>
                          <select style={S.iSel(statusColor[row.status]||"#94a3b8")}
                            value={row.status} onChange={e=>updateField(row,"status",e.target.value)}>
                            {STATUSES.map(s=><option key={s}>{s}</option>)}
                          </select>
                        </td>
                        {/* Target Date */}
                        <td style={S.td}>
                          <input type="date" style={{...S.iTxt,fontSize:10,color:"#94a3b8",minWidth:110}} value={row.target}
                            onChange={e=>{
                              const val=e.target.value;
                              setTasks(prev=>prev.map(t=>t.id===row.id?{...t,target:val}:t));
                              if(val) updateField(row,"target",val);
                            }}/>
                        </td>
                        {/* Overdue Days */}
                        <td style={{...S.td,fontWeight:700,fontSize:11,whiteSpace:"nowrap",
                          color:days===null?"#64748b":days<0?"#ff4444":days<7?"#ff8800":days<15?"#f5c518":"#22c55e"}}>
                          {days===null?"—":days<0?`${Math.abs(days)}`:`${days}`}
                        </td>
                        {/* Delete */}
                        <td style={{...S.td,textAlign:"center"}}>
                          <button onClick={()=>deleteRow(row)}
                            title="Delete task"
                            style={{background:"#ff444418",border:"1px solid #ff444444",color:"#ff6666",
                              cursor:"pointer",fontSize:13,padding:"3px 7px",borderRadius:6,
                              lineHeight:1,transition:"all .15s"}}
                            onMouseEnter={e=>{e.currentTarget.style.background="#ff444433";e.currentTarget.style.borderColor="#ff4444";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="#ff444418";e.currentTarget.style.borderColor="#ff444444";}}>
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredRows.length===0&&<div style={{padding:24,textAlign:"center",color:"#64748b"}}>No tasks match the current filters.</div>}
            </div>
          )}

          {/* COMMODITY MATRIX — always all tasks, all commodities/activities from sheet */}
          {activeTab==="matrix"&&(
            <div style={{...S.card,padding:0,overflowX:"auto"}}>
              <div style={{padding:"8px 14px 0",fontSize:9,color:"#64748b",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>
                All Engineers · All Data · Static — <span style={{color:"#334155",textTransform:"none",letterSpacing:0}}>not affected by filters</span>
              </div>
              <table style={{...S.tbl,fontSize:10,marginTop:4}}>
                <thead>
                  <tr>
                    <th style={{...S.th,padding:"8px 14px"}}>Commodity ╲ Activity</th>
                    {activities.map(a=><th key={a} style={{...S.th,textAlign:"center"}}>{a}</th>)}
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
                              ?<span style={{color:"#334155"}}>—</span>
                              :<div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
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
          {activeTab==="gantt"&&(
            <div style={S.card}>
              <div style={S.cT}>Timeline — Elapsed Progress</div>
              {filteredRows.map(row=>{
                const start=new Date("2025-01-01"),end=row.target?new Date(row.target):new Date("2025-12-31");
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
              {filteredRows.length===0&&<div style={{color:"#64748b",textAlign:"center",padding:20}}>No tasks match filters.</div>}
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={S.rght}>
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
                  <span style={{fontSize:9,color:priorityColor[t.priority]||"#94a3b8",fontWeight:700}}>{t.priority}</span>
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

      {showModal&&(
        <AddModal onClose={()=>setShowModal(false)} onSave={addTask} saving={saving}
          engineers={engineers} commodities={commodities} activities={activities}/>
      )}

      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#060c18}
        ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:3px}
        select option{background:#0a1628}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes spin{to{transform:rotate(360deg)}}
        input:focus{border-color:#38bdf855!important;background:#0f2540!important;color:#e2e8f0!important;}
        tr:hover td{background:#ffffff04;}
      `}</style>
    </div>
  );
}
