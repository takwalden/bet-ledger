import {markets,sources,books} from './config.mjs'
import {outcomes,types,wagers,kinds,columns,day,validate,settle,summarize,filter,importCsv,exportCsv} from './ledger.mjs'
import {createCloud} from './cloud.mjs'

const $=id=>document.getElementById(id)
const cloud=createCloud()
const defaultSettings=()=>({sources:[...sources],books:[...books],markets:structuredClone(markets),defaultBook:'Hard Rock Bet'})
let rows=[], prefs=null, settings=defaultSettings(), filters={}, month=new Date(), ascending=false
let ready=false, loading=null, syncingAgain=false, epoch=0, editing=null, deleting=null, draft=null, staged=[]
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})
const cash=x=>money.format(x)
const pct=x=>x===null?'—':x.toFixed(1)+'%'
const color=x=>x>0?'gain':x<0?'loss':''
const bets=()=>rows.filter(r=>r.entry_type==='bet')
const chronological=(a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||'')||a.id.localeCompare(b.id)
const uniq=items=>[...new Set(items.filter(Boolean))]
const sorted=items=>uniq(items).sort((a,b)=>a.localeCompare(b))
function el(tag,value,cls) {
  const node=document.createElement(tag)
  if(value!=null) node.textContent=value
  if(cls) node.className=cls
  return node
}
function button(text,action) {
  const node=el('button',text)
  node.type='button'
  node.addEventListener('click',action)
  return node
}
function options(select,list,value,blank='') {
  select.replaceChildren()
  if(blank) select.add(new Option(blank,''))
  for(const item of uniq([...list,value])) select.add(new Option(item,item))
  select.value=value||''
}
function message(node,value='') {node.textContent=value;node.hidden=!value}
function notice(text='') {message($('notice'),text)}
function errorFor(form,text='') {message(form.querySelector('.error'),text)}
function read(form) {return Object.fromEntries(new FormData(form))}
function unpack(r) {return {...r.details,date:r.entry_date,entry_type:r.entry_type,id:r.id,updated_at:r.updated_at}}
function signedIn() {
  $('login').hidden=!!cloud.user
  $('dashboard').hidden=$('account').hidden=!cloud.user
}
function resetSessionView() {
  epoch++
  ready=false
  syncingAgain=false
  rows=[]
  prefs=null
  settings=defaultSettings()
  filters={}
  for(const id of ['editor','preferences','csv','delete-dialog']) $(id).close()
  for(const id of ['history','metrics','calendar','chart','transactions','bankroll','filters','month-summary']) $(id).replaceChildren()
  $('sync-status').textContent=''
  $('record-count').textContent=''
  signedIn()
}
function refresh(afterWrite=false) {
  if (!cloud.user) return Promise.resolve()
  if (loading) {
    if(afterWrite) syncingAgain=true
    return loading
  }
  const started=epoch
  loading=(async()=>{
    do {
      syncingAgain=false
      $('sync-status').textContent='Syncing…'
      try {
        const [data,preferences]=await Promise.all([cloud.entries(),cloud.preferences()])
        if(epoch!==started) return
        rows=data.map(unpack)
        prefs=preferences
        settings={...defaultSettings(),...prefs?.settings}
        ready=true
        updateControls()
        render()
        $('sync-status').textContent='Synced '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})
      } catch(e) {
        if(epoch!==started) return
        if(!cloud.user) resetSessionView()
        $('sync-status').textContent='Sync failed'
        notice(e.message)
      }
    } while(syncingAgain && started===epoch)
  })().finally(()=>{
    loading=null
    if(started!==epoch&&cloud.user) void refresh()
  })
  return loading
}
function updateControls() {
  for(const id of ['new-bet','new-transaction','import','export','settings']) $(id).disabled=!ready
}
function submit(id,action) {
  const form=$(id)
  form.addEventListener('submit',async e=>{
    e.preventDefault()
    errorFor(form)
    const submitter=form.querySelector('[type=submit]')
    submitter.disabled=true
    form.setAttribute('aria-busy','true')
    try {await action(form)} catch(e) {errorFor(form,e.message)}
    finally {submitter.disabled=false;form.removeAttribute('aria-busy')}
  })
}
submit('login-form',async form=>{
  const {email,password}=read(form)
  await cloud.signIn(email.trim(),password)
  form.reset()
  signedIn()
  notice()
  await refresh()
})
$('logout').onclick=async()=>{
  const leaving=cloud.signOut()
  resetSessionView()
  updateControls()
  notice()
  try {await leaving} catch {notice('Signed out on this device. Supabase did not confirm revocation of the remote session.')}
}
$('sync').onclick=()=>{notice();void refresh()}
window.addEventListener('focus',()=>{if(document.visibilityState==='visible') void refresh()})
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') void refresh()})
window.addEventListener('online',()=>void refresh())
setInterval(()=>{if(document.visibilityState==='visible') void refresh()},45000)
for(const close of document.querySelectorAll('[data-close]')) close.onclick=()=>close.closest('dialog').close()
for(const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel',e=>{
  if(dialog.querySelector('[aria-busy=true]')) e.preventDefault()
})

