import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this._className='';this.textContent='';this.style={};this.dataset={};this._ev={};this.hidden=false;this.type='';this.parentNode=null;
    this.classList={add:(c)=>{this._className=(this._className?this._className+' ':'')+c;},remove:(c)=>{this._className=this._className.split(/\s+/).filter(x=>x&&x!==c).join(' ');},contains:(c)=>this._className.split(/\s+/).includes(c)};
  }
  addEventListener(t,f){(this._ev[t]??=[]).push(f);} 
  append(...cs){cs.forEach(c=>{c.parentNode=this;this.children.push(c);});}
  appendChild(c){c.parentNode=this;this.children.push(c);return c;}
  replaceChildren(...cs){this.children.forEach(c=>c.parentNode=null);this.children=cs;cs.forEach(c=>c.parentNode=this);}
  focus(){}
  getContext(){return {measureText:()=>({width:0})};}
  click(){ (this._ev.click||[]).forEach(f=>f({target:this,preventDefault(){},stopPropagation(){}})); }
}
function ser(n){ return {tag:n.tagName,cls:n._className,text:n.textContent,flex:n.style&&n.style.flex,children:(n.children||[]).map(ser)}; }
function walk(n,acc=[]){ const _tg=n.tag||n.tagName; if(_tg==='BUTTON') acc.push(n); for(const c of n.children||[]) walk(c,acc); return acc; }

function makeEnv(){
  globalThis.document={ createElement:(t)=>new El(t), addEventListener(){}, removeEventListener(){}, querySelector:(s)=>new El(String(s).includes('canvas')?'canvas':'div') };
  globalThis.window={ addEventListener(){}, removeEventListener(){} };
  globalThis.Node=class{}; globalThis.HTMLElement=class{};
  globalThis.setTimeout=(fn)=>0; // no real timers in equivalence
}

async function runFlow(confirmFn, modeFn, kind){
  makeEnv();
  const { ui } = await import('../app/state.js');
  ui.modal=new El('div'); ui.modalCard=new El('div'); ui.modal.classList.add('hidden');
  if(kind==='confirm-cancel'){
    const p=confirmFn('标题','消息');
    const tree=ser(ui.modalCard);
    const btns=walk(ui.modalCard); const cancel=btns.find(b=>b.textContent==='取消');
    cancel.click(); const res=await p;
    return {tree,res,hidden:ui.modal.classList.contains('hidden')};
  }
  if(kind==='confirm-ok'){
    const p=confirmFn('删除','确认删除？','删除',true);
    const tree=ser(ui.modalCard);
    const btns=walk(ui.modalCard); const ok=btns.find(b=>b.textContent==='删除');
    ok.click(); const res=await p;
    return {tree,res,hidden:ui.modal.classList.contains('hidden')};
  }
  // mode
  const p=modeFn();
  const tree=ser(ui.modalCard);
  const btns=walk(ui.modalCard); const circuit=btns.find(b=>b.textContent.startsWith('电路'));
  circuit.click(); const res=await p;
  return {tree,res,hidden:ui.modal.classList.contains('hidden')};
}

test('confirm modal equivalence cancel/ok', async () => {
  makeEnv();
  const OLD=await import('../fixtures/dialogs_build_old.mjs');
  const NEW=await import('../app/dialogs_build.js');
  for(const k of ['confirm-cancel','confirm-ok']){
    const a=await runFlow(OLD.oldConfirmModal, OLD.oldChooseModeModal, k);
    const b=await runFlow(NEW.openConfirmModal, NEW.openModeModal, k);
    assert.deepEqual(b,a,'flow '+k);
    assert.ok(a.tree.children.length>0,'modal rendered');
    assert.ok(walk(a.tree).length>=2,'at least two buttons');
    if(k==='confirm-cancel') assert.equal(a.res,false); else assert.equal(a.res,true);
  }
});
test('chooseModeModal equivalence', async () => {
  makeEnv();
  const OLD=await import('../fixtures/dialogs_build_old.mjs');
  const NEW=await import('../app/dialogs_build.js');
  const a=await runFlow(OLD.oldConfirmModal, OLD.oldChooseModeModal, 'mode');
  const b=await runFlow(NEW.openConfirmModal, NEW.openModeModal, 'mode');
  assert.deepEqual(b,a);
  assert.equal(b.res,'circuit');
});

test('closeModal direct: hides, clears card, resolves false', async () => {
  makeEnv();
  const { ui } = await import('../app/state.js');
  const NEW = await import('../app/dialogs_build.js');
  ui.modal = new El('div'); ui.modalCard = new El('div');
  ui.modal.classList.add('hidden');
  const p = NEW.openConfirmModal('t', 'm');
  assert.equal(ui.modal.classList.contains('hidden'), false);
  assert.ok(ui.modalCard.children.length > 0, 'card has children while open');
  NEW.closeModal();
  const res = await p;
  assert.equal(ui.modal.classList.contains('hidden'), true, 'hidden after closeModal');
  assert.equal(ui.modalCard.children.length, 0, 'card cleared');
  assert.equal(res, false, 'resolved false');
});
