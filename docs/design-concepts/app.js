// 비교 팔레트
const palettes=[
['기존 색상','#eef1f6','#ffffff','#1f2430','#6f7689','#e1e5ee','#4b6bfb'],
['소셜 클럽','#f5f5ed','#fcfcf7','#173d33','#53665c','#cdd4c7','#245442'],
['아케이드','#171a27','#232839','#f0f2e4','#b6bccd','#454a60','#d4ed65'],
['테이블 라운지','#e9eeea','#f7f9f6','#223e36','#52675e','#bbc9bf','#315c4b'],
['플레이룸','#f3edf4','#fffafd','#3e294c','#705d77','#d9c6df','#78429b'],
['클리어 블루','#f6f7fb','#fdfdff','#222b40','#586379','#d4dbea','#3757ca']
];
const frame=document.querySelector('iframe');let selected=1;
const keys=['--bg','--panel','--text','--muted','--line','--accent'];
// 팔레트 적용
function apply(){const doc=frame.contentDocument;if(!doc?.body)return;let style=doc.querySelector('#palette');if(!style){style=doc.createElement('style');style.id='palette';doc.head.append(style)}style.textContent=':root{'+keys.map((key,i)=>key+':'+palettes[selected][i+1]+'!important').join(';')+'}';document.querySelector('#selected').textContent=palettes[selected][0];document.querySelectorAll('[data-palette]').forEach((b,i)=>b.setAttribute('aria-pressed',i===selected));}
// 팔레트 선택 버튼
document.querySelector('#palettes').innerHTML=palettes.map((p,i)=>`<button data-palette="${i}" aria-pressed="${i===0}"><span class="swatch" style="background:${p[6]}"></span>${i===0?'원본':('0'+i)} · ${p[0]}</button>`).join('');
// 팔레트 선택
document.querySelectorAll('[data-palette]').forEach(b=>b.onclick=()=>{selected=+b.dataset.palette;apply()});
frame.onload=apply;
