import crypto from 'node:crypto'
import net from 'node:net'
import { EventEmitter } from 'node:events'

class CDPSocket extends EventEmitter {
  constructor(url) {
    super()
    this.url = new URL(url)
    this.buffer = Buffer.alloc(0)
    this.handshakeComplete = false
  }

  open() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64')
      this.client = net.createConnection(Number(this.url.port), this.url.hostname, () => {
        this.client.write(
          `GET ${this.url.pathname} HTTP/1.1\r\n` +
          `Host: ${this.url.host}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
        )
      })
      this.client.once('error', reject)
      this.client.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk])
        if (!this.handshakeComplete) {
          const boundary = this.buffer.indexOf('\r\n\r\n')
          if (boundary < 0) return
          const response = this.buffer.subarray(0, boundary).toString()
          if (!response.startsWith('HTTP/1.1 101')) {
            reject(new Error(`WebSocket upgrade failed: ${response.split('\r\n')[0]}`))
            return
          }
          this.handshakeComplete = true
          this.buffer = this.buffer.subarray(boundary + 4)
          resolve()
        }
        this.parseFrames()
      })
    })
  }

  parseFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0]
      const second = this.buffer[1]
      const opcode = first & 0x0f
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) return
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) return
        length = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }
      if (this.buffer.length < offset + length) return
      const payload = this.buffer.subarray(offset, offset + length)
      this.buffer = this.buffer.subarray(offset + length)
      if (opcode === 1) this.emit('message', payload.toString())
      else if (opcode === 8) this.emit('close')
      else if (opcode === 9) this.sendFrame(payload, 10)
    }
  }

  sendFrame(payloadValue, opcode = 1) {
    const payload = Buffer.isBuffer(payloadValue) ? payloadValue : Buffer.from(payloadValue)
    const mask = crypto.randomBytes(4)
    let header
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length])
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    const masked = Buffer.alloc(payload.length)
    for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4]
    this.client.write(Buffer.concat([header, mask, masked]))
  }

  send(value) {
    this.sendFrame(value)
  }

  close() {
    if (!this.client.destroyed) {
      this.sendFrame(Buffer.alloc(0), 8)
      this.client.end()
    }
  }
}

const debuggerPort = process.env.EDUNOVA_DEBUG_PORT || '9227'
const targets = await fetch(`http://127.0.0.1:${debuggerPort}/json`).then((response) => response.json())
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:4177'))

if (!target) throw new Error('EduNova browser target was not found')

const socket = new CDPSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const browserErrors = []
let requestId = 0

await socket.open()

socket.on('message', (data) => {
  const message = JSON.parse(data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    browserErrors.push(message.params.exceptionDetails?.text || 'Unhandled browser exception')
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    browserErrors.push(message.params.args.map((item) => item.value || item.description || '').join(' '))
  }
})

function command(method, params = {}) {
  requestId += 1
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    socket.send(JSON.stringify({ id: requestId, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
}

async function waitFor(expression, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return
    } catch {
      // The execution context can briefly disappear during reload.
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

async function loadRole(role) {
  const labels = { superadmin: 'Super Admin', admin: 'Administrator', teacher: 'Teacher', guardian: 'Guardian', student: 'Student' }
  await evaluate(`localStorage.setItem('edunova-session', ${JSON.stringify(role)})`)
  await command('Page.reload', { ignoreCache: true })
  await waitFor(`document.querySelector('.app-shell') && document.querySelector('.profile-static')?.textContent.includes(${JSON.stringify(labels[role])})`)
}

async function scanRoutes(role) {
  return evaluate(`(async () => {
    const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
    const failures = []
    const visited = []
    const routeButtons = [...document.querySelectorAll('[data-route]')]
    for (const button of routeButtons) {
      const route = button.dataset.route
      button.click()
      await sleep(18)
      const workspace = route === 'dashboard'
        ? document.querySelector('.dashboard-grid, .mighty-role-portal')
        : document.querySelector('.mighty-admin-workflow, .mighty-role-portal')
      const heading = document.querySelector('.role-dashboard-head h1, .mighty-content > .page-head h1, .mighty-admin-workflow .page-head h1, .mighty-role-portal > .page-head h1')
      const text = workspace?.textContent?.trim() || ''
      if (!workspace || text.length < 20 || !heading?.textContent?.trim()) failures.push(route)
      visited.push({ route, heading: heading?.textContent?.trim() || '' })
    }
    return { role: ${JSON.stringify(role)}, routeCount: routeButtons.length, failures, visited }
  })()`)
}

async function testAdminActions() {
  return evaluate(`(async () => {
    const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
    const setValue = (element, value) => {
      element.value = value
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    }
    const results = {}

    document.querySelector('[data-route="branch"]').click()
    await sleep(30)
    const beforeRows = document.querySelectorAll('.mighty-data-panel tbody tr').length
    document.querySelector('.mighty-admin-workflow .page-actions .primary').click()
    await sleep(20)
    document.querySelectorAll('.mighty-dynamic-form input').forEach((input, index) => setValue(input, index === 0 ? 'North Campus' : index === 1 ? 'NC' : index === 2 ? '9876543210' : 'north@edunova.school'))
    document.querySelectorAll('.mighty-dynamic-form textarea').forEach((input) => setValue(input, 'North Campus address'))
    document.querySelector('.mighty-dynamic-form').requestSubmit()
    await sleep(30)
    results.branchCreated = document.querySelectorAll('.mighty-data-panel tbody tr').length > beforeRows

    document.querySelector('[data-route="student-attendance"]').click()
    await sleep(30)
    const attendanceButton = [...document.querySelectorAll('.mighty-roster-row:first-of-type button')].find((button) => button.textContent.trim() === 'Absent') || [...document.querySelectorAll('.mighty-roster-row button')].find((button) => button.textContent.trim() === 'Absent')
    attendanceButton.click()
    document.querySelector('.mighty-sticky-actions .primary').click()
    await sleep(25)
    results.attendanceSaved = [...Array(localStorage.length)].map((_, index) => localStorage.key(index)).some((key) => key.startsWith('edunova:mighty:student-attendance:'))

    document.querySelector('[data-route="student-migration"]').click()
    await sleep(30)
    document.querySelector('.migration-layout input[type="checkbox"]').click()
    document.querySelector('.migration-target .primary').click()
    await sleep(25)
    results.migrationSaved = Boolean(localStorage.getItem('edunova:mighty:workflow:student-migration'))

    document.querySelector('[data-route="smart-collection"]').click()
    await sleep(30)
    document.querySelector('.student-search-card > button').click()
    document.querySelector('.fee-head-card > .primary').click()
    await sleep(25)
    results.feeCollected = Boolean(localStorage.getItem('edunova:mighty:workflow:smart-collection'))

    document.querySelector('[data-route="payment"]').click()
    await sleep(30)
    setValue(document.querySelector('.voucher-top input[placeholder]'), 'PAY-TEST-001')
    const voucherInputs = [...document.querySelectorAll('.voucher-line input')]
    setValue(voucherInputs[0], '1000')
    setValue(voucherInputs[3], '1000')
    document.querySelector('.voucher-card > .primary').click()
    await sleep(25)
    results.voucherPosted = Boolean(localStorage.getItem('edunova:mighty:workflow:payment'))

    document.querySelector('[data-route="class-routine"]').click()
    await sleep(30)
    document.querySelector('.routine-add-card').requestSubmit()
    await sleep(25)
    results.routineSaved = Boolean(localStorage.getItem('edunova:mighty:routine:class-routine'))

    document.querySelector('[data-route="books-issue"]').click()
    await sleep(30)
    const memberSelect = document.querySelector('.library-issue-card select')
    setValue(memberSelect, memberSelect.options[1].value)
    document.querySelector('.library-catalog-card > button').click()
    await sleep(20)
    document.querySelector('.library-issue-card').requestSubmit()
    await sleep(25)
    results.bookIssued = JSON.parse(localStorage.getItem('edunova:mighty:workflow:books-issue') || '[]').some((item) => item.status === 'Issued')

    document.querySelector('[data-route="books-return"]').click()
    await sleep(30)
    document.querySelector('.library-return-row .primary').click()
    await sleep(25)
    results.bookReturned = JSON.parse(localStorage.getItem('edunova:mighty:workflow:books-issue') || '[]').some((item) => item.status === 'Returned')

    document.querySelector('[data-route="mark-input"]').click()
    await sleep(30)
    document.querySelector('.marks-entry-card .mighty-sticky-actions .primary').click()
    await sleep(25)
    results.marksSaved = [...Array(localStorage.length)].map((_, index) => localStorage.key(index)).some((key) => key.startsWith('edunova:mighty:marks:'))

    document.querySelector('[data-route="bonafide-certificate"]').click()
    await sleep(30)
    const studentSelect = document.querySelector('.certificate-layout form select')
    setValue(studentSelect, studentSelect.options[1].value)
    document.querySelector('.certificate-layout form').requestSubmit()
    await sleep(25)
    results.certificateGenerated = document.querySelector('.certificate-layout > article').classList.contains('ready')

    document.querySelector('[data-route="add-new-question"]').click()
    await sleep(30)
    setValue(document.querySelector('.question-builder textarea'), 'What is the value of 2 + 2?')
    document.querySelectorAll('.question-builder .option-grid input').forEach((input, index) => setValue(input, ['2', '3', '4', '5'][index]))
    document.querySelector('.question-builder form').requestSubmit()
    await sleep(25)
    results.questionSaved = Boolean(localStorage.getItem('edunova:mighty:workflow:add-new-question'))

    document.querySelector('[data-route="system-settings"]').click()
    await sleep(30)
    document.querySelectorAll('.settings-workflow-card input, .settings-workflow-card textarea').forEach((input) => setValue(input, input.type === 'email' ? 'school@edunova.school' : 'EduNova Academy'))
    document.querySelector('.settings-workflow-card').requestSubmit()
    await sleep(25)
    results.settingsSaved = Boolean(localStorage.getItem('edunova:mighty:workflow:system-settings:configuration'))

    return results
  })()`)
}

async function testParentActions() {
  return evaluate(`(async () => {
    const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
    const results = {}
    const childSelect = document.querySelector('.child-switcher select')
    childSelect.value = '2'
    childSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(25)
    results.childSwitched = localStorage.getItem('edunova:mighty:default-child') === '2'

    document.querySelector('[data-route="parent-fee-payment"]').click()
    await sleep(30)
    document.querySelector('.fee-due-list > button').click()
    await sleep(20)
    document.querySelector('.payment-review .primary').click()
    await sleep(20)
    document.querySelector('.payment-confirm-modal .primary').click()
    await sleep(30)
    results.feePaid = JSON.parse(localStorage.getItem('edunova:mighty:fees:2')).some((item) => item.status === 'Paid' && item.invoice.startsWith('RCP-'))

    document.querySelector('[data-route="parent-exams"]').click()
    await sleep(30)
    document.querySelector('.exam-list > button').click()
    await sleep(25)
    results.examResultOpened = Boolean(document.querySelector('.result-hero') && document.querySelector('.result-table'))
    return results
  })()`)
}

async function testStudentActions() {
  return evaluate(`(async () => {
    const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
    document.querySelector('[data-route="student-assignment"]').click()
    await sleep(30)
    const submitButton = [...document.querySelectorAll('.assignment-actions button')].find((button) => button.textContent.includes('Submit assignment'))
    submitButton.click()
    await sleep(25)
    return {
      submissionFlowOpened: Boolean(document.querySelector('.task-modal') && document.querySelector('.file-drop input[type="file"]')),
      passwordUpdateAvailable: (document.querySelector('[data-route="student-profile"]').click(), await sleep(25), Boolean(document.querySelector('.password-card'))),
    }
  })()`)
}

await command('Runtime.enable')
await command('Page.enable')
await evaluate(`Object.keys(localStorage).filter((key) => key.startsWith('edunova:mighty:')).forEach((key) => localStorage.removeItem(key))`)

const routeScans = []
const expectedCounts = { superadmin: 151, admin: 151, teacher: 45, guardian: 11, student: 9 }
for (const role of ['superadmin', 'admin', 'teacher', 'guardian', 'student']) {
  await loadRole(role)
  const scan = await scanRoutes(role)
  scan.expectedCount = expectedCounts[role]
  routeScans.push(scan)
}

await loadRole('admin')
const adminActions = await testAdminActions()
await loadRole('guardian')
const parentActions = await testParentActions()
await loadRole('student')
const studentActions = await testStudentActions()

const report = {
  routeScans: routeScans.map(({ role, routeCount, expectedCount, failures }) => ({ role, routeCount, expectedCount, failures })),
  adminActions,
  parentActions,
  studentActions,
  browserErrors,
}

console.log(JSON.stringify(report, null, 2))

const failedChecks = [
  ...routeScans.flatMap((scan) => [
    ...(scan.routeCount !== scan.expectedCount ? [`${scan.role}: expected ${scan.expectedCount} routes, got ${scan.routeCount}`] : []),
    ...scan.failures.map((route) => `${scan.role}: blank route ${route}`),
  ]),
  ...Object.entries(adminActions).filter(([, passed]) => !passed).map(([name]) => `admin action failed: ${name}`),
  ...Object.entries(parentActions).filter(([, passed]) => !passed).map(([name]) => `parent action failed: ${name}`),
  ...Object.entries(studentActions).filter(([, passed]) => !passed).map(([name]) => `student action failed: ${name}`),
  ...browserErrors.map((error) => `browser error: ${error}`),
]

socket.close()
if (failedChecks.length) {
  console.error(`\nVerification failures:\n- ${failedChecks.join('\n- ')}`)
  process.exitCode = 1
}
