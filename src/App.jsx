import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL  = "https://xdynkskncnljbekqqgix.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkeW5rc2tuY25samJla3FxZ2l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjMwNjQsImV4cCI6MjA5NDU5OTA2NH0.DKOU1UbrxwjE18gLzwiK0D8KtOs756BcbnLc5ufiMQ8";
const TABLE = "tasks";
const HEADERS = {
  "Content-Type":  "application/json",
  "apikey":        SUPABASE_ANON,
  "Authorization": `Bearer ${SUPABASE_ANON}`,
  "Prefer":        "return=representation",
};

const sbFetch = (path, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...HEADERS, ...(opts.headers || {}) },
  });

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUSES   = ["Pending", "In Progress", "Implemented", "On Hold"];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const priorityColor = { Critical:"#ff4444", High:"#ff8800", Medium:"#f5c518", Low:"#22c55e" };
const statusColor   = { Pending:"#f59e0b", "In Progress":"#38bdf8", Implemented:"#22c55e", "On Hold":"#94a3b8" };

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
const daysFrom  = d => { if (!d) return null; const t = new Date(d); return isNaN(t) ? null : Math.ceil((t - today) / 86400000); };
const urgencyOf = row => {
  if (row.status === "Implemented") return "done";
  const d = daysFrom(row.target_date);
  if (d === null) return "none";
  if (d < 0)  return "overdue";
  if (d < 7)  return "critical";
  if (d < 15) return "warning";
  return "ok";
};
const monthOf = d => { if (!d) return null; const t = new Date(d); return isNaN(t) ? null : t.getMonth(); };
const unique  = arr => [...new Set(arr.filter(Boolean))].sort();

// Parse Supabase row → app shape
const parseRow = row => ({
  id:           row.id,
  partNo:       (row.part_no      || "").trim(),
  partName:     (row.part_name    || "").trim(),
  engineer:     (row.engineer     || "").trim(),
  commodity:    (row.commodity    || "").trim(),
  category:     (row.category     || "").trim(),
  model:        (row.model        || "").trim(),
  priority:     (row.priority     || "Medium").trim(),
  status:       (row.status       || "Pending").trim(),
  initial_date: (row.initial_date || "").trim(),
  target_date:  (row.target_date  || "").trim(),
  actual:       (row.actual       || "").trim(),
});

// Map app field → Supabase column
const toCol = f => ({ partNo:"part_no", partName:"part_name", target_date:"target_date", initial_date:"initial_date" }[f] || f);

// Normalise an Excel serial date or string → "YYYY-MM-DD"
const normaliseDate = val => {
  if (!val) return "";
  if (typeof val === "number") {
    // Excel date serial
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return "";
    const mm = String(d.m).padStart(2,"0"), dd = String(d.d).padStart(2,"0");
    return `${d.y}-${mm}-${dd}`;
  }
  const s = String(val).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // DD-MM-YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20"+m[3] : m[3];
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  return s;
};

// ─── Column auto-mapper ───────────────────────────────────────────────────────
// Maps any reasonable Excel header → our internal field name
const FIELD_ALIASES = {
  partNo:       ["part no","part#","part number","partno","part_no","pn","no","part no."],
  partName:     ["part name","partname","part_name","name","description","desc","part description","item name","item"],
  engineer:     ["engineer","eng","owner","assigned to","assignee","engineers"],
  commodity:    ["commodity","commodities","type","group","com","commodity name"],
  category:     ["category","categories","activity","action","phase","stage","act","cat"],
  model:        ["model","model name","model no","model number","models","variant"],
  priority:     ["priority","pri","urgency","sev","severity","priorities"],
  status:       ["status","state","sts","progress","current status"],
  initial_date: ["initial date","initial_date","initialdate","start date","start","start_date","begin date","from date","initial","begin","kickoff date","raised date"],
  target_date:  ["target","target date","target_date","targetdate","due","due date","deadline","planned date","completion target","end date"],
  actual:       ["actual","actual date","actual_date","actualdate","completed","completion date","done date","closed date","finish date"],
};

const autoMap = headers => {
  const map = {};
  headers.forEach(h => {
    const norm = h.toLowerCase().replace(/\s+/g, " ").trim();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!map[field] && aliases.some(a => a === norm)) {
        map[field] = h;
        break;
      }
    }
  });
  return map;
};

// ─── SVG Donut ────────────────────────────────────────────────────────────────
function Donut({ data, size=110 }) {
  const total = data.reduce((a,b) => a+b.v, 0) || 1;
  const r=38, cx=50, cy=50, circ=2*Math.PI*r;
  let offset=0;
  const segs = data.map(d => { const s={...d,pct:d.v/total,offset}; offset+=s.pct; return s; });
  return (
    <svg viewBox="0 0 100 100" style={{width:size,height:size}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={13}/>
      {segs.map((s,i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={13}
          strokeDasharray={`${s.pct*circ} ${circ}`} strokeDashoffset={-s.offset*circ}
          style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",filter:`drop-shadow(0 0 3px ${s.color})`}}/>
      ))}
      <text x={cx} y={cy-5} textAnchor="middle" fill="#e2e8f0" fontSize="15" fontWeight="bold">
        {data.reduce((a,b) => a+b.v, 0)}
      </text>
      <text x={cx} y={cy+9} textAnchor="middle" fill="#64748b" fontSize="7">TASKS</text>
    </svg>
  );
}

// ─── Engineer Bar ─────────────────────────────────────────────────────────────
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
      <div style={{background:"#1e293b",borderRadius:3,height:7,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:color,transition:"width .5s",borderRadius:3}}/>
      </div>
    </div>
  );
}

