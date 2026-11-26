export const outcomes = ['Pending', 'Won', 'Lost', 'Void', 'Push', 'Cash Out']
export const types = ['Straight Bet', 'Parlay', 'Same Game Parlay']
export const wagers = ['Standard Bet', 'Profit Boost', 'Odds Boost', 'Bonus Bet / Free Bet', 'No Sweat Bet', 'Bet & Get', 'Protected Bet', 'Other Promo']
export const kinds = {bet:'Bet', deposit:'Deposit', withdrawal:'Withdrawal', promo_credit:'Bonus credit received'}
export const columns = ('index,date,time,source,sport,away,home,name,matchup,market,side,line,book,type,legs,odds,stake,status,notes,' +
  'date_placed,wager_type,boost_pct,boost_cap,bonus_amount,actual_return,promotion_name,promotion_notes,parlay_description,period,tour,boosted_odds,selection,entry_type').split(',')
const cents = x => Math.round((x + Number.EPSILON) * 100) / 100
const present = x => x !== '' && x != null
export const day = (d = new Date()) => [d.getFullYear(), d.getMonth()+1, d.getDate()].map(x=>String(x).padStart(2,'0')).join('-')
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const d = new Date(value+'T00:00Z')
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === value
}
export function validate(input) {
  const d = Object.fromEntries(columns.filter(k=>k!=='index').map(k=>[k,String(input[k]??'').trim()]))
  if (!validDate(d.date)) throw Error('Enter a valid game or transaction date (YYYY-MM-DD).')
  d.entry_type ||= 'bet'
  if (!Object.hasOwn(kinds,d.entry_type)) throw Error('Unknown entry type.')
  function number(key, label, rule, required = false) {
    if (!present(d[key]) && !required) return
    const n = Number(d[key])
    if (!present(d[key]) || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(d[key]) || !Number.isFinite(n) || !rule(n)) throw Error('Invalid '+label+'.')
    d[key] = n
  }
  const money = x => x>=0 && Number.isSafeInteger(Math.round(x*100)) && Math.abs(x-cents(x))<1e-9
  if (d.entry_type !== 'bet') {
    number('stake','transaction amount',x=>x>0&&money(x),true)
    return d
  }
  if (d.date_placed && !validDate(d.date_placed)) throw Error('Invalid date placed.')
  if (d.time && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(d.time)) throw Error('Game time must use HH:MM.')
  d.status = outcomes.find(x=>x.toLowerCase()===d.status.toLowerCase()) || d.status || 'Pending'
  d.type = ({straight:'Straight Bet',sgp:'Same Game Parlay',single:'Straight Bet'})[d.type.toLowerCase()] || types.find(x=>x.toLowerCase()===d.type.toLowerCase()) || d.type || types[0]
  d.wager_type ||= wagers[0]
  if (!outcomes.includes(d.status) || !types.includes(d.type) || !wagers.includes(d.wager_type)) throw Error('Unknown outcome, bet type or wager type.')
  const odds = n => Number.isSafeInteger(n) && Math.abs(n)>=100
  number('odds','American odds (use +100 or higher, or −100 or lower)',odds,d.wager_type!=='Odds Boost')
  number('boosted_odds','final boosted American odds',odds,d.wager_type==='Odds Boost')
  if (d.wager_type===wagers[3] && !present(d.bonus_amount)) d.bonus_amount=d.stake
  number('bonus_amount','bonus stake',x=>money(x)&&x>0,d.wager_type===wagers[3])
  if (d.wager_type===wagers[3]) d.stake=0
  else number('stake','cash stake',x=>money(x)&&x>0,true)
  number('boost_pct','profit boost percentage',x=>x>=0,d.wager_type==='Profit Boost')
  number('boost_cap','maximum additional profit',money)
  number('actual_return','actual cash return',money,d.status==='Cash Out')
  number('legs','leg count',x=>Number.isSafeInteger(x)&&x>=2 && x<=100)
  return d
}
export function settle(d) {
  const bonus = d.wager_type===wagers[3]
  const cash = bonus ? 0 : Number(d.stake)||0
  const amount = bonus ? Number(d.bonus_amount || d.stake)||0 : cash
  const odds = Number((d.wager_type==='Odds Boost' && d.boosted_odds) || d.odds)
  const base = amount * (odds>0 ? odds/100 : odds<0 ? 100/Math.abs(odds) : 0)
  const extra = d.wager_type==='Profit Boost' ? Math.min(base*(Number(d.boost_pct)||0)/100,present(d.boost_cap)?Number(d.boost_cap):Infinity) : 0
  const potential = cents(cash+base+extra)
  const status = d.status || 'Pending'
  const actual = status!=='Pending' && present(d.actual_return)
  const returned = actual ? Number(d.actual_return) : ({Won:potential, Void:cash, Push:cash})[status] ?? 0
  return {cash, amount, potential, profit:cents(potential-cash), returned, net:status==='Pending'?0:cents(returned-cash),
    pending:status==='Pending', risk:['Won','Lost','Cash Out'].includes(status)?cash:0}
}
export function summarize(rows) {
  const s={total:0,amount:0,cash:0,net:0,won:0,lost:0,pending:0,void:0,push:0,cashOut:0,risk:0,cashNet:0,bonusNet:0,potential:0}
  for (const d of rows) {
    const r=settle(d)
    const key=({'Cash Out':'cashOut'})[d.status] ?? d.status?.toLowerCase() ?? 'pending'
    if (['won','lost','pending','void','push','cashOut'].includes(key)) s[key]++
    s.total++
    for(const k of ['amount','cash','net','risk']) s[k]+=r[k]
    if (r.cash) s.cashNet+=r.net
    else s.bonusNet+=r.net
    if (r.pending) s.potential+=r.potential
  }
  for(const k of ['amount','cash','net','risk','cashNet','bonusNet','potential']) s[k]=cents(s[k])
  return {...s, roi:s.risk?s.cashNet/s.risk*100:null, winRate:s.won+s.lost?s.won/(s.won+s.lost)*100:null}
}
export function filter(rows, f, omitDates=false) {
  const query=(f.search||'').toLowerCase().trim()
  return rows.filter(r=>(!query || Object.values(r).join(' ').toLowerCase().includes(query)) &&
    ['source','sport','status','market','side','book','wager_type'].every(k=>!f[k]||r[k]===f[k]) &&
    (omitDates || ((!f.date||r.date===f.date)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to))))
}
function parseCsv(text) {
  const rows=[]
  let row=[], field='', quoted=false, closed=false
  text=text.replace(/^\uFEFF/,'')
  for(let i=0;i<text.length;i++) {
    const c=text[i]
    if (quoted) {
      if(c==='"'&&text[i+1]==='"') {field+='"'; i++}
      else if(c==='"') {quoted=false; closed=true}
      else field+=c
    } else if(c===','||c==='\n'||c==='\r') {
      row.push(field); field=''; closed=false
      if(c!==',') {
        rows.push(row); row=[]
        if(c==='\r'&&text[i+1]==='\n') i++
      }
    } else if(c==='"'&&!field&&!closed) quoted=true
    else if(c==='"'||closed) throw Error('Malformed CSV near record '+(rows.length+1)+'.')
    else field+=c
  }
  if(quoted) throw Error('Unclosed quoted CSV field.')
  if(row.length||field||closed) rows.push([...row,field])
  return rows
}
export function importCsv(text) {
  const [header,...rows]=parseCsv(text)
  const keys=header?.map(x=>x.trim().toLowerCase())
  if(!keys?.includes('date')||new Set(keys).size!==keys.length) throw Error('CSV requires a date column and unique headers.')
  const records=[]
  const errors=[]
  rows.forEach((cells,i)=>{
    if(!cells.some(x=>x.trim())) return
    try {
      if(cells.length!==keys.length) throw Error('Expected '+keys.length+' columns.')
      const data=Object.fromEntries(keys.map((k,j)=>[k,cells[j].replace(/^'(?=\s*['=+\-@]|[\t\r\n])/,'')]))
      records.push(validate(data))
    } catch(error) {errors.push('Record '+(i+2)+' · '+error.message)}
  })
  return {records,errors}
}
export function exportCsv(rows) {
  return [columns.join(','),...rows.map((row,i)=>columns.map(k=>{
    let value=k==='index'?String(i+1):String(row[k]??'')
    if (/^\s*['=+\-@]|^[\t\r\n]/.test(value) && !/^[+-]?\d+(?:\.\d+)?$/.test(value)) value="'"+value
    return '"'+value.replaceAll('"','""')+'"'
  }).join(','))].join('\r\n')+'\r\n'
}
