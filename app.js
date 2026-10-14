window.ERP_JS_OK = true;
/* =========================================================
   UTILITIES
   ========================================================= */
function uid(prefix){ return (prefix||'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function todayISO(){ const d=new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function pad2(n){ return String(n).padStart(2,'0'); }

function fmtDate(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d + ' ' + months[parseInt(m,10)-1] + ' ' + y;
}
function fmtDateShort(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-');
  return d+'/'+m+'/'+y.slice(2);
}
function money(n){
  n = Number(n)||0;
  const neg = n < -0.004;
  n = Math.abs(n);
  const s = n.toLocaleString('en-PK', {minimumFractionDigits:0, maximumFractionDigits:0});
  return (neg?'-':'') + 'Rs. ' + s;
}
function num(n, dp){
  n = Number(n)||0;
  return n.toLocaleString('en-PK', {minimumFractionDigits:dp||0, maximumFractionDigits:dp===undefined?2:dp});
}
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

/* Linear interpolation over a sorted [x,y] calibration table */
function interpolateTable(table, x){
  if(!table || !table.length) return 0;
  x = Number(x)||0;
  if(x <= table[0][0]) return table[0][1] * (x/ (table[0][0]||1)) ; // below first point, scale from origin (0,0)
  if(x >= table[table.length-1][0]) return table[table.length-1][1];
  // binary search
  let lo=0, hi=table.length-1;
  while(hi-lo>1){
    const mid=(lo+hi)>>1;
    if(table[mid][0] <= x) lo=mid; else hi=mid;
  }
  const [x0,y0]=table[lo], [x1,y1]=table[hi];
  if(x1===x0) return y0;
  return y0 + (y1-y0) * (x-x0)/(x1-x0);
}

function dateInRange(iso, start, end){
  if(start && iso < start) return false;
  if(end && iso > end) return false;
  return true;
}

function sortByDate(arr){ return [...arr].sort((a,b)=> a.date===b.date ? (a._seq||0)-(b._seq||0) : (a.date<b.date?-1:1)); }

function weekBounds(iso){
  const d = new Date(iso+'T00:00:00');
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diffToMon = (day===0? -6 : 1-day);
  const mon = new Date(d); mon.setDate(d.getDate()+diffToMon);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  return [isoOf(mon), isoOf(sun)];
}
function isoOf(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function monthBounds(year,month){ // month 1-12
  const start = year+'-'+pad2(month)+'-01';
  const last = new Date(year, month, 0).getDate();
  const end = year+'-'+pad2(month)+'-'+pad2(last);
  return [start,end];
}
function yearBounds(year){ return [year+'-01-01', year+'-12-31']; }
function addDaysISO(iso, n){ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return isoOf(d); }
function daysBetween(a,b){ return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/86400000); }

function downloadBlob(filename, content, mime){
  const blob = new Blob([content], {type: mime||'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 400);
}

function toast(msg, type){
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (type? ' '+type : '');
  el.innerHTML = (type==='ok'?'✅ ':type==='err'?'⚠️ ':type==='warn'?'⏳ ':'ℹ️ ') + esc(msg);
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, 3200);
}
/* =========================================================
   DATA STORE
   ========================================================= */
/* DB is filled from the cloud (Firestore) by js/cloud.js after login */
var DB = {meta:{},tanks:{},fuel:{},nozzles:{},oils:[],customers:[],suppliers:[],banks:[],partners:[],employees:[],expenseHeads:[],calibration:{},tx:{}};
var seqCounter = 1;
function stampSeq(){
  seqCounter = 1;
  Object.keys(DB.tx).forEach(k=>{
    DB.tx[k].forEach(r=>{ r._seq = seqCounter++; });
  });
}

/* markDirty() / saving is implemented in js/cloud.js */

/* ---- generic collection helpers (tx.*) ---- */
function txList(key){ return DB.tx[key]; }
function txAdd(key, obj){
  obj.id = obj.id || uid(key);
  obj._seq = seqCounter++;
  DB.tx[key].push(obj);
  markDirty();
  return obj;
}
function txUpdate(key, id, patch){
  const row = DB.tx[key].find(r=>r.id===id);
  if(!row) return null;
  Object.assign(row, patch);
  markDirty();
  return row;
}
function txDelete(key, id){
  const i = DB.tx[key].findIndex(r=>r.id===id);
  if(i<0) return false;
  DB.tx[key].splice(i,1);
  markDirty();
  return true;
}
function txGet(key, id){ return DB.tx[key].find(r=>r.id===id); }

/* ---- master list helpers (customers/suppliers/oils/banks/partners/employees) ---- */
function masterList(key){ return DB[key]; }
function masterAdd(key, obj, idPrefix){
  obj.id = obj.id || uid(idPrefix||key);
  DB[key].push(obj);
  markDirty();
  return obj;
}
function masterUpdate(key, id, patch){
  const row = DB[key].find(r=>r.id===id);
  if(!row) return null;
  Object.assign(row, patch);
  markDirty();
  return row;
}
function masterDelete(key, id){
  const i = DB[key].findIndex(r=>r.id===id);
  if(i<0) return false;
  DB[key].splice(i,1);
  markDirty();
  return true;
}
function nameOf(key, id){ const r=(DB[key]||[]).find(x=>x.id===id); return r? r.name : '—'; }

function allModes(){
  return ['Cash', ...DB.banks.map(b=>b.name)];
}
/* =========================================================
   CALCULATION ENGINE
   ========================================================= */

/* ---------- Nozzle sales (Diesel / Petrol) ---------- */
function nozzleKey(kind){ return kind==='diesel' ? 'nozzleDiesel' : 'nozzlePetrol'; }

function nozzleOpeningFor(kind, idx, beforeDate){
  const rows = sortByDate(DB.tx[nozzleKey(kind)]).filter(r=> r.date < beforeDate);
  if(rows.length) return Number(rows[rows.length-1].closings[idx])||0;
  return Number(DB.nozzles[kind][idx].opening)||0;
}
function computeNozzleRow(kind, entry){
  const opens = entry.closings.map((c,i)=> nozzleOpeningFor(kind, i, entry.date));
  const sales = entry.closings.map((c,i)=> Math.max(0, Number(c||0) - opens[i]));
  const totalLitres = sales.reduce((a,b)=>a+b,0);
  const rate = Number(entry.rate)||0;
  const costRate = fuelCostRate(kind, entry.date, entry);
  const amount = totalLitres * rate;
  const cogs = totalLitres * costRate;
  return {opens, sales, totalLitres, rate, costRate, amount, cogs};
}
function getFuelRate(kind, date){
  const rows = sortByDate(DB.tx[nozzleKey(kind)]).filter(r=> r.date <= date);
  if(rows.length) return Number(rows[rows.length-1].rate)||0;
  const all = sortByDate(DB.tx[nozzleKey(kind)]);
  if(all.length) return Number(all[0].rate)||0;
  return kind==='diesel' ? 280 : 275;
}
/* ---------- Fuel purchase (cost) rate ----------
   Priority: cost rate typed on that day's nozzle entry -> latest purchase rate on/before the date
   -> cost rate in Setup -> (sale rate - dealer margin) as a last resort. */
function latestPurchaseRate(kind, date){
  const label = kind==='diesel'?'Diesel':'Petrol';
  const rows = sortByDate(DB.tx.purchases.filter(r=> r.product===label && r.date<=date && Number(r.rate)>0));
  return rows.length ? Number(rows[rows.length-1].rate) : 0;
}
function fuelCostRate(kind, date, entry){
  if(entry && Number(entry.costRate)>0) return Number(entry.costRate);
  const p = latestPurchaseRate(kind, date);
  if(p>0) return p;
  const c = Number(DB.fuel[kind].costRate)||0;
  if(c>0) return c;
  return Math.max(0, getFuelRate(kind, date) - (Number(DB.fuel[kind].margin)||0));
}
function nozzleSaleAmount(kind, date){
  const row = DB.tx[nozzleKey(kind)].find(r=>r.date===date);
  if(!row) return 0;
  return computeNozzleRow(kind,row).amount;
}
function cumulativeSalesLitres(kind, uptoDate){
  return DB.tx[nozzleKey(kind)].filter(r=> r.date <= uptoDate)
    .reduce((sum,r)=> sum + computeNozzleRow(kind,r).totalLitres, 0);
}
function cumulativePurchaseLitres(kind, uptoDate){
  const label = kind==='diesel'?'Diesel':'Petrol';
  return DB.tx.purchases.filter(r=> r.product===label && r.date<=uptoDate)
    .reduce((s,r)=>s+Number(r.qty||0),0);
}
function bookStock(kind, uptoDate){
  return Number(DB.fuel[kind].openingStock||0) + cumulativePurchaseLitres(kind,uptoDate) - cumulativeSalesLitres(kind,uptoDate);
}
function physicalStock(kind, dipMM){
  return interpolateTable(DB.calibration[kind], dipMM);
}
function computeDipRow(entry){
  const dieselPhysical = physicalStock('diesel', entry.dieselDip);
  const petrolPhysical = physicalStock('petrol', entry.petrolDip);
  const dieselBook = bookStock('diesel', entry.date);
  const petrolBook = bookStock('petrol', entry.date);
  return {
    dieselPhysical, dieselBook, dieselVariance: dieselPhysical-dieselBook,
    petrolPhysical, petrolBook, petrolVariance: petrolPhysical-petrolBook
  };
}
function latestDipOnOrBefore(kind, asOf){
  const rows = sortByDate(DB.tx.dip).filter(r=>r.date<=asOf);
  if(!rows.length) return null;
  const last = rows[rows.length-1];
  const mm = kind==='diesel'? last.dieselDip : last.petrolDip;
  return physicalStock(kind, mm);
}

/* ---------- Products / labels ---------- */
function productLabel(product){
  if(product==='Diesel') return 'HSD (Diesel)';
  if(product==='Petrol') return 'PMG (Petrol)';
  const o = DB.oils.find(x=>x.id===product);
  return o? o.name : '—';
}
function productUnit(product){
  if(product==='Diesel'||product==='Petrol') return 'Litres';
  const o=DB.oils.find(x=>x.id===product);
  return o? o.unit : '';
}
function productSaleRate(product, date){
  if(product==='Diesel') return getFuelRate('diesel', date);
  if(product==='Petrol') return getFuelRate('petrol', date);
  const o=DB.oils.find(x=>x.id===product);
  return o? Number(o.saleRate)||0 : 0;
}
function productCostRate(product, date){
  if(product==='Diesel') return fuelCostRate('diesel', date);
  if(product==='Petrol') return fuelCostRate('petrol', date);
  const o=DB.oils.find(x=>x.id===product);
  return o? Number(o.costRate)||0 : 0;
}

/* ---------- Credit sale / cash oils helpers ---------- */
function creditSaleSum(date, type){
  return DB.tx.creditSale.filter(r=>r.date===date && r.type===type).reduce((s,r)=>s+r.qty*r.rate,0);
}
function csGross(r){ return Number(r.qty||0)*Number(r.rate||0); }
function csDisc(r){ return Math.round((Number(r.qty||0)*Number(r.discPerUnit||0) + csGross(r)*Number(r.discPct||0)/100)*100)/100; }
function csNet(r){ return csGross(r) - csDisc(r); }
function creditSaleSumAll(date){
  return DB.tx.creditSale.filter(r=>r.date===date).reduce((s,r)=>s+r.qty*r.rate,0);
}
function cashOilsSum(date){
  return DB.tx.cashOils.filter(r=>r.date===date).reduce((s,r)=>s+r.qty*r.rate,0);
}

/* ---------- Calendar / date range helpers ---------- */
function allCalendarDates(){
  let maxDate = DB.meta.startDate;
  Object.values(DB.tx).forEach(arr=> arr.forEach(r=>{ if(r.date && r.date>maxDate) maxDate=r.date; }));
  const t = todayISO();
  if(t > maxDate) maxDate = t;
  const dates=[];
  let d = DB.meta.startDate;
  let guard=0;
  while(d <= maxDate && guard < 20000){ dates.push(d); d = addDaysISO(d,1); guard++; }
  return dates;
}

/* Fuel sales before this date are opening/baseline data and are not posted to cash */
function cashBooksActive(date){ return date >= (DB.meta.cashBooksStart || DB.meta.startDate); }

/* ---------- Bank deductions (charges on deposit / withdrawal) ---------- */
function dedOf(r){ return Number(r.dedAmt)||0; }
function calcDed(amount, pct){ return Math.round(Number(amount||0)*Number(pct||0))/100; }
function transferChargeMode(r){ return r.from!=='Cash' ? r.from : r.to; }
function deductionRows(start, end){
  const rows = [];
  const add = (src, r, who, mode)=>{
    const a = dedOf(r);
    if(a>0 && dateInRange(r.date,start,end)) rows.push({date:r.date, source:src, who, mode, pct:Number(r.dedPct)||0, base:Number(r.amount)||0, amount:a, _seq:r._seq});
  };
  DB.tx.receipts.forEach(r=>add('Deposit (receipt)', r, nameOf('customers',r.customerId), r.mode));
  DB.tx.payments.forEach(r=>add('Withdrawal (payment)', r, r.type==='Supplier Payment'?nameOf('suppliers',r.supplierId):(r.paidTo||'—'), r.mode));
  DB.tx.partnersLedger.forEach(r=>add(r.type==='Deposit'?'Deposit (partner)':'Withdrawal (partner)', r, nameOf('partners',r.partnerId), r.mode));
  DB.tx.fundTransfer.forEach(r=>add('Fund transfer', r, r.from+' → '+r.to, transferChargeMode(r)));
  return sortByDate(rows);
}
function dedSum(date){ return deductionRows(date,date).reduce((s,x)=>s+x.amount,0); }

/* ---------- Day Book ---------- */
function empSalaryPaidSum(date){ return DB.tx.employeeLedger.filter(r=>r.date===date && r.type==='Salary Paid').reduce((s,r)=>s+Number(r.amount||0),0); }
function empAdvanceGivenSum(date){ return DB.tx.employeeLedger.filter(r=>r.date===date && r.type==='Advance Given').reduce((s,r)=>s+Number(r.amount||0),0); }
function empAdvanceRecoveredSum(date){ return DB.tx.employeeLedger.filter(r=>r.date===date && r.type==='Advance Recovered').reduce((s,r)=>s+Number(r.amount||0),0); }
function empAdvanceNetSum(date){ return empAdvanceGivenSum(date) - empAdvanceRecoveredSum(date); }
function receiptsSum(date){ return DB.tx.receipts.filter(r=>r.date===date).reduce((s,r)=>s+Number(r.amount||0),0); }
function paymentsSum(date){ return DB.tx.payments.filter(r=>r.date===date).reduce((s,r)=>s+Number(r.amount||0),0); }
function expensesSum(date){ return DB.tx.expenses.filter(r=>r.date===date).reduce((s,r)=>s+Number(r.amount||0),0); }

function dayBookRow(date, prevClosing){
  const dieselTotal = nozzleSaleAmount('diesel', date);
  const petrolTotal = nozzleSaleAmount('petrol', date);
  const dieselCredit = creditSaleSum(date,'Diesel');
  const petrolCredit = creditSaleSum(date,'Petrol');
  const posted = cashBooksActive(date);
  const dieselCash = posted ? dieselTotal - dieselCredit : 0;
  const petrolCash = posted ? petrolTotal - petrolCredit : 0;
  const oilsCash = cashOilsSum(date);
  const totalCashSales = dieselCash+petrolCash+oilsCash;
  const creditRef = creditSaleSumAll(date);
  const receipts = receiptsSum(date);
  const supplierPayments = paymentsSum(date);
  const expenses = expensesSum(date);
  const deductions = dedSum(date);
  const salaryPaid = empSalaryPaidSum(date);
  const advNet = empAdvanceNetSum(date);
  const opening = prevClosing;
  // advance given is a cash outflow; advance recovered is a cash inflow
  const advOut = Math.max(0, advNet);
  const advIn = advNet < 0 ? -advNet : 0;
  const totalIn = totalCashSales + receipts + advIn;
  const totalOut = supplierPayments + expenses + salaryPaid + advOut + deductions;
  const closing = opening + totalIn - totalOut;
  const totalRevenue = totalCashSales + creditRef;
  return {date, opening, dieselCash, petrolCash, oilsCash, totalCashSales, creditRef, receipts,
    supplierPayments, expenses, deductions, salaryPaid, advNet, totalIn, totalOut, closing, totalRevenue};
}
function dayBookRange(start,end){
  const dates = allCalendarDates();
  const rows=[];
  let running = Number(DB.meta.openingCash)||0;
  for(const d of dates){
    const row = dayBookRow(d, running);
    running = row.closing;
    if(dateInRange(d,start,end)) rows.push(row);
  }
  return rows;
}
function dayBookAsOf(date){
  const dates = allCalendarDates().filter(d=>d<=date);
  let running = Number(DB.meta.openingCash)||0, row=null;
  for(const d of dates){ row = dayBookRow(d, running); running = row.closing; }
  return row;
}

/* ---------- Cash & Bank Ledger (mode aware) ---------- */
function modeInSum(mode, date){
  let sum=0;
  if(mode==='Cash' && cashBooksActive(date)){
    sum += (nozzleSaleAmount('diesel',date)-creditSaleSum(date,'Diesel'));
    sum += (nozzleSaleAmount('petrol',date)-creditSaleSum(date,'Petrol'));
    sum += cashOilsSum(date);
  }
  sum += DB.tx.receipts.filter(r=>r.date===date && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.partnersLedger.filter(r=>r.date===date && r.type==='Deposit' && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.employeeLedger.filter(r=>r.date===date && r.type==='Advance Recovered' && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.fundTransfer.filter(r=>r.date===date && r.to===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  return sum;
}
function modeOutSum(mode, date){
  let sum=0;
  sum += DB.tx.payments.filter(r=>r.date===date && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.expenses.filter(r=>r.date===date && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.employeeLedger.filter(r=>r.date===date && (r.type==='Salary Paid'||r.type==='Advance Given') && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.partnersLedger.filter(r=>r.date===date && r.type==='Drawing' && r.mode===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  sum += DB.tx.fundTransfer.filter(r=>r.date===date && r.from===mode).reduce((s,r)=>s+Number(r.amount||0),0);
  // bank deduction is charged to the account where the deposit / withdrawal happened
  sum += DB.tx.receipts.filter(r=>r.date===date && r.mode===mode).reduce((s,r)=>s+dedOf(r),0);
  sum += DB.tx.payments.filter(r=>r.date===date && r.mode===mode).reduce((s,r)=>s+dedOf(r),0);
  sum += DB.tx.partnersLedger.filter(r=>r.date===date && r.mode===mode).reduce((s,r)=>s+dedOf(r),0);
  sum += DB.tx.fundTransfer.filter(r=>r.date===date && transferChargeMode(r)===mode).reduce((s,r)=>s+dedOf(r),0);
  return sum;
}
function cashBankLedgerRange(start,end){
  const dates = allCalendarDates();
  const modes = allModes();
  const running = {};
  running['Cash']=Number(DB.meta.openingCash)||0;
  DB.banks.forEach(b=> running[b.name]=Number(b.openingBalance)||0);
  const rows=[];
  for(const d of dates){
    const entry = {date:d, modes:{}};
    let total=0;
    modes.forEach(m=>{
      const opening = running[m]||0;
      const inn = modeInSum(m,d);
      const out = modeOutSum(m,d);
      const closing = opening+inn-out;
      entry.modes[m] = {opening,in:inn,out,closing};
      running[m]=closing;
      total += closing;
    });
    entry.total = total;
    if(dateInRange(d,start,end)) rows.push(entry);
  }
  return rows;
}
function currentBalances(){
  const rows = cashBankLedgerRange(null, todayISO());
  const last = rows.length? rows[rows.length-1] : null;
  const out = {};
  allModes().forEach(m=> out[m] = last? last.modes[m].closing : (m==='Cash'? Number(DB.meta.openingCash)||0 : (DB.banks.find(b=>b.name===m)||{}).openingBalance||0));
  out._total = last? last.total : Object.values(out).reduce((a,b)=>a+b,0);
  return out;
}

/* ---------- Customer / Supplier ledgers ---------- */
function creditSaleDesc(r){
  const d = csDisc(r);
  const dtxt = d>0 ? ' — less discount '+money(d) : '';
  if(r.type==='Oil') return 'Credit sale — '+productLabel(r.product)+' ('+r.qty+' '+productUnit(r.product)+')'+dtxt;
  return 'Credit sale — '+r.type+' ('+num(r.qty,0)+' L)'+dtxt;
}
function purchaseDesc(r){ return 'Purchase — '+productLabel(r.product)+' ('+num(r.qty,0)+' '+productUnit(r.product)+')'; }

function customerTransactions(custId){
  const rows=[];
  DB.tx.creditSale.filter(r=>r.customerId===custId).forEach(r=>{
    rows.push({date:r.date, type:'Credit Sale', desc:creditSaleDesc(r), debit:csNet(r), credit:0, _seq:r._seq, ref:r});
  });
  DB.tx.receipts.filter(r=>r.customerId===custId).forEach(r=>{
    rows.push({date:r.date, type:'Receipt', desc:(r.narration||('Received via '+r.mode)), debit:0, credit:Number(r.amount||0), _seq:r._seq, ref:r});
  });
  return sortByDate(rows);
}
function customerBalance(custId, asOf){
  const cust = DB.customers.find(c=>c.id===custId);
  let bal = cust? Number(cust.openingBalance||0):0;
  customerTransactions(custId).forEach(r=>{ if(asOf && r.date>asOf) return; bal += r.debit - r.credit; });
  return bal;
}
function supplierTransactions(supId){
  const rows=[];
  DB.tx.purchases.filter(r=>r.supplierId===supId).forEach(r=>{
    rows.push({date:r.date, type:'Purchase', desc:purchaseDesc(r), debit:0, credit:r.qty*r.rate, _seq:r._seq, ref:r});
  });
  DB.tx.payments.filter(r=>r.supplierId===supId).forEach(r=>{
    rows.push({date:r.date, type:'Payment', desc:(r.narration||('Paid via '+r.mode)), debit:Number(r.amount||0), credit:0, _seq:r._seq, ref:r});
  });
  return sortByDate(rows);
}
function supplierBalance(supId, asOf){
  const sup = DB.suppliers.find(s=>s.id===supId);
  let bal = sup? Number(sup.openingBalance||0):0;
  supplierTransactions(supId).forEach(r=>{ if(asOf && r.date>asOf) return; bal += r.credit - r.debit; });
  return bal;
}
function allCustomerBalances(asOf){ return DB.customers.map(c=>({...c, balance: customerBalance(c.id, asOf)})); }
function allSupplierBalances(asOf){ return DB.suppliers.map(s=>({...s, balance: supplierBalance(s.id, asOf)})); }

/* ---------- Employees ---------- */
function employeeSummary(empId, asOf){
  const emp = DB.employees.find(e=>e.id===empId);
  const rows = DB.tx.employeeLedger.filter(r=>r.employeeId===empId && (!asOf || r.date<=asOf));
  const given = rows.filter(r=>r.type==='Advance Given').reduce((s,r)=>s+Number(r.amount||0),0);
  const recovered = rows.filter(r=>r.type==='Advance Recovered').reduce((s,r)=>s+Number(r.amount||0),0);
  const salaryPaid = rows.filter(r=>r.type==='Salary Paid').reduce((s,r)=>s+Number(r.amount||0),0);
  const closingAdvance = Number(emp.openingAdvance||0) + given - recovered;
  return {emp, given, recovered, salaryPaid, closingAdvance};
}

/* ---------- Stock Summary ---------- */
function stockSummary(asOf){
  const dieselBook = bookStock('diesel', asOf);
  const petrolBook = bookStock('petrol', asOf);
  const dieselPhysical = latestDipOnOrBefore('diesel', asOf);
  const petrolPhysical = latestDipOnOrBefore('petrol', asOf);
  const oils = DB.oils.map(o=>{
    const purchased = DB.tx.purchases.filter(r=>r.product===o.id && r.date<=asOf).reduce((s,r)=>s+Number(r.qty||0),0);
    const creditSold = DB.tx.creditSale.filter(r=>r.type==='Oil'&&r.product===o.id&&r.date<=asOf).reduce((s,r)=>s+Number(r.qty||0),0);
    const cashSold = DB.tx.cashOils.filter(r=>r.product===o.id&&r.date<=asOf).reduce((s,r)=>s+Number(r.qty||0),0);
    const closing = Number(o.openingStock||0) + purchased - creditSold - cashSold;
    return {...o, purchased, sold:creditSold+cashSold, closing, value: closing*Number(o.costRate||0), saleValue: closing*Number(o.saleRate||0)};
  });
  function fuel(kind, book, physical){
    const costRate = fuelCostRate(kind, asOf), saleRate = getFuelRate(kind, asOf);
    return {book, physical, costRate, saleRate, value: Math.max(0,book)*costRate, saleValue: Math.max(0,book)*saleRate};
  }
  const diesel = fuel('diesel', dieselBook, dieselPhysical), petrol = fuel('petrol', petrolBook, petrolPhysical);
  const oilsCost = oils.reduce((a,o)=>a+o.value,0), oilsSale = oils.reduce((a,o)=>a+o.saleValue,0);
  return {
    diesel, petrol, oils, oilsCost, oilsSale,
    totalCost: diesel.value + petrol.value + oilsCost,
    totalSaleValue: diesel.saleValue + petrol.saleValue + oilsSale
  };
}

/* ---------- Profit & Loss ---------- */
function plForRange(start,end){
  const inRange = (d)=> dateInRange(d,start,end);
  let dieselRev=0,dieselCogs=0,dieselL=0, petrolRev=0,petrolCogs=0,petrolL=0;
  DB.tx.nozzleDiesel.filter(r=>inRange(r.date)).forEach(r=>{ const c=computeNozzleRow('diesel',r); dieselRev+=c.amount; dieselCogs+=c.cogs; dieselL+=c.totalLitres; });
  DB.tx.nozzlePetrol.filter(r=>inRange(r.date)).forEach(r=>{ const c=computeNozzleRow('petrol',r); petrolRev+=c.amount; petrolCogs+=c.cogs; petrolL+=c.totalLitres; });
  let oilsRev=0, oilsCogs=0;
  const oilMap = {};
  const addOil = (r)=>{
    const o = DB.oils.find(x=>x.id===r.product);
    const cr = Number(r.costRate)>0 ? Number(r.costRate) : (o? Number(o.costRate)||0 : 0);
    const m = oilMap[r.product] || (oilMap[r.product] = {name:productLabel(r.product), unit:productUnit(r.product), qty:0, sale:0, cost:0});
    const sale = r.qty*r.rate - (r.discPct||r.discPerUnit ? csDisc(r) : 0);
    m.qty += Number(r.qty)||0; m.sale += r.qty*r.rate; m.cost += r.qty*cr;
    oilsRev += r.qty*r.rate; oilsCogs += r.qty*cr;
  };
  DB.tx.cashOils.filter(r=>inRange(r.date)).forEach(addOil);
  DB.tx.creditSale.filter(r=>r.type==='Oil' && inRange(r.date)).forEach(addOil);
  const oilRows = Object.values(oilMap);
  const dieselCostRate = dieselL>0 ? dieselCogs/dieselL : fuelCostRate('diesel', end);
  const petrolCostRate = petrolL>0 ? petrolCogs/petrolL : fuelCostRate('petrol', end);
  const revenue = dieselRev+petrolRev+oilsRev;
  const cogs = dieselCogs+petrolCogs+oilsCogs;

  // discounts allowed to parties on credit sales
  let discount = 0; const discountRows = [];
  sortByDate(DB.tx.creditSale.filter(r=>inRange(r.date))).forEach(r=>{
    const d = csDisc(r);
    if(d>0){ discount += d; discountRows.push({date:r.date, customer:nameOf('customers',r.customerId), what:(r.type==='Oil'?productLabel(r.product):r.type), qty:r.qty, unit:productUnit(r.type==='Oil'?r.product:r.type), gross:csGross(r), amount:d}); }
  });
  const grossProfit = revenue - discount - cogs;

  const expenseRows = sortByDate(DB.tx.expenses.filter(r=>inRange(r.date)));
  const expenses = expenseRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const salaryRows = sortByDate(DB.tx.employeeLedger.filter(r=>r.type==='Salary Paid'&&inRange(r.date)));
  const salaries = salaryRows.reduce((s,r)=>s+Number(r.amount||0),0);
  const bankRows = deductionRows(start,end);
  const bankCharges = bankRows.reduce((s,r)=>s+r.amount,0);
  const totalOpex = expenses + salaries + bankCharges;
  const netProfit = grossProfit - totalOpex;

  const byHead = {};
  expenseRows.forEach(r=>{ byHead[r.head] = (byHead[r.head]||0) + Number(r.amount||0); });
  if(salaries>0) byHead['Employee Salaries (paid)'] = salaries;
  if(bankCharges>0) byHead['Bank Deductions'] = bankCharges;

  const costWarnings = [];
  if(dieselL>0 && dieselCogs >= dieselRev-0.5) costWarnings.push('Diesel: purchase (cost) rate is not lower than the sale rate, so diesel profit shows zero.');
  if(petrolL>0 && petrolCogs >= petrolRev-0.5) costWarnings.push('Petrol: purchase (cost) rate is not lower than the sale rate, so petrol profit shows zero.');
  if(oilsRev>0 && oilsCogs >= oilsRev-0.5) costWarnings.push('Oils / Lubricants: cost rate is not lower than the sale rate, so oil profit shows zero.');

  return {dieselRev,dieselCogs,dieselL,petrolRev,petrolCogs,petrolL,oilsRev,oilsCogs,revenue,cogs,oilRows,dieselCostRate,petrolCostRate,
    discount,discountRows,grossProfit,expenses,expenseRows,salaries,salaryRows,bankCharges,bankRows,totalOpex,netProfit,byHead,costWarnings};
}

/* =========================================================
   UI CORE — nav, router, modal, topbar
   ========================================================= */
var NAV = [
  {title:'Overview', items:[
    {id:'dashboard', icon:'📊', label:'Dashboard'},
  ]},
  {title:'Daily Entry', items:[
    {id:'nozzle-diesel', icon:'🛢️', label:'HSD (Diesel) Nozzle Sales'},
    {id:'nozzle-petrol', icon:'⛽', label:'PMG (Petrol) Nozzle Sales'},
    {id:'dip-stock', icon:'📏', label:'Daily Stock Dip'},
    {id:'credit-sale', icon:'📝', label:'Credit (Udhaar) Sale'},
    {id:'cash-oils', icon:'🧴', label:'Cash Sale — Oils'},
    {id:'purchases', icon:'🚚', label:'Purchases'},
  ]},
  {title:'Cash & Bank', items:[
    {id:'receipts', icon:'💵', label:'Receipts'},
    {id:'payments', icon:'💳', label:'Payments'},
    {id:'expenses', icon:'🧾', label:'Expenses'},
    {id:'fund-transfer', icon:'🔁', label:'Fund Transfer'},
  ]},
  {title:'People', items:[
    {id:'partners-ledger', icon:'🤝', label:'Partners Ledger'},
    {id:'employee-ledger', icon:'👷', label:'Employee Ledger'},
  ]},
  {title:'Ledgers & Stock', items:[
    {id:'customer-ledger', icon:'🧑\u200d💼', label:'Customer Ledger'},
    {id:'supplier-ledger', icon:'🏭', label:'Supplier Ledger'},
    {id:'stock-summary', icon:'📦', label:'Stock Summary'},
    {id:'cash-bank-ledger', icon:'🏦', label:'Cash & Bank Ledger'},
  ]},
  {title:'Reports', items:[
    {id:'day-book', icon:'📖', label:'Day Book'},
    {id:'weekly-report', icon:'📅', label:'Weekly Report'},
    {id:'monthly-report', icon:'🗓️', label:'Monthly Report'},
    {id:'yearly-report', icon:'📈', label:'Yearly Report'},
    {id:'profit-loss', icon:'💰', label:'Profit & Loss'},
  ]},
  {title:'System', items:[
    {id:'setup', icon:'⚙️', label:'Setup / Masters'},
  ]}
];
var PAGE_META = {
  'dashboard':['Dashboard','Live overview of your petrol pump'],
  'nozzle-diesel':['HSD (Diesel) Nozzle Sales','Meter readings \u2192 automatic daily sale'],
  'nozzle-petrol':['PMG (Petrol) Nozzle Sales','Meter readings \u2192 automatic daily sale'],
  'dip-stock':['Daily Stock Dip','Dip stick reading \u2192 physical stock vs book stock'],
  'credit-sale':['Credit (Udhaar) Sale','Diesel, Petrol &amp; Oils sold on credit'],
  'cash-oils':['Cash Sale \u2014 Oils','Counter sale of oils / lubricants'],
  'purchases':['Purchases','Fuel &amp; oil purchases from suppliers'],
  'receipts':['Receipts','Money received from customers'],
  'payments':['Payments','Money paid to suppliers &amp; others'],
  'expenses':['Expenses','Daily running expenses'],
  'fund-transfer':['Fund Transfer','Move money between cash &amp; bank accounts'],
  'partners-ledger':['Partners Ledger','Drawings &amp; capital deposits'],
  'employee-ledger':['Employee Ledger','Salary &amp; advance tracking'],
  'customer-ledger':['Customer Ledger','Outstanding balances &amp; running account'],
  'supplier-ledger':['Supplier Ledger','Payables &amp; running account'],
  'stock-summary':['Stock Summary','Closing stock \u2014 all products, as of any date'],
  'cash-bank-ledger':['Cash & Bank Ledger','Mode-wise daily balances'],
  'day-book':['Day Book','Daily cash book register'],
  'weekly-report':['Weekly Report','Any 7-day window'],
  'monthly-report':['Monthly Report','Pick a month'],
  'yearly-report':['Yearly Report','Pick a year'],
  'profit-loss':['Profit & Loss','Daily / Weekly / Monthly / Yearly'],
  'setup':['Setup / Masters','Station info, tanks, price margins, master lists'],
};

var currentPage = 'dashboard';

function renderNav(){
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map(group=>`
    <div class="nav-group">
      <div class="nav-group-title">${group.title}</div>
      ${group.items.map(it=>`
        <div class="nav-item ${it.id===currentPage?'active':''}" onclick="goTo('${it.id}')">
          <span class="ic">${it.icon}</span><span>${it.label}</span>
        </div>`).join('')}
    </div>`).join('');
  document.getElementById('brand-name').textContent = DB.meta.stationName || 'Petrol Pump ERP';
}

function goTo(id){
  currentPage = id;
  renderNav();
  renderPage();
  closeSidebar();
  document.getElementById('content').scrollTop = 0;
  window.scrollTo(0,0);
}

var PAGES = {}; // filled in by module files: PAGES['dashboard'] = function(){...}

function renderPage(){
  const meta = PAGE_META[currentPage] || ['',''];
  document.getElementById('page-title').innerHTML = meta[0];
  document.getElementById('page-sub').innerHTML = meta[1];
  const el = document.getElementById('content');
  const fn = PAGES[currentPage];
  el.innerHTML = '<div class="page active" id="page-inner"></div>';
  const inner = document.getElementById('page-inner');
  if(fn){ fn(inner); } else { inner.innerHTML = '<div class="card card-pad">Coming soon.</div>'; }
}

function renderAll(){ renderNav(); renderTopbarActions(); renderPage(); }

function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay-scrim').classList.toggle('show');
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay-scrim').classList.remove('show');
}

/* ---------- Topbar ---------- */
function renderTopbarActions(){
  const el = document.getElementById('topbar-actions');
  el.innerHTML = `
    <span class="user-chip" id="user-chip"></span>
    <button class="save-pill" id="save-pill" title="Click to save now" onclick="saveNow()"></button>
    <button class="btn btn-icon" title="Export data as JSON" onclick="exportJSON()">📤</button>
    <button class="btn btn-icon" title="Import data from JSON (replaces cloud data)" onclick="triggerImportJSON()">📥</button>
    <button class="btn btn-icon" title="Log out" onclick="logout()">🚪</button>
  `;
  updateSavePill();
  if(typeof updateUserChip==='function') updateUserChip();
}

/* ---------- Modal ---------- */
function openModal(title, bodyHtml, footHtml, wide){
  const modal = document.getElementById('modal');
  modal.className = 'modal' + (wide?' wide':'');
  modal.innerHTML = `
    <div class="modal-head"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">${bodyHtml}</div>
    ${footHtml? `<div class="modal-foot">${footHtml}</div>` : ''}
  `;
  document.getElementById('modal-backdrop').classList.add('show');
}
function closeModal(){ document.getElementById('modal-backdrop').classList.remove('show'); }
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
document.getElementById('modal-backdrop') && document.getElementById('modal-backdrop').addEventListener('click', e=>{
  if(e.target.id==='modal-backdrop') closeModal();
});

function confirmDelete(msg, onYes){
  openModal('Confirm delete', `<p style="margin:0 0 4px 0;">${esc(msg)}</p><p class="small-note">This cannot be undone.</p>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" onclick="(${onYes.toString()})(); closeModal();">Delete</button>`);
}

/* ---------- Small reusable renderers ---------- */
function optionsHtml(list, selected, valueKey, labelKey){
  return list.map(x=>`<option value="${esc(x[valueKey])}" ${String(x[valueKey])===String(selected)?'selected':''}>${esc(x[labelKey])}</option>`).join('');
}
function modeOptionsHtml(selected){
  return allModes().map(m=>`<option value="${esc(m)}" ${m===selected?'selected':''}>${esc(m)}</option>`).join('');
}
function productOptionsHtml(selected, includeFuel){
  let opts='';
  if(includeFuel!==false){
    opts += `<option value="Diesel" ${selected==='Diesel'?'selected':''}>HSD (Diesel)</option>`;
    opts += `<option value="Petrol" ${selected==='Petrol'?'selected':''}>PMG (Petrol)</option>`;
  }
  opts += DB.oils.map(o=>`<option value="${o.id}" ${o.id===selected?'selected':''}>${esc(o.name)}</option>`).join('');
  return opts;
}
function emptyRow(colspan, text){
  return `<tr class="empty-row"><td colspan="${colspan}">${esc(text||'No entries yet — click “Add” to get started.')}</td></tr>`;
}
/* =========================================================
   PAGE: SETUP / MASTERS
   ========================================================= */
var setupTab = 'general';

PAGES['setup'] = function(root){
  const tabs = [
    ['general','General & Tanks'], ['nozzles','Nozzles'], ['oils','Oils / Lubricants'],
    ['customers','Customers'], ['suppliers','Suppliers'], ['banks','Banks'],
    ['partners','Partners'], ['employees','Employees'], ['expenseHeads','Expense Categories']
  ];
  root.innerHTML = `
    <div class="tabs">${tabs.map(t=>`<button class="tab-btn ${setupTab===t[0]?'active':''}" onclick="setupTab='${t[0]}'; renderPage();">${t[1]}</button>`).join('')}</div>
    <div id="setup-body"></div>
  `;
  const body = document.getElementById('setup-body');
  const renderers = {
    general: renderSetupGeneral, nozzles: renderSetupNozzles, oils: renderSetupOils,
    customers: renderSetupCustomers, suppliers: renderSetupSuppliers, banks: renderSetupBanks,
    partners: renderSetupPartners, employees: renderSetupEmployees, expenseHeads: renderSetupExpenseHeads
  };
  renderers[setupTab](body);
};

function renderSetupGeneral(el){
  el.innerHTML = `
    <div class="grid grid-2">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Station Info</div>
        <div class="field"><label>Station Name</label><input id="f-stationName" value="${esc(DB.meta.stationName)}"></div>
        <div class="field"><label>Owner Name</label><input id="f-ownerName" value="${esc(DB.meta.ownerName)}"></div>
        <div class="field-row">
          <div class="field"><label>Books Start Date</label><input type="date" id="f-startDate" value="${DB.meta.startDate}"></div>
          <div class="field"><label>Opening Cash (Rs.)</label><input type="number" id="f-openingCash" value="${DB.meta.openingCash}"></div>
        </div>
        <div class="field"><label>Cash Books Start Date</label><input type="date" id="f-cashStart" value="${DB.meta.cashBooksStart||DB.meta.startDate}"><span class="helptext">Fuel sales before this date are not posted to cash / Day Book.</span></div>
        <button class="btn btn-primary" onclick="saveGeneral()">Save</button>
      </div>
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Tank Capacities</div>
        <div class="field-row">
          <div class="field"><label>HSD (Diesel) Tank Capacity (L)</label><input type="number" id="f-dieselCap" value="${DB.tanks.dieselCapacity}"></div>
          <div class="field"><label>PMG (Petrol) Tank Capacity (L)</label><input type="number" id="f-petrolCap" value="${DB.tanks.petrolCapacity}"></div>
        </div>
        <div class="section-title">Opening Stock & Dealer Margin</div>
        <div class="field-row">
          <div class="field"><label>Diesel Opening Stock (L)</label><input type="number" id="f-dieselStock" value="${DB.fuel.diesel.openingStock}"></div>
          <div class="field"><label>Diesel Margin (Rs./L)</label><input type="number" step="0.01" id="f-dieselMargin" value="${DB.fuel.diesel.margin}"><span class="helptext">Only used if no cost rate is set</span></div>
          <div class="field"><label>Diesel Purchase / Cost Rate (Rs./L)</label><input type="number" step="0.01" id="f-dieselCost" value="${DB.fuel.diesel.costRate||0}"><span class="helptext">Must be LOWER than sale rate. Purchase entries override it.</span></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Petrol Opening Stock (L)</label><input type="number" id="f-petrolStock" value="${DB.fuel.petrol.openingStock}"></div>
          <div class="field"><label>Petrol Margin (Rs./L)</label><input type="number" step="0.01" id="f-petrolMargin" value="${DB.fuel.petrol.margin}"><span class="helptext">Only used if no cost rate is set</span></div>
          <div class="field"><label>Petrol Purchase / Cost Rate (Rs./L)</label><input type="number" step="0.01" id="f-petrolCost" value="${DB.fuel.petrol.costRate||0}"><span class="helptext">Must be LOWER than sale rate. Purchase entries override it.</span></div>
        </div>
        <button class="btn btn-primary" onclick="saveTanks()">Save</button>
      </div>
    </div>
    <div class="card card-pad" style="margin-top:16px;">
      <div class="section-title" style="margin-top:0;">About cloud saving</div>
      <p class="small-note">Your data is stored securely in the cloud and saved automatically after every change. The pill in the top-right shows the status (click it to force a save). Use <b>Export</b> (📤) anytime to download a JSON backup, and <b>Import</b> (📥) to restore one.</p>
    </div>
  `;
}
function saveGeneral(){
  DB.meta.stationName = val('f-stationName');
  DB.meta.ownerName = val('f-ownerName');
  DB.meta.startDate = val('f-startDate');
  DB.meta.openingCash = numVal('f-openingCash');
  DB.meta.cashBooksStart = val('f-cashStart') || DB.meta.startDate;
  markDirty(); renderNav(); toast('Station info saved.','ok');
}
function saveTanks(){
  DB.tanks.dieselCapacity = numVal('f-dieselCap');
  DB.tanks.petrolCapacity = numVal('f-petrolCap');
  DB.fuel.diesel.openingStock = numVal('f-dieselStock');
  DB.fuel.diesel.margin = numVal('f-dieselMargin');
  DB.fuel.diesel.costRate = numVal('f-dieselCost');
  DB.fuel.petrol.costRate = numVal('f-petrolCost');
  DB.fuel.petrol.openingStock = numVal('f-petrolStock');
  DB.fuel.petrol.margin = numVal('f-petrolMargin');
  markDirty(); toast('Tank & stock settings saved.','ok');
}
function val(id){ return document.getElementById(id).value; }
function numVal(id){ return Number(document.getElementById(id).value)||0; }

function renderSetupNozzles(el){
  function nozzleTable(kind, title){
    return `
      <div class="card">
        <div class="card-head"><h3>${title}</h3><div class="hint">Opening reading used only for the very first entry of each nozzle</div></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nozzle</th><th class="num">Opening Reading (L)</th></tr></thead><tbody>
        ${DB.nozzles[kind].map((n,i)=>`<tr>
          <td><input style="max-width:220px" value="${esc(n.name)}" onchange="DB.nozzles['${kind}'][${i}].name=this.value; markDirty();"></td>
          <td class="num"><input type="number" style="max-width:160px; text-align:right" value="${n.opening}" onchange="DB.nozzles['${kind}'][${i}].opening=Number(this.value)||0; markDirty();"></td>
        </tr>`).join('')}
        </tbody></table></div>
      </div>`;
  }
  el.innerHTML = `<div class="grid grid-2">${nozzleTable('diesel','Diesel Nozzles')}${nozzleTable('petrol','Petrol Nozzles')}</div>
  <p class="small-note" style="margin-top:12px;">Changes save automatically as you type.</p>`;
}

function renderSetupOils(el){
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Oils &amp; Lubricants (${DB.oils.length})</h3>
        <button class="btn btn-primary btn-sm" onclick="openOilForm()">+ Add Product</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Product</th><th>Unit</th><th class="num">Opening Stock</th><th class="num">Cost Rate</th><th class="num">Sale Rate</th><th></th>
      </tr></thead><tbody>
      ${DB.oils.length? DB.oils.map(o=>`<tr>
        <td>${esc(o.name)}</td><td class="muted">${esc(o.unit)}</td>
        <td class="num">${num(o.openingStock,0)}</td><td class="num">${money(o.costRate)}</td><td class="num">${money(o.saleRate)}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openOilForm('${o.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteOil('${o.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(6)}
      </tbody></table></div>
    </div>`;
}
function openOilForm(id){
  const o = id? DB.oils.find(x=>x.id===id) : {name:'',unit:'',openingStock:0,costRate:0,saleRate:0};
  openModal(id?'Edit Product':'Add Product', `
    <div class="field"><label>Product Name</label><input id="m-name" value="${esc(o.name)}"></div>
    <div class="field"><label>Unit</label><input id="m-unit" placeholder="e.g. 4 Ltr Can, 1 Ltr" value="${esc(o.unit)}"></div>
    <div class="field-row">
      <div class="field"><label>Opening Stock</label><input type="number" id="m-stock" value="${o.openingStock}"></div>
      <div class="field"><label>Cost Rate (Rs./unit)</label><input type="number" id="m-cost" value="${o.costRate}"></div>
    </div>
    <div class="field"><label>Sale Rate (Rs./unit)</label><input type="number" id="m-sale" value="${o.saleRate}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitOilForm('${id||''}')">Save</button>`);
}
function submitOilForm(id){
  const obj = {name:val('m-name').trim(), unit:val('m-unit').trim(), openingStock:numVal('m-stock'), costRate:numVal('m-cost'), saleRate:numVal('m-sale')};
  if(!obj.name){ toast('Product name is required.','err'); return; }
  if(id) masterUpdate('oils', id, obj); else masterAdd('oils', obj, 'O');
  closeModal(); renderPage(); toast('Product saved.','ok');
}
function deleteOil(id){
  confirmDelete('Delete this product? Existing sales/purchase records referencing it will keep showing its old name.', ()=>{ masterDelete('oils', id); renderPage(); });
}

function genericMasterTab(el, opts){
  // opts: {key, title, addLabel, fields:[{key,label,type}], extraCol?:(row)=>html, idPrefix}
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>${opts.title} (${DB[opts.key].length})</h3>
        <button class="btn btn-primary btn-sm" onclick="openMasterForm('${opts.key}')">+ ${opts.addLabel}</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        ${opts.fields.map(f=>`<th${f.type==='number'?' class="num"':''}>${f.label}</th>`).join('')}
        ${opts.extraCol? `<th class="num">${opts.extraCol.label}</th>`:''}<th></th>
      </tr></thead><tbody>
      ${DB[opts.key].length? DB[opts.key].map(row=>`<tr>
        ${opts.fields.map(f=>`<td${f.type==='number'?' class="num"':''}>${f.type==='number'? (f.money?money(row[f.key]):num(row[f.key],f.dp!==undefined?f.dp:0)) : esc(row[f.key])}</td>`).join('')}
        ${opts.extraCol? `<td class="num">${opts.extraCol.render(row)}</td>`:''}
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openMasterForm('${opts.key}','${row.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteMasterRow('${opts.key}','${row.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(opts.fields.length + (opts.extraCol?2:1))}
      </tbody></table></div>
    </div>`;
}
var MASTER_DEFS = {
  customers: {key:'customers', title:'Customers', addLabel:'Add Customer', idPrefix:'C',
    fields:[{key:'name',label:'Customer Name'},{key:'openingBalance',label:'Opening Balance',type:'number',money:true}],
    extraCol:{label:'Current Balance', render:(row)=>{ const b=customerBalance(row.id, todayISO()); return `<span class="${b>0?'':'muted'}">${money(b)}</span>`; }}},
  suppliers: {key:'suppliers', title:'Suppliers', addLabel:'Add Supplier', idPrefix:'S',
    fields:[{key:'name',label:'Supplier Name'},{key:'openingBalance',label:'Opening Balance',type:'number',money:true}],
    extraCol:{label:'Current Balance', render:(row)=>{ const b=supplierBalance(row.id, todayISO()); return `<span class="${b>0?'':'muted'}">${money(b)}</span>`; }}},
  banks: {key:'banks', title:'Bank Accounts', addLabel:'Add Bank', idPrefix:'B',
    fields:[{key:'name',label:'Bank Name'},{key:'openingBalance',label:'Opening Balance',type:'number',money:true},
      {key:'depositPct',label:'Deposit Deduction %',type:'number',dp:3},{key:'withdrawPct',label:'Withdrawal Deduction %',type:'number',dp:3}]},
  partners: {key:'partners', title:'Partners', addLabel:'Add Partner', idPrefix:'PT',
    fields:[{key:'name',label:'Partner Name'},{key:'sharePct',label:'Profit Share %',type:'number',dp:1},{key:'openingCapital',label:'Opening Capital',type:'number',money:true}]},
};
function renderSetupCustomers(el){ genericMasterTab(el, MASTER_DEFS.customers); }
function renderSetupSuppliers(el){ genericMasterTab(el, MASTER_DEFS.suppliers); }
function renderSetupBanks(el){ genericMasterTab(el, MASTER_DEFS.banks); }
function renderSetupPartners(el){ genericMasterTab(el, MASTER_DEFS.partners); }

function openMasterForm(key, id){
  const def = MASTER_DEFS[key];
  const row = id? DB[key].find(r=>r.id===id) : {};
  def.fields.forEach(f=>{ if(row[f.key]===undefined) row[f.key]=f.type==='number'?0:''; });
  openModal(id?'Edit '+def.title.replace(/s$/,''):'Add '+def.title.replace(/s$/,''),
    def.fields.map(f=>`<div class="field"><label>${f.label}</label><input id="m-${f.key}" type="${f.type==='number'?'number':'text'}" ${f.dp?`step="0.1"`:''} value="${esc(row[f.key])}"></div>`).join(''),
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitMasterForm('${key}','${id||''}')">Save</button>`
  );
}
function submitMasterForm(key, id){
  const def = MASTER_DEFS[key];
  const obj={};
  let ok=true;
  def.fields.forEach(f=>{
    const raw = val('m-'+f.key);
    if(f.type==='number') obj[f.key]=Number(raw)||0; else obj[f.key]=raw.trim();
    if(f.key==='name' && !obj[f.key]) ok=false;
  });
  if(!ok){ toast('Name is required.','err'); return; }
  if(id) masterUpdate(key, id, obj); else masterAdd(key, obj, def.idPrefix);
  closeModal(); renderPage(); toast('Saved.','ok');
}
function deleteMasterRow(key, id){
  confirmDelete('Delete this entry? Historical records referencing it are kept as-is.', ()=>{ masterDelete(key, id); renderPage(); });
}


/* ---------- Expense categories (Setup) — these feed the Head dropdown on the Expenses page ---------- */
function renderSetupExpenseHeads(el){
  const used = {};
  DB.tx.expenses.forEach(r=>{ used[r.head] = (used[r.head]||0) + 1; });
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Expense Categories (${DB.expenseHeads.length})</h3>
        <div class="hint">Categories added here appear automatically in the “Head” list when you add an expense.</div></div>
        <button class="btn btn-primary btn-sm" onclick="openExpenseHeadForm()">+ Add Category</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Category</th><th class="num">Expenses recorded</th><th></th>
      </tr></thead><tbody>
      ${DB.expenseHeads.length? DB.expenseHeads.map(h=>`<tr>
        <td>${esc(h.name)}</td><td class="num muted">${used[h.name]||0}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openExpenseHeadForm('${h.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteExpenseHead('${h.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(3,'No categories yet — click “Add Category”.')}
      </tbody></table></div>
    </div>
    <p class="small-note" style="margin-top:12px;">Renaming a category also renames it on existing expense entries. Deleting a category only removes it from the dropdown — old expense entries keep their category.</p>`;
}
function openExpenseHeadForm(id){
  const h = id? DB.expenseHeads.find(x=>x.id===id) : {name:''};
  openModal(id?'Edit Expense Category':'Add Expense Category',
    `<div class="field"><label>Category name</label><input id="m-name" value="${esc(h.name)}" placeholder="e.g. Generator Diesel, Tea & Snacks" onkeydown="if(event.key==='Enter') submitExpenseHeadForm('${id||''}')"></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitExpenseHeadForm('${id||''}')">Save</button>`);
  setTimeout(()=>{ const i=document.getElementById('m-name'); if(i) i.focus(); }, 50);
}
function submitExpenseHeadForm(id){
  const name = val('m-name').trim();
  if(!name){ toast('Category name is required.','err'); return; }
  if(DB.expenseHeads.some(x=>x.id!==id && x.name.toLowerCase()===name.toLowerCase())){ toast('This category already exists.','err'); return; }
  if(id){
    const old = DB.expenseHeads.find(x=>x.id===id);
    if(old && old.name!==name) DB.tx.expenses.forEach(r=>{ if(r.head===old.name) r.head = name; });
    masterUpdate('expenseHeads', id, {name});
  } else masterAdd('expenseHeads', {name}, 'EH');
  markDirty(); closeModal(); renderPage(); toast('Category saved.','ok');
}
function deleteExpenseHead(id){
  confirmDelete('Delete this category? Existing expense entries keep their category name.', ()=>{ masterDelete('expenseHeads', id); renderPage(); });
}

function renderSetupEmployees(el){
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Employees (${DB.employees.length})</h3>
        <button class="btn btn-primary btn-sm" onclick="openEmployeeForm()">+ Add Employee</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Name</th><th>Designation</th><th class="num">Monthly Salary</th><th class="num">Opening Advance</th><th class="num">Closing Advance</th><th></th>
      </tr></thead><tbody>
      ${DB.employees.length? DB.employees.map(e=>{
        const s = employeeSummary(e.id, todayISO());
        return `<tr>
          <td>${esc(e.name)}</td><td class="muted">${esc(e.designation)}</td>
          <td class="num">${money(e.monthlySalary)}</td><td class="num">${money(e.openingAdvance)}</td>
          <td class="num">${money(s.closingAdvance)}</td>
          <td class="row-actions">
            <button class="btn btn-sm btn-icon" onclick="openEmployeeForm('${e.id}')">✏️</button>
            <button class="btn btn-sm btn-icon btn-danger" onclick="deleteMasterRow('employees','${e.id}')">🗑️</button>
          </td>
        </tr>`;
      }).join('') : emptyRow(6)}
      </tbody></table></div>
    </div>`;
}
function openEmployeeForm(id){
  const e = id? DB.employees.find(x=>x.id===id) : {name:'',designation:'',monthlySalary:0,openingAdvance:0};
  openModal(id?'Edit Employee':'Add Employee', `
    <div class="field"><label>Name</label><input id="m-name" value="${esc(e.name)}"></div>
    <div class="field"><label>Designation</label><input id="m-designation" value="${esc(e.designation)}"></div>
    <div class="field-row">
      <div class="field"><label>Monthly Salary</label><input type="number" id="m-salary" value="${e.monthlySalary}"></div>
      <div class="field"><label>Opening Advance (Dr)</label><input type="number" id="m-advance" value="${e.openingAdvance}"></div>
    </div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitEmployeeForm('${id||''}')">Save</button>`);
}
function submitEmployeeForm(id){
  const obj={name:val('m-name').trim(), designation:val('m-designation').trim(), monthlySalary:numVal('m-salary'), openingAdvance:numVal('m-advance')};
  if(!obj.name){ toast('Name is required.','err'); return; }
  if(id) masterUpdate('employees', id, obj); else masterAdd('employees', obj, 'E');
  closeModal(); renderPage(); toast('Saved.','ok');
}
/* =========================================================
   PAGE: NOZZLE SALES (Diesel / Petrol)
   ========================================================= */
function renderNozzlePage(el, kind){
  const key = nozzleKey(kind);
  const rows = sortByDate(DB.tx[key]).reverse();
  const totalL = DB.tx[key].reduce((s,r)=>s+computeNozzleRow(kind,r).totalLitres,0);
  const totalAmt = DB.tx[key].reduce((s,r)=>s+computeNozzleRow(kind,r).amount,0);
  const nozzles = DB.nozzles[kind];
  el.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      <div class="kpi ${kind==='diesel'?'green':'amber'}"><div class="label">Total Litres Sold</div><div class="value">${num(totalL,0)} L</div></div>
      <div class="kpi blue"><div class="label">Total Sale Value</div><div class="value">${money(totalAmt)}</div></div>
      <div class="kpi purple"><div class="label">Current Rate</div><div class="value">${money(getFuelRate(kind, todayISO()))}<span style="font-size:12px;">/L</span></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Daily Readings</h3>
        <button class="btn btn-primary btn-sm" onclick="openNozzleForm('${kind}')">+ Add Day's Reading</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th>
        ${nozzles.map((n,i)=>`<th class="num">${esc(n.name)}<br><span style="font-weight:400;">Closing</span></th>`).join('')}
        <th class="num">Total L</th><th class="num">Sale Rate</th><th class="num">Cost/L</th><th class="num">Sale Amount</th><th class="num">COGS</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>{
        const c = computeNozzleRow(kind, r);
        return `<tr>
          <td>${fmtDateShort(r.date)}</td>
          ${r.closings.map((v,i)=>`<td class="num">${num(v,0)}<div class="muted" style="font-size:11px;">+${num(c.sales[i],0)} L</div></td>`).join('')}
          <td class="num"><b>${num(c.totalLitres,0)}</b></td>
          <td class="num">${money(c.rate)}</td>
          <td class="num muted">${money(c.costRate)}</td>
          <td class="num">${money(c.amount)}</td>
          <td class="num muted">${money(c.cogs)}</td>
          <td class="row-actions">
            <button class="btn btn-sm btn-icon" onclick="openNozzleForm('${kind}','${r.id}')">✏️</button>
            <button class="btn btn-sm btn-icon btn-danger" onclick="deleteNozzleRow('${kind}','${r.id}')">🗑️</button>
          </td>
        </tr>`;
      }).join('') : emptyRow(nozzles.length+6)}
      </tbody></table></div>
    </div>`;
}
PAGES['nozzle-diesel'] = (el)=>renderNozzlePage(el,'diesel');
PAGES['nozzle-petrol'] = (el)=>renderNozzlePage(el,'petrol');

function openNozzleForm(kind, id){
  const key = nozzleKey(kind);
  const nozzles = DB.nozzles[kind];
  const row = id? DB.tx[key].find(r=>r.id===id) : null;
  const date = row? row.date : nextSuggestedDate(key);
  const closings = row? row.closings : nozzles.map((n,i)=> nozzleOpeningFor(kind,i,addDaysISO(date,1)));
  const rate = row? row.rate : getFuelRate(kind, date);
  const costRate = row? (row.costRate || fuelCostRate(kind, date, row)) : fuelCostRate(kind, date);
  const opens = nozzles.map((n,i)=> nozzleOpeningFor(kind,i,date));
  openModal((row?'Edit':'Add') + ' ' + (kind==='diesel'?'Diesel':'Petrol') + ' Reading', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${date}" onchange="refreshNozzleOpenings('${kind}')"></div>
    <div class="field-row">
      <div class="field"><label>Sale Rate (Rs./L)</label><input type="number" step="0.01" id="m-rate" value="${rate}"></div>
      <div class="field"><label>Purchase / Cost Rate (Rs./L)</label><input type="number" step="0.01" id="m-cost" value="${costRate}"><span class="helptext">Must be lower than the sale rate</span></div>
    </div>
    <div id="nozzle-fields">
      ${nozzles.map((n,i)=>`
        <div class="field-row">
          <div class="field"><label>${esc(n.name)} — Opening</label><input type="number" id="m-open-${i}" value="${opens[i]}" disabled style="background:#f6f8fa;"></div>
          <div class="field"><label>${esc(n.name)} — Closing</label><input type="number" id="m-close-${i}" value="${closings[i]}"></div>
        </div>`).join('')}
    </div>
    <p class="small-note">Opening reading is pulled automatically from the previous day's closing (or Setup, for the first entry).</p>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitNozzleForm('${kind}','${id||''}')">Save</button>`);
}
function refreshNozzleOpenings(kind){
  const date = val('m-date');
  DB.nozzles[kind].forEach((n,i)=>{
    document.getElementById('m-open-'+i).value = nozzleOpeningFor(kind,i,date);
  });
  document.getElementById('m-rate').value = getFuelRate(kind, date);
  document.getElementById('m-cost').value = fuelCostRate(kind, date);
}
function nextSuggestedDate(key){
  const rows = sortByDate(DB.tx[key]);
  if(rows.length) return addDaysISO(rows[rows.length-1].date, 1);
  return DB.meta.startDate;
}
function submitNozzleForm(kind, id){
  const key = nozzleKey(kind);
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  if(!id && DB.tx[key].some(r=>r.date===date)){ toast('An entry for this date already exists — edit it instead.','err'); return; }
  const closings = DB.nozzles[kind].map((n,i)=> Number(val('m-close-'+i))||0);
  const rate = numVal('m-rate');
  const costRate = numVal('m-cost');
  const obj = {date, closings, rate, costRate};
  if(costRate>=rate) toast('Warning: cost rate is not lower than the sale rate — profit will show zero.','warn');
  if(id) txUpdate(key, id, obj); else txAdd(key, obj);
  closeModal(); renderPage(); toast('Reading saved.','ok');
}
function deleteNozzleRow(kind, id){
  confirmDelete('Delete this day\'s nozzle reading? Later days that reference its closing as their opening will recompute automatically.', ()=>{
    txDelete(nozzleKey(kind), id); renderPage();
  });
}
/* =========================================================
   PAGE: DAILY STOCK DIP  (tank charts + dip readings)
   ========================================================= */
var TANK_META = {
  diesel:{label:'HSD (Diesel)', short:'HSD', color:'#0f5f4e', soft:'#e6f3ef'},
  petrol:{label:'PMG (Petrol)', short:'PMG', color:'#c8862a', soft:'#fbf0dd'}
};
function tankCapacity(kind){ return Number(kind==='diesel'? DB.tanks.dieselCapacity : DB.tanks.petrolCapacity) || 25000; }
function tankDiaMM(){ return (Number(DB.tanks.diaFt)||8.08) * 304.8; }

/* inverse of the dip chart: litres -> dip (mm) */
function dipFromVolume(table, vol){
  if(!table || !table.length || vol<=0) return 0;
  const last = table[table.length-1];
  if(vol >= last[1]) return last[0];
  if(vol < table[0][1]) return table[0][0] * vol / table[0][1];
  for(let i=1;i<table.length;i++){
    if(table[i][1] >= vol){
      const [x0,y0]=table[i-1], [x1,y1]=table[i];
      return y1===y0 ? x0 : x0 + (x1-x0)*(vol-y0)/(y1-y0);
    }
  }
  return last[0];
}

/* current tank level: latest dip entry if there is one, otherwise book stock */
function tankLevel(kind){
  const table = DB.calibration[kind];
  const cap = tankCapacity(kind);
  const dips = sortByDate(DB.tx.dip);
  const last = dips.length ? dips[dips.length-1] : null;
  const book = bookStock(kind, todayISO());
  let litres, dipMM, source;
  const lastDip = last ? (Number(kind==='diesel'? last.dieselDip : last.petrolDip) || 0) : 0;
  if(last && lastDip > 0){
    dipMM = lastDip;
    litres = physicalStock(kind, dipMM);
    source = 'Dip reading of ' + fmtDate(last.date);
  } else {
    litres = Math.max(0, book);
    dipMM = dipFromVolume(table, litres);
    source = 'Book stock (no dip entered yet)';
  }
  return {litres, dipMM, source, book, cap, pct: cap? Math.max(0,Math.min(100, litres/cap*100)) : 0, hasDip: !!(last && lastDip > 0)};
}

/* cross-section of the horizontal tank showing the liquid level */
function svgTankGauge(kind, dipMM){
  const m = TANK_META[kind];
  const size = 150, r = 66, cx = size/2, cy = size/2;
  const frac = Math.max(0, Math.min(1, dipMM / tankDiaMM()));
  const levelY = cy + r - frac*2*r;
  const id = 'tg-'+kind;
  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px; height:${size}px; flex:none;" role="img" aria-label="${m.short} tank liquid level ${Math.round(frac*100)}% of diameter">
    <defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6f8fa"/>
    <rect x="0" y="${levelY.toFixed(1)}" width="${size}" height="${size}" fill="${m.color}" opacity="0.85" clip-path="url(#${id})"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#9aa5b1" stroke-width="3"/>
    <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="15" font-weight="800" fill="${frac>0.5?'#fff':'#16212e'}">${Math.round(frac*100)}%</text>
  </svg>`;
}

/* dip (mm) -> litres curve, with optional marker */
function svgDipCurve(kind, markDip){
  const m = TANK_META[kind];
  const table = DB.calibration[kind] || [];
  const cap = tankCapacity(kind);
  const W=520, H=250, PL=54, PR=14, PT=14, PB=38;
  const pw=W-PL-PR, ph=H-PT-PB;
  if(!table.length) return '<p class="small-note">No dip chart loaded.</p>';
  const maxDip = table[table.length-1][0];
  const xMax = Math.ceil(maxDip/400)*400;
  const yMax = Math.max(cap, table[table.length-1][1]);
  const X = d => PL + pw*(d/xMax), Y = v => PT + ph - ph*(v/yMax);
  let grid='';
  for(let g=0; g<=5; g++){
    const v = yMax*g/5, y = Y(v);
    grid += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W-PR}" y2="${y.toFixed(1)}" stroke="var(--border-soft)"/>`;
    grid += `<text x="${PL-6}" y="${(y+3).toFixed(1)}" font-size="9.5" text-anchor="end" fill="var(--ink-soft)">${Math.round(v).toLocaleString()}</text>`;
  }
  for(let d=0; d<=xMax; d+=400){
    grid += `<text x="${X(d).toFixed(1)}" y="${H-20}" font-size="9.5" text-anchor="middle" fill="var(--ink-soft)">${d}</text>`;
  }
  let path = `M ${X(0).toFixed(1)} ${Y(0).toFixed(1)} `;
  table.forEach(([d,v])=>{ path += `L ${X(d).toFixed(1)} ${Y(v).toFixed(1)} `; });
  const area = path + `L ${X(maxDip).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  let marker='';
  if(markDip!==null && markDip!==undefined && markDip!=='' && !isNaN(markDip)){
    const md = Math.max(0, Math.min(maxDip, Number(markDip)));
    const mv = physicalStock(kind, md);
    const mx = X(md), my = Y(mv);
    const anchor = mx > W-150 ? 'end' : 'start';
    const tx = anchor==='end' ? mx-8 : mx+8;
    marker = `<line x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#b3413a" stroke-dasharray="4 3"/>
      <line x1="${PL}" y1="${my.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#b3413a" stroke-dasharray="4 3"/>
      <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4.5" fill="#b3413a" stroke="#fff" stroke-width="1.5"/>
      <text x="${tx.toFixed(1)}" y="${Math.max(PT+10, my-10).toFixed(1)}" font-size="10.5" font-weight="700" text-anchor="${anchor}" fill="#b3413a">${Math.round(md)} mm · ${Math.round(mv).toLocaleString()} L</text>`;
  }
  const capY = Y(cap);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;" role="img" aria-label="${m.short} dip chart: dip in mm against litres">
    ${grid}
    <path d="${area}" fill="${m.color}" opacity="0.10"/>
    <line x1="${PL}" y1="${capY.toFixed(1)}" x2="${W-PR}" y2="${capY.toFixed(1)}" stroke="#9aa5b1" stroke-dasharray="5 4"/>
    <text x="${PL+6}" y="${(capY+12).toFixed(1)}" font-size="9.5" fill="var(--ink-soft)">Capacity ${cap.toLocaleString()} L</text>
    <path d="${path}" fill="none" stroke="${m.color}" stroke-width="2.4" stroke-linejoin="round"/>
    ${marker}
    <text x="${(PL+pw/2).toFixed(1)}" y="${H-5}" font-size="10.5" text-anchor="middle" fill="var(--ink-soft)">Dip (mm)</text>
    <text x="11" y="${(PT+ph/2).toFixed(1)}" font-size="10.5" text-anchor="middle" fill="var(--ink-soft)" transform="rotate(-90 11 ${(PT+ph/2).toFixed(1)})">Litres</text>
  </svg>`;
}

function tankCardHtml(kind){
  const m = TANK_META[kind];
  const lv = tankLevel(kind);
  const free = Math.max(0, lv.cap - lv.litres);
  return `
    <div class="card">
      <div class="card-head">
        <div><h3>${m.label} Tank</h3><div class="hint">Capacity ${num(lv.cap,0)} L · Dia ${DB.tanks.diaFt||8.08} ft × Length ${DB.tanks.lengthFt||17.38} ft · Base plate ${DB.tanks.basePlateMm||14.30} mm</div></div>
        <button class="btn btn-sm" onclick="openDipChartTable('${kind}')">📋 Dip chart table</button>
      </div>
      <div class="card-pad">
        <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap;">
          ${svgTankGauge(kind, lv.dipMM)}
          <div style="flex:1; min-width:190px;">
            <div style="font-size:26px; font-weight:800; letter-spacing:-.02em; color:${m.color};">${num(lv.litres,0)} L</div>
            <div class="small-note" style="margin-bottom:10px;">${esc(lv.source)}</div>
            <table class="tbl" style="font-size:12.5px;"><tbody>
              <tr><td class="muted" style="padding:5px 0;">Filled</td><td class="num" style="padding:5px 0;"><b>${lv.pct.toFixed(1)}%</b></td></tr>
              <tr><td class="muted" style="padding:5px 0;">Free space</td><td class="num" style="padding:5px 0;">${num(free,0)} L</td></tr>
              <tr><td class="muted" style="padding:5px 0;">Dip</td><td class="num" style="padding:5px 0;">${num(lv.dipMM,0)} mm</td></tr>
              <tr><td class="muted" style="padding:5px 0;">Book stock</td><td class="num" style="padding:5px 0;">${num(lv.book,0)} L</td></tr>
            </tbody></table>
          </div>
        </div>
        <div class="section-title">Dip chart — ${m.short}</div>
        <div id="curve-${kind}">${svgDipCurve(kind, lv.hasDip ? lv.dipMM : null)}</div>
        <div style="display:flex; gap:12px; align-items:flex-end; margin-top:12px; flex-wrap:wrap;">
          <div class="field" style="margin:0; flex:1; min-width:150px;"><label>Check a dip reading (mm)</label>
            <input type="number" step="0.1" min="0" id="calc-${kind}" placeholder="e.g. 560" oninput="tankCalc('${kind}')"></div>
          <div id="calc-out-${kind}" style="font-size:14px; font-weight:800; padding-bottom:9px; min-width:120px;" class="muted">— L</div>
        </div>
      </div>
    </div>`;
}
function tankCalc(kind){
  const v = document.getElementById('calc-'+kind).value;
  const out = document.getElementById('calc-out-'+kind);
  const lv = tankLevel(kind);
  if(v===''){ out.textContent='— L'; out.className='muted'; document.getElementById('curve-'+kind).innerHTML = svgDipCurve(kind, lv.hasDip? lv.dipMM : null); return; }
  const litres = physicalStock(kind, Number(v)||0);
  out.textContent = num(litres,0) + ' L';
  out.className = '';
  document.getElementById('curve-'+kind).innerHTML = svgDipCurve(kind, Number(v)||0);
}
function openDipChartTable(kind){
  const m = TANK_META[kind];
  const t = DB.calibration[kind] || [];
  const blocks = 4, per = Math.ceil(t.length/blocks);
  let head = '', body = '';
  for(let b=0;b<blocks;b++) head += `<th class="num">Dip (mm)</th><th class="num" style="border-right:${b<blocks-1?'2px solid var(--border)':'0'};">Litres</th>`;
  for(let i=0;i<per;i++){
    body += '<tr>';
    for(let b=0;b<blocks;b++){
      const p = t[b*per+i];
      body += p ? `<td class="num" style="padding:4px 10px;">${p[0]}</td><td class="num" style="padding:4px 10px; border-right:${b<blocks-1?'2px solid var(--border)':'0'};"><b>${num(p[1],0)}</b></td>` : `<td></td><td></td>`;
    }
    body += '</tr>';
  }
  openModal(m.label + ' — Dip chart (' + num(tankCapacity(kind),0) + ' L tank)',
    `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
     <p class="small-note" style="margin-top:10px;">${t.length} points from the supplied dip chart. Readings between two points are interpolated.</p>`,
    `<button class="btn" onclick="closeModal()">Close</button>`, true);
  document.getElementById('modal').style.maxWidth = '860px';
}

PAGES['dip-stock'] = function(el){
  const rows = sortByDate(DB.tx.dip).reverse();
  el.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:16px; align-items:start;">
      ${tankCardHtml('diesel')}
      ${tankCardHtml('petrol')}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Dip Readings</h3>
        <button class="btn btn-primary btn-sm" onclick="openDipForm()">+ Add Day's Dip</button>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th>
        <th class="num">HSD Dip (mm)</th><th class="num">HSD Physical (L)</th><th class="num">HSD Book (L)</th><th class="num">Variance</th>
        <th class="num">PMG Dip (mm)</th><th class="num">PMG Physical (L)</th><th class="num">PMG Book (L)</th><th class="num">Variance</th>
        <th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>{
        const c = computeDipRow(r);
        return `<tr>
          <td>${fmtDateShort(r.date)}</td>
          <td class="num">${num(r.dieselDip,0)}</td>
          <td class="num">${num(c.dieselPhysical,0)}</td>
          <td class="num muted">${num(c.dieselBook,0)}</td>
          <td class="num"><span class="badge ${Math.abs(c.dieselVariance)<10?'gray':(c.dieselVariance<0?'red':'amber')}">${c.dieselVariance>=0?'+':''}${num(c.dieselVariance,0)}</span></td>
          <td class="num">${num(r.petrolDip,0)}</td>
          <td class="num">${num(c.petrolPhysical,0)}</td>
          <td class="num muted">${num(c.petrolBook,0)}</td>
          <td class="num"><span class="badge ${Math.abs(c.petrolVariance)<10?'gray':(c.petrolVariance<0?'red':'amber')}">${c.petrolVariance>=0?'+':''}${num(c.petrolVariance,0)}</span></td>
          <td class="row-actions">
            <button class="btn btn-sm btn-icon" onclick="openDipForm('${r.id}')">✏️</button>
            <button class="btn btn-sm btn-icon btn-danger" onclick="deleteDipRow('${r.id}')">🗑️</button>
          </td>
        </tr>`;
      }).join('') : emptyRow(10,'No dip readings yet — click “Add Day’s Dip”. Until then the tanks above show book stock.')}
      </tbody></table></div>
    </div>
    <p class="small-note" style="margin-top:12px;">Physical stock is read from the tank dip chart (${DB.calibration.diesel.length} points for HSD / ${DB.calibration.petrol.length} points for PMG, linearly interpolated). Book stock = opening stock + purchases to date − nozzle sales to date. A negative variance suggests leakage, evaporation or under-delivery; a positive variance suggests over-delivery or a measurement error.</p>
  `;
};
function dipPreview(){
  [['m-ddip','m-dprev','diesel'],['m-pdip','m-pprev','petrol']].forEach(([inp,out,kind])=>{
    const v = document.getElementById(inp).value;
    document.getElementById(out).textContent = v===''? '' : '≈ ' + num(physicalStock(kind, Number(v)||0),0) + ' L in tank';
  });
}
function openDipForm(id){
  const row = id? DB.tx.dip.find(r=>r.id===id) : null;
  const date = row? row.date : nextSuggestedDate('dip');
  openModal((row?'Edit':'Add')+' Stock Dip', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${date}"></div>
    <div class="field-row">
      <div class="field"><label>HSD (Diesel) Dip (mm)</label><input type="number" step="0.1" id="m-ddip" oninput="dipPreview()" value="${row?row.dieselDip:''}"><span class="helptext" id="m-dprev"></span></div>
      <div class="field"><label>PMG (Petrol) Dip (mm)</label><input type="number" step="0.1" id="m-pdip" oninput="dipPreview()" value="${row?row.petrolDip:''}"><span class="helptext" id="m-pprev"></span></div>
    </div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitDipForm('${id||''}')">Save</button>`);
  dipPreview();
}
function submitDipForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  if(!id && DB.tx.dip.some(r=>r.date===date)){ toast('A dip entry for this date already exists — edit it instead.','err'); return; }
  const obj = {date, dieselDip:numVal('m-ddip'), petrolDip:numVal('m-pdip')};
  if(id) txUpdate('dip', id, obj); else txAdd('dip', obj);
  closeModal(); renderPage(); toast('Dip reading saved.','ok');
}
function deleteDipRow(id){ confirmDelete('Delete this dip reading?', ()=>{ txDelete('dip', id); renderPage(); }); }
/* =========================================================
   PAGE: CREDIT (UDHAAR) SALE
   ========================================================= */
PAGES['credit-sale'] = function(el){
  const rows = sortByDate(DB.tx.creditSale).reverse();
  const total = DB.tx.creditSale.reduce((s,r)=>s+csNet(r),0);
  const totalDisc = DB.tx.creditSale.reduce((s,r)=>s+csDisc(r),0);
  el.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      <div class="kpi amber"><div class="label">Total Credit Sales (net)</div><div class="value">${money(total)}</div><div class="sub">Discount given: ${money(totalDisc)}</div></div>
      <div class="kpi red"><div class="label">Total Outstanding</div><div class="value">${money(DB.customers.reduce((s,c)=>s+customerBalance(c.id,todayISO()),0))}</div></div>
      <div class="kpi blue"><div class="label">Entries</div><div class="value">${rows.length}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Credit Sale Entries</h3><button class="btn btn-primary btn-sm" onclick="openCreditSaleForm()">+ Add Entry</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Type</th><th>Customer</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Gross</th><th class="num">Discount</th><th class="num">Net Amount</th><th>Receipt #</th><th>Vehicle #</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td>
        <td><span class="badge ${r.type==='Diesel'?'green':r.type==='Petrol'?'amber':'blue'}">${r.type==='Oil'?productLabel(r.product):r.type}</span></td>
        <td>${esc(nameOf('customers', r.customerId))}</td>
        <td class="num">${num(r.qty,r.type==='Oil'?0:0)} ${productUnit(r.type==='Oil'?r.product:r.type)}</td>
        <td class="num">${money(r.rate)}</td>
        <td class="num">${money(csGross(r))}</td>
        <td class="num" style="color:var(--red)">${csDisc(r)?'-'+money(csDisc(r)):'—'}${r.discPct?'<div class="muted" style="font-size:11px;">'+r.discPct+'%</div>':''}</td>
        <td class="num"><b>${money(csNet(r))}</b></td>
        <td class="muted">${esc(r.receiptNo||'—')}</td>
        <td class="muted">${esc(r.vehicleNo||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openCreditSaleForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteCreditSale('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(11)}
      </tbody></table></div>
    </div>`;
};
function openCreditSaleForm(id){
  const row = id? DB.tx.creditSale.find(r=>r.id===id) : null;
  const date = row? row.date : todayISO();
  const type = row? row.type : 'Diesel';
  const product = row? row.product : '';
  openModal((row?'Edit':'Add')+' Credit Sale', `
    <div class="field-row">
      <div class="field"><label>Date</label><input type="date" id="m-date" value="${date}" onchange="ccRefreshRate()"></div>
      <div class="field"><label>Type</label>
        <select id="m-type" onchange="ccTypeChanged()">
          <option value="Diesel" ${type==='Diesel'?'selected':''}>Diesel</option>
          <option value="Petrol" ${type==='Petrol'?'selected':''}>Petrol</option>
          <option value="Oil" ${type==='Oil'?'selected':''}>Oil / Lubricant</option>
        </select>
      </div>
    </div>
    <div class="field" id="m-product-wrap" style="display:${type==='Oil'?'block':'none'};">
      <label>Product</label>
      <select id="m-product" onchange="ccRefreshRate()">${DB.oils.map(o=>`<option value="${o.id}" ${o.id===product?'selected':''}>${esc(o.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Customer</label><select id="m-customer">${optionsHtml(DB.customers, row?row.customerId:(DB.customers[0]||{}).id, 'id','name')}</select></div>
    <div class="field-row">
      <div class="field"><label>Quantity</label><input type="number" step="0.01" id="m-qty" oninput="csPreview()" value="${row?row.qty:''}"></div>
      <div class="field"><label>Rate (auto — editable)</label><input type="number" step="0.01" id="m-rate" oninput="csPreview()" value="${row?row.rate: ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Discount % (optional)</label><input type="number" step="0.01" min="0" id="m-discpct" oninput="csPreview()" value="${row&&row.discPct?row.discPct:''}" placeholder="0"></div>
      <div class="field"><label>Discount Rs. per unit / litre (optional)</label><input type="number" step="0.01" min="0" id="m-discunit" oninput="csPreview()" value="${row&&row.discPerUnit?row.discPerUnit:''}" placeholder="0"></div>
    </div>
    <div class="small-note" id="m-csprev" style="margin:-4px 0 12px 0; padding:9px 11px; background:#f6f8fa; border-radius:8px;"></div>
    <div class="field-row">
      <div class="field"><label>Receipt # (optional)</label><input id="m-receipt" value="${row?esc(row.receiptNo||''):''}"></div>
      <div class="field"><label>Vehicle # (optional)</label><input id="m-vehicle" value="${row?esc(row.vehicleNo||''):''}"></div>
    </div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitCreditSaleForm('${id||''}')">Save</button>`);
  if(!row) ccRefreshRate();
  csPreview();
}
function csPreview(){
  const q = numVal('m-qty'), r = numVal('m-rate'), g = q*r;
  const d = Math.round((q*numVal('m-discunit') + g*numVal('m-discpct')/100)*100)/100;
  const el = document.getElementById('m-csprev');
  if(el) el.innerHTML = 'Gross: <b>'+money(g)+'</b> · Discount: <b>'+money(d)+'</b> · Net payable by party: <b>'+money(g-d)+'</b>';
}
function ccTypeChanged(){
  document.getElementById('m-product-wrap').style.display = val('m-type')==='Oil' ? 'block' : 'none';
  ccRefreshRate();
}
function ccRefreshRate(){
  const type = val('m-type'), date = val('m-date');
  const product = type==='Oil' ? val('m-product') : type;
  document.getElementById('m-rate').value = productSaleRate(product, date);
  csPreview();
}
function submitCreditSaleForm(id){
  const type = val('m-type');
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const product = type==='Oil' ? val('m-product') : type;
  const qty = numVal('m-qty');
  const rate = numVal('m-rate');
  if(qty<=0){ toast('Quantity must be greater than zero.','err'); return; }
  const obj = {date, type, product, customerId: val('m-customer'), qty, rate, discPct: numVal('m-discpct'), discPerUnit: numVal('m-discunit'),
    costRate: productCostRate(product, date), receiptNo: val('m-receipt').trim(), vehicleNo: val('m-vehicle').trim()};
  if(id) txUpdate('creditSale', id, obj); else txAdd('creditSale', obj);
  closeModal(); renderPage(); toast('Credit sale saved.','ok');
}
function deleteCreditSale(id){ confirmDelete('Delete this credit sale entry?', ()=>{ txDelete('creditSale', id); renderPage(); }); }
/* =========================================================
   PAGE: CASH SALE — OTHER OILS
   ========================================================= */
PAGES['cash-oils'] = function(el){
  const rows = sortByDate(DB.tx.cashOils).reverse();
  const total = DB.tx.cashOils.reduce((s,r)=>s+r.qty*r.rate,0);
  el.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      <div class="kpi green"><div class="label">Total Counter Sales</div><div class="value">${money(total)}</div></div>
      <div class="kpi blue"><div class="label">Entries</div><div class="value">${rows.length}</div></div>
      <div class="kpi purple"><div class="label">Products Available</div><div class="value">${DB.oils.length}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Counter Sale Entries</h3><button class="btn btn-primary btn-sm" onclick="openCashOilsForm()">+ Add Entry</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Product</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th>Receipt #</th><th>Vehicle #</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td>
        <td>${esc(productLabel(r.product))}</td>
        <td class="num">${num(r.qty,0)} <span class="muted">${esc(productUnit(r.product))}</span></td>
        <td class="num">${money(r.rate)}</td>
        <td class="num"><b>${money(r.qty*r.rate)}</b></td>
        <td class="muted">${esc(r.receiptNo||'—')}</td>
        <td class="muted">${esc(r.vehicleNo||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openCashOilsForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteCashOils('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(8)}
      </tbody></table></div>
    </div>`;
};
function openCashOilsForm(id){
  const row = id? DB.tx.cashOils.find(r=>r.id===id) : null;
  const date = row? row.date : todayISO();
  openModal((row?'Edit':'Add')+' Counter Sale', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${date}" onchange="coRefreshRate()"></div>
    <div class="field"><label>Product</label><select id="m-product" onchange="coRefreshRate()">${DB.oils.map(o=>`<option value="${o.id}" ${row&&row.product===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Quantity</label><input type="number" step="0.01" id="m-qty" value="${row?row.qty:''}"></div>
      <div class="field"><label>Rate (auto — editable)</label><input type="number" step="0.01" id="m-rate" value="${row?row.rate:''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Receipt # (optional)</label><input id="m-receipt" value="${row?esc(row.receiptNo||''):''}"></div>
      <div class="field"><label>Vehicle # (optional)</label><input id="m-vehicle" value="${row?esc(row.vehicleNo||''):''}"></div>
    </div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitCashOilsForm('${id||''}')">Save</button>`);
  if(!row) coRefreshRate();
}
function coRefreshRate(){ document.getElementById('m-rate').value = productSaleRate(val('m-product'), val('m-date')); }
function submitCashOilsForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const product = val('m-product');
  const qty = numVal('m-qty');
  if(qty<=0){ toast('Quantity must be greater than zero.','err'); return; }
  const obj = {date, product, qty, rate:numVal('m-rate'), costRate:productCostRate(product,date),
    receiptNo: val('m-receipt').trim(), vehicleNo: val('m-vehicle').trim()};
  if(id) txUpdate('cashOils', id, obj); else txAdd('cashOils', obj);
  closeModal(); renderPage(); toast('Sale saved.','ok');
}
function deleteCashOils(id){ confirmDelete('Delete this counter sale entry?', ()=>{ txDelete('cashOils', id); renderPage(); }); }
/* =========================================================
   PAGE: PURCHASES
   ========================================================= */
PAGES['purchases'] = function(el){
  const rows = sortByDate(DB.tx.purchases).reverse();
  const total = DB.tx.purchases.reduce((s,r)=>s+r.qty*r.rate,0);
  el.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      <div class="kpi blue"><div class="label">Total Purchases</div><div class="value">${money(total)}</div></div>
      <div class="kpi red"><div class="label">Total Payable</div><div class="value">${money(DB.suppliers.reduce((s,x)=>s+supplierBalance(x.id,todayISO()),0))}</div></div>
      <div class="kpi purple"><div class="label">Entries</div><div class="value">${rows.length}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Purchase Entries</h3><button class="btn btn-primary btn-sm" onclick="openPurchaseForm()">+ Add Purchase</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Product</th><th>Supplier</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td>
        <td>${esc(productLabel(r.product))}</td>
        <td>${esc(nameOf('suppliers', r.supplierId))}</td>
        <td class="num">${num(r.qty,0)} <span class="muted">${esc(productUnit(r.product))}</span></td>
        <td class="num">${money(r.rate)}</td>
        <td class="num"><b>${money(r.qty*r.rate)}</b></td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openPurchaseForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deletePurchase('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(7)}
      </tbody></table></div>
    </div>`;
};
function openPurchaseForm(id){
  const row = id? DB.tx.purchases.find(r=>r.id===id) : null;
  const date = row? row.date : todayISO();
  openModal((row?'Edit':'Add')+' Purchase', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${date}"></div>
    <div class="field"><label>Product</label><select id="m-product">${productOptionsHtml(row?row.product:'Diesel')}</select></div>
    <div class="field"><label>Supplier</label><select id="m-supplier">${optionsHtml(DB.suppliers, row?row.supplierId:(DB.suppliers[0]||{}).id, 'id','name')}</select></div>
    <div class="field-row">
      <div class="field"><label>Quantity</label><input type="number" step="0.01" id="m-qty" value="${row?row.qty:''}"></div>
      <div class="field"><label>Rate (Rs./unit)</label><input type="number" step="0.01" id="m-rate" value="${row?row.rate:''}"></div>
    </div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitPurchaseForm('${id||''}')">Save</button>`);
}
function submitPurchaseForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const qty = numVal('m-qty');
  if(qty<=0){ toast('Quantity must be greater than zero.','err'); return; }
  const obj = {date, product: val('m-product'), supplierId: val('m-supplier'), qty, rate: numVal('m-rate')};
  if(id) txUpdate('purchases', id, obj); else txAdd('purchases', obj);
  closeModal(); renderPage(); toast('Purchase saved.','ok');
}
function deletePurchase(id){ confirmDelete('Delete this purchase entry?', ()=>{ txDelete('purchases', id); renderPage(); }); }
/* =========================================================
   PAGE: RECEIPTS
   ========================================================= */
PAGES['receipts'] = function(el){
  const rows = sortByDate(DB.tx.receipts).reverse();
  const total = rows.reduce((s,r)=>s+Number(r.amount||0),0);
  el.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="kpi green"><div class="label">Total Received</div><div class="value">${money(total)}</div></div>
      <div class="kpi red"><div class="label">Still Outstanding (all customers)</div><div class="value">${money(DB.customers.reduce((s,c)=>s+customerBalance(c.id,todayISO()),0))}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Receipt Entries</h3><button class="btn btn-primary btn-sm" onclick="openReceiptForm()">+ Add Receipt</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Received From</th><th>Mode</th><th class="num">Amount</th><th class="num">Bank Ded.</th><th>Narration</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td><td>${esc(nameOf('customers', r.customerId))}</td>
        <td><span class="badge blue">${esc(r.mode)}</span></td>
        <td class="num"><b>${money(r.amount)}</b></td><td class="num muted">${dedOf(r)?'-'+money(dedOf(r))+' ('+r.dedPct+'%)':'—'}</td><td class="muted">${esc(r.narration||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openReceiptForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteReceipt('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(7)}
      </tbody></table></div>
    </div>`;
};
/* ---------- Bank deduction form helpers ---------- */
function bankPct(modeName, which){
  const b = DB.banks.find(x=>x.name===modeName);
  return b ? (Number(which==='deposit'? b.depositPct : b.withdrawPct)||0) : 0;
}
function dedFieldsHtml(row){
  return `<div class="field-row">
    <div class="field"><label>Bank deduction % (manual)</label>
      <input type="number" step="0.001" min="0" id="m-dedpct" value="${row&&row.dedPct?row.dedPct:''}" placeholder="0" oninput="dedPreview()">
      <span class="helptext">Charge taken by the bank on this deposit / withdrawal. Pre-filled from the bank's default in Setup; change it as needed.</span></div>
    <div class="field"><label>Deduction amount</label>
      <div id="m-dedamt" style="padding:9px 11px; border:1px solid var(--border); border-radius:8px; background:#f6f8fa; font-weight:700;">Rs. 0</div></div>
  </div>`;
}
function dedPreview(){
  const el = document.getElementById('m-dedamt'); if(!el) return;
  el.textContent = 'Rs. ' + num(calcDed(numVal('m-amount'), numVal('m-dedpct')), 2);
}
function dedAutoFill(kind){
  let pct = 0;
  if(kind==='receipt') pct = bankPct(val('m-mode'),'deposit');
  else if(kind==='payment') pct = bankPct(val('m-mode'),'withdraw');
  else if(kind==='partner') pct = bankPct(val('m-mode'), val('m-type')==='Deposit'?'deposit':'withdraw');
  else if(kind==='transfer'){ const f=val('m-from'), t=val('m-to'); pct = f!=='Cash' ? bankPct(f,'withdraw') : bankPct(t,'deposit'); }
  document.getElementById('m-dedpct').value = pct || '';
  dedPreview();
}
function dedFields(amount){ const pct = numVal('m-dedpct'); return {dedPct:pct, dedAmt:calcDed(amount,pct)}; }

function openReceiptForm(id){
  const row = id? DB.tx.receipts.find(r=>r.id===id) : null;
  const custId = row? row.customerId : (DB.customers[0]||{}).id;
  openModal((row?'Edit':'Add')+' Receipt', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${row?row.date:todayISO()}"></div>
    <div class="field"><label>Received From</label><select id="m-customer" onchange="rcShowBalance()">${optionsHtml(DB.customers, custId, 'id','name')}</select></div>
    <div class="small-note" id="rc-balance" style="margin:-6px 0 12px 0;"></div>
    <div class="field-row">
      <div class="field"><label>Mode</label><select id="m-mode" onchange="dedAutoFill('receipt')">${modeOptionsHtml(row?row.mode:'Cash')}</select></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="m-amount" oninput="dedPreview()" value="${row?row.amount:''}"></div>
    </div>
    ${dedFieldsHtml(row)}
    <div class="field"><label>Narration (optional)</label><input id="m-narration" value="${row?esc(row.narration||''):''}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitReceiptForm('${id||''}')">Save</button>`);
  rcShowBalance();
  if(row) dedPreview(); else dedAutoFill('receipt');
}
function rcShowBalance(){
  const b = customerBalance(val('m-customer'), todayISO());
  document.getElementById('rc-balance').innerHTML = 'Current balance: <b>'+money(b)+'</b>' + (b>0? ' receivable' : b<0? ' advance held' : '');
}
function submitReceiptForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const amount = numVal('m-amount');
  if(amount<=0){ toast('Amount must be greater than zero.','err'); return; }
  const obj = {date, customerId: val('m-customer'), mode: val('m-mode'), amount, narration: val('m-narration').trim(), ...dedFields(amount)};
  if(id) txUpdate('receipts', id, obj); else txAdd('receipts', obj);
  closeModal(); renderPage(); toast('Receipt saved.','ok');
}
function deleteReceipt(id){ confirmDelete('Delete this receipt?', ()=>{ txDelete('receipts', id); renderPage(); }); }

/* =========================================================
   PAGE: PAYMENTS
   ========================================================= */
var PAYMENT_CATEGORIES = ['Fuel/Oil Purchase','Loan Repayment','Other'];
PAGES['payments'] = function(el){
  const rows = sortByDate(DB.tx.payments).reverse();
  const total = rows.reduce((s,r)=>s+Number(r.amount||0),0);
  el.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="kpi red"><div class="label">Total Paid</div><div class="value">${money(total)}</div></div>
      <div class="kpi amber"><div class="label">Still Payable (all suppliers)</div><div class="value">${money(DB.suppliers.reduce((s,x)=>s+supplierBalance(x.id,todayISO()),0))}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Payment Entries</h3><button class="btn btn-primary btn-sm" onclick="openPaymentForm()">+ Add Payment</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Paid To</th><th>Type</th><th>Category</th><th>Mode</th><th class="num">Amount</th><th class="num">Bank Ded.</th><th>Narration</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td>
        <td>${r.type==='Supplier Payment'? esc(nameOf('suppliers', r.supplierId)) : esc(r.paidTo||'—')}</td>
        <td class="muted">${esc(r.type)}</td><td class="muted">${esc(r.category||'—')}</td>
        <td><span class="badge blue">${esc(r.mode)}</span></td>
        <td class="num"><b>${money(r.amount)}</b></td><td class="num muted">${dedOf(r)?'-'+money(dedOf(r))+' ('+r.dedPct+'%)':'—'}</td><td class="muted">${esc(r.narration||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openPaymentForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deletePayment('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(9)}
      </tbody></table></div>
    </div>`;
};
function openPaymentForm(id){
  const row = id? DB.tx.payments.find(r=>r.id===id) : null;
  const type = row? row.type : 'Supplier Payment';
  openModal((row?'Edit':'Add')+' Payment', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${row?row.date:todayISO()}"></div>
    <div class="field"><label>Type</label>
      <select id="m-type" onchange="pmTypeChanged()">
        <option value="Supplier Payment" ${type==='Supplier Payment'?'selected':''}>Supplier Payment</option>
        <option value="Other" ${type==='Other'?'selected':''}>Other Payment</option>
      </select>
    </div>
    <div class="field" id="pm-supplier-wrap" style="display:${type==='Supplier Payment'?'block':'none'};">
      <label>Supplier</label><select id="m-supplier">${optionsHtml(DB.suppliers, row?row.supplierId:(DB.suppliers[0]||{}).id, 'id','name')}</select>
    </div>
    <div class="field" id="pm-paidto-wrap" style="display:${type==='Other'?'block':'none'};">
      <label>Paid To</label><input id="m-paidto" value="${row?esc(row.paidTo||''):''}">
    </div>
    <div class="field"><label>Category</label><select id="m-category">${PAYMENT_CATEGORIES.map(c=>`<option ${row&&row.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div class="field-row">
      <div class="field"><label>Mode</label><select id="m-mode" onchange="dedAutoFill('payment')">${modeOptionsHtml(row?row.mode:'Cash')}</select></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="m-amount" oninput="dedPreview()" value="${row?row.amount:''}"></div>
    </div>
    ${dedFieldsHtml(row)}
    <div class="field"><label>Narration (optional)</label><input id="m-narration" value="${row?esc(row.narration||''):''}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitPaymentForm('${id||''}')">Save</button>`);
  if(row) dedPreview(); else dedAutoFill('payment');
}
function pmTypeChanged(){
  const t = val('m-type');
  document.getElementById('pm-supplier-wrap').style.display = t==='Supplier Payment'?'block':'none';
  document.getElementById('pm-paidto-wrap').style.display = t==='Other'?'block':'none';
}
function submitPaymentForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const amount = numVal('m-amount');
  if(amount<=0){ toast('Amount must be greater than zero.','err'); return; }
  const type = val('m-type');
  const obj = {date, type, category: val('m-category'), mode: val('m-mode'), amount, narration: val('m-narration').trim(), ...dedFields(amount)};
  if(type==='Supplier Payment') obj.supplierId = val('m-supplier'); else obj.paidTo = val('m-paidto').trim();
  if(id) txUpdate('payments', id, obj); else txAdd('payments', obj);
  closeModal(); renderPage(); toast('Payment saved.','ok');
}
function deletePayment(id){ confirmDelete('Delete this payment?', ()=>{ txDelete('payments', id); renderPage(); }); }

/* =========================================================
   PAGE: EXPENSES
   ========================================================= */
/* Categories come from Setup → Expense Categories. A category used by an old entry (but since deleted) is still listed when editing that entry. */
function expenseHeadNames(extra){
  const names = DB.expenseHeads.map(h=>h.name);
  if(extra && names.indexOf(extra)<0) names.push(extra);
  return names;
}
PAGES['expenses'] = function(el){
  const rows = sortByDate(DB.tx.expenses).reverse();
  const total = rows.reduce((s,r)=>s+Number(r.amount||0),0);
  el.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="kpi red"><div class="label">Total Expenses</div><div class="value">${money(total)}</div></div>
      <div class="kpi blue"><div class="label">Entries</div><div class="value">${rows.length}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Expense Entries</h3><button class="btn btn-primary btn-sm" onclick="openExpenseForm()">+ Add Expense</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Head</th><th>Paid To</th><th>Mode</th><th class="num">Amount</th><th>Narration</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td><td><span class="badge gray">${esc(r.head)}</span></td>
        <td class="muted">${esc(r.paidTo||'—')}</td><td><span class="badge blue">${esc(r.mode)}</span></td>
        <td class="num"><b>${money(r.amount)}</b></td><td class="muted">${esc(r.narration||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openExpenseForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteExpense('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(7)}
      </tbody></table></div>
    </div>`;
};
function openExpenseForm(id){
  const row = id? DB.tx.expenses.find(r=>r.id===id) : null;
  openModal((row?'Edit':'Add')+' Expense', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${row?row.date:todayISO()}"></div>
    <div class="field"><label>Head</label><select id="m-head">${expenseHeadNames(row&&row.head).map(h=>`<option value="${esc(h)}" ${row&&row.head===h?'selected':''}>${esc(h)}</option>`).join('')}</select></div>
    <div class="field"><label>Paid To (optional)</label><input id="m-paidto" value="${row?esc(row.paidTo||''):''}"></div>
    <div class="field-row">
      <div class="field"><label>Mode</label><select id="m-mode">${modeOptionsHtml(row?row.mode:'Cash')}</select></div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" id="m-amount" value="${row?row.amount:''}"></div>
    </div>
    <div class="field"><label>Narration (optional)</label><input id="m-narration" value="${row?esc(row.narration||''):''}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitExpenseForm('${id||''}')">Save</button>`);
}
function submitExpenseForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const amount = numVal('m-amount');
  if(amount<=0){ toast('Amount must be greater than zero.','err'); return; }
  if(!val('m-head')){ toast('Add an expense category first (Setup → Expense Categories).','err'); return; }
  const obj = {date, head: val('m-head'), paidTo: val('m-paidto').trim(), mode: val('m-mode'), amount, narration: val('m-narration').trim()};
  if(id) txUpdate('expenses', id, obj); else txAdd('expenses', obj);
  closeModal(); renderPage(); toast('Expense saved.','ok');
}
function deleteExpense(id){ confirmDelete('Delete this expense?', ()=>{ txDelete('expenses', id); renderPage(); }); }

/* =========================================================
   PAGE: FUND TRANSFER
   ========================================================= */
PAGES['fund-transfer'] = function(el){
  const rows = sortByDate(DB.tx.fundTransfer).reverse();
  const bal = currentBalances();
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">Current Balances</div>
      <div class="grid grid-4">
        ${allModes().map(m=>`<div class="kpi ${m==='Cash'?'green':'blue'}"><div class="label">${esc(m)}</div><div class="value" style="font-size:18px;">${money(bal[m])}</div></div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Transfer Entries</h3><button class="btn btn-primary btn-sm" onclick="openTransferForm()">+ Add Transfer</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>From</th><th>To</th><th class="num">Amount</th><th class="num">Bank Ded.</th><th>Narration</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td>
        <td><span class="badge gray">${esc(r.from)}</span></td><td><span class="badge blue">${esc(r.to)}</span></td>
        <td class="num"><b>${money(r.amount)}</b></td><td class="num muted">${dedOf(r)?'-'+money(dedOf(r))+' ('+r.dedPct+'%)':'—'}</td><td class="muted">${esc(r.narration||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openTransferForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteTransfer('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(7)}
      </tbody></table></div>
    </div>`;
};
function openTransferForm(id){
  const row = id? DB.tx.fundTransfer.find(r=>r.id===id) : null;
  openModal((row?'Edit':'Add')+' Fund Transfer', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${row?row.date:todayISO()}"></div>
    <div class="field-row">
      <div class="field"><label>From</label><select id="m-from" onchange="dedAutoFill('transfer')">${modeOptionsHtml(row?row.from:'Cash')}</select></div>
      <div class="field"><label>To</label><select id="m-to" onchange="dedAutoFill('transfer')">${modeOptionsHtml(row?row.to:(DB.banks[0]||{}).name)}</select></div>
    </div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="m-amount" oninput="dedPreview()" value="${row?row.amount:''}"></div>
    ${dedFieldsHtml(row)}
    <div class="small-note" style="margin:-4px 0 12px 0;">The deduction is charged to the bank account involved (the “From” bank on a withdrawal, otherwise the “To” bank on a deposit).</div>
    <div class="field"><label>Narration (optional)</label><input id="m-narration" value="${row?esc(row.narration||''):''}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitTransferForm('${id||''}')">Save</button>`);
  if(row) dedPreview(); else dedAutoFill('transfer');
}
function submitTransferForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const from = val('m-from'), to = val('m-to');
  if(from===to){ toast('“From” and “To” accounts must be different.','err'); return; }
  const amount = numVal('m-amount');
  if(amount<=0){ toast('Amount must be greater than zero.','err'); return; }
  const obj = {date, from, to, amount, narration: val('m-narration').trim(), ...dedFields(amount)};
  if(id) txUpdate('fundTransfer', id, obj); else txAdd('fundTransfer', obj);
  closeModal(); renderPage(); toast('Transfer saved.','ok');
}
function deleteTransfer(id){ confirmDelete('Delete this transfer?', ()=>{ txDelete('fundTransfer', id); renderPage(); }); }
/* =========================================================
   PAGE: PARTNERS LEDGER
   ========================================================= */
PAGES['partners-ledger'] = function(el){
  const rows = sortByDate(DB.tx.partnersLedger).reverse();
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">Partner Capital Balances</div>
      <div class="grid grid-3">
      ${DB.partners.map(p=>{
        const dep = DB.tx.partnersLedger.filter(r=>r.partnerId===p.id && r.type==='Deposit').reduce((s,r)=>s+Number(r.amount||0),0);
        const draw = DB.tx.partnersLedger.filter(r=>r.partnerId===p.id && r.type==='Drawing').reduce((s,r)=>s+Number(r.amount||0),0);
        const bal = Number(p.openingCapital||0)+dep-draw;
        return `<div class="kpi purple"><div class="label">${esc(p.name)} (${p.sharePct}%)</div><div class="value" style="font-size:19px;">${money(bal)}</div>
          <div class="sub">Deposits ${money(dep)} · Drawings ${money(draw)}</div></div>`;
      }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Transactions</h3><button class="btn btn-primary btn-sm" onclick="openPartnerTxForm()">+ Add Entry</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Partner</th><th>Type</th><th>Mode</th><th class="num">Amount</th><th class="num">Bank Ded.</th><th>Narration</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td><td>${esc(nameOf('partners', r.partnerId))}</td>
        <td><span class="badge ${r.type==='Deposit'?'green':'red'}">${esc(r.type)}</span></td>
        <td><span class="badge blue">${esc(r.mode)}</span></td>
        <td class="num"><b>${money(r.amount)}</b></td><td class="num muted">${dedOf(r)?'-'+money(dedOf(r))+' ('+r.dedPct+'%)':'—'}</td><td class="muted">${esc(r.narration||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openPartnerTxForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deletePartnerTx('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(8)}
      </tbody></table></div>
    </div>`;
};
function openPartnerTxForm(id){
  const row = id? DB.tx.partnersLedger.find(r=>r.id===id) : null;
  openModal((row?'Edit':'Add')+' Partner Transaction', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${row?row.date:todayISO()}"></div>
    <div class="field"><label>Partner</label><select id="m-partner">${optionsHtml(DB.partners, row?row.partnerId:(DB.partners[0]||{}).id,'id','name')}</select></div>
    <div class="field-row">
      <div class="field"><label>Type</label><select id="m-type" onchange="dedAutoFill('partner')"><option value="Deposit" ${row&&row.type==='Deposit'?'selected':''}>Deposit (capital in)</option><option value="Drawing" ${row&&row.type==='Drawing'?'selected':''}>Drawing (capital out)</option></select></div>
      <div class="field"><label>Mode</label><select id="m-mode" onchange="dedAutoFill('partner')">${modeOptionsHtml(row?row.mode:'Cash')}</select></div>
    </div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="m-amount" oninput="dedPreview()" value="${row?row.amount:''}"></div>
    ${dedFieldsHtml(row)}
    <div class="field"><label>Narration (optional)</label><input id="m-narration" value="${row?esc(row.narration||''):''}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitPartnerTxForm('${id||''}')">Save</button>`);
  if(row) dedPreview(); else dedAutoFill('partner');
}
function submitPartnerTxForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const amount = numVal('m-amount');
  if(amount<=0){ toast('Amount must be greater than zero.','err'); return; }
  const obj = {date, partnerId: val('m-partner'), type: val('m-type'), mode: val('m-mode'), amount, narration: val('m-narration').trim(), ...dedFields(amount)};
  if(id) txUpdate('partnersLedger', id, obj); else txAdd('partnersLedger', obj);
  closeModal(); renderPage(); toast('Saved.','ok');
}
function deletePartnerTx(id){ confirmDelete('Delete this entry?', ()=>{ txDelete('partnersLedger', id); renderPage(); }); }

/* =========================================================
   PAGE: EMPLOYEE LEDGER
   ========================================================= */
PAGES['employee-ledger'] = function(el){
  const rows = sortByDate(DB.tx.employeeLedger).reverse();
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">Employee Balances</div>
      <div class="grid grid-3">
      ${DB.employees.map(e=>{
        const s = employeeSummary(e.id, todayISO());
        return `<div class="kpi ${s.closingAdvance>0?'amber':'green'}"><div class="label">${esc(e.name)}</div>
          <div class="value" style="font-size:19px;">${money(s.closingAdvance)}</div>
          <div class="sub">${esc(e.designation)} · Salary ${money(e.monthlySalary)}/mo</div></div>`;
      }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Transactions</h3><button class="btn btn-primary btn-sm" onclick="openEmpTxForm()">+ Add Entry</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th>Employee</th><th>Type</th><th>Mode</th><th class="num">Amount</th><th>Narration</th><th></th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td><td>${esc(nameOf('employees', r.employeeId))}</td>
        <td><span class="badge ${r.type==='Salary Paid'?'blue':r.type==='Advance Given'?'amber':'green'}">${esc(r.type)}</span></td>
        <td><span class="badge gray">${esc(r.mode)}</span></td>
        <td class="num"><b>${money(r.amount)}</b></td><td class="muted">${esc(r.narration||'—')}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="openEmpTxForm('${r.id}')">✏️</button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="deleteEmpTx('${r.id}')">🗑️</button>
        </td>
      </tr>`).join('') : emptyRow(7)}
      </tbody></table></div>
    </div>`;
};
function openEmpTxForm(id){
  const row = id? DB.tx.employeeLedger.find(r=>r.id===id) : null;
  openModal((row?'Edit':'Add')+' Employee Transaction', `
    <div class="field"><label>Date</label><input type="date" id="m-date" value="${row?row.date:todayISO()}"></div>
    <div class="field"><label>Employee</label><select id="m-employee">${optionsHtml(DB.employees, row?row.employeeId:(DB.employees[0]||{}).id,'id','name')}</select></div>
    <div class="field-row">
      <div class="field"><label>Type</label><select id="m-type">
        <option value="Salary Paid" ${row&&row.type==='Salary Paid'?'selected':''}>Salary Paid</option>
        <option value="Advance Given" ${row&&row.type==='Advance Given'?'selected':''}>Advance Given</option>
        <option value="Advance Recovered" ${row&&row.type==='Advance Recovered'?'selected':''}>Advance Recovered</option>
      </select></div>
      <div class="field"><label>Mode</label><select id="m-mode">${modeOptionsHtml(row?row.mode:'Cash')}</select></div>
    </div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="m-amount" value="${row?row.amount:''}"></div>
    <div class="field"><label>Narration (optional)</label><input id="m-narration" value="${row?esc(row.narration||''):''}"></div>
  `, `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitEmpTxForm('${id||''}')">Save</button>`);
}
function submitEmpTxForm(id){
  const date = val('m-date');
  if(!date){ toast('Date is required.','err'); return; }
  const amount = numVal('m-amount');
  if(amount<=0){ toast('Amount must be greater than zero.','err'); return; }
  const obj = {date, employeeId: val('m-employee'), type: val('m-type'), mode: val('m-mode'), amount, narration: val('m-narration').trim()};
  if(id) txUpdate('employeeLedger', id, obj); else txAdd('employeeLedger', obj);
  closeModal(); renderPage(); toast('Saved.','ok');
}
function deleteEmpTx(id){ confirmDelete('Delete this entry?', ()=>{ txDelete('employeeLedger', id); renderPage(); }); }
/* =========================================================
   PAGE: CUSTOMER LEDGER
   ========================================================= */
var clSelectedCustomer = null;
PAGES['customer-ledger'] = function(el){
  if(!clSelectedCustomer && DB.customers.length) clSelectedCustomer = DB.customers[0].id;
  const balances = allCustomerBalances(todayISO());
  const totalOut = balances.reduce((s,c)=>s+Math.max(0,c.balance),0);
  el.innerHTML = `
    <div class="kpi red" style="margin-bottom:16px; max-width:280px;"><div class="label">Total Receivable</div><div class="value">${money(totalOut)}</div></div>
    <div class="grid" style="grid-template-columns:280px 1fr; align-items:start;">
      <div class="card">
        <div class="card-head"><h3>Customers</h3></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
        ${balances.map(c=>`<tr style="cursor:pointer; ${c.id===clSelectedCustomer?'background:var(--brand-light);':''}" onclick="clSelectedCustomer='${c.id}'; renderPage();">
          <td>${esc(c.name)}</td><td class="num">${money(c.balance)}</td>
        </tr>`).join('') || emptyRow(2,'No customers — add one in Setup.')}
        </tbody></table></div>
      </div>
      <div id="cl-detail"></div>
    </div>`;
  renderCustomerDetail();
};
function renderCustomerDetail(){
  const wrap = document.getElementById('cl-detail');
  const cust = DB.customers.find(c=>c.id===clSelectedCustomer);
  if(!cust){ wrap.innerHTML = '<div class="card card-pad">Select a customer.</div>'; return; }
  const txs = customerTransactions(cust.id);
  let running = Number(cust.openingBalance||0);
  const withRunning = [{date:cust.openingBalance?DB.meta.startDate:null, isOpening:true, balance:running}];
  const rowsHtml = txs.map(t=>{ running += t.debit - t.credit; return {...t, balance:running}; });
  wrap.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>${esc(cust.name)}</h3><span class="badge ${running>0?'red':'green'}">${money(running)}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>
        <tr><td>${fmtDateShort(DB.meta.startDate)}</td><td class="muted">Opening</td><td class="muted">Opening balance</td><td class="num">${Number(cust.openingBalance||0)>0?money(cust.openingBalance):''}</td><td class="num"></td><td class="num">${money(cust.openingBalance||0)}</td></tr>
        ${rowsHtml.length? rowsHtml.map(t=>`<tr>
          <td>${fmtDateShort(t.date)}</td><td class="muted">${esc(t.type)}</td><td>${esc(t.desc)}</td>
          <td class="num">${t.debit? money(t.debit):''}</td><td class="num">${t.credit? money(t.credit):''}</td>
          <td class="num"><b>${money(t.balance)}</b></td>
        </tr>`).join('') : emptyRow(6,'No transactions yet.')}
      </tbody></table></div>
    </div>`;
}

/* =========================================================
   PAGE: SUPPLIER LEDGER
   ========================================================= */
var slSelectedSupplier = null;
PAGES['supplier-ledger'] = function(el){
  if(!slSelectedSupplier && DB.suppliers.length) slSelectedSupplier = DB.suppliers[0].id;
  const balances = allSupplierBalances(todayISO());
  const totalPayable = balances.reduce((s,c)=>s+Math.max(0,c.balance),0);
  el.innerHTML = `
    <div class="kpi amber" style="margin-bottom:16px; max-width:280px;"><div class="label">Total Payable</div><div class="value">${money(totalPayable)}</div></div>
    <div class="grid" style="grid-template-columns:280px 1fr; align-items:start;">
      <div class="card">
        <div class="card-head"><h3>Suppliers</h3></div>
        <div class="tbl-wrap"><table class="tbl"><tbody>
        ${balances.map(s=>`<tr style="cursor:pointer; ${s.id===slSelectedSupplier?'background:var(--brand-light);':''}" onclick="slSelectedSupplier='${s.id}'; renderPage();">
          <td>${esc(s.name)}</td><td class="num">${money(s.balance)}</td>
        </tr>`).join('') || emptyRow(2,'No suppliers — add one in Setup.')}
        </tbody></table></div>
      </div>
      <div id="sl-detail"></div>
    </div>`;
  renderSupplierDetail();
};
function renderSupplierDetail(){
  const wrap = document.getElementById('sl-detail');
  const sup = DB.suppliers.find(s=>s.id===slSelectedSupplier);
  if(!sup){ wrap.innerHTML = '<div class="card card-pad">Select a supplier.</div>'; return; }
  const txs = supplierTransactions(sup.id);
  let running = Number(sup.openingBalance||0);
  const rowsHtml = txs.map(t=>{ running += t.credit - t.debit; return {...t, balance:running}; });
  wrap.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>${esc(sup.name)}</h3><span class="badge ${running>0?'amber':'green'}">${money(running)}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>
        <tr><td>${fmtDateShort(DB.meta.startDate)}</td><td class="muted">Opening</td><td class="muted">Opening balance</td><td class="num"></td><td class="num">${Number(sup.openingBalance||0)>0?money(sup.openingBalance):''}</td><td class="num">${money(sup.openingBalance||0)}</td></tr>
        ${rowsHtml.length? rowsHtml.map(t=>`<tr>
          <td>${fmtDateShort(t.date)}</td><td class="muted">${esc(t.type)}</td><td>${esc(t.desc)}</td>
          <td class="num">${t.debit? money(t.debit):''}</td><td class="num">${t.credit? money(t.credit):''}</td>
          <td class="num"><b>${money(t.balance)}</b></td>
        </tr>`).join('') : emptyRow(6,'No transactions yet.')}
      </tbody></table></div>
    </div>`;
}

/* =========================================================
   PAGE: STOCK SUMMARY
   ========================================================= */
PAGES['stock-summary'] = function(el){
  const asOf = window._ssDate || todayISO();
  const s = stockSummary(asOf);
  const fuelCard = (k,label,cap)=>{ const f=s[k]; const bad=f.costRate>=f.saleRate;
    return `<div class="card card-pad">
      <div class="section-title" style="margin-top:0;">⛽ ${label}</div>
      <div class="grid grid-2">
        <div><div class="muted" style="font-size:11.5px;">Book Stock</div><div style="font-size:20px; font-weight:800;">${num(f.book,0)} L</div></div>
        <div><div class="muted" style="font-size:11.5px;">Physical (last dip)</div><div style="font-size:20px; font-weight:800;">${f.physical==null?'—':num(f.physical,0)+' L'}</div></div>
      </div>
      <table class="tbl" style="margin-top:10px; font-size:12.5px;"><tbody>
        <tr><td class="muted">Purchase (cost) rate</td><td class="num">${money(f.costRate)}/L</td></tr>
        <tr><td class="muted">Sale rate</td><td class="num">${money(f.saleRate)}/L ${bad?'<span class="badge red">cost ≥ sale</span>':''}</td></tr>
        <tr><td><b>Stock cost value</b></td><td class="num"><b>${money(f.value)}</b></td></tr>
        <tr><td class="muted">Value at sale price</td><td class="num muted">${money(f.saleValue)}</td></tr>
      </tbody></table>
      <div class="muted" style="font-size:12px; margin-top:8px;">Tank capacity: ${num(cap,0)} L</div>
    </div>`; };
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
      <label style="font-weight:700; font-size:13px;">As of date</label>
      <input type="date" value="${asOf}" onchange="window._ssDate=this.value; renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px;">
      <span class="small-note">Every figure below recalculates for the chosen date.</span>
    </div>
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="kpi purple"><div class="label">Total Stock Cost</div><div class="value" style="font-size:19px;">${money(s.totalCost)}</div><div class="sub">Diesel + Petrol + Oils at purchase rate</div></div>
      <div class="kpi green"><div class="label">Stock at Sale Price</div><div class="value" style="font-size:19px;">${money(s.totalSaleValue)}</div></div>
      <div class="kpi blue"><div class="label">Expected Profit</div><div class="value" style="font-size:19px;">${money(s.totalSaleValue-s.totalCost)}</div><div class="sub">when this stock is sold</div></div>
      <div class="kpi amber"><div class="label">Fuel Stock Cost</div><div class="value" style="font-size:19px;">${money(s.diesel.value+s.petrol.value)}</div><div class="sub">Oils ${money(s.oilsCost)}</div></div>
    </div>
    <div class="grid grid-2" style="margin-bottom:16px;">
      ${fuelCard('diesel','Diesel',DB.tanks.dieselCapacity)}
      ${fuelCard('petrol','Petrol',DB.tanks.petrolCapacity)}
    </div>
    <div class="card">
      <div class="card-head"><h3>Oils &amp; Lubricants</h3></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Product</th><th class="num">Opening</th><th class="num">Purchased</th><th class="num">Sold</th><th class="num">Closing</th><th class="num">Cost Rate</th><th class="num">Sale Rate</th><th class="num">Value (cost)</th><th class="num">Value (sale)</th>
      </tr></thead><tbody>
      ${s.oils.map(o=>`<tr>
        <td>${esc(o.name)} <span class="muted">(${esc(o.unit)})</span></td>
        <td class="num">${num(o.openingStock,0)}</td><td class="num">${num(o.purchased,0)}</td><td class="num">${num(o.sold,0)}</td>
        <td class="num"><b>${num(o.closing,0)}</b></td>
        <td class="num">${money(o.costRate)} ${Number(o.costRate)>=Number(o.saleRate)?'<span class="badge red">≥ sale</span>':''}</td><td class="num">${money(o.saleRate)}</td>
        <td class="num">${money(o.value)}</td><td class="num muted">${money(o.saleValue)}</td>
      </tr>`).join('')}
      <tr><td colspan="7" class="right"><b>Total Oils</b></td><td class="num"><b>${money(s.oilsCost)}</b></td><td class="num muted"><b>${money(s.oilsSale)}</b></td></tr>
      <tr><td colspan="7" class="right"><b>TOTAL STOCK COST (Fuel + Oils)</b></td><td class="num"><b>${money(s.totalCost)}</b></td><td class="num muted"><b>${money(s.totalSaleValue)}</b></td></tr>
      </tbody></table></div>
    </div>
    <p class="small-note" style="margin-top:12px;">Fuel cost rate = latest purchase rate entered in Purchases; if none, the cost rate in Setup. Cost must be lower than the sale rate or profit shows zero.</p>`;
};

/* =========================================================
   PAGE: CASH & BANK LEDGER
   ========================================================= */
PAGES['cash-bank-ledger'] = function(el){
  const range = getRangeState('cbl', 30);
  const allRows = cashBankLedgerRange(null, null);
  const cashUsed = (Number(DB.meta.openingCash)||0)!==0 || allRows.some(r=> r.modes['Cash'].in || r.modes['Cash'].out);
  const modes = allModes().filter(m=> m!=='Cash' || cashUsed);
  const rows = cashBankLedgerRange(range.start, range.end).filter(r=> modes.some(m=> r.modes[m].in || r.modes[m].out)).reverse();
  const bal = currentBalances();
  el.innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(${Math.min(modes.length+1,5)},1fr); gap:12px; margin-bottom:16px;">
      ${modes.map(m=>`<div class="kpi ${m==='Cash'?'green':'blue'}"><div class="label">${esc(m)}</div><div class="value" style="font-size:18px;">${money(bal[m])}</div></div>`).join('')}
      <div class="kpi purple"><div class="label">Total Balance</div><div class="value" style="font-size:18px;">${money(modes.reduce((s,m)=>s+(bal[m]||0),0))}</div></div>
    </div>
    ${rangePickerHtml('cbl')}
    <div class="card">
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th rowspan="2" style="vertical-align:bottom;">Date</th>
        ${modes.map(m=>`<th colspan="4" class="center" style="text-align:center;">${esc(m)}</th>`).join('')}
        <th rowspan="2" class="num" style="vertical-align:bottom;">Total</th>
      </tr><tr>
        ${modes.map(()=>`<th class="num">Open</th><th class="num">In</th><th class="num">Out</th><th class="num">Close</th>`).join('')}
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td>
        ${modes.map(m=>{ const c=r.modes[m]; return `<td class="num muted">${num(c.opening,0)}</td><td class="num" style="color:var(--brand-dark)">${c.in?'+'+num(c.in,0):''}</td><td class="num" style="color:var(--red)">${c.out?'-'+num(c.out,0):''}</td><td class="num"><b>${num(c.closing,0)}</b></td>`; }).join('')}
        <td class="num"><b>${money(r.total)}</b></td>
      </tr>`).join('') : emptyRow(modes.length*4+2,'No cash or bank transactions in this period. Opening bank balances are shown above.')}
      </tbody></table></div>
    </div>`;
};

/* =========================================================
   PAGE: DAY BOOK
   ========================================================= */
PAGES['day-book'] = function(el){
  const range = getRangeState('db', 30);
  const rows = dayBookRange(range.start, range.end).filter(r=> r.totalCashSales||r.creditRef||r.receipts||r.supplierPayments||r.expenses||r.deductions||r.salaryPaid||r.advNet).reverse();
  const today = dayBookAsOf(todayISO());
  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="kpi green"><div class="label">Today's Cash Sales</div><div class="value" style="font-size:18px;">${today?money(today.totalCashSales):'—'}</div></div>
      <div class="kpi blue"><div class="label">Today's Closing Cash</div><div class="value" style="font-size:18px;">${today?money(today.closing):'—'}</div></div>
      <div class="kpi amber"><div class="label">Today's Expenses</div><div class="value" style="font-size:18px;">${today?money(today.expenses):'—'}</div></div>
      <div class="kpi purple"><div class="label">Today's Revenue (Cash+Credit)</div><div class="value" style="font-size:18px;">${today?money(today.totalRevenue):'—'}</div></div>
    </div>
    ${rangePickerHtml('db')}
    <div class="card">
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th class="num">Opening Cash</th><th class="num">Diesel Cash</th><th class="num">Petrol Cash</th><th class="num">Oils Cash</th>
        <th class="num">Total Cash Sales</th><th class="num">Credit (ref)</th><th class="num">Receipts</th><th class="num">Payments</th>
        <th class="num">Expenses</th><th class="num">Bank Ded.</th><th class="num">Salary</th><th class="num">Closing Cash</th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>`<tr>
        <td>${fmtDateShort(r.date)}</td><td class="num muted">${num(r.opening,0)}</td>
        <td class="num">${num(r.dieselCash,0)}</td><td class="num">${num(r.petrolCash,0)}</td><td class="num">${num(r.oilsCash,0)}</td>
        <td class="num"><b>${num(r.totalCashSales,0)}</b></td><td class="num muted">${num(r.creditRef,0)}</td>
        <td class="num" style="color:var(--brand-dark)">${r.receipts?'+'+num(r.receipts,0):''}</td>
        <td class="num" style="color:var(--red)">${r.supplierPayments?'-'+num(r.supplierPayments,0):''}</td>
        <td class="num" style="color:var(--red)">${r.expenses?'-'+num(r.expenses,0):''}</td>
        <td class="num" style="color:var(--red)">${r.deductions?'-'+num(r.deductions,0):''}</td>
        <td class="num" style="color:var(--red)">${r.salaryPaid?'-'+num(r.salaryPaid,0):''}</td>
        <td class="num"><b>${money(r.closing)}</b></td>
      </tr>`).join('') : emptyRow(13,'No day book entries yet.')}
      </tbody></table></div>
    </div>
    <p class="small-note" style="margin-top:12px;">The Day Book treats every receipt/payment as a cash-flow event regardless of mode (a simple overall cash-flow view). For the exact mode-by-mode (Cash vs each bank) picture, see <button class="link-btn" onclick="goTo('cash-bank-ledger')">Cash &amp; Bank Ledger</button>.</p>
  `;
};

/* ---------- shared date-range picker used by several report pages ---------- */
var _rangeState = {};
function getRangeState(key, defaultDays){
  if(!_rangeState[key]){
    const end = todayISO();
    const start = addDaysISO(end, -(defaultDays-1));
    _rangeState[key] = {start, end};
  }
  return _rangeState[key];
}
function rangePickerHtml(key){
  const r = getRangeState(key);
  return `
    <div class="card card-pad" style="margin-bottom:14px; display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap;">
      <div class="field" style="margin-bottom:0;"><label>From</label><input type="date" value="${r.start}" onchange="_rangeState['${key}'].start=this.value; renderPage();"></div>
      <div class="field" style="margin-bottom:0;"><label>To</label><input type="date" value="${r.end}" onchange="_rangeState['${key}'].end=this.value; renderPage();"></div>
      <div class="pill-select">
        <button onclick="setQuickRange('${key}',7)">7d</button>
        <button onclick="setQuickRange('${key}',30)">30d</button>
        <button onclick="setQuickRange('${key}',90)">90d</button>
      </div>
    </div>`;
}
function setQuickRange(key, days){
  const end = todayISO();
  _rangeState[key] = {start: addDaysISO(end,-(days-1)), end};
  renderPage();
}
/* =========================================================
   SHARED: period summary cards
   ========================================================= */
function periodSummaryHtml(start,end){
  const pl = plForRange(start,end);
  return `
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="kpi green"><div class="label">Revenue</div><div class="value" style="font-size:19px;">${money(pl.revenue)}</div></div>
      <div class="kpi blue"><div class="label">Gross Profit</div><div class="value" style="font-size:19px;">${money(pl.grossProfit)}</div></div>
      <div class="kpi amber"><div class="label">All Expenses</div><div class="value" style="font-size:19px;">${money(pl.totalOpex)}</div></div>
      <div class="kpi ${pl.netProfit>=0?'purple':'red'}"><div class="label">Net Profit</div><div class="value" style="font-size:19px;">${money(pl.netProfit)}</div></div>
    </div>`;
}
function dailyBreakdownTable(start,end){
  const rows = dayBookRange(start,end);
  return `
    <div class="card">
      <div class="card-head"><h3>Day-by-Day</h3></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Date</th><th class="num">Diesel L</th><th class="num">Petrol L</th><th class="num">Cash Sales</th><th class="num">Credit Sales</th><th class="num">Expenses</th><th class="num">Closing Cash</th>
      </tr></thead><tbody>
      ${rows.length? rows.map(r=>{
        const dRow = DB.tx.nozzleDiesel.find(x=>x.date===r.date);
        const pRow = DB.tx.nozzlePetrol.find(x=>x.date===r.date);
        const dL = dRow? computeNozzleRow('diesel',dRow).totalLitres : 0;
        const pL = pRow? computeNozzleRow('petrol',pRow).totalLitres : 0;
        return `<tr>
          <td>${fmtDateShort(r.date)}</td><td class="num">${dL?num(dL,0):'—'}</td><td class="num">${pL?num(pL,0):'—'}</td>
          <td class="num">${num(r.totalCashSales,0)}</td><td class="num muted">${num(r.creditRef,0)}</td>
          <td class="num">${(r.expenses+r.deductions)?num(r.expenses+r.deductions,0):''}</td><td class="num"><b>${num(r.closing,0)}</b></td>
        </tr>`;
      }).join('') : emptyRow(7)}
      </tbody></table></div>
    </div>`;
}

/* ---------- itemised detail: every expense, salary, bank deduction & discount ---------- */
function expenseDetailHtml(start,end){
  const pl = plForRange(start,end);
  const card = (title, hint, head, rows, colspan, total)=>`
    <div class="card" style="margin-top:16px;">
      <div class="card-head"><div><h3>${title}</h3><div class="hint">${hint}</div></div><span class="badge gray">${money(total)}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead>
      <tbody>${rows || emptyRow(colspan,'None in this period.')}</tbody>
      <tfoot><tr><td colspan="${colspan-1}">Total</td><td class="num">${money(total)}</td></tr></tfoot></table></div>
    </div>`;
  const heads = Object.entries(pl.byHead).sort((a,b)=>b[1]-a[1]);
  const summary = `
    <div class="card" style="margin-top:16px;">
      <div class="card-head"><div><h3>All Expenses by Head</h3><div class="hint">Operating expenses, salaries and bank deductions</div></div><span class="badge red">${money(pl.totalOpex)}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Head</th><th class="num">Amount</th></tr></thead><tbody>
      ${heads.length? heads.map(([h,v])=>`<tr><td>${esc(h)}</td><td class="num">${money(v)}</td></tr>`).join('') : emptyRow(2,'No expenses in this period.')}
      </tbody><tfoot><tr><td>Total expenses</td><td class="num">${money(pl.totalOpex)}</td></tr></tfoot></table></div>
    </div>`;
  const exp = card('Expense Entries — one by one', 'Every expense recorded in this period',
    '<th>Date</th><th>Head</th><th>Paid To</th><th>Mode</th><th>Narration</th><th class="num">Amount</th>',
    pl.expenseRows.map(r=>`<tr><td>${fmtDateShort(r.date)}</td><td><span class="badge gray">${esc(r.head)}</span></td><td class="muted">${esc(r.paidTo||'—')}</td><td>${esc(r.mode)}</td><td class="muted">${esc(r.narration||'—')}</td><td class="num">${money(r.amount)}</td></tr>`).join(''),
    6, pl.expenses);
  const sal = card('Salaries Paid', 'Employee salary payments', '<th>Date</th><th>Employee</th><th>Mode</th><th>Narration</th><th class="num">Amount</th>',
    pl.salaryRows.map(r=>`<tr><td>${fmtDateShort(r.date)}</td><td>${esc(nameOf('employees',r.employeeId))}</td><td>${esc(r.mode)}</td><td class="muted">${esc(r.narration||'—')}</td><td class="num">${money(r.amount)}</td></tr>`).join(''),
    5, pl.salaries);
  const bank = card('Bank Deductions (deposit / withdrawal charges)', 'Manual % charged by the bank on deposits and withdrawals',
    '<th>Date</th><th>Type</th><th>Party</th><th>Account</th><th class="num">Amount</th><th class="num">Rate %</th><th class="num">Deduction</th>',
    pl.bankRows.map(r=>`<tr><td>${fmtDateShort(r.date)}</td><td>${esc(r.source)}</td><td>${esc(r.who)}</td><td>${esc(r.mode)}</td><td class="num">${money(r.base)}</td><td class="num">${num(r.pct,3)}%</td><td class="num">${money(r.amount)}</td></tr>`).join(''),
    7, pl.bankCharges);
  const disc = card('Discounts Allowed on Sales to Parties', 'Reduces the party balance and your profit',
    '<th>Date</th><th>Customer</th><th>Product</th><th class="num">Qty</th><th class="num">Gross Sale</th><th class="num">Discount</th>',
    pl.discountRows.map(r=>`<tr><td>${fmtDateShort(r.date)}</td><td>${esc(r.customer)}</td><td>${esc(r.what)}</td><td class="num">${num(r.qty,0)} ${esc(r.unit)}</td><td class="num">${money(r.gross)}</td><td class="num">${money(r.amount)}</td></tr>`).join(''),
    6, pl.discount);
  return summary + exp + sal + bank + disc;
}

/* =========================================================
   PAGE: WEEKLY REPORT
   ========================================================= */
PAGES['weekly-report'] = function(el){
  const start = window._wrStart || addDaysISO(todayISO(),-6);
  const end = addDaysISO(start,6);
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
      <label style="font-weight:700; font-size:13px;">Week start date</label>
      <input type="date" value="${start}" onchange="window._wrStart=this.value; renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px;">
      <span class="small-note">Week: ${fmtDate(start)} — ${fmtDate(end)}</span>
    </div>
    ${periodSummaryHtml(start,end)}
    ${dailyBreakdownTable(start,end)}
    ${expenseDetailHtml(start,end)}
  `;
};

/* =========================================================
   PAGE: MONTHLY REPORT
   ========================================================= */
PAGES['monthly-report'] = function(el){
  const now = new Date();
  const month = window._mrMonth || (now.getMonth()+1);
  const year = window._mrYear || now.getFullYear();
  const [start,end] = monthBounds(year,month);
  const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
      <label style="font-weight:700; font-size:13px;">Month</label>
      <select onchange="window._mrMonth=Number(this.value); renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px;">
        ${monthNames.map((m,i)=>`<option value="${i+1}" ${i+1===month?'selected':''}>${m}</option>`).join('')}
      </select>
      <label style="font-weight:700; font-size:13px;">Year</label>
      <input type="number" value="${year}" onchange="window._mrYear=Number(this.value); renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px; width:100px;">
    </div>
    ${periodSummaryHtml(start,end)}
    ${dailyBreakdownTable(start,end)}
    ${expenseDetailHtml(start,end)}
  `;
};

/* =========================================================
   PAGE: YEARLY REPORT
   ========================================================= */
PAGES['yearly-report'] = function(el){
  const year = window._yrYear || new Date().getFullYear();
  const [start,end] = yearBounds(year);
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthRows = monthNames.map((m,i)=>{
    const [ms,me] = monthBounds(year,i+1);
    const pl = plForRange(ms,me);
    return {m, pl};
  });
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px; display:flex; align-items:center; gap:14px;">
      <label style="font-weight:700; font-size:13px;">Year</label>
      <input type="number" value="${year}" onchange="window._yrYear=Number(this.value); renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px; width:110px;">
    </div>
    ${periodSummaryHtml(start,end)}
    <div class="card">
      <div class="card-head"><h3>Month-by-Month</h3></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>Month</th><th class="num">Diesel L</th><th class="num">Petrol L</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross Profit</th><th class="num">All Expenses</th><th class="num">Net Profit</th>
      </tr></thead><tbody>
      ${monthRows.map(r=>`<tr>
        <td>${r.m}</td><td class="num">${r.pl.dieselL?num(r.pl.dieselL,0):'—'}</td><td class="num">${r.pl.petrolL?num(r.pl.petrolL,0):'—'}</td>
        <td class="num">${money(r.pl.revenue)}</td><td class="num muted">${money(r.pl.cogs)}</td><td class="num">${money(r.pl.grossProfit)}</td>
        <td class="num">${money(r.pl.totalOpex)}</td><td class="num"><b>${money(r.pl.netProfit)}</b></td>
      </tr>`).join('')}
      </tbody></table></div>
    </div>
    ${expenseDetailHtml(start,end)}`;
};

/* =========================================================
   PAGE: PROFIT & LOSS
   ========================================================= */
var plMode = 'monthly';
PAGES['profit-loss'] = function(el){
  const now = new Date();
  let start,end,label;
  if(plMode==='daily'){ const d=window._plDate||todayISO(); start=end=d; label=fmtDate(d); }
  else if(plMode==='weekly'){ const s=window._plWeekStart||addDaysISO(todayISO(),-6); start=s; end=addDaysISO(s,6); label=fmtDate(start)+' – '+fmtDate(end); }
  else if(plMode==='monthly'){ const m=window._plMonth||(now.getMonth()+1), y=window._plYear||now.getFullYear(); [start,end]=monthBounds(y,m); label=['January','February','March','April','May','June','July','August','September','October','November','December'][m-1]+' '+y; }
  else { const y=window._plYearOnly||now.getFullYear(); [start,end]=yearBounds(y); label='Year '+y; }

  const pl = plForRange(start,end);
  const stockAsOf = end > todayISO() ? todayISO() : end;
  const ss = stockSummary(stockAsOf);
  const mc = (kind,name)=>{ const cr=fuelCostRate(kind,stockAsOf), sr=getFuelRate(kind,stockAsOf); const bad = cr>=sr;
    return `<tr><td>${name}</td><td class="num">${money(sr)}</td><td class="num">${money(cr)}</td><td class="num"><span class="badge ${bad?'red':'green'}">${money(sr-cr)}/L</span></td></tr>`; };
  const line = (lbl,val,muted)=>`<tr><td class="${muted?'muted':''}">${lbl}</td><td class="num ${muted?'muted':''}">${val}</td></tr>`;
  const expHeads = Object.entries(pl.byHead).sort((a,b)=>b[1]-a[1]);
  el.innerHTML = `
    <div class="tabs">
      ${['daily','weekly','monthly','yearly'].map(m=>`<button class="tab-btn ${plMode===m?'active':''}" onclick="plMode='${m}'; renderPage();">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}
    </div>
    <div class="card card-pad" style="margin-bottom:16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
      ${plMode==='daily'? `<input type="date" value="${window._plDate||todayISO()}" onchange="window._plDate=this.value; renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px;">` : ''}
      ${plMode==='weekly'? `<label style="font-weight:700; font-size:13px;">Week start</label><input type="date" value="${window._plWeekStart||addDaysISO(todayISO(),-6)}" onchange="window._plWeekStart=this.value; renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px;">` : ''}
      ${plMode==='monthly'? `<select onchange="window._plMonth=Number(this.value); renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px;">${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i)=>`<option value="${i+1}" ${ (window._plMonth||now.getMonth()+1)===i+1?'selected':''}>${m}</option>`).join('')}</select><input type="number" value="${window._plYear||now.getFullYear()}" onchange="window._plYear=Number(this.value); renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px; width:100px;">` : ''}
      ${plMode==='yearly'? `<input type="number" value="${window._plYearOnly||now.getFullYear()}" onchange="window._plYearOnly=Number(this.value); renderPage();" style="padding:8px 10px; border:1px solid var(--border); border-radius:8px; width:110px;">` : ''}
      <span class="small-note">Showing: <b>${label}</b></span>
    </div>
    ${pl.costWarnings.length? `<div class="card card-pad" style="margin-bottom:16px; background:var(--red-light); border-color:#eecdc9;">
      <b style="color:var(--red);">⚠ Cost of Goods Sold equals the sale amount for some products</b>
      <ul style="margin:8px 0 0 18px; padding:0; font-size:13px;">${pl.costWarnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>
      <p class="small-note" style="margin:8px 0 0 0;">Enter the <b>Purchase / Cost Rate</b> in Setup &rarr; General &amp; Tanks (fuel) or Setup &rarr; Oils (lubricants), or on a nozzle entry. The cost rate must be lower than the sale rate.</p>
    </div>` : ''}
    <div class="grid" style="grid-template-columns:1.3fr 1fr; align-items:start; gap:16px;">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Profit &amp; Loss Statement</div>
        <div class="grid grid-2" style="gap:14px; align-items:stretch;">
          <div style="border:1px solid var(--border); border-radius:10px; padding:12px;">
            <div style="font-weight:800; margin-bottom:6px; color:var(--green,#1a7f4b);">TOTAL SALE (Revenue)</div>
            <table class="tbl" style="font-size:12.5px;"><tbody>
              ${pl.dieselL? `<tr><td>Diesel<div class="muted" style="font-size:11px;">${num(pl.dieselL,0)} L sold</div></td><td class="num">${money(pl.dieselRev)}</td></tr>`:''}
              ${pl.petrolL? `<tr><td>Petrol<div class="muted" style="font-size:11px;">${num(pl.petrolL,0)} L sold</div></td><td class="num">${money(pl.petrolRev)}</td></tr>`:''}
              ${pl.oilRows.map(o=>`<tr><td>${esc(o.name)}<div class="muted" style="font-size:11px;">${num(o.qty,0)} ${esc(o.unit)} sold</div></td><td class="num">${money(o.sale)}</td></tr>`).join('')}
              ${(!pl.dieselL && !pl.petrolL && !pl.oilRows.length)? '<tr><td class="muted">No sales in this period.</td><td></td></tr>':''}
              ${pl.discount? `<tr><td class="muted">Less: discounts allowed to parties</td><td class="num muted">(${money(pl.discount)})</td></tr>`:''}
              <tr style="border-top:2px solid var(--ink);"><td><b>Net Sale</b></td><td class="num"><b>${money(pl.revenue-pl.discount)}</b></td></tr>
            </tbody></table>
          </div>
          <div style="border:1px solid var(--border); border-radius:10px; padding:12px;">
            <div style="font-weight:800; margin-bottom:6px; color:var(--red);">COST OF GOODS SOLD <span class="muted" style="font-weight:600; font-size:11px;">(stock sold only)</span></div>
            <table class="tbl" style="font-size:12.5px;"><tbody>
              ${pl.dieselL? `<tr><td>Diesel<div class="muted" style="font-size:11px;">${num(pl.dieselL,0)} L × ${money(pl.dieselCostRate)}</div></td><td class="num">${money(pl.dieselCogs)}</td></tr>`:''}
              ${pl.petrolL? `<tr><td>Petrol<div class="muted" style="font-size:11px;">${num(pl.petrolL,0)} L × ${money(pl.petrolCostRate)}</div></td><td class="num">${money(pl.petrolCogs)}</td></tr>`:''}
              ${pl.oilRows.map(o=>`<tr><td>${esc(o.name)}<div class="muted" style="font-size:11px;">${num(o.qty,0)} ${esc(o.unit)} × ${money(o.qty? o.cost/o.qty:0)}</div></td><td class="num">${money(o.cost)}</td></tr>`).join('')}
              ${(!pl.dieselL && !pl.petrolL && !pl.oilRows.length)? '<tr><td class="muted">Nothing sold in this period.</td><td></td></tr>':''}
              <tr style="border-top:2px solid var(--ink);"><td><b>Total Cost of Goods Sold</b></td><td class="num"><b>${money(pl.cogs)}</b></td></tr>
            </tbody></table>
            <div class="small-note" style="margin-top:8px;">Unsold stock is not included here — it stays in Stock Summary.</div>
          </div>
        </div>
        <table class="tbl" style="margin-top:14px;"><tbody>
          <tr style="border-top:2px solid var(--border);"><td><b>Gross Profit</b> <span class="muted">(Net Sale − Cost of Goods Sold)</span></td><td class="num"><b style="font-size:15px; color:${pl.grossProfit<0?'var(--red)':'var(--green,#1a7f4b)'};">${pl.grossProfit<0?'−':'+'}${money(Math.abs(pl.grossProfit))}</b></td></tr>
          <tr><td colspan="2" class="muted" style="padding-top:10px; font-weight:700;">Less: Expenses</td></tr>
          ${expHeads.length? expHeads.map(([h,v])=>line('&nbsp;&nbsp;'+esc(h),'('+money(v)+')',true)).join('') : line('&nbsp;&nbsp;No expenses','(Rs. 0)',true)}
          <tr style="border-top:1px solid var(--border-soft);"><td><b>Total Expenses</b></td><td class="num"><b>(${money(pl.totalOpex)})</b></td></tr>
          <tr style="border-top:2px solid var(--ink);"><td><b>NET PROFIT</b> <span class="muted">(Gross Profit − Expenses)</span></td><td class="num"><b style="font-size:17px; color:${pl.netProfit<0?'var(--red)':'var(--green,#1a7f4b)'};">${pl.netProfit<0?'−':'+'}${money(Math.abs(pl.netProfit))}</b></td></tr>
        </tbody></table>
      </div>
      <div>
        <div class="card card-pad" style="margin-bottom:16px;">
          <div class="section-title" style="margin-top:0;">Sale Rate vs Purchase Rate</div>
          <table class="tbl"><thead><tr><th>Product</th><th class="num">Sale</th><th class="num">Cost</th><th class="num">Margin</th></tr></thead><tbody>
            ${mc('diesel','Diesel')}${mc('petrol','Petrol')}
          </tbody></table>
          <div class="section-title">Closing Stock at Cost (${fmtDate(stockAsOf)})</div>
          <table class="tbl"><tbody>
            ${line('Diesel stock ('+num(ss.diesel.book,0)+' L)', money(ss.diesel.value))}
            ${line('Petrol stock ('+num(ss.petrol.book,0)+' L)', money(ss.petrol.value))}
            ${line('Oils / Lubricants stock', money(ss.oilsCost))}
            <tr style="border-top:2px solid var(--border);"><td><b>Total Stock Cost</b></td><td class="num"><b>${money(ss.totalCost)}</b></td></tr>
            ${line('Same stock at sale price', money(ss.totalSaleValue), true)}
            ${line('Expected profit when sold', money(ss.totalSaleValue-ss.totalCost), true)}
          </tbody></table>
        </div>
        <div class="card card-pad">
          <div class="section-title" style="margin-top:0;">Partner Profit Share</div>
          ${DB.partners.length? DB.partners.map(p=>`<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border-soft); font-size:13px;"><span>${esc(p.name)} (${p.sharePct}%)</span><b>${money(pl.netProfit*p.sharePct/100)}</b></div>`).join('') : '<p class="small-note">No partners added in Setup.</p>'}
        </div>
      </div>
    </div>
    ${expenseDetailHtml(start,end)}
  `;
};
/* =========================================================
   MINI CHART HELPERS (pure inline SVG, no external libs)
   ========================================================= */
var CHART_COLORS = ['#0f5f4e','#c8862a','#2b6ca3','#6a4d9c','#b3413a','#3a9188','#9a7325'];

function svgBarChart(labels, series, opts){
  opts = opts||{};
  const W = opts.width||560, H = opts.height||220, PAD_L=46, PAD_B=28, PAD_T=12, PAD_R=10;
  const plotW = W-PAD_L-PAD_R, plotH = H-PAD_T-PAD_B;
  const n = labels.length;
  const maxV = Math.max(1, ...series.flatMap(s=>s.data));
  const groupW = plotW/n;
  const barW = Math.max(2, (groupW*0.62)/series.length);
  let bars='';
  labels.forEach((lab,i)=>{
    series.forEach((s,si)=>{
      const v = s.data[i]||0;
      const h = plotH * (v/maxV);
      const x = PAD_L + i*groupW + groupW*0.19 + si*barW;
      const y = PAD_T + plotH - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color||CHART_COLORS[si%CHART_COLORS.length]}"><title>${esc(s.name||'')} ${esc(lab)}: ${Math.round(v).toLocaleString()}</title></rect>`;
    });
  });
  let gridlines='', yLabels='';
  const steps=4;
  for(let g=0; g<=steps; g++){
    const yy = PAD_T + plotH - (plotH*g/steps);
    gridlines += `<line x1="${PAD_L}" y1="${yy.toFixed(1)}" x2="${W-PAD_R}" y2="${yy.toFixed(1)}" stroke="var(--border-soft)" stroke-width="1"/>`;
    yLabels += `<text x="${PAD_L-6}" y="${(yy+3).toFixed(1)}" font-size="9.5" text-anchor="end" fill="var(--ink-soft)">${Math.round(maxV*g/steps).toLocaleString()}</text>`;
  }
  let xLabels='';
  const stride = n>14? Math.ceil(n/14) : 1;
  labels.forEach((lab,i)=>{
    if(i%stride!==0) return;
    const x = PAD_L + i*groupW + groupW/2;
    xLabels += `<text x="${x.toFixed(1)}" y="${H-8}" font-size="9.5" text-anchor="middle" fill="var(--ink-soft)">${esc(lab)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:${H}px;">${gridlines}${bars}${yLabels}${xLabels}</svg>`;
}

function svgLineChart(labels, series, opts){
  opts = opts||{};
  const W = opts.width||560, H = opts.height||220, PAD_L=46, PAD_B=28, PAD_T=12, PAD_R=10;
  const plotW = W-PAD_L-PAD_R, plotH = H-PAD_T-PAD_B;
  const n = labels.length;
  const maxV = Math.max(1, ...series.flatMap(s=>s.data));
  const stepX = n>1? plotW/(n-1) : 0;
  let gridlines='', yLabels='';
  const steps=4;
  for(let g=0; g<=steps; g++){
    const yy = PAD_T + plotH - (plotH*g/steps);
    gridlines += `<line x1="${PAD_L}" y1="${yy.toFixed(1)}" x2="${W-PAD_R}" y2="${yy.toFixed(1)}" stroke="var(--border-soft)" stroke-width="1"/>`;
    yLabels += `<text x="${PAD_L-6}" y="${(yy+3).toFixed(1)}" font-size="9.5" text-anchor="end" fill="var(--ink-soft)">${Math.round(maxV*g/steps).toLocaleString()}</text>`;
  }
  let paths='';
  series.forEach((s,si)=>{
    const color = s.color||CHART_COLORS[si%CHART_COLORS.length];
    let d='';
    let pts='';
    s.data.forEach((v,i)=>{
      const x = PAD_L + i*stepX;
      const y = PAD_T + plotH - plotH*(v/maxV);
      d += (i===0?'M':'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      pts += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${color}"><title>${esc(s.name||'')} ${esc(labels[i])}: ${Math.round(v).toLocaleString()}</title></circle>`;
    });
    paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>` + pts;
  });
  let xLabels='';
  const stride = n>14? Math.ceil(n/14) : 1;
  labels.forEach((lab,i)=>{
    if(i%stride!==0) return;
    const x = PAD_L + i*stepX;
    xLabels += `<text x="${x.toFixed(1)}" y="${H-8}" font-size="9.5" text-anchor="middle" fill="var(--ink-soft)">${esc(lab)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:${H}px;">${gridlines}${paths}${xLabels}</svg>`;
}

function svgDonut(segments, opts){
  opts = opts||{};
  const size = opts.size||160, stroke = opts.stroke||24;
  const r = (size-stroke)/2, cx=size/2, cy=size/2, C=2*Math.PI*r;
  const total = segments.reduce((s,x)=>s+Math.max(0,x.value),0) || 1;
  let offset = 0, circles='';
  segments.forEach((s,i)=>{
    const frac = Math.max(0,s.value)/total;
    const len = frac*C;
    const color = s.color || CHART_COLORS[i%CHART_COLORS.length];
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${len.toFixed(1)} ${(C-len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.name)}: ${Math.round(s.value).toLocaleString()}</title></circle>`;
    offset += len;
  });
  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px; height:${size}px;">${circles||`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>`}</svg>`;
}
function legendHtml(segments){
  const total = segments.reduce((s,x)=>s+Math.max(0,x.value),0) || 1;
  return `<div class="chart-legend">${segments.map((s,i)=>`<span><i style="background:${s.color||CHART_COLORS[i%CHART_COLORS.length]}"></i>${esc(s.name)} — ${money(s.value)} (${Math.round(100*Math.max(0,s.value)/total)}%)</span>`).join('')}</div>`;
}
/* =========================================================
   PAGE: DASHBOARD
   ========================================================= */
PAGES['dashboard'] = function(el){
  const today = todayISO();
  const todayRow = dayBookAsOf(today);
  const bal = currentBalances();
  const receivable = DB.customers.reduce((s,c)=>s+Math.max(0,customerBalance(c.id,today)),0);
  const payable = DB.suppliers.reduce((s,x)=>s+Math.max(0,supplierBalance(x.id,today)),0);
  const ss = stockSummary(today);
  const monthStart = today.slice(0,8)+'01';
  const plMonth = plForRange(monthStart, today);

  // Last 14 days trend
  const days = []; for(let i=13;i>=0;i--) days.push(addDaysISO(today,-i));
  const dieselSeries = days.map(d=>{ const r=DB.tx.nozzleDiesel.find(x=>x.date===d); return r? computeNozzleRow('diesel',r).amount : 0; });
  const petrolSeries = days.map(d=>{ const r=DB.tx.nozzlePetrol.find(x=>x.date===d); return r? computeNozzleRow('petrol',r).amount : 0; });
  const oilsSeries = days.map(d=> cashOilsSum(d) + DB.tx.creditSale.filter(r=>r.date===d&&r.type==='Oil').reduce((s,r)=>s+r.qty*r.rate,0));
  const dayLabels = days.map(d=>fmtDateShort(d).slice(0,5));

  const mixSegments = [
    {name:'Diesel', value: plMonth.dieselRev, color:CHART_COLORS[0]},
    {name:'Petrol', value: plMonth.petrolRev, color:CHART_COLORS[1]},
    {name:'Oils', value: plMonth.oilsRev, color:CHART_COLORS[2]},
  ];
  const expSegments = Object.entries(plMonth.byHead).map(([h,v],i)=>({name:h, value:v, color:CHART_COLORS[i%CHART_COLORS.length]}));

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="kpi green"><div class="label">Today's Total Sales</div><div class="value">${todayRow?money(todayRow.totalRevenue):money(0)}</div><div class="sub">Cash ${todayRow?money(todayRow.totalCashSales):money(0)} · Credit ${todayRow?money(todayRow.creditRef):money(0)}</div></div>
      <div class="kpi blue"><div class="label">Cash + Bank Balance</div><div class="value">${money(bal._total)}</div><div class="sub">${allModes().map(m=>m+': '+money(bal[m])).join(' · ')}</div></div>
      <div class="kpi red"><div class="label">Total Receivable</div><div class="value">${money(receivable)}</div><div class="sub">from ${DB.customers.length} customers</div></div>
      <div class="kpi amber"><div class="label">Total Payable</div><div class="value">${money(payable)}</div><div class="sub">to ${DB.suppliers.length} suppliers</div></div>
    </div>
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="kpi purple"><div class="label">HSD (Diesel) Stock</div><div class="value" style="font-size:19px;">${num(ss.diesel.book,0)} L</div><div class="sub">of ${num(DB.tanks.dieselCapacity,0)} L tank</div></div>
      <div class="kpi purple"><div class="label">PMG (Petrol) Stock</div><div class="value" style="font-size:19px;">${num(ss.petrol.book,0)} L</div><div class="sub">of ${num(DB.tanks.petrolCapacity,0)} L tank</div></div>
      <div class="kpi green"><div class="label">This Month Net Profit</div><div class="value" style="font-size:19px;">${money(plMonth.netProfit)}</div><div class="sub">Revenue ${money(plMonth.revenue)}</div></div>
      <div class="kpi blue"><div class="label">Total Stock Cost</div><div class="value" style="font-size:19px;">${money(ss.totalCost)}</div><div class="sub">Fuel + ${DB.oils.length} oil products</div></div>
    </div>

    <div class="grid" style="grid-template-columns:2fr 1fr; gap:16px; margin-bottom:16px; align-items:start;">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Sales — Last 14 Days</div>
        ${svgLineChart(dayLabels, [
          {name:'Diesel', data:dieselSeries, color:CHART_COLORS[0]},
          {name:'Petrol', data:petrolSeries, color:CHART_COLORS[1]},
          {name:'Oils', data:oilsSeries, color:CHART_COLORS[2]},
        ])}
        <div class="chart-legend">
          <span><i style="background:${CHART_COLORS[0]}"></i>Diesel</span>
          <span><i style="background:${CHART_COLORS[1]}"></i>Petrol</span>
          <span><i style="background:${CHART_COLORS[2]}"></i>Oils</span>
        </div>
      </div>
      <div class="card card-pad" style="text-align:center;">
        <div class="section-title" style="margin-top:0; text-align:left;">Sales Mix — This Month</div>
        ${svgDonut(mixSegments)}
        ${legendHtml(mixSegments)}
      </div>
    </div>

    <div class="grid grid-2" style="gap:16px;">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0;">Expense Breakdown — This Month</div>
        ${expSegments.length? `<div style="display:flex; align-items:center; gap:18px;">${svgDonut(expSegments)}<div style="flex:1;">${legendHtml(expSegments)}</div></div>` : '<p class="small-note">No expenses recorded this month yet.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Recent Activity</h3></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Amount</th></tr></thead><tbody>
          ${recentActivity(8).map(a=>`<tr><td>${fmtDateShort(a.date)}</td><td><span class="badge gray">${esc(a.type)}</span></td><td>${esc(a.desc)}</td><td class="num">${money(a.amount)}</td></tr>`).join('') || emptyRow(4,'No activity yet.')}
        </tbody></table></div>
      </div>
    </div>
  `;
};

function recentActivity(n){
  const items = [];
  DB.tx.nozzleDiesel.forEach(r=>items.push({date:r.date,type:'Diesel Sale',desc:num(computeNozzleRow('diesel',r).totalLitres,0)+' L',amount:computeNozzleRow('diesel',r).amount,_seq:r._seq}));
  DB.tx.nozzlePetrol.forEach(r=>items.push({date:r.date,type:'Petrol Sale',desc:num(computeNozzleRow('petrol',r).totalLitres,0)+' L',amount:computeNozzleRow('petrol',r).amount,_seq:r._seq}));
  DB.tx.creditSale.forEach(r=>items.push({date:r.date,type:'Credit Sale',desc:nameOf('customers',r.customerId),amount:csNet(r),_seq:r._seq}));
  DB.tx.cashOils.forEach(r=>items.push({date:r.date,type:'Counter Sale',desc:productLabel(r.product),amount:r.qty*r.rate,_seq:r._seq}));
  DB.tx.purchases.forEach(r=>items.push({date:r.date,type:'Purchase',desc:productLabel(r.product)+' — '+nameOf('suppliers',r.supplierId),amount:r.qty*r.rate,_seq:r._seq}));
  DB.tx.receipts.forEach(r=>items.push({date:r.date,type:'Receipt',desc:nameOf('customers',r.customerId),amount:r.amount,_seq:r._seq}));
  DB.tx.payments.forEach(r=>items.push({date:r.date,type:'Payment',desc:r.type==='Supplier Payment'?nameOf('suppliers',r.supplierId):(r.paidTo||'—'),amount:r.amount,_seq:r._seq}));
  DB.tx.expenses.forEach(r=>items.push({date:r.date,type:'Expense',desc:r.head,amount:r.amount,_seq:r._seq}));
  items.sort((a,b)=> a.date===b.date ? b._seq-a._seq : (a.date<b.date?1:-1));
  return items.slice(0,n);
}
/* App start-up happens in js/cloud.js (login -> load data -> bootApp()). */
