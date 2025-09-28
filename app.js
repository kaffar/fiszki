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
    // źródła
    availableFiles: [], // [{name, url, content?}]
    selectedFile: null, // name
    sessionTouched: false, // czy użytkownik zaczął rozwiązywać
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

    // lista plików
    const ul = $('filesList'); ul.innerHTML = '';
    state.availableFiles.forEach(f => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = f.name;
      a.className = 'fileitem' + (state.selectedFile === f.name ? ' active' : '');
      a.setAttribute('role','button');
      a.tabIndex = 0;
      a.addEventListener('click', ()=> onSelectFile(f.name));
      a.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); onSelectFile(f.name); }});
      li.appendChild(a);
      ul.appendChild(li);
    });

    if(!empty){
      const card = state.active[state.idx];
      const prompt = state.dir==='EN->PL' ? card.en : card.pl;
      const answer = state.dir==='EN->PL' ? card.pl : card.en;
      $('prompt').textContent = prompt;
      $('answer').textContent = answer;
      $('answer').style.display = state.show ? '' : 'none';
    }
  }

  // ====== PRZEŁĄCZANIE ZESTAWU (klik w liście) ======
  async function onSelectFile(name){
    if (name === state.selectedFile) return;
    // jeśli sesja zaczęta i są jeszcze karty w puli, zapytaj
    const remaining = state.active.length;
    const total = state.cards.length;
    const midSession = state.sessionTouched && remaining > 0 && total > 0;
    if (midSession) {
      const ok = confirm('Trwa sesja z bieżącym zestawem. Przełączyć na "'+name+'"?');
      if (!ok) return;
    }
    await loadSingleFileByName(name);
  }

  async function loadSingleFileByName(name){
    const f = state.availableFiles.find(x=>x.name===name);
    if (!f) return;
    let text = f.content;
    if (text == null && f.url) {
      const r = await fetch(f.url, { cache: 'no-store' });
      if (!r.ok) return;
      text = await r.text();
    }
    if (text == null) return;
    const parsed = parse(text, name);
    setCards(parsed.cards);
    state.selectedFile = name;
    state.sessionTouched = false;
    render();
  }

  // ====== AUTO-ROZPOZNAWANIE PLIKÓW Z /data ======
  async function autoDetectFilesFromGithub(){
    if (!/\.github\.io$/.test(location.hostname)) return false;
    const ctx = detectGithubContext();
    if (!ctx) return false;
    const branches = ['main','master','gh-pages'];
    for (const branch of branches) {
      const files = await listFilesFromBranch(ctx.owner, ctx.repo, branch);
      if (files && files.length) {
        state.availableFiles = files;
        state.selectedFile = files[0]?.name || null;
        render();
        // od razu wczytaj pierwszy
        await loadSingleFileByName(state.selectedFile);
        return true;
      }
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

  async function listFilesFromBranch(owner, repo, branch){
    try {
      const api = `https://api.github.com/repos/${owner}/${repo}/contents/data?ref=${branch}`;
      const res = await fetch(api, { headers: { 'Accept': 'application/vnd.github+json' } });
      if (!res.ok) return null;
      const list = await res.json();
      const names = (Array.isArray(list) ? list : [])
        .filter(it => it.type === 'file' && /\.txt$/i.test(it.name))
        .map(it => it.name);
      const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/data/`;
      return names.map(n => ({ name: n, url: rawBase + encodeURIComponent(n) }));
    } catch { return null; }
  }

  // ====== RĘCZNE WGRYWANIE (Document Picker w przeglądarce) ======
  async function handleFiles(fileList){
    const files = Array.from(fileList);
    const fileEntries = [];
    for(const f of files){
      const text = await f.text();
      fileEntries.push({ name: f.name || 'plik.txt', content: text });
    }
    state.availableFiles = fileEntries;
    state.selectedFile = fileEntries[0]?.name || null;
    render();
    if (state.selectedFile) {
      await loadSingleFileByName(state.selectedFile);
    }
  }

  // ====== START ======
  (async function init(){
    const loaded = await autoDetectFilesFromGithub();
    if (!loaded) {
      // fallback: jeden plik demo
      state.availableFiles = [{ name: 'przykład.txt', content: sample }];
      state.selectedFile = 'przykład.txt';
      render();
      await loadSingleFileByName('przykład.txt');
    }
  })();

  // Zdarzenia UI
  $('pickBtn').addEventListener('click', ()=> $('fileInput').click());
  $('fileInput').addEventListener('change', (e)=> handleFiles(e.target.files));

  $('dirEnPl').addEventListener('click', ()=>{ state.dir='EN->PL'; save(); render(); });
  $('dirPlEn').addEventListener('click', ()=>{ state.dir='PL->EN'; save(); render(); });

  // BAD/GOOD: pierwsze kliknięcie = pokaż tłumaczenie, drugie = oceniaj
  $('goodBtn').addEventListener('click', ()=> onAnswer('good'));
  $('badBtn').addEventListener('click', ()=> onAnswer('bad'));

  function onAnswer(type){
    if (state.active.length===0) return;
    state.sessionTouched = true;
    if (!state.show) { // najpierw pokaż tłumaczenie
      state.show = true;
      render();
      return;
    }
    if (type === 'good') {
      const k = state.active[state.idx].key;
      state.learned.add(k); save();
    }
    // dla 'bad' nic nie zapisujemy
    // losuj kolejną
    state.show = false;
    state.idx = Math.floor(Math.random()*state.active.length);
    // ale uwzględnij, że po GOOD active może się zmienić
    state.active = state.cards.filter(c=>!state.learned.has(c.key));
    if (state.active.length===0) {
      render();
      return;
    }
    render();
  }

  $('resetBtn').addEventListener('click', ()=>{ state.learned=new Set(); save(); recompute(); });
})();

