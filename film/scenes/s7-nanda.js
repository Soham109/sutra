// sutra — film · Scene 7 · NANDA AS A PRODUCT COMPONENT
// Two integrations, shown distinctly: open-web agent discovery and the actual
// NANDA Town payments plugin. Then the real pay_group() differentiator.

(function () {
  var START = 120000;
  var END = 145000;

  function el(tag, cls, parent, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    if (text != null) node.textContent = text;
    return node;
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s7-nanda{position:relative;background:#f7f6f2!important;color:#121210}'
      + '.n7-head{position:absolute;left:92px;right:92px;top:112px;display:flex;align-items:flex-end;justify-content:space-between}'
      + '.n7-kicker{font:12px var(--font-mono);letter-spacing:.16em;color:#ff8b6f;text-transform:uppercase}'
      + '.n7-head h2{margin-top:9px;font-size:40px;line-height:1.05;letter-spacing:-.04em}'
      + '.n7-head h2 span{color:#c63817}.n7-live{font:11px var(--font-mono);color:#12734f;padding:9px 14px;border:1px solid #a9d8c1;background:#e3f3ea;border-radius:999px}'
      + '.n7-layer{position:absolute;left:92px;right:92px;top:230px;height:520px}'
      + '.n7-discovery{display:block}'
      + '.n7-card{border:1px solid #302d29;background:linear-gradient(145deg,#171614,#10100f);border-radius:22px;box-shadow:0 24px 70px #0008}'
      + '.n7-explain{display:none}'
      + '.n7-code{margin-top:24px;padding:15px;border:1px solid #34312d;border-radius:12px;background:#090909;font:13px var(--font-mono);color:#ff9d84}'
      + '.n7-chain{padding:24px 38px;position:relative;overflow:hidden;height:500px;background:#fff}'
      + '.n7-chain-title{font:12px var(--font-mono);letter-spacing:.12em;color:#8c887f}'
      + '.n7-chain-line{position:absolute;left:140px;right:140px;top:145px;height:4px;background:#292724}.n7-chain-fill{height:100%;background:linear-gradient(90deg,#ff6743,#ffaf56,#22b37a);box-shadow:0 0 26px #22a06b88}'
      + '.n7-nodes{display:flex;justify-content:space-between;margin:32px 70px 0}.n7-node{width:210px;text-align:center;position:relative}'
      + '.n7-dot{margin:auto;width:70px;height:70px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(145deg,#174f3b,#0d2c21);border:2px solid #38b982;color:#7ae2b5;font-size:28px;box-shadow:0 15px 35px #0008}'
      + '.n7-node b{display:block;margin-top:14px;font:14px var(--font-mono);color:#f1eee7}.n7-node small{display:block;margin-top:5px;color:#9a958b;font-size:12px}'
      + '.n7-registry{margin:25px 70px 0;display:flex;align-items:center;gap:14px;padding:16px 22px;background:linear-gradient(90deg,#ff6b47,#ff9a57);color:#fff;border-radius:14px;box-shadow:0 15px 34px #0006}'
      + '.n7-registry code{font:14px var(--font-mono);font-weight:700}.n7-registry i{margin-left:auto;font:11px var(--font-mono);color:#fff;font-style:normal}'
      + '.n7-discovery-flow{display:grid;grid-template-columns:1fr 100px 1.2fr 100px 1fr;align-items:center;margin:24px 70px 0;gap:12px}.n7-discovery-block{height:145px;border-radius:20px;border:1px solid #3b3731;padding:20px;background:#10100f;display:flex;flex-direction:column;justify-content:center;text-align:center}.n7-discovery-block strong{font-size:22px}.n7-discovery-block span{margin-top:9px;color:#9a958b;font:11px var(--font-mono)}.n7-discovery-block.brand{background:linear-gradient(145deg,#4c251b,#21130e);border-color:#7b3d2b}.n7-discovery-block.town{background:linear-gradient(145deg,#183c30,#0e211a);border-color:#286249}.n7-discovery-arrow{height:4px;background:linear-gradient(90deg,#ff6743,#46c88e);position:relative}.n7-discovery-arrow:after{content:"›";position:absolute;right:-4px;top:-25px;font-size:40px;color:#53ce98}'
      + '.n7-purchase{display:grid;grid-template-columns:380px 1fr 360px;gap:30px;align-items:center}'
      + '.n7-call{padding:30px}.n7-call .ey{font:11px var(--font-mono);color:#ff8b6f;letter-spacing:.12em}.n7-call h3{margin-top:13px;font-size:30px;line-height:1.1}.n7-call pre{margin-top:22px;white-space:pre-wrap;font:13px/1.7 var(--font-mono);color:#bbb6ac}.n7-call strong{color:#fff}'
      + '.n7-principals{display:flex;justify-content:space-between;align-items:flex-start;position:relative;padding-top:26px}'
      + '.n7-principals:after{content:"";position:absolute;left:8%;right:8%;top:160px;height:2px;background:#ff6b47;box-shadow:0 0 24px #ff6b4766}'
      + '.n7-person{width:150px;text-align:center;position:relative;z-index:2}.n7-avatar{width:92px;height:92px;border-radius:28px;margin:auto;display:grid;place-items:center;font:700 25px var(--font-mono);background:linear-gradient(145deg,#ff7654,#b72e15);box-shadow:0 18px 38px #0008}'
      + '.n7-person.declined .n7-avatar{background:#242321;color:#777;border:2px dashed #555}.n7-person b{display:block;margin-top:14px}.n7-person small{display:block;margin-top:5px;font:11px var(--font-mono);color:#8c887f}.n7-person em{display:inline-block;margin-top:10px;padding:6px 9px;border-radius:999px;background:#1e1d1b;font:10px var(--font-mono);color:#ff9d84;font-style:normal}'
      + '.n7-merchant{padding:30px;text-align:center}.n7-shop{width:112px;height:112px;margin:auto;border-radius:28px;display:grid;place-items:center;background:#153328;border:1px solid #2d7c59;font-size:42px;box-shadow:0 0 50px #20a66a33}.n7-merchant h3{margin-top:18px;font-size:24px}.n7-total{margin-top:12px;font:700 38px var(--font-mono);color:#79dfb3}.n7-zero{margin-top:16px;color:#928d83;font:11px var(--font-mono)}'
      + '.n7-compare{display:grid;grid-template-columns:1fr 1fr;gap:28px}.n7-rail{padding:34px 38px;position:relative;overflow:hidden;background:linear-gradient(145deg,#201511,#11100f)}.n7-rail.good{background:linear-gradient(145deg,#10271f,#10110f)}.n7-rail h3{font:700 22px var(--font-mono)}.n7-rail .big{margin-top:22px;font-size:58px;font-weight:760;letter-spacing:-.05em}.n7-rail p{margin-top:12px;font-size:17px;line-height:1.5;color:#aaa59b}.n7-rail.bad .big{color:#ff8062}.n7-rail.good .big{color:#78ddb3}'
      + '.n7-flow{margin-top:34px;display:flex;align-items:center;justify-content:space-between;font:12px var(--font-mono)}.n7-flow span{padding:12px 15px;border:1px solid #3a3732;border-radius:10px}.n7-flow i{height:2px;flex:1;background:#4c4842;position:relative}.n7-flow i:after{content:"›";position:absolute;right:-2px;top:-15px;font-size:25px}.n7-pass{position:absolute;left:50%;bottom:38px;transform:translateX(-50%);padding:15px 24px;border-radius:999px;background:#143426;border:1px solid #2e7958;color:#7ce1b6;font:12px var(--font-mono);white-space:nowrap}'
      + '.n7-proof{padding:35px 44px}.n7-proof-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:20px;border-bottom:1px solid #302e2b;font:13px var(--font-mono);color:#8d897f}.n7-proof-lines{margin-top:24px}.n7-proof-line{font:18px/1.8 var(--font-mono);color:#e8e4dc}.n7-proof-line b{color:#64d6a4}.n7-proof-foot{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:28px}.n7-proof-stat{padding:18px;border:1px solid #2e4f40;background:#10241c;border-radius:13px;color:#74dbae;font:12px var(--font-mono);text-align:center}'
      + '.n7-layer{opacity:0}';
    var style = el('style', '', document.head); style.textContent = css;
  }

  function mount(root) {
    injectStyle();
    var head = el('div', 'n7-head', root);
    var title = el('div', '', head);
    el('div', 'n7-kicker', title, 'NANDA · TWO REAL INTEGRATIONS');
    var h2 = el('h2', '', title); h2.innerHTML = 'NANDA Town, wired to <span>human-approved card mandates.</span>';
    el('div', 'n7-live', head, '● VERIFIED IN THIS REPO');

    var discovery = el('div', 'n7-layer n7-discovery', root);
    var exp = el('div', 'n7-card n7-explain', discovery);
    el('b', '', exp, '1 · Open-web discovery');
    el('p', '', exp, 'Sutra publishes four machine-readable surfaces generated from one endpoint inventory. Agents can find the protocol before they call it.');
    el('div', 'n7-code', exp, 'GET /.well-known/agent-card.json');
    var chain = el('div', 'n7-card n7-chain', discovery);
    el('div', 'n7-chain-title', chain, 'LIVE DISCOVERY CHAIN');
    var line = el('div', 'n7-chain-line', chain); var fill = el('div', 'n7-chain-fill', line);
    var nodes = el('div', 'n7-nodes', chain);
    [['A2A','AgentCard'],['NANDA','AgentFacts'],['CAT','AI Catalog'],['SK','SkillMD']].forEach(function (n) {
      var x=el('div','n7-node',nodes); el('div','n7-dot',x,'✓'); el('b','',x,n[0]); el('small','',x,n[1]+' · HTTP 200');
    });
    var reg=el('div','n7-registry',chain); el('code','',reg,'nest.plugins.payments → prava_mandates'); el('i','',reg,'DISCOVERED ✓');
    var dflow=el('div','n7-discovery-flow',chain);
    var da=el('div','n7-discovery-block brand',dflow);el('strong','',da,'sutra agent');el('span','',da,'HTTPS · OPEN WEB');
    el('div','n7-discovery-arrow',dflow);
    var db=el('div','n7-discovery-block town',dflow);el('strong','',db,'NANDA Town');el('span','',db,'PLUGIN REGISTRY RESOLVES');
    el('div','n7-discovery-arrow',dflow);
    var dc=el('div','n7-discovery-block',dflow);el('strong','',dc,'pay_group()');el('span','',dc,'4 PRINCIPALS · 1 PURCHASE');

    var purchase = el('div', 'n7-layer n7-purchase', root);
    var call=el('div','n7-card n7-call',purchase); el('div','ey',call,'2 · NANDA TOWN ADAPTER'); el('h3','',call,'One pay_group(). Four human principals.');
    var pre=el('pre','',call); pre.innerHTML='<strong>policy</strong>  quorum(2 of 3)\n<strong>cart</strong>    velvet-tickets · $186\n<strong>rail</strong>    prava_mandates\n\nDev declines. Maya backstops.';
    var people=el('div','n7-principals',purchase);
    [['SO','Soham','$65.10','PASSKEY'],['AR','Arsh','$65.10','PASSKEY'],['DE','Dev','$0','DECLINED'],['MA','Maya','$55.80','BACKSTOP']].forEach(function(p){var q=el('div','n7-person'+(p[3]==='DECLINED'?' declined':''),people);el('div','n7-avatar',q,p[0]);el('b','',q,p[1]);el('small','',q,p[2]);el('em','',q,p[3]);});
    var merchant=el('div','n7-card n7-merchant',purchase);el('div','n7-shop',merchant,'◈');el('h3','',merchant,'velvet-tickets');el('div','n7-total',merchant,'$186.00');el('div','n7-zero',merchant,'ORGANISER BALANCE +$0');

    var compare=el('div','n7-layer n7-compare',root);
    var bad=el('div','n7-card n7-rail bad',compare);el('h3','',bad,'prepaid_credits');el('div','big',bad,'POOLS $186');el('p','',bad,'Three agents credit the organiser. pay_group() does not exist; the organiser forwards the pool alone.');var bf=el('div','n7-flow',bad);el('span','',bf,'3 agents');el('i','',bf);el('span','',bf,'organiser');el('i','',bf);el('span','',bf,'merchant');
    var good=el('div','n7-card n7-rail good',compare);el('h3','',good,'prava_mandates');el('div','big',good,'POOLS $0');el('p','',good,'Four capped mandates cross the simulator boundary directly to one merchant. No agent can pay another.');var gf=el('div','n7-flow',good);el('span','',gf,'4 cards');el('i','',gf);el('span','',gf,'GMP/1');el('i','',gf);el('span','',gf,'merchant');
    el('div','n7-pass',compare,'AttributeError vs pay_group() · the prize argument');

    var proof=el('div','n7-layer n7-card n7-proof',root);
    var ph=el('div','n7-proof-head',proof);el('span','',ph,'$ python scripts/town_scene.py');el('span','',ph,'ZERO KEYS · DETERMINISTIC · REPRODUCIBLE');
    var pls=el('div','n7-proof-lines',proof);
    ['group committed despite a mid-flight decline','Dev was never charged','Maya absorbed exactly the $55.80 shortfall','merchant received the full $186.00'].forEach(function(t){var l=el('div','n7-proof-line',pls);l.innerHTML='<b>[PASS]</b> '+t;});
    var foot=el('div','n7-proof-foot',proof);['authorization_conserved','no_pooled_funds','settlement_conserved'].forEach(function(t){el('div','n7-proof-stat',foot,t+' · TRUE');});
    root._els={discovery:discovery,purchase:purchase,compare:compare,proof:proof,fill:fill};
  }

  function show(layer, t, from, to) {
    var F=window.FILM; var enter=F.easeOut(F.progress(t,from,from+450)); var exit=F.easeIn(F.progress(t,to-350,to));
    layer.style.opacity=String(enter*(1-exit)); layer.style.transform='translateY('+F.lerp(18,-8,F.easeInOut(F.progress(t,from,to)))+'px) scale('+F.lerp(.985,1.01,F.easeInOut(F.progress(t,from,to)))+')';
  }
  function draw(t,root){var E=root._els;show(E.discovery,t,0,4800);show(E.purchase,t,4300,14400);show(E.compare,t,13800,20300);show(E.proof,t,19700,25000);E.fill.style.width=(window.FILM.progress(t,500,3300)*100)+'%';}

  window.FILM.register({id:'s7-nanda',startMs:START,endMs:END,mount:mount,draw:draw});
  window.FILM.caption('Agents discover Sutra. Town loads prava_mandates.',START,START+6000);
  window.FILM.caption('One pay_group call. Four human mandates. Dev declines; Maya backstops.',START+6000,START+17000);
  window.FILM.caption('prepaid_credits pools with an organiser. prava_mandates never can.',START+17000,END);
})();
