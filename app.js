const fmt = (n) => (Math.trunc(n)).toLocaleString("ja-JP");
const byId = (id) => document.getElementById(id);

async function api(path, opt){
  const res = await fetch(path, { credentials: "include", ...opt });
  if(!res.ok) throw new Error(res.status);
  return res;
}
async function isAuthed(){
  const res = await api("/api/me");
  const j = await res.json();
  return !!j.authed;
}
async function login(code){
  await api("/api/login", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ code })
  });
}
async function logout(){
  await api("/api/logout", { method:"POST" });
}

function hasTiers(item){
  return Array.isArray(item.tiers) && item.tiers.length;
}
function pickUnitPrice(item, qty){
  if(hasTiers(item)){
    const q = Number(qty || 0);
    const t = item.tiers.find(x => q >= x.min && (x.max == null || q <= x.max)) || item.tiers[0];
    return t.unitPrice;
  }
  return item.unitPrice ?? 0;
}
function calcLine(item, qty){
  const q = (qty === "" || qty == null) ? 0 : Number(qty);
  const unit = pickUnitPrice(item, q);
  const ex = unit * q;
  const incRaw = ex * (1 + (item.taxRate ?? 0.10));
  const inc = (item.rounding === "int") ? Math.trunc(incRaw) : Math.round(incRaw);
  return { q, unit, ex, inc };
}

/* 文字ゆれ対策：半角/全角スペース除去 */
function norm(s){
  return (s || "").replace(/[ \u3000]/g, "").trim();
}

/**
 * 色分け：row（Excel行番号）で確実に判定
 * - LNC：水色（名前判定）
 * - JBPポーサインPRO：オレンジ
 * - それ以降～JBPプラセンタEQドリンク：ピンク
 */
function makeGeneralRowClassifier(general){
  const START_KEY = "JBPポーサインPRO";
  const END_KEY   = "JBPプラセンタEQドリンク";

  const start = general.find(x => norm(x.name).includes(START_KEY));
  const end   = general.find(x => norm(x.name).includes(END_KEY));

  const rs = start?.row != null ? Number(start.row) : null;
  const re = end?.row   != null ? Number(end.row)   : null;

  return (item) => {
    const nameN = norm(item.name);

    // LNCはそのまま
    if(/^LNC/i.test(nameN) || nameN.includes("LNC")) return "row-lnc";

    if(item.group !== "一般品") return "row-default";
    if(item.row == null || rs == null || re == null) return "row-default";

    const r = Number(item.row);
    if(r < rs || r > re) return "row-default";
    if(r === rs) return "row-jbp-orange";
    return "row-jbp-pink";
  };
}

function makeOtherRowClassifier(){
  return (item) => {
    const n = norm(item.name);
    if(/^LNC/i.test(n) || n.includes("LNC")) return "row-lnc";
    return "row-default";
  };
}

function buildTable(rootEl, items, onChange, rowClassFn){
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>品名</th>
        <th class="col-spec">規格</th>
        <th class="right col-tax">税率</th>
        <th class="right col-num">単価</th>
        <th class="right col-qty">数量</th>
        <th class="right col-num">税抜</th>
        <th class="right col-num">税込</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  items.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.className = rowClassFn(it);

    const initialUnit = hasTiers(it) ? "—" : fmt(it.unitPrice ?? 0);

    tr.innerHTML = `
      <td class="name">${it.name}</td>
      <td class="col-spec">${it.spec ?? ""}</td>
      <td class="right col-tax">${it.taxRate === 0.08 ? "8%" : "10%"}</td>
      <td class="right unit col-num">${initialUnit}</td>
      <td class="right col-qty">
        <input class="qty" type="number" min="0" step="1" value="" inputmode="numeric">
      </td>
      <td class="right ex col-num">0</td>
      <td class="right inc col-num">0</td>
    `;

    const qty = tr.querySelector("input");
    qty.addEventListener("input", () => onChange(idx, qty.value));
    tbody.appendChild(tr);
  });

  rootEl.innerHTML = "";
  rootEl.appendChild(table);

  return {
    updateRow(idx, ex, inc){
      const tr = tbody.children[idx];
      tr.querySelector(".ex").textContent = fmt(ex);
      tr.querySelector(".inc").textContent = fmt(inc);
    },
    setUnit(idx, txt){
      const tr = tbody.children[idx];
      tr.querySelector(".unit").textContent = txt;
    }
  };
}