// ─── Month Chart ──────────────────────────────────────────────────────────────
// Counts tasks per month based on the span between initial_date and target_date.
// A task "belongs" to every month in its [initial_date, target_date] range.
// Completed = status Implemented (shown by target_date month); In Progress = others (by target_date month).
function MonthChart({ tasks }) {
  const data = MONTHS.map((m, i) => {
    const completed = tasks.filter(t => {
      if (t.status !== "Implemented") return false;
      const tMonth = monthOf(t.target_date);
      return tMonth === i;
    }).length;
    const inProgress = tasks.filter(t => {
      if (t.status === "Implemented") return false;
      const iMonth = monthOf(t.initial_date);
      const tMonth = monthOf(t.target_date);
      if (tMonth === null) return false;
      // Task spans this month if initial_date month <= i <= target_date month
      const start = iMonth !== null ? iMonth : tMonth;
      return i >= start && i <= tMonth;
    }).length;
    return { m, completed, inProgress };
  });
  const max = Math.max(...data.map(d => d.completed + d.inProgress), 1);
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:3,height:72,padding:"0 2px"}}>
      {data.map(d => {
        const total = d.completed + d.inProgress;
        return (
          <div key={d.m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <span style={{fontSize:7,color:total>0?"#94a3b8":"transparent",fontWeight:700,marginBottom:1,lineHeight:1}}>{total||0}</span>
            <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:46,gap:1}}>
              {d.completed>0 && <div style={{width:"100%",height:`${(d.completed/max)*46}px`,background:"#22c55e",borderRadius:"2px 2px 0 0",minHeight:2}}/>}
              {d.inProgress>0 && <div style={{width:"100%",height:`${(d.inProgress/max)*46}px`,background:"#38bdf8",borderRadius:d.completed?"0":"2px 2px 0 0",minHeight:2}}/>}
            </div>
            <span style={{fontSize:7,color:"#334155"}}>{d.m}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Category Chart ───────────────────────────────────────────────────────────
function ActivityChart({ tasks, activities }) {
  const data = activities.map(a => ({
    a: a.length>14 ? a.slice(0,13)+"…" : a, full:a,
    impl: tasks.filter(t => t.category===a && t.status==="Implemented").length,
    pend: tasks.filter(t => t.category===a && t.status!=="Implemented").length,
  }));
  const max = Math.max(...data.map(d => d.impl+d.pend), 1);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {data.map(d => (
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
function Spinner({ msg }) {
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

// ─── Add Task Modal ───────────────────────────────────────────────────────────
function AddModal({ onClose, onSave, saving }) {
  const EMPTY = { partNo:"", partName:"", engineer:"", commodity:"", category:"", model:"",
    priority:"Medium", status:"Pending", initial_date:"", target_date:"", actual:"" };
  const [form, setForm] = useState(EMPTY);
  const set = (k,v) => setForm(f => ({...f,[k]:v}));
  const inp = { width:"100%", background:"#0f2540", border:"1px solid #1e3a5f", borderRadius:8,
    padding:"7px 10px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:"#64748b",
    marginBottom:3, letterSpacing:.8, textTransform:"uppercase" };
  return (
    <div style={{position:"fixed",inset:0,background:"#000b",zIndex:1000,display:"flex",
      alignItems:"center",justifyContent:"center"}} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:14,padding:24,
        width:500,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <span style={{fontSize:15,fontWeight:800,color:"#38bdf8"}}>+ New Task</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:20}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {[["Part Number","partNo","e.g. RBR-013"],["Part Name","partName","e.g. Exhaust Gasket"],
            ["Engineer","engineer","Engineer name"],["Commodity","commodity","e.g. Fasteners"],
            ["Category","category","e.g. PPAP"],["Model","model","e.g. Model X"]].map(([l,k,ph]) => (
            <div key={k}><label style={lbl}>{l}</label>
              <input style={inp} value={form[k]} onChange={e => set(k,e.target.value)} placeholder={ph}/>
            </div>
          ))}
          {[["Priority","priority",PRIORITIES],["Status","status",STATUSES]].map(([l,k,opts]) => (
            <div key={k}><label style={lbl}>{l}</label>
              <select style={{...inp,cursor:"pointer"}} value={form[k]} onChange={e => set(k,e.target.value)}>
                {opts.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
          <div><label style={lbl}>Initial Date</label>
            <input type="date" style={inp} value={form.initial_date} onChange={e => set("initial_date",e.target.value)}/></div>
          <div><label style={lbl}>Target Date</label>
            <input type="date" style={inp} value={form.target_date} onChange={e => set("target_date",e.target.value)}/></div>
          <div><label style={lbl}>Actual Date</label>
            <input type="date" style={inp} value={form.actual} onChange={e => set("actual",e.target.value)}/></div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:20}}>
          <button onClick={onClose} style={{background:"#1e3a5f",border:"none",borderRadius:8,
            padding:"7px 16px",color:"#94a3b8",cursor:"pointer",fontSize:12,fontWeight:600}}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving||!form.partNo||!form.partName}
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

// ─── Import Modal ─────────────────────────────────────────────────────────────
function ImportModal({ onClose, onImport, importing }) {
  const [rows,    setRows]    = useState([]);      // parsed preview rows (app shape)
  const [headers, setHeaders] = useState([]);      // original Excel headers
  const [mapping, setMapping] = useState({});      // field → Excel header
  const [fileName,setFileName]= useState("");
  const [step,    setStep]    = useState("upload");// upload | map | preview
  const [error,   setError]   = useState("");

  const appFields = ["partNo","partName","engineer","commodity","category","model","priority","status","initial_date","target_date","actual"];
  const fieldLabels = { partNo:"Part No", partName:"Part Name", engineer:"Engineer",
    commodity:"Commodity", category:"Category", model:"Model",
    priority:"Priority", status:"Status",
    initial_date:"Initial Date", target_date:"Target Date", actual:"Actual Date" };

  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type:"array", cellDates:false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval:"", raw:true });
        if (!raw.length) { setError("Sheet is empty."); return; }
        const hdrs = Object.keys(raw[0]);
        setHeaders(hdrs);
        setMapping(autoMap(hdrs));
        setRows(raw);
        setStep("map");
      } catch(err) {
        setError("Could not read file: "+err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Build preview from current mapping
  const preview = useMemo(() => rows.slice(0,5).map(r => {
    const obj = {};
    appFields.forEach(f => {
      const col = mapping[f];
      let val = col ? String(r[col]||"").trim() : "";
      if (f==="target_date"||f==="initial_date"||f==="actual") val = normaliseDate(col ? r[col] : "");
      obj[f] = val;
    });
    return obj;
  }), [rows, mapping]);

  const allRows = useMemo(() => rows.map(r => {
    const obj = {};
    appFields.forEach(f => {
      const col = mapping[f];
      let val = col ? String(r[col]||"").trim() : "";
      if (f==="target_date"||f==="initial_date"||f==="actual") val = normaliseDate(col ? r[col] : "");
      obj[f] = val;
    });
    return obj;
  }), [rows, mapping]);

  const S = {
    overlay: { position:"fixed",inset:0,background:"#000c",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center" },
    box:     { background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:14,padding:28,width:700,maxWidth:"96vw",maxHeight:"92vh",overflowY:"auto" },
    h2:      { fontSize:15,fontWeight:800,color:"#38bdf8",marginBottom:4 },
    sub:     { fontSize:11,color:"#64748b",marginBottom:18 },
    lbl:     { fontSize:10,fontWeight:700,color:"#64748b",marginBottom:3,letterSpacing:.8,textTransform:"uppercase",display:"block" },
    sel:     { width:"100%",background:"#0f2540",border:"1px solid #1e3a5f",borderRadius:7,padding:"5px 8px",color:"#e2e8f0",fontSize:11,outline:"none" },
    btnP:    { background:"#38bdf8",border:"none",borderRadius:8,padding:"7px 18px",color:"#060c18",fontSize:12,fontWeight:700,cursor:"pointer" },
    btnG:    { background:"#1e3a5f",border:"none",borderRadius:8,padding:"7px 14px",color:"#94a3b8",fontSize:12,fontWeight:600,cursor:"pointer" },
    th:      { textAlign:"left",padding:"6px 10px",fontSize:9,fontWeight:700,letterSpacing:1.5,color:"#64748b",textTransform:"uppercase",borderBottom:"1px solid #1e3a5f" },
    td:      { padding:"5px 10px",fontSize:11,borderBottom:"1px solid #0f2540",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" },
  };

  return (
    <div style={S.overlay} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={S.box}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={S.h2}>📥 Import from Excel / CSV</div>
            <div style={S.sub}>
              {step==="upload" && "Upload your .xlsx or .csv file to import tasks in bulk."}
              {step==="map"    && `"${fileName}" — Map your columns to app fields, then preview.`}
              {step==="preview"&& `Preview of first 5 rows from "${fileName}". ${rows.length} total rows will be imported.`}
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
        </div>

        {error && <div style={{background:"#ff444418",border:"1px solid #ff4444",borderRadius:8,padding:"8px 12px",color:"#ff8888",fontSize:12,marginBottom:14}}>{error}</div>}

        {/* STEP 1 — Upload */}
        {step==="upload" && (
          <label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            border:"2px dashed #1e3a5f",borderRadius:12,padding:40,cursor:"pointer",gap:10,
            background:"#0f1f38",transition:"border-color .2s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="#38bdf8"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="#1e3a5f"}>
            <span style={{fontSize:36}}>📂</span>
            <span style={{color:"#e2e8f0",fontWeight:700,fontSize:13}}>Click to choose file</span>
            <span style={{color:"#64748b",fontSize:11}}>Supports .xlsx, .xls, .csv</span>
            <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleFile}/>
          </label>
        )}

        {/* STEP 2 — Column Mapping */}
        {step==="map" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
              {appFields.map(f => (
                <div key={f}>
                  <label style={S.lbl}>
                    {fieldLabels[f]}
                    {(f==="partNo"||f==="partName") && <span style={{color:"#ff4444"}}> *</span>}
                  </label>
                  <select style={S.sel} value={mapping[f]||""} onChange={e => setMapping(m => ({...m,[f]:e.target.value}))}>
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,color:"#64748b"}}>{rows.length} rows detected</span>
              <div style={{display:"flex",gap:10}}>
                <button style={S.btnG} onClick={() => setStep("upload")}>← Back</button>
                <button style={S.btnP} onClick={() => setStep("preview")}
                  disabled={!mapping.partNo && !mapping.partName}>
                  Preview →
                </button>
              </div>
            </div>
          </>
        )}

        {/* STEP 3 — Preview */}
        {step==="preview" && (
          <>
            <div style={{overflowX:"auto",marginBottom:16}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr>{appFields.map(f => <th key={f} style={S.th}>{fieldLabels[f]}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row,i) => (
                    <tr key={i}>
                      {appFields.map(f => (
                        <td key={f} style={{...S.td,color:f==="partNo"?"#38bdf8":f==="status"?statusColor[row[f]]||"#e2e8f0":f==="priority"?priorityColor[row[f]]||"#e2e8f0":"#e2e8f0"}}>
                          {row[f]||<span style={{color:"#334155"}}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length>5 && <div style={{fontSize:11,color:"#64748b",padding:"8px 10px"}}>… and {rows.length-5} more rows</div>}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:11,color:"#64748b"}}>
                <span style={{color:"#38bdf8",fontWeight:700}}>{rows.length}</span> rows will be saved to Supabase
              </div>
              <div style={{display:"flex",gap:10}}>
                <button style={S.btnG} onClick={() => setStep("map")}>← Edit Mapping</button>
                <button style={{...S.btnP,background:importing?"#334155":"#22c55e",color:importing?"#64748b":"#060c18"}}
                  onClick={() => onImport(allRows)} disabled={importing}>
                  {importing ? "Importing…" : `✓ Import ${rows.length} Rows`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [importing, setImporting]     = useState(false);
  const [error, setError]             = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [search, setSearch]           = useState("");
  const [fEng, setFEng]               = useState("All");
  const [fCom, setFCom]               = useState("All");
  const [fAct, setFAct]               = useState("All");
  const [fStat, setFStat]             = useState("All");
  const [activeTab, setActiveTab]     = useState("table");
  const [showModal, setShowModal]     = useState(false);
  const [showImport, setShowImport]   = useState(false);
  const [activeEng, setActiveEng]     = useState(null);
  const debounceRef = useRef({});

  // ── FETCH ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (isManual=false) => {
    if (isManual) setLoading(true);
    try {
      const res = await sbFetch(`${TABLE}?select=*&order=id.asc`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTasks(json.map(parseRow).filter(r => r.partNo));
      setError(null);
      setLastFetched(new Date());
    } catch(e) {
      setError(`Refresh failed — showing last data. (${e.message})`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── DERIVED LISTS ─────────────────────────────────────────────────────────
  const engineers   = useMemo(() => unique(tasks.map(t => t.engineer)),  [tasks]);
  const commodities = useMemo(() => unique(tasks.map(t => t.commodity)), [tasks]);
  const activities  = useMemo(() => unique(tasks.map(t => t.category)),  [tasks]);
  const statuses    = useMemo(() => {
    const inData = unique(tasks.map(t => t.status));
    const ordered = STATUSES.filter(s => inData.includes(s));
    inData.forEach(s => { if (!ordered.includes(s)) ordered.push(s); });
    return ordered;
  }, [tasks]);

  // ── UPDATE — debounced 600ms ──────────────────────────────────────────────
  const updateField = useCallback((row, field, val) => {
    setTasks(prev => prev.map(t => t.id===row.id ? {...t,[field]:val} : t));
    const key = `${row.id}_${field}`;
    clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(async () => {
      try {
        const res = await sbFetch(`${TABLE}?id=eq.${row.id}`, {
          method:"PATCH",
          headers:{ Prefer:"return=minimal" },
          body: JSON.stringify({ [toCol(field)]: val || null }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch(e) {
        setError(`Save failed for ${field}.`);
        setTasks(prev => prev.map(t => t.id===row.id ? {...t,[field]:row[field]} : t));
      }
    }, 600);
  }, []);

  // ── ADD ───────────────────────────────────────────────────────────────────
  const addTask = async (form) => {
    setSaving(true);
    try {
      const res = await sbFetch(TABLE, {
        method:"POST",
        body: JSON.stringify({
          part_no:      form.partNo,
          part_name:    form.partName,
          engineer:     form.engineer,
          commodity:    form.commodity,
          category:     form.category,
          model:        form.model || null,
          priority:     form.priority,
          status:       form.status,
          initial_date: form.initial_date || null,
          target_date:  form.target_date || null,
          actual:       form.actual || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const [newRow] = await res.json();
      setTasks(prev => [...prev, parseRow(newRow)]);
      setShowModal(false);
    } catch(e) {
      setError(`Failed to add task: ${e.message}`);
    } finally { setSaving(false); }
  };

  // ── DELETE ────────────────────────────────────────────────────────────────
  const deleteRow = async (row) => {
    if (!window.confirm(`Delete ${row.partNo} — ${row.partName}?`)) return;
    setTasks(prev => prev.filter(t => t.id!==row.id));
    try {
      await sbFetch(`${TABLE}?id=eq.${row.id}`, { method:"DELETE", headers:{ Prefer:"return=minimal" } });
    } catch(e) {
      setError("Delete failed — restoring.");
      fetchData();
    }
  };

  // ── IMPORT ────────────────────────────────────────────────────────────────
  const handleImport = async (rows) => {
    setImporting(true);
    try {
      // Supabase allows bulk insert in one POST
      const payload = rows.map(r => ({
        part_no:      r.partNo   || null,
        part_name:    r.partName || null,
        engineer:     r.engineer || null,
        commodity:    r.commodity|| null,
        category:     r.category || null,
        model:        r.model    || null,
        priority:     PRIORITIES.includes(r.priority) ? r.priority : "Medium",
        status:       STATUSES.includes(r.status)     ? r.status   : "Pending",
        initial_date: r.initial_date || null,
        target_date:  r.target_date  || null,
        actual:       r.actual   || null,
      })).filter(r => r.part_no || r.part_name);

      const CHUNK = 50; // Supabase handles bulk fine; chunk for safety
      const inserted = [];
      for (let i=0; i<payload.length; i+=CHUNK) {
        const chunk = payload.slice(i, i+CHUNK);
        const res = await sbFetch(TABLE, {
          method:"POST",
          body: JSON.stringify(chunk),
        });
        if (!res.ok) {
          const err = await res.json().catch(()=>({}));
          throw new Error(err.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        inserted.push(...data);
      }
      setTasks(prev => [...prev, ...inserted.map(parseRow)]);
      setShowImport(false);
      setError(null);
    } catch(e) {
      setError(`Import failed: ${e.message}`);
    } finally { setImporting(false); }
  };

  // ── DATA SLICES ───────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => tasks.filter(t => {
    const q = search.toLowerCase();
    if (q && !t.partNo.toLowerCase().includes(q) && !t.partName.toLowerCase().includes(q)) return false;
    if (fEng !=="All" && t.engineer  !==fEng)  return false;
    if (fCom !=="All" && t.commodity !==fCom)  return false;
    if (fAct !=="All" && t.category  !==fAct)  return false;
    if (fStat!=="All" && t.status    !==fStat) return false;
    return true;
  }), [tasks,search,fEng,fCom,fAct,fStat]);

  const engTasks   = useMemo(() => activeEng ? tasks.filter(t => t.engineer===activeEng) : tasks, [tasks,activeEng]);
  const engBarData = useMemo(() => engineers.map(e => ({
    name:e, color:getEngColor(e,engineers),
    impl:  tasks.filter(t => t.engineer===e && t.status==="Implemented").length,
    pend:  tasks.filter(t => t.engineer===e && t.status!=="Implemented").length,
    total: tasks.filter(t => t.engineer===e).length,
  })), [tasks,engineers]);

  const matrix = useMemo(() => commodities.map(c => ({
    name:c,
    cols: activities.map(a => ({
      name:a,
      impl: tasks.filter(t => t.commodity===c && t.category===a && t.status==="Implemented").length,
      pend: tasks.filter(t => t.commodity===c && t.category===a && t.status!=="Implemented").length,
    })),
  })), [tasks,commodities,activities]);

  const total     = engTasks.length;
  const implCount = engTasks.filter(t => t.status==="Implemented").length;
  const implRate  = total ? Math.round((implCount/total)*100) : 0;

  const donutData = useMemo(() => {
    const inData = unique(engTasks.map(t => t.status));
    const ordered = STATUSES.filter(s => inData.includes(s));
    inData.forEach(s => { if (!ordered.includes(s)) ordered.push(s); });
    return ordered.map(s => ({ label:s, v:engTasks.filter(t => t.status===s).length, color:statusColor[s]||"#64748b" }));
  }, [engTasks]);

  const priCount = useMemo(() => {
    const inData = unique(engTasks.map(t => t.priority));
    const ordered = PRIORITIES.filter(p => inData.includes(p));
    inData.forEach(p => { if (!ordered.includes(p)) ordered.push(p); });
    return ordered.map(p => ({ label:p, v:engTasks.filter(t => t.priority===p).length, color:priorityColor[p]||"#94a3b8" }));
  }, [engTasks]);

  const sidebarItems = useMemo(() =>
    tasks.filter(t => t.status!=="Implemented")
      .map(t => ({...t, urg:urgencyOf(t), days:daysFrom(t.target_date)}))
      .sort((a,b) => ({overdue:0,critical:1,warning:2,ok:3,none:4}[a.urg] - {overdue:0,critical:1,warning:2,ok:3,none:4}[b.urg])),
  [tasks]);

  if (loading && tasks.length===0) return <Spinner msg="Connecting to Supabase…" />;

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
    btnI: { background:"#a78bfa22", border:"1px solid #a78bfa66", borderRadius:8, padding:"6px 12px", color:"#a78bfa", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" },
    body: { display:"flex", height:"calc(100vh - 54px)", overflow:"hidden" },
    left: { width:215, minWidth:200, background:"#0a1628", borderRight:"1px solid #1e3a5f", overflowY:"auto", padding:11, display:"flex", flexDirection:"column", gap:10 },
    ctr:  { flex:1, overflowY:"auto", padding:13, display:"flex", flexDirection:"column", gap:11 },
    rght: { width:228, minWidth:210, background:"#0a1628", borderLeft:"1px solid #1e3a5f", overflowY:"auto", padding:11, display:"flex", flexDirection:"column", gap:8 },
    card: { background:"#0f1f38", border:"1px solid #1e3a5f", borderRadius:10, padding:11 },
    cT:   { fontSize:9, fontWeight:700, letterSpacing:2, color:"#64748b", textTransform:"uppercase", marginBottom:7 },
    tabB: { display:"flex", gap:2, borderBottom:"1px solid #1e3a5f" },
    tab:  a => ({ padding:"7px 14px", background:"none", border:"none", borderBottom:a?"2px solid #38bdf8":"2px solid transparent", color:a?"#38bdf8":"#64748b", fontWeight:a?700:400, cursor:"pointer", fontSize:12, marginBottom:-1 }),
    tbl:  { width:"100%", borderCollapse:"collapse", fontSize:11 },
    th:   { textAlign:"left", padding:"7px 9px", fontSize:9, fontWeight:700, letterSpacing:1.5, color:"#64748b", textTransform:"uppercase", borderBottom:"1px solid #1e3a5f", whiteSpace:"nowrap" },
    td:   { padding:"6px 9px", borderBottom:"1px solid #0f2540", verticalAlign:"middle" },
    barW: { background:"#1e293b", borderRadius:3, height:5, overflow:"hidden", marginTop:3 },
    bar:  (p,c) => ({ width:`${Math.min(p,100)}%`, height:"100%", background:c, borderRadius:3, transition:"width .5s" }),
    iSel: c => ({ background:`${c}18`, border:`1px solid ${c}`, borderRadius:6, padding:"2px 7px", color:c, fontSize:10, cursor:"pointer", outline:"none", fontWeight:600 }),
    iTxt: { background:"#0a1628", border:"1px solid transparent", borderRadius:6, padding:"2px 6px", color:"#38bdf8", fontSize:11, outline:"none", width:"100%", minWidth:60, fontFamily:"inherit", transition:"border-color .15s", cursor:"text" },
  };

  return (
    <div style={S.app}>
      {/* HEADER */}
      <div style={S.hdr}>
        <span style={S.logo}>⚙ AUTOFLOW</span>
        <div style={S.srchW}>
          <svg style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",opacity:.4}}
            width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input style={S.srch} placeholder="Search Part # or Name…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <select style={S.sel} value={fEng}  onChange={e => setFEng(e.target.value)}>
          <option value="All">All Engineers</option>
          {engineers.map(x => <option key={x}>{x}</option>)}
        </select>
        <select style={S.sel} value={fCom}  onChange={e => setFCom(e.target.value)}>
          <option value="All">All Commodities</option>
          {commodities.map(x => <option key={x}>{x}</option>)}
        </select>
        <select style={S.sel} value={fAct}  onChange={e => setFAct(e.target.value)}>
          <option value="All">All Categories</option>
          {activities.map(x => <option key={x}>{x}</option>)}
        </select>
        <select style={S.sel} value={fStat} onChange={e => setFStat(e.target.value)}>
          <option value="All">All Statuses</option>
          {statuses.map(x => <option key={x}>{x}</option>)}
        </select>
        <button style={S.btnG} onClick={() => { setSearch(""); setFEng("All"); setFCom("All"); setFAct("All"); setFStat("All"); setActiveEng(null); }}>↺ Reset</button>
        <button style={S.btnP} onClick={() => setShowModal(true)}>+ Add Task</button>
        <button style={S.btnI} onClick={() => setShowImport(true)}>📥 Import</button>
        <button style={S.btnG} onClick={() => fetchData(true)}>{loading?"…":"⟳"}</button>
        {lastFetched && <span style={{fontSize:10,color:"#334155"}}>Updated {lastFetched.toLocaleTimeString()}</span>}
      </div>

      {error && (
        <div style={{background:"#ff444412",borderBottom:"1px solid #ff444433",padding:"7px 16px",display:"flex",justifyContent:"space-between"}}>
          <span style={{color:"#ff8888",fontSize:12}}>⚠ {error}</span>
          <button onClick={() => setError(null)} style={{background:"none",border:"none",color:"#ff4444",cursor:"pointer",fontSize:16}}>×</button>
        </div>
      )}

      <div style={S.body}>

        {/* LEFT PANEL */}
        <div style={S.left}>
          <div style={S.card}>
            <div style={S.cT}>{activeEng ? `${activeEng}'s Tasks` : "All Tasks"}</div>
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

          <div style={S.card}>
            <div style={S.cT}>Priority {activeEng && <span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            {priCount.map(p => (
              <div key={p.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{display:"flex",alignItems:"center",gap:5}}>
                  {p.label==="Critical" && <span style={{width:6,height:6,borderRadius:"50%",background:"#ff4444",display:"inline-block",animation:"pulse 1s infinite"}}/>}
                  <span style={{color:"#94a3b8",fontSize:11}}>{p.label}</span>
                </span>
                <span style={{fontWeight:700,color:p.color,fontSize:12}}>{p.v}</span>
              </div>
            ))}
          </div>

          <div style={{...S.card,display:"flex",flexDirection:"column",alignItems:"center"}}>
            <div style={S.cT}>Status Split {activeEng && <span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            <Donut data={donutData}/>
            <div style={{width:"100%",marginTop:5}}>
              {donutData.map(d => (
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

          <div style={S.card}>
            <div style={S.cT}>By Engineer <span style={{color:"#38bdf855",fontSize:8,textTransform:"none"}}>(click to filter)</span></div>
            {engBarData.map(e => (
              <HBar key={e.name} label={e.name} impl={e.impl} pend={e.pend} total={e.total}
                color={e.color} active={activeEng===e.name}
                onClick={() => setActiveEng(activeEng===e.name ? null : e.name)}/>
            ))}
            {activeEng && <div style={{fontSize:9,color:"#38bdf8",marginTop:4,cursor:"pointer",textAlign:"center"}} onClick={() => setActiveEng(null)}>× Clear filter</div>}
          </div>

          <div style={S.card}>
            <div style={S.cT}>Monthly {activeEng && <span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            <MonthChart tasks={engTasks}/>
            <div style={{display:"flex",gap:10,marginTop:4,justifyContent:"center"}}>
              <span style={{fontSize:9,color:"#22c55e"}}>▮ Completed</span>
              <span style={{fontSize:9,color:"#38bdf8"}}>▮ In Progress</span>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cT}>By Category {activeEng && <span style={{color:"#38bdf855"}}>· {activeEng}</span>}</div>
            <ActivityChart tasks={engTasks} activities={activities}/>
          </div>
        </div>

        {/* CENTER */}
        <div style={S.ctr}>
          <div style={S.tabB}>
            {[["table","Tracking Table"],["matrix","Commodity Matrix"],["gantt","Timeline / Gantt"],["monthly","Monthly Dashboard"]].map(([k,l]) => (
              <button key={k} style={S.tab(activeTab===k)} onClick={() => setActiveTab(k)}>{l}</button>
            ))}
          </div>

          {/* TRACKING TABLE */}
          {activeTab==="table" && (
            <div style={{...S.card,padding:0,overflowX:"auto"}}>
              <table style={S.tbl}>
                <thead>
                  <tr>{["Part #","Part Name","Engineer","Commodity","Category","Model","Priority","Status","Initial Date","Target Date","Overdue Days","Delete"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => {
                    const urg = urgencyOf(row), days = daysFrom(row.target_date);
                    return (
                      <tr key={row.id} style={{background:urg==="overdue"||urg==="critical"?"#ff44440a":"transparent"}}>
                        <td style={S.td}><input style={S.iTxt} value={row.partNo}    onChange={e => updateField(row,"partNo",e.target.value)}/></td>
                        <td style={{...S.td,maxWidth:150}}><input style={{...S.iTxt,minWidth:90}} value={row.partName}  onChange={e => updateField(row,"partName",e.target.value)}/></td>
                        <td style={S.td}><input style={{...S.iTxt,minWidth:80}} value={row.engineer}  onChange={e => updateField(row,"engineer",e.target.value)}/></td>
                        <td style={S.td}><input style={{...S.iTxt,minWidth:80}} value={row.commodity} onChange={e => updateField(row,"commodity",e.target.value)}/></td>
                        <td style={S.td}><input style={{...S.iTxt,minWidth:80}} value={row.category}  onChange={e => updateField(row,"category",e.target.value)}/></td>
                        <td style={S.td}><input style={{...S.iTxt,minWidth:80}} value={row.model}     onChange={e => updateField(row,"model",e.target.value)}/></td>
                        <td style={S.td}>
                          <select style={S.iSel(priorityColor[row.priority]||"#94a3b8")} value={row.priority} onChange={e => updateField(row,"priority",e.target.value)}>
                            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          <select style={S.iSel(statusColor[row.status]||"#94a3b8")} value={row.status} onChange={e => updateField(row,"status",e.target.value)}>
                            {STATUSES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          <input type="date" style={{...S.iTxt,fontSize:10,color:"#94a3b8",minWidth:110}} value={row.initial_date} onChange={e => updateField(row,"initial_date",e.target.value)}/>
                        </td>
                        <td style={S.td}>
                          <input type="date" style={{...S.iTxt,fontSize:10,color:"#94a3b8",minWidth:110}} value={row.target_date} onChange={e => updateField(row,"target_date",e.target.value)}/>
                        </td>
                        <td style={{...S.td,fontWeight:700,fontSize:11,whiteSpace:"nowrap",
                          color:days===null?"#64748b":days<0?"#ff4444":days<7?"#ff8800":days<15?"#f5c518":"#22c55e"}}>
                          {days===null?"—":Math.abs(days)}
                        </td>
                        <td style={{...S.td,textAlign:"center"}}>
                          <button onClick={() => deleteRow(row)} title="Delete task"
                            style={{background:"#ff444418",border:"1px solid #ff444444",color:"#ff6666",
                              cursor:"pointer",fontSize:13,padding:"3px 7px",borderRadius:6,lineHeight:1,transition:"all .15s"}}
                            onMouseEnter={e => { e.currentTarget.style.background="#ff444433"; e.currentTarget.style.borderColor="#ff4444"; }}
                            onMouseLeave={e => { e.currentTarget.style.background="#ff444418"; e.currentTarget.style.borderColor="#ff444444"; }}>
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredRows.length===0 && <div style={{padding:24,textAlign:"center",color:"#64748b"}}>No tasks match the current filters.</div>}
            </div>
          )}

          {/* COMMODITY MATRIX */}
          {activeTab==="matrix" && (
            <div style={{...S.card,padding:0,overflowX:"auto"}}>
              <div style={{padding:"8px 14px 0",fontSize:9,color:"#64748b",letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>
                All Engineers · All Data · <span style={{color:"#334155",textTransform:"none",letterSpacing:0}}>not affected by filters</span>
              </div>
              <table style={{...S.tbl,fontSize:10,marginTop:4}}>
                <thead>
                  <tr>
                    <th style={{...S.th,padding:"8px 14px"}}>Commodity ╲ Category</th>
                    {activities.map(a => <th key={a} style={{...S.th,textAlign:"center"}}>{a}</th>)}
                    <th style={{...S.th,textAlign:"center"}}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(row => {
                    const rT = row.cols.reduce((a,c) => a+c.impl+c.pend, 0);
                    const rI = row.cols.reduce((a,c) => a+c.impl, 0);
                    return (
                      <tr key={row.name}>
                        <td style={{...S.td,fontWeight:600,color:"#38bdf8",whiteSpace:"nowrap",padding:"8px 14px"}}>{row.name}</td>
                        {row.cols.map(c => (
                          <td key={c.name} style={{...S.td,textAlign:"center",padding:5}}>
                            {c.impl+c.pend===0
                              ? <span style={{color:"#334155"}}>—</span>
                              : <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                                  {c.impl>0 && <span style={{background:"#22c55e22",border:"1px solid #22c55e",borderRadius:4,padding:"1px 6px",color:"#22c55e"}}>✓{c.impl}</span>}
                                  {c.pend>0 && <span style={{background:"#f59e0b22",border:"1px solid #f59e0b",borderRadius:4,padding:"1px 6px",color:"#f59e0b"}}>◷{c.pend}</span>}
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
              <div style={S.cT}>Timeline — Elapsed Progress</div>
              {filteredRows.map(row => {
                const start = new Date("2025-01-01"), end = row.target_date ? new Date(row.target_date) : new Date("2025-12-31");
                const elapsed = Math.min(Math.max((today-start)/Math.max(end-start,1),0),1);
                const urg = urgencyOf(row);
                const bc = urg==="overdue"||urg==="critical"?"#ff4444":urg==="warning"?"#f5c518":"#22c55e";
                return (
                  <div key={row.id} style={{marginBottom:9}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2,fontSize:10}}>
                      <span><code style={{color:"#38bdf8"}}>{row.partNo}</code> — {row.partName}</span>
                      <span style={{color:"#64748b"}}>{row.engineer} · {row.target_date||"—"}</span>
                    </div>
                    <div style={{background:"#0f2540",borderRadius:4,height:11,position:"relative",overflow:"hidden"}}>
                      <div style={{width:`${elapsed*100}%`,height:"100%",background:bc,transition:"width .5s",boxShadow:`0 0 5px ${bc}88`}}/>
                      <div style={{position:"absolute",right:5,top:0,height:"100%",display:"flex",alignItems:"center",fontSize:9,color:"#64748b"}}>{Math.round(elapsed*100)}%</div>
                    </div>
                  </div>
                );
              })}
              {filteredRows.length===0 && <div style={{color:"#64748b",textAlign:"center",padding:20}}>No tasks match filters.</div>}
            </div>
          )}

          {/* MONTHLY DASHBOARD */}
          {activeTab==="monthly" && (() => {
            const monthlyData = MONTHS.map((m, i) => {
              const completed = filteredRows.filter(t => {
                if (t.status !== "Implemented") return false;
                return monthOf(t.target_date) === i;
              });
              const inProgress = filteredRows.filter(t => {
                if (t.status === "Implemented") return false;
                const iM = monthOf(t.initial_date);
                const tM = monthOf(t.target_date);
                if (tM === null) return false;
                const start = iM !== null ? iM : tM;
                return i >= start && i <= tM;
              });
              return { m, i, completed, inProgress };
            }).filter(d => d.completed.length + d.inProgress.length > 0);

            return (
              <div style={{...S.card,overflowX:"auto"}}>
                <div style={S.cT}>Monthly Dashboard — Completed vs In Progress (by Initial → Target Date range)</div>
                {monthlyData.length === 0
                  ? <div style={{color:"#64748b",textAlign:"center",padding:24}}>No tasks with date ranges match the current filters.</div>
                  : (
                  <table style={{...S.tbl,fontSize:11,marginTop:4}}>
                    <thead>
                      <tr>
                        <th style={S.th}>Month</th>
                        <th style={{...S.th,textAlign:"center",color:"#22c55e"}}>✓ Completed</th>
                        <th style={{...S.th,textAlign:"center",color:"#38bdf8"}}>◷ In Progress</th>
                        <th style={{...S.th,textAlign:"center"}}>Total</th>
                        <th style={{...S.th}}>Progress Bar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyData.map(d => {
                        const total = d.completed.length + d.inProgress.length;
                        const pct = total ? Math.round((d.completed.length/total)*100) : 0;
                        return (
                          <tr key={d.m}>
                            <td style={{...S.td,fontWeight:700,color:"#94a3b8",minWidth:40}}>{d.m}</td>
                            <td style={{...S.td,textAlign:"center",fontWeight:700,color:"#22c55e"}}>{d.completed.length}</td>
                            <td style={{...S.td,textAlign:"center",fontWeight:700,color:"#38bdf8"}}>{d.inProgress.length}</td>
                            <td style={{...S.td,textAlign:"center",fontWeight:700,color:"#e2e8f0"}}>{total}</td>
                            <td style={{...S.td,minWidth:160}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <div style={{flex:1,background:"#1e293b",borderRadius:4,height:8,overflow:"hidden",display:"flex"}}>
                                  <div style={{width:`${pct}%`,background:"#22c55e",transition:"width .5s"}}/>
                                  <div style={{width:`${100-pct}%`,background:"#38bdf833",transition:"width .5s"}}/>
                                </div>
                                <span style={{fontSize:10,color:"#64748b",minWidth:30}}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:"1px solid #1e3a5f"}}>
                        <td style={{...S.td,fontWeight:800,color:"#38bdf8"}}>TOTAL</td>
                        <td style={{...S.td,textAlign:"center",fontWeight:800,color:"#22c55e"}}>
                          {monthlyData.reduce((a,d)=>a+d.completed.length,0)}
                        </td>
                        <td style={{...S.td,textAlign:"center",fontWeight:800,color:"#38bdf8"}}>
                          {monthlyData.reduce((a,d)=>a+d.inProgress.length,0)}
                        </td>
                        <td style={{...S.td,textAlign:"center",fontWeight:800,color:"#e2e8f0"}}>
                          {monthlyData.reduce((a,d)=>a+d.completed.length+d.inProgress.length,0)}
                        </td>
                        <td style={S.td}/>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            );
          })()}
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={S.rght}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth={2}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span style={{fontWeight:700,fontSize:11,letterSpacing:1,color:"#38bdf8"}}>URGENCY DECK</span>
          </div>
          {sidebarItems.length===0 && <div style={{color:"#64748b",fontSize:11,textAlign:"center",marginTop:20}}>All tasks implemented 🎉</div>}
          {sidebarItems.map(t => {
            const b = urgencyMeta[t.urg] || urgencyMeta.ok;
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

      {showModal  && <AddModal    onClose={() => setShowModal(false)}  onSave={addTask}      saving={saving}/>}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} importing={importing}/>}

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
