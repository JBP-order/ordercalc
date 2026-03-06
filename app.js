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
function calcLine(item, qty){
  const q = (qty === "" || qty == null) ? 0 : Number(qty);
  const unit = pickUnitPrice(item, q);
  const incRaw = (unit * q) * (1 + (item.taxRate ?? 0.10));
  const inc = (item.rounding === "int") ? Math.trunc(incRaw) : Math.round(incRaw);
  return { q, unit, inc };
}

async function loadProducts(){
  const res = await fetch("./products.json", { cache: "no-store" });
  if(!res.ok) throw new Error("products.json が読み込めません: " + res.status);
  return await res.json();
}

// 規格を品名に統合（全商品）
function mergedName(it){
  return `${it.name}${it.spec ? " " + it.spec : ""}`;
}

// 色分け（一般品のJBP範囲だけ）
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

/**
 * 列順：品名 → 数量 → 単価 → 税込
 * 税抜列は廃止
 */
function buildTable(rootEl, items, onChange, rowClassFn){
  const table = document.createElement("table");
  table.className = "items-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>品名</th>
        <th class="right col-qty">数量</th>
        <th class="right col-unit">単価</th>
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
      <td class="right inc col-inc">0</td>
    `;

    const qty = tr.querySelector("input");
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
    updateRow(idx, inc){
      const tr = tbody.children[idx];
      tr.querySelector(".inc").textContent = fmt(inc);
    },
    getQty(idx){
      const tr = tbody.children[idx];
      return tr.querySelector(".qty").value;
    },
    sumInc(){
      let inc = 0;
      tbody.querySelectorAll("tr").forEach(tr=>{
        inc += Number(tr.querySelector(".inc").textContent.replace(/,/g,"") || 0);
      });
      return inc;
    },
    // 税抜は出さないが、合計の税抜欄が残っている場合に備えて unit*qty を足す
    sumExForLegacy(){
      let ex = 0;
      tbody.querySelectorAll("tr").forEach(tr=>{
        const qty = Number(tr.querySelector(".qty").value || 0);
        const unitTxt = tr.querySelector(".unit").textContent.replace(/,/g,"");
        const unit = unitTxt === "—" ? 0 : Number(unitTxt || 0);
        ex += unit * qty;
      });
      return ex;
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
    const {q, unit, inc} = calcLine(it, qtyStr);
    if(hasTiers(it)) tblG.setUnit(idx, q > 0 ? fmt(unit) : "—");
    tblG.updateRow(idx, inc);
    recalc();
  }, generalRowClass);

  const tblN = buildTable(byId("tblNeedle"), needle, (idx, qtyStr)=>{
    const it = needle[idx];
    const {q, unit, inc} = calcLine(it, qtyStr);
    if(hasTiers(it)) tblN.setUnit(idx, q > 0 ? fmt(unit) : "—");
    tblN.updateRow(idx, inc);
    recalc();
  }, otherRowClass);

  const tblC = buildTable(byId("tblCannula"), cannula, (idx, qtyStr)=>{
    const it = cannula[idx];
    const {q, unit, inc} = calcLine(it, qtyStr);
    if(hasTiers(it)) tblC.setUnit(idx, q > 0 ? fmt(unit) : "—");
    tblC.updateRow(idx, inc);
    recalc();
  }, otherRowClass);

  function setTextIfExists(id, value){
    const el = byId(id);
    if(el) el.textContent = fmt(value);
  }

  function recalc(){
    const gInc = tblG.sumInc();
    const nInc = tblN.sumInc();
    const cInc = tblC.sumInc();
    const allInc = gInc + nInc + cInc;

    // 税込系（各所に残っていても更新されるように）
    setTextIfExists("sumGeneralIn", gInc);
    setTextIfExists("sumNeedleIn",  nInc);
    setTextIfExists("sumCannulaIn", cInc);
    setTextIfExists("sumAllIn",     allInc);

    // 旧UIに税抜欄が残っている場合の互換（空でもOK）
    const gEx = tblG.sumExForLegacy();
    const nEx = tblN.sumExForLegacy();
    const cEx = tblC.sumExForLegacy();
    const allEx = gEx + nEx + cEx;

    setTextIfExists("sumGeneralEx", gEx);
    setTextIfExists("sumNeedleEx",  nEx);
    setTextIfExists("sumCannulaEx", cEx);
    setTextIfExists("sumAllEx",     allEx);
  }
}

main().catch(e=>{
  const el = document.createElement("div");
  el.style.padding = "12px";
  el.style.color = "red";
  el.textContent = "エラー: " + (e?.message || e);
  document.body.prepend(el);
  console.error(e);
});
