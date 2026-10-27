// Run with the bundled workspace Node runtime. Generates the five printable
// delivery sheets and a combined PDF from the exact data used by index.html.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.env.WORKSPACE_RUNTIME || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
const require = createRequire(path.join(runtime, 'node/node_modules/package.json'));
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const dataStart = html.indexOf('const DAYS = [');
const dataEnd = html.indexOf('/* ===================== HELPERS');
const { DAYS, B, ITEMS } = vm.runInNewContext(html.slice(dataStart, dataEnd) + ';({DAYS,B,ITEMS})');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = n => n.toLocaleString('en-US');
const sum = a => a.reduce((s,n)=>s+n,0);
const total = b => sum(b.q);
const viaOf = b => B.find(x=>x.id===b.via);
const viaName = b => viaOf(b).name.replace(/^สาขา|^โรงพยาบาล/,'');
const nav = b => { const d = b.offmap ? viaOf(b) : b; return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${d.lat},${d.lng}`; };
const qr = JSON.parse(execFileSync(path.join(runtime, 'python/bin/python3'), ['-c', `
import json,sys,base64
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderSVG
out={}
for url in json.loads(sys.stdin.read()):
 q=QrCodeWidget(url,barLevel='M'); x,y,w,h=q.getBounds(); d=Drawing(w,h); d.add(q)
 out[url]='data:image/svg+xml;base64,'+base64.b64encode(renderSVG.drawToString(d).encode()).decode()
print(json.dumps(out))
`], {input:JSON.stringify([...new Set(B.map(nav))]),encoding:'utf8',maxBuffer:20*1024*1024}));
const fontDir = process.env.THAI_FONT_DIR || path.join(os.homedir(), 'Library/Fonts');
const font = await fs.readFile(path.join(fontDir,'NotoSansThai-Regular.ttf'));
const bold = await fs.readFile(path.join(fontDir,'NotoSansThai-Bold.ttf'));
const out = path.join(root,'output/pdf');
await fs.mkdir(out,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
const merged = await PDFDocument.create();
const selectedDays = new Set(process.argv.slice(2).map(Number));
try {
 for (const d of DAYS) {
  if (selectedDays.size && !selectedDays.has(d.n)) {
   const doc = await PDFDocument.load(await fs.readFile(path.join(out, `phufa-day-${d.n}.pdf`)));
   for (const p of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(p);
   continue;
  }
  const list = B.filter(b=>b.day===d.n).sort((a,b)=>a.seq-b.seq);
  const q = ITEMS.map((_,i)=>sum(list.map(b=>b.q[i])));
  const blocks = list.map((b,i)=>`${i===2 ? `<div class="continuation">เที่ยว ${d.n} · ${esc(d.label)} (ต่อ)</div>` : ""}<section class="branch">
    <div class="branch-title"><span class="box"></span><b>${b.seq}. ${esc(b.name)}</b><span class="right">${nf(total(b))} ชิ้น</span></div>
    <div class="branch-body"><div>
      <p><b>เวลาแนะนำ ${esc(b.eta)}</b> · ${esc(b.floor)}${b.offmap ? `<br><b>ฝากที่${esc(viaName(b))} ไม่ขับไปสาขาปลายทาง</b>` : ''}</p>
      <p>${esc(b.addr)}</p><p><b>โทร</b> ${esc(b.tel.join(' / '))} · <b>เปิด</b> ${esc(b.hours)}</p>
      <p><b>ส่งของ / ที่จอด</b> ${esc(b.how)}</p>
      <table class="quantities"><tbody>${ITEMS.map((it,i)=>`<tr><th>${it.name}</th><td><b>${nf(b.q[i])}</b></td><td>${it.colors.map((c,k)=>`${c} ${nf(b.c[i][k])}`).join(' · ')}</td></tr>`).join('')}</tbody></table>
      <p class="signature">ส่งจริง _________ น. &nbsp; ผู้รับ / ลายเซ็น ________________________</p>
    </div><aside><a href="${esc(nav(b))}"><img src="${qr[nav(b)]}" alt="QR นำทาง"></a><br><a href="${esc(nav(b))}">${b.offmap ? `นำทางจุดฝาก${esc(viaName(b))}` : 'สแกนนำทาง'}</a></aside></div>
   </section>`).join('');
  const content = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    @font-face{font-family:Thai;src:url(data:font/ttf;base64,${font.toString('base64')})}
    @font-face{font-family:Thai;font-weight:700;src:url(data:font/ttf;base64,${bold.toString('base64')})}
    @page{size:A4;margin:11mm 12mm 13mm}*{box-sizing:border-box}body{font-family:Thai,sans-serif;font-size:11px;line-height:1.5;color:#1b1c20;margin:0}
    h1{font-size:20px;margin:0}h2{font-size:15px;margin:4px 0}p{margin:2px 0}header{border-bottom:2px solid #8e2f2a;padding-bottom:7px;margin-bottom:8px}
    .kicker{letter-spacing:1px;color:#8e2f2a;font-size:9px}.note{background:#f4f1ea;padding:7px;margin:7px 0}.pending{border:1px solid #8a5a12;padding:6px;color:#69410a;font-weight:700;margin:6px 0}
    table{border-collapse:collapse;width:100%}th{text-align:left}td,th{padding:3px 5px}.summary{margin:8px 0;font-size:11px}.summary th,.summary td{border:1px solid #dfdace}.summary td{font-weight:700;text-align:right}
    .branch{border:1px solid #dfdace;margin:8px 0;break-inside:avoid}.branch-title{background:#f4f1ea;padding:5px 8px;font-size:12px;display:flex;align-items:center;gap:5px}.right{margin-left:auto;font-weight:700}.box{display:inline-block;width:10px;height:10px;border:1px solid #555}
    .branch-body{display:grid;grid-template-columns:1fr 83px;gap:8px;padding:6px 8px}.quantities{font-size:10px;margin-top:3px}.quantities td,.quantities th{border-bottom:1px solid #ece8e0;padding:2px 4px}.quantities th{width:60px}.quantities td:nth-child(2){width:35px;text-align:right}aside{text-align:center;font-size:8px}aside img{width:80px;height:80px}a{color:#2c6446}.signature{margin-top:7px}.continuation{break-before:page;font-size:15px;font-weight:700;border-bottom:2px solid #8e2f2a;padding-bottom:7px;margin-bottom:8px}footer{break-inside:avoid;font-size:8px;color:#5a554b;border-top:1px solid #dfdace;padding-top:5px;margin-top:8px}
   </style></head><body><header><div class="kicker">TANAPAT PRINTING · PHUFA DELIVERY 2570</div><h1>ใบเตรียมของและเช็คลิสต์ส่งรายวัน</h1><h2>เที่ยว ${d.n} · ${esc(d.label)}</h2><p>${esc(d.title)}</p></header>
   ${d.pending ? `<div class="pending">รอยืนยันวัน/วันที่: ${d.n===1 ? 'ข้อความเดิม “พ 22/10/69” แต่ 22 ต.ค. เป็นวันพฤหัสบดี' : 'ข้อความเดิม “ส 23/10/69” แต่ 23 ต.ค. เป็นวันศุกร์'} · ใช้ตัวเลขวันที่เดิมชั่วคราว</div>` : ''}
   <p>เวลาแต่ละจุดเป็นเวลาแนะนำ ยังไม่ใช่เวลานัดยืนยัน · ลำดับตามผู้ใช้แจ้ง</p>
   <table class="summary"><tr>${ITEMS.map(it=>`<th>${it.name}</th>`).join('')}<th>รวมเที่ยวนี้</th></tr><tr>${q.map(n=>`<td>${nf(n)}</td>`).join('')}<td>${nf(sum(q))} ชิ้น</td></tr></table>
   <div class="note">${esc(d.note)}</div>${blocks}
   <footer>จำนวน: ร่างตารางสิ่งพิมพ์ 2570.xls · สคส / สมุดเล่มเล็ก / สมุดเล่มใหญ่ · ตรวจครบ 15,000 ชิ้น<br>วัน ลำดับ ชั้น เวลารับของ และที่จอด: ผู้ใช้ 19 และ 27 ต.ค. 2569 · โทร/เวลาเปิด: <a href="https://www.phufa.org/branch-all/">phufa.org/branch-all</a> · วิธีเข้ารับสินค้าต้องโทรยืนยัน<br>แผนที่และ PDF ล่าสุด: <a href="https://hellopae.github.io/PhufaRoute/">hellopae.github.io/PhufaRoute</a> · ยืนยันวันส่งตามชื่อวัน: 21 / 22 / 24 / 26 / 27 ต.ค. 2569</footer>
   </body></html>`;
  await page.setContent(content,{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  const bytes = await page.pdf({path:path.join(out,`phufa-day-${d.n}.pdf`),format:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center;color:#666">PHUFA · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',preferCSSPageSize:true});
  const doc=await PDFDocument.load(bytes);
  for(const p of await merged.copyPages(doc,doc.getPageIndices())) merged.addPage(p);
  console.log(`Day ${d.n}: ${doc.getPageCount()} pages, ${sum(q)} pieces`);
 }
 await fs.writeFile(path.join(out,'phufa-all-days.pdf'),await merged.save());
 console.log('Created all six PDFs.');
} finally { await browser.close(); }
