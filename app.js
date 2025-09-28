(function(){
  const LS_LEARNED = 'web_fiszki_learned_v1';
  const LS_DIR = 'web_fiszki_direction_v1';

  const sample = `hello - cześć
apple - jabłko
car - samochód
book - książka
water - woda
how are you? - jak się masz?
see you later - do zobaczenia później
cat - kot
dog - pies
thank you - dziękuję
`;

  const $ = (id) => document.getElementById(id);
  const state = {
    cards: [],
    learned: new Set(JSON.parse(localStorage.getItem(LS_LEARNED) || '[]')),
    dir: localStorage.getItem(LS_DIR) || 'EN->PL',
    active: [],
    idx: null,
    show: false,
  };

  function save(){
    localStorage.setItem(LS_DIR, state.dir);
    localStorage.setItem(LS_LEARNED, JSON.stringify(Array.from(state.learned)));
  }

  function splitOnce(line){
    const i=line.indexOf('-');
    if(i===-1) return null;
    const a=line.slice(0,i).trim();
    const b=line.slice(i+1).trim();
    if(!a||!b) return null; return [a,b];
  }

  function parse(text, file){
    const out=[], errors=[]; const seen=new Set();
    text.replace(/\r\n?/g,'\n').split('\n').forEach((line,ix)=>{
      const t=line.trim(); if(!t||t.startsWith('#')) return;
      const p=splitOnce(t); if(!p){ errors.push({file,line:ix+1,value:line}); return; }
      const [en,pl]=p; const key=(en+' — '+pl).toLowerCase();
      if(seen.has(key)) return; seen.add(key); out.push({en,pl,key});
    });
    return {cards:out, errors};
  }

  function setCards(cards){
    state.cards = cards;
    recompute();
  }

  function recompute(){
    state.active = state.cards.filter(c=>!state.learned.has(c.key));
    if(state.active.length===0){ state.idx=null; render(); return; }
    state.idx = Math.floor(Math.random()*state.active.length);
    state.show = false;
    render();
  }

  function render(){
    const remaining = state.active.length;
    const total = state.cards.length;
    const learned = Math.max(0, total - remaining);

    $('stats').textContent = `${learned}/${total} zaliczone • ${remaining} w puli`;
    $('bar').style.width = total ? ((learned/total)*100)+'%' : '0%';

    $('dirEnPl').className = 'btn' + (state.dir==='EN->PL'?' primary':'');
    $('dirPlEn').className = 'btn' + (state.dir==='PL->EN'?' primary':'');

    const empty = remaining===0;
    $('emptyState').style.display = empty ? '' : 'none';
    $('qaWrap').style.display = empty ? 'none' : '';

    if(!empty){
      const card = state.active[state.idx];
      const prompt = state.dir==='EN->PL' ? card.en : card.pl;
      const answer = state.dir==='EN->PL' ? card.pl : card.en;
      $('prompt').textContent = prompt;
      $('answer').textContent = answer;
      $('answer').style.display = state.show ? '' : 'none';
      $('showBtn').style.display = state.show ? 'none' : '';
    }
  }

  // ==== AUTO-ROZPOZNAWANIE PLIKÓW Z /data (bez index.json) ====
  // Działa na GitHub Pages: próbuje branchy main -> master -> gh-pages
  async function autoLoadFromGithubData(){
    if (!/\.github\.io$/.test(location.hostname)) return false;
    const ctx = detectGithubContext();
    if (!ctx) return false;
    const branches = ['main','master','gh-pages'];
    for (const branch of branches) {
      const ok = await tryBranch(ctx.owner, ctx.repo, branch);
      if (ok) return true;
    }
    return false;
  }

  function detectGithubContext(){
    // https://owner.github.io/repo/...
    const m = location.hostname.match(/^(.*?)\.github\.io$/);
    if (!m) return null;
    const owner = m[1];
    const seg = location.pathname.split('/').filter(Boolean);
    const repo = seg[0];
    if (!owner || !repo) return null;
    return { owner, repo };
  }

  async function tryBranch(owner, repo, branch){
    try {
      const api = `https://api.github.com/repos/${owner}/${repo}/contents/data?ref=${branch}`;
      const res = await fetch(api, { headers: { 'Accept': 'application/vnd.github+json' } });
      if (!res.ok) return false;
      const list = await res.json();
      const names = (Array.isArray(list) ? list : [])
        .filter(it => it.type === 'file' && /\.txt$/i.test(it.name))
        .map(it => it.name);
      if (!names.length) return false;
      const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/data/`;
      return await fetchAndUseData(names, (n)=> rawBase + encodeURIComponent(n));
    } catch { return false; }
  }

  async function fetchAndUseData(names, toUrl){
    const allCards=[]; const allErrors=[];
    for (const name of names) {
      try {
        const r = await fetch(toUrl(name), { cache: 'no-store' });
        if (!r.ok) continue;
        const txt = await r.text();
        const parsed = parse(txt, name);
        allCards.push(...parsed.cards);
        allErrors.push(...parsed.errors);
      } catch {}
    }
    if (!allCards.length) return false;
    const map=new Map();
    allCards.forEach(c=>{ if(!map.has(c.key)) map.set(c.key,c); });
    setCards(Array.from(map.values()));
    // lista plików
    const list = $('filesList'); list.innerHTML='';
    names.forEach(n=>{ const li=document.createElement('li'); li.textContent = n; list.appendChild(li); });
    // błędy (opcjonalnie)
    const errBox=$('errorsBox');
    $('errorsCount').textContent = String(allErrors.length);
    if(allErrors.length){
      errBox.style.display='';
      const ul=$('errorsList'); ul.innerHTML='';
      allErrors.slice(0,200).forEach(er=>{
        const li=document.createElement('li');
        li.textContent = `${er.file}:${er.line}: ${er.value}`;
        ul.appendChild(li);
      });
    } else {
      errBox.style.display='none';
    }
    return true;
  }

  // ==== RĘCZNE WGRYWANIE ====
  async function handleFiles(fileList){
    const files = Array.from(fileList);
    const allCards=[]; const infos=[]; const errors=[];

    for(const f of files){
      const text = await f.text();
      const name = f.name || 'plik.txt';
      const parsed = parse(text, name);
      allCards.push(...parsed.cards);
      infos.push({name, count: parsed.cards.length});
      errors.push(...parsed.errors);
    }

    const map=new Map();
    allCards.forEach(c=>{ if(!map.has(c.key)) map.set(c.key,c); });
    setCards(Array.from(map.values()));

    const list = $('filesList');
    list.innerHTML='';
    if(infos.length===0){
      list.innerHTML = '<li>Na start załadowano plik „przykład.txt”.</li>';
    } else {
      for(const fi of infos){
        const li=document.createElement('li');
        li.textContent = `${fi.name} — ${fi.count} fiszek`;
        list.appendChild(li);
      }
    }

    const errBox=$('errorsBox');
    $('errorsCount').textContent = String(errors.length);
    if(errors.length){
      errBox.style.display='';
      const ul=$('errorsList'); ul.innerHTML='';
      errors.slice(0,200).forEach(er=>{
        const li=document.createElement('li');
        li.textContent = `${er.file}:${er.line}: ${er.value}`;
        ul.appendChild(li);
      });
    } else {
      errBox.style.display='none';
    }
  }

  // ==== START ====
  (async function init(){
    const loaded = await autoLoadFromGithubData();
    if (!loaded) {
      // fallback: przykładowe fiszki + wpis na listę
      const parsed = parse(sample, 'przykład.txt');
      setCards(parsed.cards);
      const li=document.createElement('li');
      li.textContent = 'przykład.txt — ' + parsed.cards.length + ' fiszek';
      $('filesList').appendChild(li);
    }
  })();

  // Zdarzenia UI
  $('pickBtn').addEventListener('click', ()=> $('fileInput').click());
  $('fileInput').addEventListener('change', (e)=> handleFiles(e.target.files));

  $('dirEnPl').addEventListener('click', ()=>{ state.dir='EN->PL'; save(); render(); });
  $('dirPlEn').addEventListener('click', ()=>{ state.dir='PL->EN'; save(); render(); });

  $('showBtn').addEventListener('click', ()=>{ state.show=true; render(); });
  $('goodBtn').addEventListener('click', ()=>{
    if(state.active.length===0) return; const k=state.active[state.idx].key;
    state.learned.add(k); save(); recompute();
  });
  $('badBtn').addEventListener('click', ()=>{ if(state.active.length===0) return; state.idx=Math.floor(Math.random()*state.active.length); state.show=false; render(); });

  $('resetBtn').addEventListener('click', ()=>{ state.learned=new Set(); save(); recompute(); });
})();

