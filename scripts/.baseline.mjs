import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=') && !l.trim().startsWith('#'))
  .map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const g = async (p) => (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${p}`,
  { headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`} })).json()
console.log('═══ BASELINE לפני בקשת ה-QA ═══')
console.log('  customers          :', (await g('customers?select=id')).length)
console.log('  appointments       :', (await g('appointments?select=id')).length)
console.log('  appointment_history:', (await g('appointment_history?select=id')).length)
console.log('  booking_rate_events:', (await g('booking_rate_events?select=id')).length)
const bs = await g('business_settings?select=key,value&key=in.(cancel_cutoff_hours,reschedule_cutoff_hours,pending_expiration_hours)&order=key')
console.log('  business_settings  :', bs.map(r=>`${r.key}=${r.value}`).join(' · '))
