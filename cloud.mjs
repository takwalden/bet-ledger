export const endpoint = 'https://dhgkixdfcqbrprybgrwf.supabase.co'
export const publishableKey = 'sb_publishable_37PtxlcNrcQQt72zmb8uxw_pI4hHeEc'

export function createCloud({request=fetch, storage=localStorage, now=Date.now}={}) {
  const key='bet-ledger.session.v2'
  let session=null, refreshing=null, generation=0
  try {session=JSON.parse(storage.getItem(key))} catch {}
  function save(value) {
    session=value ? {...value,expires_at:value.expires_at || Math.floor(now()/1000)+(value.expires_in||3600)} : null
    if(session) storage.setItem(key,JSON.stringify(session))
    else storage.removeItem(key)
  }
  async function call(path,{method='GET',body,token,prefer}={}) {
    const headers={apikey:publishableKey,Accept:'application/json'}
    if(token) headers.Authorization='Bearer '+token
    if(body!==undefined) headers['Content-Type']='application/json'
    if(prefer) headers.Prefer=prefer
    const res=await request(endpoint+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'})
    const content=await res.text()
    let data
    try {data=JSON.parse(content)} catch {data=null}
    if(!res.ok) throw Object.assign(Error(data?.msg || data?.message || data?.error_description || 'Supabase request failed ('+res.status+').'),{status:res.status})
    return data
  }
  async function access() {
    if(!session) throw Error('Sign in to access your ledger.')
    if(session.expires_at*1000-now()>60000) return session.access_token
    if(!refreshing) {
      const started=generation
      refreshing=call('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}})
        .then(value=>{
          if(started!==generation) throw Error('Session changed.')
          save(value)
          return session.access_token
        }).catch(error=>{
          if(started===generation && [400,401,403].includes(error.status)) save(null)
          throw error
        }).finally(()=>{refreshing=null})
    }
    return refreshing
  }
  async function rest(path,options={}) {
    const token=await access()
    return call('/rest/v1/'+path,{...options,token})
  }
  const owned=()=> 'user_id=eq.'+encodeURIComponent(session?.user?.id || '')
  async function update(table,query,body,method) {
    const result=await rest(table+'?'+query,{method,body,prefer:'return=representation'})
    if(!result?.length) throw Error('This record changed on another device. Refresh and reopen it before trying again.')
    return result[0]
  }
  const timestamp=(previous)=>new Date(Math.max(now(),(Date.parse(previous)||0)+1)).toISOString()
  const match=stamp=>stamp?'&updated_at=eq.'+encodeURIComponent(stamp):''
  return {
    get user(){return session?.user ?? null},
    async signIn(email,password) {
      const started=++generation
      const value=await call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}})
      if(started===generation) save(value)
    },
    async signOut() {
      const token=session?.access_token
      ++generation
      save(null)
      if(token) await call('/auth/v1/logout?scope=local',{method:'POST',token})
    },
    async entries() {
      const own=owned()
      const rows=[]
      let cursor=''
      while(true) {
        const page=await rest('ledger_entries?'+own+'&select=id,entry_date,entry_type,details,updated_at&order=id.asc&limit=500'+cursor)
        if(!Array.isArray(page)) throw Error('Could not read ledger entries.')
        rows.push(...page)
        if(page.length<500) return rows
        cursor='&id=gt.'+encodeURIComponent(page.at(-1).id)
      }
    },
    async preferences() {
      return (await rest('user_preferences?'+owned()+'&select=settings,updated_at'))[0] || null
    },
    savePreferences(settings,previous) {
      const body={settings,updated_at:timestamp(previous)}
      return previous?update('user_preferences',owned()+match(previous),body,'PATCH'):
        rest('user_preferences',{method:'POST',body,prefer:'return=representation'})
    },
    save(d,original) {
      const {date,entry_type,...details}=d
      const body={entry_date:date,entry_type,details,updated_at:timestamp(original?.updated_at)}
      return original?update('ledger_entries',owned()+'&id=eq.'+encodeURIComponent(original.id)+match(original.updated_at),body,'PATCH'):
        rest('ledger_entries',{method:'POST',body,prefer:'return=representation'})
    },
    remove(row) {
      return update('ledger_entries',owned()+'&id=eq.'+encodeURIComponent(row.id)+match(row.updated_at),undefined,'DELETE')
    },
    import(rows) {
      return rest('ledger_entries',{method:'POST',body:rows.map(({date,entry_type,...details})=>({entry_date:date,entry_type,details}))})
    }
  }
}
