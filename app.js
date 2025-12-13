(function(){
  const LS_LEARNED = 'web_fiszki_learned_v1';
  const LS_DIR = 'web_fiszki_direction_v1';
  const LS_REMOVED = 'web_fiszki_removed_v1';

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
    removed: new Set(JSON.parse(localStorage.getItem(LS_REMOVED) || '[]')),
    dir: localStorage.getItem(LS_DIR) || 'EN->PL',
    queue: [],
    idx: null,
    show: false,
    history: [],
    // źródła
    availableFiles: [], // [{name, url, content?}]
    selectedFile: null, // name
    sessionTouched: false, // czy użytkownik zaczął rozwiązywać
  };

  function save(){
    localStorage.setItem(LS_DIR, state.dir);
    localStorage.setItem(LS_LEARNED, JSON.stringify(Array.from(state.learned)));
    localStorage.setItem(LS_REMOVED, JSON.stringify(Array.from(state.removed)));
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
    state.queue = shuffle(activeCards());
    state.idx = pickFirstIndex();
    state.history = [];
    state.show = false;
    render();
  }

  function activeCards(){
    return state.cards.filter(c=>!state.learned.has(c.key) && !state.removed.has(c.key));
  }

  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }

  function pickFirstIndex(){
    for(let i=0;i<state.queue.length;i++){
      if(!state.learned.has(state.queue[i].key) && !state.removed.has(state.queue[i].key)) return i;
    }
    return null;
  }

  function currentCard(){
    if (state.idx == null) return null;
    return state.queue[state.idx] || null;
  }

  function findNextIndex(startIdx){
    for(let i=startIdx+1;i<state.queue.length;i++){
      const card = state.queue[i];
      if(!state.learned.has(card.key) && !state.removed.has(card.key)) return i;
    }
    return null;
  }

  function moveToNext(){
    const nextIdx = findNextIndex(state.idx == null ? -1 : state.idx);
    state.show = false;
    state.idx = nextIdx;
    // jeżeli skończyliśmy, upewnij się że kolejka jest spójna
    if (state.idx == null && activeCards().length > 0) {
      state.idx = pickFirstIndex();
    }
    render();
  }

  function scheduleBad(card){
    // wstaw kartę ponownie za 3 inne (czyli na pozycji +4)
    const insertAt = Math.min(state.queue.length, (state.idx ?? -1) + 4);
    state.queue.splice(insertAt, 0, card);
  }

  function onRevert(){
    if (!state.history.length) return;
    const prevIdx = state.history.pop();
    state.idx = prevIdx;
    state.show = true;
    render();
  }

  function removeCurrentCard(){
    const card = currentCard();
    if (!card) return;
    state.sessionTouched = true;
    state.removed.add(card.key);
    state.learned.delete(card.key);
    save();
    state.queue = state.queue.filter(c => !state.removed.has(c.key));
    state.history = [];
    state.idx = pickFirstIndex();
    state.show = false;
    render();
  }

  function resetRemoved(){
    if (!state.removed.size) return;
    state.removed = new Set();
    save();
    recompute();
  }

  function render(){
    const remaining = activeCards().length;
    const total = state.cards.length - state.removed.size;
    const learned = Math.max(0, total - remaining);

    $('stats').textContent = `${learned}/${total} zaliczone • ${remaining} w puli`;
    $('removedInfo').textContent = `${state.removed.size} usunięte`;
    $('bar').style.width = total ? ((learned/total)*100)+'%' : '0%';

    $('dirEnPl').className = 'btn' + (state.dir==='EN->PL'?' primary':'');
    $('dirPlEn').className = 'btn' + (state.dir==='PL->EN'?' primary':'');

    const card = currentCard();
    const hasCard = !!card;
    $('emptyState').style.display = hasCard ? 'none' : '';
    $('qaWrap').style.display = hasCard ? '' : 'none';

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

    if(hasCard && card){
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
    const remaining = activeCards().length;
    const total = state.cards.length - state.removed.size;
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
  $('revertBtn').addEventListener('click', onRevert);
  $('removeBtn').addEventListener('click', removeCurrentCard);
  $('restoreRemovedBtn').addEventListener('click', resetRemoved);

  function onAnswer(type){
    const card = currentCard();
    if (!card) return;
    state.sessionTouched = true;
    if (!state.show) { // najpierw pokaż tłumaczenie
      state.show = true;
      render();
      return;
    }

    if (type === 'good') {
      state.learned.add(card.key);
    } else {
      state.learned.delete(card.key);
      scheduleBad(card);
    }

    save();
    state.history.push(state.idx);
    moveToNext();
  }

  $('resetBtn').addEventListener('click', ()=>{ state.learned=new Set(); save(); recompute(); });
})();

