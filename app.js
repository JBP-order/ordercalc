// ===== util =====
const fmt = (n) => (Math.trunc(n)).toLocaleString("ja-JP");
const byId = (id) => document.getElementById(id);

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
function calcLine(item, qtyStr){
  const q = (qtyStr === "" || qtyStr == null) ? 0 : Number(qtyStr);
  const unit = pickUnitPrice(item, q);
  const ex = unit * q;
  const incRaw = ex * (1 + (item.taxRate ?? 0.10));
  const inc = (item.rounding === "int") ? Math.trunc(incRaw) : Math.round(incRaw);
  return { q, unit, ex, inc };
}
async function loadProducts(){
  const res = await fetch("./products.json", { cache: "no-store" });
  if(!res.ok) throw new Error("products.json が読み込めません: " + res.status);
  return await res.json();
}
function mergedName(it){
  return `${it.name}${it.spec ? " " + it.spec : ""}`;
}

// ===== color classifier (existing behavior kept) =====
function norm(s){ return (s || "").replace(/[ \u3000]/g, "").trim(); }

function makeGeneralRowClassifier(general){
  const START_KEY = "JBPポーサインPRO";
  const END_KEY   = "JBPプラセンタEQドリンク";
  const start = general.find(x => norm(x.name).includes(START_KEY));
  const end   = general.find(x => norm(x.name).includes(END_KEY));
  const rs = start?.row != null ? Number(start.row) : null;
  const re = end?.row   != null ? Number(end.row)   : null;

  return (item) => {
    const nameN = norm(item.name);
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

// ===== table =====
// ※今のデザインを壊さないため、テーブルはJS側で「単価列」を追加するだけにします。
// 期待する列順：品名 / 数量 / 単価 / 税抜 / 税込（※既存が違っても、ここで描画される表が基準になります）
function buildTable(rootEl, items, onChange, rowClassFn){
  const table = document.createElement("table");
  table.className = "items-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>品名</th>
        <th class="right col-qty">数量</th>
        <th class="right col-unit">単価</th>
        <th class="right col-ex">税抜</th>
        <th class="right col-inc">税込</th>
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
      <td class="name">${mergedName(it)}</td>
      <td class="right col-qty">
        <input class="qty" type="number" min="0" step="1" value="" inputmode="numeric" placeholder="">
      </td>
      <td class="right unit col-unit">${initialUnit}</td>
      <td class="right ex col-ex">0</td>
      <td class="right inc col-inc">0</td>
    `;

    const qty = tr.querySelector("input.qty");
    qty.addEventListener("input", () => onChange(idx, qty.value));
    tbody.appendChild(tr);
  });

  rootEl.innerHTML = "";
  rootEl.appendChild(table);

  return {
    setUnit(idx, txt){
      const tr = tbody.children[idx];
      tr.querySelector(".unit").textContent = txt;
    },
    updateRow(idx, ex, inc){
      const tr = tbody.children[idx];
      tr.querySelector(".ex").textContent  = fmt(ex);
      tr.querySelector(".inc").textContent = fmt(inc);
    },
    getQty(idx){
      const tr = tbody.children[idx];
      return tr.querySelector(".qty").value;
    },
    sum(){
      let ex=0, inc=0;
      tbody.querySelectorAll("tr").forEach(tr=>{
        ex  += Number(tr.querySelector(".ex").textContent.replace(/,/g,"") || 0);
        inc += Number(tr.querySelector(".inc").textContent.replace(/,/g,"") || 0);
      });
      return {ex, inc};
    }
  };
}

async function main(){
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

  function setTextIfExists(id, value){
    const el = byId(id);
    if(el) el.textContent = fmt(value);
  }

  function recalc(){
    const sg = tblG.sum();
    const sn = tblN.sum();
    const sc = tblC.sum();

    setTextIfExists("sumGeneralEx", sg.ex);
    setTextIfExists("sumGeneralIn", sg.inc);

    setTextIfExists("sumNeedleEx",  sn.ex);
    setTextIfExists("sumNeedleIn",  sn.inc);

    setTextIfExists("sumCannulaEx", sc.ex);
    setTextIfExists("sumCannulaIn", sc.inc);

    setTextIfExists("sumAllEx", sg.ex + sn.ex + sc.ex);
    setTextIfExists("sumAllIn", sg.inc + sn.inc + sc.inc);
  }
}

main().catch(e=>{
  console.error(e);
});