const filterFields={search:'Search',source:'Source',sport:'Sport / League',status:'Outcome',market:'Market',side:'Side',book:'Bookmaker',wager_type:'Wager type',date:'Game date',from:'From',to:'Through'}
function renderFilters() {
  const area=$('filters')
  for(const [key,label] of Object.entries(filterFields)) {
    let control=area.querySelector('[name='+key+']')
    const isSelect=!['search','date','from','to'].includes(key)
    if(!control) {
      const field=el('label',label)
      control=el(isSelect?'select':'input')
      control.name=key
      if(!isSelect) control.type=key==='search'?'search':'date'
      if(key==='search') control.placeholder='Search teams, players, markets, notes…'
      control.addEventListener(key==='search'?'input':'change',()=>{
        filters[key]=control.value
        if(key==='sport'&&filters.market&&control.value&&!choices('market').includes(filters.market)) filters.market=''
        if(key==='date'&&control.value) month=new Date(control.value+'T12:00')
        render()
      })
      field.append(control)
      area.append(field)
    }
    if(isSelect) options(control,choices(key),filters[key],'All')
    else if(control.value!==(filters[key]||'')) control.value=filters[key]||''
  }
}
function choices(key) {
  const league=filters.sport
  const lists={source:settings.sources,sport:Object.keys(settings.markets),status:outcomes,market:league?(settings.markets[league]||[]):Object.values(settings.markets).flat(),
    side:['Over','Under','Yes','No','Home','Away','Draw'],book:settings.books,wager_type:wagers}
  return sorted([...lists[key],...bets().filter(r=>key!=='market'||!league||r.sport===league).map(r=>r[key])])
}
$('reset').onclick=()=>{filters={};render()}
$('previous').onclick=()=>moveMonth(-1)
$('next').onclick=()=>moveMonth(1)
function moveMonth(step) {
  month=new Date(month.getFullYear(),month.getMonth()+step,1)
  renderCalendar()
}
function renderMetrics(s) {
  const cards=[
    ['Net cash P&L',cash(s.net),'Bonus proceeds '+cash(s.bonusNet),color(s.net)],
    ['Total bets',s.total,'Total staked '+cash(s.amount)],
    ['Record',s.won+'–'+s.lost,pct(s.winRate)+' win rate'],
    ['Pending',s.pending,'Potential return '+cash(s.potential),'pending'],
    ['Cash ROI',pct(s.roi),'Settled cash stake '+cash(s.risk),color(s.roi)],
    ['Cash wagered',cash(s.cash),'Includes pending cash stakes'],
    ['Void / Push',s.void+' / '+s.push,'Cash outs '+s.cashOut],
    ['Cash-funded P&L',cash(s.cashNet),'Includes cash-funded promotions',color(s.cashNet)]
  ]
  $('metrics').replaceChildren(...cards.map(([label,value,note,cls])=>{
    const tile=el('article',null,'metric')
    tile.append(el('span',label),el('strong',value,cls),el('small',note))
    return tile
  }))
}
function recordLabel(r) {
  return [r.name,r.matchup||[r.away,r.home].filter(Boolean).join(' @ '),r.selection].filter(Boolean).join(' · ')||r.market||r.sport||kinds[r.entry_type]||'Record'
}
function actionButtons(r) {
  const controls=el('div',null,'actions')
  for(const [label,fn] of [['Edit',()=>openEditor(r)],['Duplicate',()=>openEditor(r,true)],['Delete',()=>openDelete(r)]]) {
    if(r.entry_type!=='bet'&&label==='Duplicate') continue
    const b=button(label,fn)
    b.setAttribute('aria-label',label+' '+recordLabel(r)+' '+r.date)
    controls.append(b)
  }
  return controls
}
function renderHistory(records) {
  $('record-count').textContent=records.length+' of '+bets().length+' bets'
  const area=$('history')
  if(!records.length) {
    area.replaceChildren(el('p',bets().length?'No bets match these filters.':'No bets yet. Add a bet or import a CSV.','empty'))
    return
  }
  const table=el('table')
  table.setAttribute('aria-label','Historical bets')
  const tr=table.createTHead().insertRow()
  for(const label of ['Game date','Wager','Odds','Stake','Outcome','Net P&L','Actions']) {
    const th=el('th',label)
    th.scope='col'
    if(label==='Game date') {
      th.setAttribute('aria-sort',ascending?'ascending':'descending')
      th.replaceChildren(button(label+(ascending?' ↑':' ↓'),()=>{ascending=!ascending;renderHistory(records)}))
    }
    tr.append(th)
  }
  const body=table.createTBody()
  const ordered=[...records].sort((a,b)=>(ascending?1:-1)*chronological(a,b))
  for(const r of ordered) {
    const row=body.insertRow()
    const result=settle(r)
    const dateCell=el('td',r.date)
    if(r.time) dateCell.append(el('span',r.time.slice(0,5),'sub'))
    const item=el('td',recordLabel(r))
    item.append(el('span',[r.sport,r.market,r.side,r.line].filter(Boolean).join(' · '),'sub'))
    item.append(el('span',[r.source,r.book,r.type,r.legs?r.legs+' legs':''].filter(Boolean).join(' · '),'sub'))
    if(r.wager_type&&r.wager_type!==wagers[0]) item.append(el('span',r.wager_type,'sub tag'))
    const odds=Number(r.boosted_odds&&r.wager_type==='Odds Boost'?r.boosted_odds:r.odds)
    const net=el('td',result.pending?'—':cash(result.net),'money '+color(result.net))
    const actions=el('td')
    actions.append(actionButtons(r))
    row.append(dateCell,item,el('td',odds>0?'+'+odds:odds||'—'),el('td',cash(result.amount)+(result.cash?'':' bonus'),'money'),
      el('td',r.status||'Pending',result.pending?'pending':''),net,actions)
  }
  const wrap=el('div',null,'table-wrap')
  wrap.append(table)
  area.replaceChildren(wrap)
}
function renderCalendar() {
  const prefix=day(new Date(month.getFullYear(),month.getMonth(),1)).slice(0,7)
  $('month').textContent=month.toLocaleDateString('en-US',{month:'long',year:'numeric'})
  const dates=filter(bets(),{...filters,date:''}).filter(r=>r.date.startsWith(prefix))
  const groups=Map.groupBy?Map.groupBy(dates,r=>r.date):dates.reduce((m,r)=>m.set(r.date,[...(m.get(r.date)||[]),r]),new Map())
  const items=['Su','Mo','Tu','We','Th','Fr','Sa'].map(x=>el('span',x))
  const first=new Date(month.getFullYear(),month.getMonth(),1).getDay()
  for(let i=0;i<first;i++) items.push(el('span'))
  const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate()
  for(let i=1;i<=days;i++) {
    const key=prefix+'-'+String(i).padStart(2,'0')
    const s=summarize(groups.get(key)||[])
    const cell=button(i,()=>{
      filters.date=filters.date===key?'':key
      render()
      $('calendar').querySelector('[data-date="'+key+'"]')?.focus()
    })
    cell.dataset.date=key
    cell.setAttribute('aria-pressed',String(filters.date===key))
    cell.setAttribute('aria-label',key+(s.total?', '+cash(s.net)+', '+s.pending+' pending':''))
    if(s.total>s.pending) cell.append(el('small',cash(s.net),color(s.net)))
    if(s.pending) cell.append(el('small',s.pending+' open','pending'))
    items.push(cell)
  }
  $('calendar').replaceChildren(...items)
  const m=summarize(dates)
  $('month-summary').replaceChildren(el('strong',cash(m.net),color(m.net)),el('p',m.total+' bets · '+m.won+'–'+m.lost+' · '+m.pending+' pending'),el('p',cash(m.amount)+' staked · '+pct(m.roi)+' cash ROI'))
}
function renderBankroll() {
  const activity=rows.filter(r=>Object.hasOwn(kinds,r.entry_type)&&r.entry_type!=='bet').sort((a,b)=>-chronological(a,b))
  const sum=kind=>activity.filter(r=>r.entry_type===kind).reduce((total,r)=>total+Number(r.stake),0)
  const deposits=sum('deposit'), withdrawals=sum('withdrawal')
  const unsettled=bets().reduce((total,r)=>total+(settle(r).pending?settle(r).cash:0),0)
  const net=summarize(bets()).net
  const balance=deposits-withdrawals+net-unsettled
  $('bankroll').replaceChildren(el('strong',cash(balance),color(balance)),el('p','Recorded available cash'),
    el('p',cash(deposits)+' deposits · '+cash(withdrawals)+' withdrawals'),el('p',cash(unsettled)+' cash in open bets'),
    el('p',cash(sum('promo_credit'))+' bonus credits received'))
  $('transactions').replaceChildren(...(activity.length?activity.map(r=>{
    const item=el('div',null,'transaction')
    const text=el('div',kinds[r.entry_type]+' · '+cash(Number(r.stake)))
    text.append(el('span',[r.date,r.book,r.promotion_name,r.notes].filter(Boolean).join(' · '),'sub'))
    item.append(text,actionButtons(r))
    return item
  }):[el('p','No transactions recorded.')]))
}
function renderChart(records) {
  const area=$('chart')
  const totals=new Map()
  for(const r of [...records].sort(chronological)) {
    const s=settle(r)
    if(!s.pending) totals.set(r.date,(totals.get(r.date)||0)+s.net)
  }
  if(!totals.size) {area.replaceChildren(el('p','No settled wagers in this view.'));return}
  let running=0
  const values=[0,...[...totals.values()].map(n=>running+=n)]
  const lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1
  const x=i=>65+i*710/(values.length-1),y=v=>185-(v-lo)*149/span
  function svg(tag,attrs,value) {
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag)
    for(const [k,v] of Object.entries(attrs)) node.setAttribute(k,v)
    if(value!=null) node.textContent=value
    return node
  }
  const graph=svg('svg',{viewBox:'0 0 800 220',role:'img','aria-label':'Cumulative net cash profit and loss, ending at '+cash(running)})
  graph.append(svg('line',{x1:65,y1:y(0),x2:775,y2:y(0),stroke:'#52647a','stroke-dasharray':'5 5'}),
    svg('text',{x:4,y:y(0)+4,fill:'#a2b1c5','font-size':14},'$0'),
    svg('polyline',{points:values.map((v,i)=>x(i)+','+y(v)).join(' '),stroke:running<0?'#ff9aa2':'#7edccc','stroke-width':3,fill:'none'}),
    svg('circle',{cx:x(values.length-1),cy:y(running),r:5,fill:running<0?'#ff9aa2':'#7edccc'}))
  const dates=[...totals.keys()]
  area.replaceChildren(graph,el('p',dates[0]+' through '+dates.at(-1)+' · '+cash(running),color(running)))
}
function render() {
  renderFilters()
  const records=filter(bets(),filters)
  renderMetrics(summarize(records))
  renderHistory(records)
  renderCalendar()
  renderChart(records)
  renderBankroll()
}
const editor=$('editor-form')
function field(key,label,value,{type='text',list,blank,required=false,wide=false,step,placeholder}={}) {
  const wrap=el('label',label,wide?'wide':'')
  const input=el(list?'select':type==='textarea'?'textarea':'input')
  input.name=key
  if(list) options(input,list,value,blank)
  else {
    if(type==='textarea') input.rows=2
    else input.type=type
    input.value=value??''
    if(step) input.step=step
    if(type==='number') input.inputMode=step==='1'?'numeric':'decimal'
    if(placeholder) input.placeholder=placeholder
  }
  input.required=required
  wrap.append(input)
  $('fields').append(wrap)
  return wrap
}
function toggle(key,show,required=false) {
  const input=editor.elements.namedItem(key)
  if(!input) return
  input.closest('label').hidden=!show
  input.disabled=!show
  input.required=show&&required
}
function editorUpdates() {
  const v=read(editor)
  if(v.entry_type) return
  const bonus=v.wager_type===wagers[3], boost=v.wager_type===wagers[1], oddsBoost=v.wager_type===wagers[2]
  toggle('stake',!bonus,true)
  toggle('bonus_amount',bonus,true)
  toggle('boost_pct',boost,true)
  toggle('boost_cap',boost)
  toggle('boosted_odds',oddsBoost,true)
  editor.elements.odds.required=!oddsBoost
  toggle('promotion_name',v.wager_type!==wagers[0])
  toggle('promotion_notes',v.wager_type!==wagers[0])
  toggle('legs',v.type!==types[0])
  toggle('parlay_description',v.type!==types[0])
  toggle('actual_return',v.status!=='Pending',v.status==='Cash Out')
  const result=settle(read(editor))
  $('estimate').textContent=result.amount && result.potential && Number.isFinite(result.potential)
    ? 'If won · '+cash(result.profit)+' profit · '+cash(result.potential)+' cash return' : ''
}
function openEditor(original=null,copy=false,transaction=false) {
  editing=copy?null:original
  transaction=transaction||(original&&original.entry_type!=='bet')
  const r={...original}
  if(copy) {r.status='Pending';r.actual_return=''}
  $('editor-title').textContent=transaction?(original?'Edit activity':'Add activity'):(copy?'Duplicate Bet':original?'Edit Bet':'Add Bet')
  $('fields').replaceChildren()
  $('estimate').textContent=''
  errorFor(editor)
  if(transaction) {
    const select=field('entry_type','Activity type',kinds[r.entry_type]||kinds.deposit,{list:Object.values(kinds).slice(1)})
    for(const option of select.lastChild.options) option.value=Object.keys(kinds).find(k=>kinds[k]===option.text)
  }
  field('date',transaction?'Transaction date':'Game date',r.date||day(),{type:'date',required:true})
  if(!transaction) {
    field('time','Game time',r.time,{type:'time'})
    field('date_placed','Date placed',r.date_placed,{type:'date'})
    field('source','Source',r.source??(settings.sources.includes('Self')?'Self':''),{list:settings.sources,blank:'Select source'})
    const league=r.sport||'NFL'
    field('sport','Sport / League',league,{list:Object.keys(settings.markets),required:true})
    field('market','Market',r.market,{list:sorted(settings.markets[league]||[]),blank:'Select market'})
    field('side','Side',r.side,{list:['Over','Under','Yes','No','Home','Away','Draw'],blank:'Select side'})
    for(const [k,label] of [['line','Line'],['away','Away team'],['home','Home team'],['name','Player name'],['matchup','Matchup'],['selection','Selection'],['period','Game / Event period'],['tour','League / Tour']]) field(k,label,r[k])
  }
  field('book','Bookmaker',r.book??settings.defaultBook,{list:settings.books,blank:'Select bookmaker'})
  if(!transaction) {
    field('type','Bet type',r.type||types[0],{list:types})
    field('legs','Leg count',r.legs,{type:'number',step:'1'})
    field('parlay_description','Parlay description',r.parlay_description,{type:'textarea',wide:true,placeholder:'For multiple dates, use the final scheduled leg’s game date.'})
    field('wager_type','Wager type',r.wager_type||wagers[0],{list:wagers})
    field('odds','American odds',r.odds,{type:'number',step:'1',placeholder:'e.g. −110 or +150'})
    field('boosted_odds','Final boosted odds',r.boosted_odds,{type:'number',step:'1'})
    field('bonus_amount','Bonus stake ($)',r.bonus_amount||(r.wager_type===wagers[3]?r.stake:''),{type:'number',step:'.01'})
    field('boost_pct','Profit boost (%)',r.boost_pct,{type:'number',step:'any'})
    field('boost_cap','Maximum additional profit ($)',r.boost_cap,{type:'number',step:'.01'})
    field('status','Outcome',r.status||'Pending',{list:outcomes})
    field('actual_return','Actual cash return ($)',r.actual_return,{type:'number',step:'.01',placeholder:'Total paid, including any returned cash stake'})
  }
  field('stake',transaction?'Amount ($)':'Cash stake ($)',r.stake,{type:'number',step:'.01',required:true})
  if(!transaction||r.entry_type==='promo_credit'||!original) field('promotion_name','Promotion name',r.promotion_name)
  if(!transaction) field('promotion_notes','Promotion notes',r.promotion_notes,{type:'textarea',wide:true})
  field('notes','Notes',r.notes,{type:'textarea',wide:true})
  editorUpdates()
  $('editor').showModal()
}
editor.addEventListener('input',e=>{
  if(e.target.name==='sport') options(editor.elements.market,sorted(settings.markets[e.target.value]||[]),'','Select market')
  editorUpdates()
})
$('new-bet').onclick=()=>openEditor()
$('new-transaction').onclick=()=>openEditor(null,false,true)
submit('editor-form',async form=>{
  const started=epoch
  const result=validate(read(form))
  await cloud.save(result,editing)
  if(started!==epoch) return
  $('editor').close()
  notice('Record saved.')
  await refresh(true)
})
function openDelete(row) {
  deleting=row
  $('delete-name').textContent=recordLabel(row)+' · '+row.date
  errorFor($('delete-form'))
  $('delete-dialog').showModal()
}
submit('delete-form',async()=>{
  const started=epoch
  await cloud.remove(deleting)
  if(started!==epoch) return
  $('delete-dialog').close()
  notice('Record deleted.')
  await refresh(true)
})

