(function () {
  'use strict'

  var F = window.FILM
  var root
  var scenes = []
  var captionText
  var chapterNumber
  var chapterName
  var progressFill

  var WINDOWS = [
    [0, 11000, '01', 'The temporary lender'],
    [11000, 18000, '02', 'The reversal'],
    [18000, 34000, '03', 'Four cards. One decision.'],
    [34000, 51000, '04', 'Coordinate first'],
    [51000, 63000, '05', 'An agent with a boundary'],
    [63000, 79000, '06', 'NANDA Town × Prava'],
    [79000, 90000, '07', 'The honest edge'],
    [90000, 105000, '08', 'Proof you can carry'],
  ]

  var CAPTIONS = [
    [500, 6500, 'Ada paid ₹9,600 for everyone. Now she has a second job: debt collector.'],
    [6500, 11000, 'Eleven days. Four reminders. ₹7,200 still outstanding.'],
    [11000, 14500, 'What if nobody had to pay first?'],
    [14500, 18000, 'Sutra turns a group into one coordinated decision.'],
    [18000, 23500, 'Each person sees one exact share, one personal cap, and their own card.'],
    [23500, 28500, 'Approval is permission—not a charge.'],
    [28500, 34000, 'The last required yes locks the plan. Unknown results reconcile before retry.'],
    [34000, 39500, 'Start with a sentence, a link, an extension-imported cart, or a bill.'],
    [39500, 45500, 'Then the agent gathers availability, distance, and private budgets.'],
    [45500, 51000, 'Real venues re-rank live, with reasons the group can inspect.'],
    [51000, 57000, 'Ask Sutra who is missing and it answers from the group’s real state.'],
    [57000, 63000, 'Ask it to pay for you? Hard no. Your passkey is the boundary.'],
    [63000, 68500, 'The same protocol ships as a NANDA Town payments plugin.'],
    [68500, 74000, 'A pooled ledger credits the organiser. Prava mandates never do.'],
    [74000, 79000, 'The reproducible NANDA simulation proves scoped mandate semantics without a pooled balance.'],
    [79000, 84500, 'Shopify discovery and extension imports work now. POS stays merchant-operated.'],
    [84500, 90000, 'Development stores can receive valid test orders. Production checkout needs an adapter.'],
    [90000, 98000, 'Every outcome ends in a signed, hash-chained, rail-aware receipt.'],
    [98000, 105000, 'No pooled wallet. Every handoff named. Nothing invented.'],
  ]

  function el(tag, cls, parent, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    if (parent) parent.appendChild(node)
    return node
  }

  function html(tag, cls, parent, content) {
    var node = el(tag, cls, parent)
    node.innerHTML = content
    return node
  }

  function avatar(parent, name, tone) {
    var a = el('div', 'v2-avatar ' + (tone || ''), parent, name.slice(0, 1))
    a.setAttribute('aria-label', name)
    return a
  }

  function scene(id, mount, draw) {
    var section = el('section', 'v2-scene', root)
    section.id = id
    mount(section)
    scenes.push({ node: section, draw: draw })
  }

  function setScene(s, active, local, duration) {
    s.node.style.display = active ? 'block' : 'none'
    if (!active) return
    // Never fade the whole composition to the bare canvas. Chapter changes
    // are clean editorial cuts; motion happens inside each shot.
    s.node.style.opacity = '1'
    s.node.style.transform = 'scale(' + F.lerp(1.006, 1, F.progress(local, 0, duration)) + ')'
  }

  function mountProblem(s) {
    var glow = el('div', 'v2-orb v2-orb-orange', s)
    glow.style.left = '-180px'; glow.style.top = '350px'
    var copy = el('div', 'problem-copy', s)
    el('div', 'v2-kicker', copy, 'THE OLD GROUP PAYMENT FLOW')
    html('h1', 'problem-title', copy, 'One card pays.<br><span>Everyone else owes.</span>')
    var owed = el('div', 'owed-card', copy)
    el('small', '', owed, 'STILL ON ADA’S CARD')
    el('strong', '', owed, '₹7,200')
    el('em', '', owed, '11 days · 4 reminders')

    var phone = el('div', 'chat-phone', s)
    var head = el('div', 'chat-head', phone)
    avatar(head, 'G', 'orange')
    html('div', '', head, '<b>goa trip ✈</b><small>5 people</small>')
    var body = el('div', 'chat-body-v2', phone)
    var msgs = [
      ['me', 'Booked! ₹2,400 each 🙏'],
      ['', 'sent!'],
      ['', 'paying tonight'],
      ['', 'remind me tomorrow'],
      ['me quiet', 'hey… just checking again'],
    ]
    msgs.forEach(function (m, i) {
      var b = el('div', 'chat-bubble ' + m[0], body, m[1])
      b.dataset.i = i
    })
    var typing = html('div', 'typing', body, '<i></i><i></i><i></i>')
    typing.dataset.i = '5'
    s._els = { phone: phone, owed: owed, bubbles: body.children }
  }

  function drawProblem(t, s) {
    var E = s._els
    E.phone.style.transform = 'translateY(' + F.lerp(42, -12, F.out(F.progress(t, 0, 10000))) + 'px) rotate(' + F.lerp(2.2, -1.2, F.progress(t, 0, 11000)) + 'deg)'
    for (var i = 0; i < E.bubbles.length; i++) {
      var reveal = F.out(F.progress(t, 700 + i * 1050, 1300 + i * 1050))
      E.bubbles[i].style.opacity = String(reveal)
      E.bubbles[i].style.transform = 'translateY(' + F.lerp(20, 0, reveal) + 'px)'
    }
    var pulse = 1 + Math.sin(t / 450) * 0.008
    E.owed.style.transform = 'scale(' + pulse + ')'
  }

  function mountTurn(s) {
    el('div', 'v2-orb v2-orb-orange turn-orb', s)
    var wrap = el('div', 'turn-wrap', s)
    el('div', 'turn-rule', wrap)
    html('h1', 'turn-title', wrap, 'What if nobody<br>had to <span>pay first?</span>')
    var formula = el('div', 'turn-formula', wrap)
    ;['REQUIRED PEOPLE APPROVE', 'ONE DECISION', 'SAFE COMMIT'].forEach(function (x, i) {
      if (i) el('i', '', formula, '→')
      el('b', i === 1 ? 'hot' : '', formula, x)
    })
    var rail = el('div', 'turn-approval-rail', wrap)
    var people = el('div', 'turn-principals', rail)
    ;[['A','Ada'],['A','Arsh'],['M','Maya'],['D','Dev']].forEach(function (x, i) {
      var p = el('div', 'turn-principal p' + i, people)
      el('i', '', p, x[0]); el('span', '', p, x[1]); el('b', '', p, '✓')
    })
    el('div', 'turn-rail-line', rail)
    html('div', 'turn-decision', rail, '<small>POLICY</small><b>all_of(4)</b><span>one locked commit plan</span>')
    s._els = { wrap: wrap, formula: formula, rail: rail, principals: people.children }
  }

  function drawTurn(t, s) {
    var p = F.out(F.progress(t, 0, 1200))
    s._els.wrap.style.transform = 'translateY(' + F.lerp(52, 0, p) + 'px)'
    s._els.formula.style.opacity = String(F.out(F.progress(t, 2200, 3000)))
    s._els.rail.style.opacity = String(F.out(F.progress(t, 3000, 3800)))
    for (var i = 0; i < s._els.principals.length; i++) {
      s._els.principals[i].classList.toggle('on', t >= 3600 + i * 430)
    }
  }

  function mandateCard(parent, person, tint) {
    var card = el('div', 'mandate-card', parent)
    var top = el('div', 'mandate-top', card)
    avatar(top, person, tint)
    html('div', '', top, '<b>' + person + '</b><small>OWN CARD · OWN CONSENT</small>')
    var amount = el('div', 'mandate-amount', card)
    el('small', '', amount, 'YOUR SHARE')
    el('strong', '', amount, '₹2,400')
    el('span', '', amount, 'cap ₹2,400')
    var button = el('div', 'passkey-btn', card, '⌁  Approve with passkey')
    var state = el('div', 'mandate-state', card, 'WAITING')
    var ring = el('div', 'mandate-ring', card)
    return { card: card, button: button, state: state, ring: ring }
  }

  function mountMandates(s) {
    el('div', 'v2-grid', s)
    var head = el('div', 'mandate-heading', s)
    el('div', 'v2-kicker', head, 'GMP/1 · GROUP MANDATE PROTOCOL')
    html('h1', '', head, 'Four people. <span>Four permissions.</span>')
    el('p', '', head, 'No balance. No shared wallet. No temporary lender.')
    var row = el('div', 'mandate-row', s)
    var names = [['Ada','orange'],['Arsh','blue'],['Maya','gold'],['Dev','violet']]
    var cards = names.map(function (x) { return mandateCard(row, x[0], x[1]) })
    var rail = el('div', 'commit-rail', s)
    el('div', 'commit-line', rail)
    var status = html('div', 'commit-status', rail, '<i></i><b>0 / 4 approved</b><span>NOTHING CHARGED</span>')
    s._els = { cards: cards, status: status, rail: rail, head: head }
  }

  function drawMandates(t, s) {
    var E = s._els
    var approvals = [2800, 5800, 8800, 11800]
    var count = 0
    E.cards.forEach(function (c, i) {
      var reveal = F.out(F.progress(t, 350 + i * 180, 1000 + i * 180))
      c.card.style.opacity = String(reveal)
      c.card.style.transform = 'translateY(' + F.lerp(34, 0, reveal) + 'px)'
      var approved = t >= approvals[i]
      if (approved) count++
      c.card.classList.toggle('approved', approved)
      c.button.textContent = approved ? '✓  Approved' : '⌁  Approve with passkey'
      c.state.textContent = t >= 13000 ? 'CHARGED ONCE' : approved ? 'APPROVED · ON HOLD' : 'WAITING'
      c.ring.style.setProperty('--fill', String(approved ? 1 : F.progress(t, approvals[i] - 900, approvals[i])))
    })
    var committed = t >= 13000
    E.status.classList.toggle('committed', committed)
    E.status.innerHTML = committed
      ? '<i></i><b>COMMITTED</b><span>4 TEST CHARGES · RECONCILED</span>'
      : '<i></i><b>' + count + ' / 4 approved</b><span>NOTHING CHARGED</span>'
  }

  function mountPlan(s) {
    el('div', 'v2-orb v2-orb-blue plan-orb', s)
    var launch = el('div', 'launch-panel', s)
    el('div', 'v2-kicker', launch, 'START ANYWHERE')
    html('h1', '', launch, 'Messy input.<br><span>Structured intent.</span>')
    var modes = el('div', 'launch-modes', launch)
    ;[['✦','SAY IT'],['↗','PASTE A LINK'],['▣','IMPORT CART'],['⌁','SCAN A BILL']].forEach(function (m) {
      var x = el('div', 'launch-mode', modes)
      el('i', '', x, m[0]); el('b', '', x, m[1])
    })
    var prompt = html('div', 'launch-prompt', launch, '<i>✦</i><span>Dinner Saturday near Koramangala, under ₹800 each</span><b>→</b>')

    var board = el('div', 'plan-board', s)
    var bh = el('div', 'plan-head', board)
    html('div', '', bh, '<small>LIVE PLAN</small><b>Saturday dinner</b>')
    el('span', '', bh, '3 / 3 answered')
    var signals = el('div', 'signal-row', board)
    ;[['A','Arsh','8 PM · HSR'],['M','Maya','8 PM · Indiranagar'],['S','Soham','7:30 PM · Koramangala']].forEach(function (p, i) {
      var sig = el('div', 'signal-card', signals)
      avatar(sig, p[0], ['blue','gold','orange'][i])
      html('div', '', sig, '<b>' + p[1] + '</b><small>' + p[2] + '</small>')
      el('em', '', sig, 'budget private')
    })
    var venues = el('div', 'venue-list', board)
    var data = [
      ['Nandhana Palace','Koramangala · open until 11:30','94','2.1 km from Maya · aggregate budget fit'],
      ['Sultans of Spice','HSR Layout · open until 11:00','89','Best midpoint · 3.4 km maximum distance'],
      ['Sablewood','Indiranagar · open until 10:30','82','Great fit · tighter closing time'],
    ]
    var ranks = []
    var scores = []
    var cards = data.map(function (v, i) {
      var c = el('div', 'venue-card', venues)
      ranks.push(el('div', 'venue-rank', c, String(i + 1)))
      html('div', 'venue-copy', c, '<b>' + v[0] + '</b><small>' + v[1] + '</small><p>✦ ' + v[3] + '</p>')
      scores.push(el('strong', 'venue-score', c, v[2] + '%'))
      return c
    })
    var moved = el('div', 'rank-change', board, '↗ Nandhana moved to #1 when Maya answered')
    s._els = { launch: launch, board: board, cards: cards, ranks: ranks, scores: scores, moved: moved, prompt: prompt }
  }

  function drawPlan(t, s) {
    var E = s._els
    var switchP = F.ease(F.progress(t, 4300, 5900))
    E.launch.style.opacity = String(1 - switchP)
    E.launch.style.transform = 'translateX(' + F.lerp(0, -130, switchP) + 'px) scale(' + F.lerp(1, .93, switchP) + ')'
    E.board.style.opacity = String(switchP)
    E.board.style.transform = 'translateX(' + F.lerp(150, 0, switchP) + 'px)'
    E.prompt.classList.toggle('resolved', t > 2700)
    var reorder = F.ease(F.progress(t, 10300, 11800))
    E.cards[0].style.transform = 'translateY(' + F.lerp(116, 0, reorder) + 'px)'
    E.cards[1].style.transform = 'translateY(' + F.lerp(-116, 0, reorder) + 'px)'
    E.ranks[0].textContent = reorder > .5 ? '1' : '2'
    E.ranks[1].textContent = reorder > .5 ? '2' : '1'
    E.scores[0].textContent = Math.round(F.lerp(84, 94, reorder)) + '%'
    E.scores[1].textContent = Math.round(F.lerp(91, 89, reorder)) + '%'
    E.moved.style.opacity = String(F.out(F.progress(t, 11700, 12400)))
  }

  function mountAgent(s) {
    var shell = el('div', 'agent-shell', s)
    var thread = el('div', 'agent-thread', shell)
    var th = el('div', 'agent-head', thread)
    html('div', '', th, '<b>Goa trip</b><small>group thread · live state</small>')
    el('span', '', th, '● ONLINE')
    var msgs = el('div', 'agent-msgs', thread)
    html('div', 'agent-msg person', msgs, '<b>Ada</b><p><mark>@sutra</mark> who has not answered?</p>')
    html('div', 'agent-msg bot', msgs, '<b>✦ sutra</b><p>Waiting on Dev. Maya answered 20 minutes ago.</p>')
    html('div', 'agent-msg person second', msgs, '<b>Dev</b><p><mark>@sutra</mark> just pay for me</p>')
    var refusal = html('div', 'agent-msg bot refusal', msgs, '<b>✦ sutra · boundary enforced</b><p>I can plan, rank and ask. I can never approve or move your money.</p><strong>YOUR PASSKEY IS REQUIRED →</strong>')
    var rule = el('div', 'agent-rule-card', shell)
    el('div', 'v2-kicker', rule, 'USEFUL BECAUSE IT CANNOT CHEAT')
    html('h1', '', rule, 'The agent does<br>the chasing.<br><span>Never the paying.</span>')
    html('div', 'boundary-stack', rule, '<p><i>✓</i> Reads group state</p><p><i>✓</i> Explains the decision</p><p><i>✓</i> Sends reminders</p><p class="stop"><i>×</i> Cannot approve money</p>')
    s._els = { refusal: refusal, second: msgs.querySelector('.second'), rule: rule }
  }

  function drawAgent(t, s) {
    s._els.second.style.opacity = String(F.out(F.progress(t, 2800, 3500)))
    var r = F.out(F.progress(t, 4700, 5400))
    s._els.refusal.style.opacity = String(r)
    s._els.refusal.style.transform = 'translateY(' + F.lerp(18, 0, r) + 'px)'
    s._els.rule.classList.toggle('lit', t > 5200)
  }

  function flowNode(parent, label, cls) {
    var n = el('div', 'flow-node ' + (cls || ''), parent)
    el('i', '', n, label.slice(0, 1))
    el('b', '', n, label)
    return n
  }

  function mountNanda(s) {
    var title = el('div', 'nanda-title', s)
    el('div', 'v2-kicker', title, 'REPRODUCIBLE SIMULATION · NEST.PLUGINS.PAYMENTS')
    html('h1', '', title, 'NANDA Town, tested with<br><span>human-scoped mandate semantics.</span>')
    var compare = el('div', 'nanda-compare', s)
    var pooled = el('div', 'nanda-pane pooled', compare)
    html('div', 'nanda-pane-head', pooled, '<small>BUNDLED PLUGIN</small><b>prepaid_credits</b><strong>POOLS $186</strong>')
    var pf = el('div', 'nanda-flow', pooled)
    flowNode(pf, '4 agents'); el('span', '', pf, '→'); flowNode(pf, 'organiser', 'danger'); el('span', '', pf, '→'); flowNode(pf, 'merchant')
    el('p', '', pooled, 'The organiser’s simulator balance goes up before the merchant is paid.')
    var direct = el('div', 'nanda-pane direct', compare)
    html('div', 'nanda-pane-head', direct, '<small>SUTRA PLUGIN · SIMULATED</small><b>prava_mandates</b><strong>POOLS $0</strong>')
    var df = el('div', 'nanda-flow', direct)
    var people = el('div', 'mini-people', df)
    ;['S','A','D','M'].forEach(function (x) { el('i', '', people, x) })
    el('span', '', df, '→'); flowNode(df, 'Prava', 'prava'); el('span', '', df, '→'); flowNode(df, 'merchant', 'good')
    el('p', '', direct, 'Every mandate is merchant-scoped, amount-capped, and charged at most once.')
    var terminal = el('div', 'proof-terminal', s)
    html('div', 'terminal-bar', terminal, '<i></i><i></i><i></i><b>town_scene.py · SIMULATED · NO REAL CARD</b>')
    var lines = [
      '[PASS] group committed despite a mid-flight decline',
      '[PASS] Dev was never charged · $0.00',
      '[PASS] Maya absorbed exactly $55.80',
      '[PASS] conservation_report · no_pooled_funds',
    ]
    lines.forEach(function (x) { html('p', '', terminal, '<b>[PASS]</b>' + x.slice(6)) })
    s._els = { pooled: pooled, direct: direct, terminal: terminal, lines: terminal.querySelectorAll('p') }
  }

  function drawNanda(t, s) {
    var d = F.out(F.progress(t, 3600, 4800))
    s._els.direct.style.borderColor = t > 4300 ? 'rgba(92, 238, 176, .48)' : ''
    s._els.direct.style.transform = 'scale(' + F.lerp(.985, 1.015, d) + ')'
    var tp = F.ease(F.progress(t, 9200, 10400))
    s._els.terminal.style.opacity = String(tp)
    s._els.terminal.style.transform = 'translateY(' + F.lerp(60, 0, tp) + 'px)'
    for (var i = 0; i < s._els.lines.length; i++) s._els.lines[i].style.opacity = String(F.out(F.progress(t, 10300 + i * 650, 10850 + i * 650)))
  }

  function mountLimit(s) {
    el('div', 'v2-grid', s)
    var title = el('div', 'limit-title', s)
    el('div', 'v2-kicker', title, 'THE HONEST EDGE')
    html('h1', '', title, 'Shopify data is live.<br><span>Payment capability is explicit.</span>')
    var equation = el('div', 'limit-equation', s)
    var cards = el('div', 'limit-cards', equation)
    ;['ADA','ARSH','MAYA','DEV'].forEach(function (x, i) { el('i', 'c' + i, cards, x) })
    el('b', '', equation, '≠')
    html('div', 'checkout-field', equation, '<small>ONLINE CHECKOUT</small><span>Address · shipping · tax · payment</span><i>merchant-owned</i>')
    var rails = el('div', 'honest-rails', s)
    html('div', 'rail-yes', rails, '<i>✓</i><b>SHOPIFY CATALOG</b><p>Live product, variant, price and stock.</p>')
    html('div', 'rail-yes', rails, '<i>✓</i><b>DEV STORE PROOF</b><p>Valid test order, address, and N labeled test transactions.</p>')
    html('div', 'rail-venue', rails, '<i>✓</i><b>SHOPIFY POS</b><p>Exact shares; cashier runs split payment.</p>')
    html('div', 'rail-no', rails, '<i>!</i><b>ONLINE SHARED CART</b><p>Address and payment stay at Shopify until the adapter exists.</p>')
    s._els = { cards: cards, rails: rails }
  }

  function drawLimit(t, s) {
    var p = F.out(F.progress(t, 700, 1600))
    s._els.cards.style.transform = 'translateX(' + F.lerp(-70, 0, p) + 'px)'
    s._els.rails.style.opacity = String(F.out(F.progress(t, 4700, 5600)))
  }

  function mountReceipt(s) {
    var receipt = el('div', 'receipt-card-v2', s)
    var rh = el('div', 'receipt-head-v2', receipt)
    html('div', '', rh, '<small>SIGNED AGREEMENT</small><b>Group gift · Shopify POS</b><span>gs_01KYY · GMP/1</span>')
    el('strong', '', rh, 'READY FOR POS ✓')
    var policy = html('div', 'receipt-policy', receipt, '<i>✓</i><b>all_of(4) satisfied</b><span>four exact shares agreed · merchant payment still next</span>')
    var total = el('div', 'receipt-total', receipt)
    html('div', '', total, '<small>QUOTED</small><b>₹9,600</b>')
    html('div', '', total, '<small>CHARGED BY SUTRA</small><b>₹0</b>')
    var entries = el('div', 'receipt-entries', receipt)
    ;[['Ada','a18f…2c91'],['Arsh','6d0b…81de'],['Maya','032e…a102'],['Dev','fe72…9bf0']].forEach(function (x, i) {
      var e = el('div', 'receipt-entry', entries)
      avatar(e, x[0], ['orange','blue','gold','violet'][i])
      html('div', '', e, '<b>' + x[0] + '</b><small>agreed · pay cashier directly</small>')
      html('strong', '', e, '₹2,400<small>hash ' + x[1] + '</small>')
    })
    html('div', 'receipt-signature', receipt, '<i>⌁</i><div><b>Ed25519 signature verified</b><small>hash chain intact · rail: Shopify POS · not proof of payment</small></div><strong>128 HEX ✓</strong>')
    var close = el('div', 'close-v2', s)
    html('div', 'close-mark', close, 'sutra<span>.</span>')
    html('h1', '', close, 'No pooled wallet.<br>Every handoff named.<br><span>Nothing invented.</span>')
    el('div', 'close-url', close, 'sutra-gmp.vercel.app  ↗')
    html('div', 'close-proof', close, '<b>631</b> engine tests <i>·</i> <b>117</b> plugin tests passed <i>·</i> real venues <i>·</i> merchant-sourced prices')
    s._els = { receipt: receipt, close: close, entries: entries.children, policy: policy }
  }

  function drawReceipt(t, s) {
    var E = s._els
    for (var i = 0; i < E.entries.length; i++) E.entries[i].style.opacity = String(F.out(F.progress(t, 1000 + i * 350, 1550 + i * 350)))
    var transition = F.ease(F.progress(t, 7600, 9000))
    E.receipt.style.opacity = String(1 - transition)
    E.receipt.style.transform = 'translateX(' + F.lerp(0, -150, transition) + 'px) scale(' + F.lerp(1, .92, transition) + ')'
    E.close.style.opacity = String(transition)
    E.close.style.transform = 'translateX(' + F.lerp(150, 0, transition) + 'px)'
  }

  function mount(stage) {
    root = stage
    root.innerHTML = ''
    el('div', 'v2-noise', root)
    el('div', 'v2-vignette', root)
    scene('v2-problem', mountProblem, drawProblem)
    scene('v2-turn', mountTurn, drawTurn)
    scene('v2-mandates', mountMandates, drawMandates)
    scene('v2-plan', mountPlan, drawPlan)
    scene('v2-agent', mountAgent, drawAgent)
    scene('v2-nanda', mountNanda, drawNanda)
    scene('v2-limit', mountLimit, drawLimit)
    scene('v2-receipt', mountReceipt, drawReceipt)

    var chrome = el('div', 'v2-chrome', root)
    var brand = html('div', 'v2-brand', chrome, 'sutra<span>.</span>')
    brand.setAttribute('aria-label', 'sutra')
    var chapter = el('div', 'v2-chapter', chrome)
    chapterNumber = el('b', '', chapter, '01')
    chapterName = el('span', '', chapter, 'The temporary lender')
    var provenance = el('div', 'v2-provenance', chrome, 'GMP/1 · PRAVA · NANDA TOWN')
    var caption = el('div', 'v2-caption', root)
    captionText = el('p', '', caption)
    var progress = el('div', 'v2-progress', root)
    progressFill = el('i', '', progress)
  }

  function draw(t) {
    var active = 0
    for (var i = 0; i < WINDOWS.length; i++) {
      if (t >= WINDOWS[i][0] && t < WINDOWS[i][1]) active = i
    }
    if (t >= WINDOWS[WINDOWS.length - 1][1]) active = WINDOWS.length - 1
    for (var j = 0; j < scenes.length; j++) {
      var w = WINDOWS[j]
      var local = F.clamp(t - w[0], 0, w[1] - w[0])
      setScene(scenes[j], j === active, local, w[1] - w[0])
      if (j === active) scenes[j].draw(local, scenes[j].node)
    }
    chapterNumber.textContent = WINDOWS[active][2]
    chapterName.textContent = WINDOWS[active][3]
    progressFill.style.width = (t / 105000 * 100) + '%'
    var cap = ''
    for (var k = 0; k < CAPTIONS.length; k++) if (t >= CAPTIONS[k][0] && t < CAPTIONS[k][1]) cap = CAPTIONS[k][2]
    captionText.textContent = cap
  }

  F.setFilm({ durationMs: 105000, mount: mount, draw: draw })
})()