async function loadProducts(){
  const res = await api("/api/products");
  return await res.json();
}

async function main(){
  const loginPanel = byId("loginPanel");
  const appPanel   = byId("appPanel");
  const loginErr   = byId("loginErr");

  async function showAuthed(){
    loginPanel.classList.add("hidden");
    appPanel.classList.remove("hidden");

    const all = await loadProducts();
    const general = all.filter(x => x.group === "一般品");
    const needle  = all.filter(x => x.group === "ナノニードル");
    const cannula = all.filter(x => x.group === "ナノカニューレ");

    const generalRowClass = makeGeneralRowClassifier(general);
    const otherRowClass   = makeOtherRowClassifier();

    const tblG = buildTable(byId("tblGeneral"), general, (idx, qtyStr)=>{
      const it = general[idx];
      const {q, unit, ex, inc} = calcLine(it, qtyStr);
      if(hasTiers(it)) tblG.setUnit(idx, q > 0 ? fmt(unit) : "—");
      tblG.updateRow(idx, ex, inc);
      recalc();
    }, generalRowClass);

    const tblN = buildTable(byId("tblNeedle"), needle, (idx, qtyStr)=>{
      const it = needle[idx];
      const {q, unit, ex, inc} = calcLine(it, qtyStr);
      if(hasTiers(it)) tblN.setUnit(idx, q > 0 ? fmt(unit) : "—");
      tblN.updateRow(idx, ex, inc);
      recalc();
    }, otherRowClass);

    const tblC = buildTable(byId("tblCannula"), cannula, (idx, qtyStr)=>{
      const it = cannula[idx];
      const {q, unit, ex, inc} = calcLine(it, qtyStr);
      if(hasTiers(it)) tblC.setUnit(idx, q > 0 ? fmt(unit) : "—");
      tblC.updateRow(idx, ex, inc);
      recalc();
    }, otherRowClass);

    function sumTable(tableDivId){
      const rows = byId(tableDivId).querySelectorAll("tbody tr");
      let ex=0, inc=0;
      rows.forEach(r=>{
        ex  += Number(r.querySelector(".ex").textContent.replace(/,/g,"") || 0);
        inc += Number(r.querySelector(".inc").textContent.replace(/,/g,"") || 0);
      });
      return {ex, inc};
    }

    function recalc(){
      const sg = sumTable("tblGeneral");
      const sn = sumTable("tblNeedle");
      const sc = sumTable("tblCannula");

      byId("sumGeneralEx").textContent = fmt(sg.ex);
      byId("sumGeneralIn").textContent = fmt(sg.inc);
      byId("sumNeedleEx").textContent  = fmt(sn.ex);
      byId("sumNeedleIn").textContent  = fmt(sn.inc);
      byId("sumCannulaEx").textContent = fmt(sc.ex);
      byId("sumCannulaIn").textContent = fmt(sc.inc);
      byId("sumAllEx").textContent     = fmt(sg.ex + sn.ex + sc.ex);
      byId("sumAllIn").textContent     = fmt(sg.inc + sn.inc + sc.inc);
    }
  }

  if(await isAuthed()){
    await showAuthed();
  }else{
    loginPanel.classList.remove("hidden");
    appPanel.classList.add("hidden");
  }

  byId("loginBtn").addEventListener("click", async ()=>{
    loginErr.textContent = "";
    const code = byId("codeInput").value.trim();
    try{
      await login(code);
      await showAuthed();
    }catch(e){
      loginErr.textContent = "認証コードが違います。";
    }
  });

  byId("logoutBtn").addEventListener("click", async ()=>{
    await logout();
    location.reload();
  });
}

main().catch(console.error);