const preferences=$('preferences-form')
let previousLeague,previousPrefs
const listFrom=value=>uniq(value.split(/\r?\n/).map(s=>s.trim()))
function showLists() {
  const e=preferences.elements
  e.sources.value=draft.sources.join('\n')
  e.books.value=draft.books.join('\n')
  options(e.defaultBook,draft.books,draft.books.includes(draft.defaultBook)?draft.defaultBook:'','No default')
  previousLeague=e.league.value||'NFL'
  options(e.league,Object.keys(draft.markets),previousLeague)
  e.markets.value=(draft.markets[previousLeague]||[]).join('\n')
}
$('settings').onclick=()=>{
  draft=structuredClone(settings)
  previousPrefs=prefs?.updated_at
  showLists()
  errorFor(preferences)
  $('preferences').showModal()
}
preferences.elements.league.onchange=()=>{
  const e=preferences.elements
  draft.markets[previousLeague]=listFrom(e.markets.value)
  previousLeague=e.league.value
  e.markets.value=draft.markets[previousLeague].join('\n')
}
preferences.elements.books.oninput=()=>{
  const e=preferences.elements
  const list=listFrom(e.books.value)
  options(e.defaultBook,list,list.includes(e.defaultBook.value)?e.defaultBook.value:'','No default')
}
$('defaults').onclick=()=>{draft=defaultSettings();showLists()}
submit('preferences-form',async form=>{
  const started=epoch
  const v=read(form)
  draft.sources=listFrom(v.sources)
  draft.books=listFrom(v.books)
  draft.defaultBook=v.defaultBook
  draft.markets[v.league]=listFrom(v.markets)
  await cloud.savePreferences(draft,previousPrefs)
  if(started!==epoch) return
  $('preferences').close()
  notice('Settings saved.')
  await refresh(true)
})

