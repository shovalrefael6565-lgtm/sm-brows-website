import puppeteer from 'puppeteer'

const BASE = 'http://localhost:3001'

const PAGES = [
  { name: 'home-mob',       url: '/',          w: 390,  h: 844,  scrollTo: 0 },
  { name: 'home-desk',      url: '/',          w: 1440, h: 900,  scrollTo: 0 },
  { name: 'services-mob',   url: '/services',  w: 390,  h: 844,  scrollTo: 0 },
  { name: 'services-desk',  url: '/services',  w: 1440, h: 900,  scrollTo: 0 },
  { name: 'course-mob',     url: '/course',    w: 390,  h: 844,  scrollTo: 0 },
  { name: 'course-desk',    url: '/course',    w: 1440, h: 900,  scrollTo: 0 },
  { name: 'booking-mob',    url: '/booking',   w: 390,  h: 844,  scrollTo: 0 },
  { name: 'booking-desk',   url: '/booking',   w: 1440, h: 900,  scrollTo: 0 },
  { name: 'contact-mob',    url: '/contact',   w: 390,  h: 844,  scrollTo: 0 },
  { name: 'contact-desk',   url: '/contact',   w: 1440, h: 900,  scrollTo: 0 },
  { name: 'blog-mob',       url: '/blog',      w: 390,  h: 844,  scrollTo: 0 },
  { name: 'blog-desk',      url: '/blog',      w: 1440, h: 900,  scrollTo: 0 },
]

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })

for (const { name, url, w, h, scrollTo } of PAGES) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 })
  
  // seed consent
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('cookie-consent', JSON.stringify({ analytics: false, marketing: false }))
  })
  
  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 30000 })
  
  // scroll to trigger lazy sections
  for (let y = 0; y <= 15000; y += 500) {
    await page.evaluate(y => window.scrollTo(0, y), y)
    await new Promise(r => setTimeout(r, 60))
  }
  await page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 2000))
  
  // scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0))
  await new Promise(r => setTimeout(r, 400))
  
  // hide fixed overlays
  await page.evaluate(() => {
    document.querySelectorAll('.fixed').forEach(el => { el.style.display = 'none' })
  })
  
  await page.screenshot({ path: `/tmp/review-${name}.png`, fullPage: false })
  await page.close()
  console.log('✓', name)
}

await browser.close()
console.log('done')