const csvForm=$('csv-form')
$('import').onclick=()=>{
  csvForm.reset()
  staged=[]
  csvForm.querySelector('[type=submit]').disabled=true
  $('import-summary').textContent=''
  $('import-errors').replaceChildren()
  errorFor(csvForm)
  $('csv').showModal()
}
const fingerprint=row=>JSON.stringify(columns.slice(1).map(k=>String(row[k]??'')))
let fileGeneration=0
csvForm.elements.file.onchange=async()=>{
  const generation=++fileGeneration
  const file=csvForm.elements.file.files[0]
  const save=csvForm.querySelector('[type=submit]')
  staged=[]
  save.disabled=true
  errorFor(csvForm)
  $('import-summary').textContent=''
  $('import-errors').replaceChildren()
  if(!file) return
  try {
    const text=await file.text()
    if(generation!==fileGeneration||!$('csv').open) return
    const {records,errors}=importCsv(text)
    const seen=new Set(rows.map(r=>{
      try {return fingerprint(validate(r))} catch {return fingerprint(r)}
    }))
    for(const record of records) {
      const key=fingerprint(record)
      if(!seen.has(key)) {seen.add(key);staged.push(record)}
    }
    $('import-summary').textContent=staged.length+' ready · '+(records.length-staged.length)+' duplicates skipped · '+errors.length+' invalid'
    $('import-errors').replaceChildren(...errors.map(error=>el('div',error)))
    save.disabled=staged.length===0
  } catch(e) {errorFor(csvForm,e.message)}
}
submit('csv-form',async()=>{
  if(!staged.length) return
  const started=epoch
  const count=staged.length
  await cloud.import(staged)
  if(started!==epoch) return
  staged=[]
  $('csv').close()
  notice(count+' records imported.')
  await refresh(true)
})
$('export').onclick=()=>{
  const csv=exportCsv([...rows].sort(chronological))
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const file=el('a')
  file.href=url
  file.download='bet-ledger-'+day()+'.csv'
  document.body.append(file)
  file.click()
  file.remove()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

signedIn()
updateControls()
void refresh()
