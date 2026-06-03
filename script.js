(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  let W=0,H=0;
  function resize(){
    W = canvas.width = Math.floor(innerWidth * DPR);
    H = canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width = innerWidth+'px';
    canvas.style.height = innerHeight+'px';
  }
  addEventListener('resize', resize); resize();

  // Storage
  const save = {
    get(k,d){ try { return JSON.parse(localStorage.getItem('dp_'+k)) ?? d } catch { return d } },
    set(k,v){ localStorage.setItem('dp_'+k, JSON.stringify(v)) }
  };

  // Game state
  const skins = [
    {id:'frog', emoji:'🐸', price:0},
    {id:'bunny', emoji:'🐰', price:50},
    {id:'panda', emoji:'🐼', price:100},
    {id:'fox', emoji:'🦊', price:150},
    {id:'cat', emoji:'🐱', price:200},
    {id:'alien', emoji:'👾', price:300},
    {id:'robot', emoji:'🤖', price:400},
    {id:'unicorn', emoji:'🦄', price:600},
  ];
  let coins = save.get('coins', 0);
  let best = save.get('best', 0);
  let owned = save.get('owned', ['frog']);
  let currentSkin = save.get('skin', 'frog');
  let tiltEnabled = save.get('tilt', false);

  const ui = {
    coins: document.getElementById('coins'),
    height: document.getElementById('height'),
    best: document.getElementById('best'),
    statBest: document.getElementById('statBest'),
    statCoins: document.getElementById('statCoins'),
    statSkins: document.getElementById('statSkins'),
    startOverlay: document.getElementById('startOverlay'),
    pauseOverlay: document.getElementById('pauseOverlay'),
    gameOverOverlay: document.getElementById('gameOverOverlay'),
    shopOverlay: document.getElementById('shopOverlay'),
    howOverlay: document.getElementById('howOverlay'),
    tiltToggle: document.getElementById('tiltToggle'),
  };
  ui.tiltToggle.checked = tiltEnabled;

  function updateHUD(){
    ui.coins.textContent = coins;
    ui.best.textContent = best + 'm';
    ui.statBest.textContent = best + 'm';
    ui.statCoins.textContent = coins;
    ui.statSkins.textContent = owned.length + '/' + skins.length;
  }
  updateHUD();

  // Input
  const input = {left:false, right:false, tilt:0};
  const leftPad = document.getElementById('leftPad');
  const rightPad = document.getElementById('rightPad');
  function bindPad(el, on){
    const down = e => { e.preventDefault(); input[on]=true; };
    const up = e => { e.preventDefault(); input[on]=false; };
    el.addEventListener('touchstart', down, {passive:false});
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    el.addEventListener('mousedown', down);
    addEventListener('mouseup', up);
  }
  bindPad(leftPad,'left'); bindPad(rightPad,'right');

  addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft'||e.key==='a') input.left=true;
    if(e.key==='ArrowRight'||e.key==='d') input.right=true;
    if(e.key==='p') togglePause();
  });
  addEventListener('keyup',e=>{
    if(e.key==='ArrowLeft'||e.key==='a') input.left=false;
    if(e.key==='ArrowRight'||e.key==='d') input.right=false;
  });

  // Tilt
  function handleOrientation(e){
    if(!tiltEnabled) return;
    const g = e.gamma ?? 0; // -90..90
    input.tilt = Math.max(-1, Math.min(1, g/30));
  }
  if('DeviceOrientationEvent' in window){
    window.addEventListener('deviceorientation', handleOrientation);
  }
  ui.tiltToggle.addEventListener('change', ()=>{
    tiltEnabled = ui.tiltToggle.checked;
    save.set('tilt', tiltEnabled);
    if(tiltEnabled && typeof DeviceOrientationEvent.requestPermission === 'function'){
      DeviceOrientationEvent.requestPermission().catch(()=>{});
    }
  });

  // Game objects
  const GRAV = 0.6 * DPR;
  const JUMP = -16 * DPR;
  const PLAYER_W = 60 * DPR, PLAYER_H = 60 * DPR;
  const PLAT_W = 100 * DPR, PLAT_H = 18 * DPR;

  let player, platforms, stars, cameraY, maxHeight, running, paused, sessionCoins, lastTime;

  function resetGame(){
    player = {
      x: W/2, y: H*0.6,
      vx:0, vy:0,
      w: PLAYER_W, h: PLAYER_H,
      onGround:false
    };
    platforms = [];
    stars = [];
    cameraY = 0;
    maxHeight = 0;
    sessionCoins = 0;
    // initial platforms
    let y = player.y + 100*DPR;
    for(let i=0;i<12;i++){
      y -= 80*DPR + Math.random()*40*DPR;
      spawnPlatform(y);
    }
    // ground platform under player
    platforms.push({x:W/2, y:player.y+PLAYER_H+10*DPR, w:PLAT_W, h:PLAT_H, type:'normal', vx:0});
  }

  function spawnPlatform(y){
    const x = Math.random()*(W-PLAT_W*1.2)+PLAT_W*0.6;
    const r = Math.random();
    let type='normal';
    if(r<0.15) type='break';
    else if(r<0.35) type='move';
    const p = {x, y, w:PLAT_W, h:PLAT_H, type, vx:0};
    if(type==='move'){
      p.vx = (Math.random()<0.5?-1:1)*(1.2+Math.random()*1.2)*DPR;
      p.minX = PLAT_W*0.6;
      p.maxX = W-PLAT_W*0.6;
    }
    platforms.push(p);
    // occasional star
    if(Math.random()<0.35){
      stars.push({x:x+(Math.random()-0.5)*40*DPR, y:y-40*DPR, r:14*DPR, taken:false, rot:Math.random()*Math.PI});
    }
  }

  function loop(t){
    if(!running || paused){ lastTime=t; requestAnimationFrame(loop); return; }
    const dt = Math.min(32, t - (lastTime||t));
    lastTime = t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt){
    // input
    let ax = 0;
    if(input.left) ax -= 0.8*DPR;
    if(input.right) ax += 0.8*DPR;
    if(tiltEnabled) ax += input.tilt * 0.8*DPR;
    player.vx += ax;
    player.vx *= 0.9; // friction
    player.vx = Math.max(-8*DPR, Math.min(8*DPR, player.vx));
    player.vy += GRAV;
    player.x += player.vx;
    player.y += player.vy;

    // wrap horizontal
    if(player.x < -player.w) player.x = W+player.w;
    if(player.x > W+player.w) player.x = -player.w;

    // camera follow up
    const targetCam = player.y - H*0.6;
    if(targetCam < cameraY){
      cameraY = targetCam;
    }
    maxHeight = Math.max(maxHeight, -cameraY);
    ui.height.textContent = Math.floor(maxHeight / (10*DPR)) + 'm';

    // platforms
    const py = player.y + player.h*0.5;
    player.onGround = false;
    for(let i=platforms.length-1;i>=0;i--){
      const p = platforms[i];
      if(p.type==='move'){
        p.x += p.vx;
        if(p.x < p.minX || p.x > p.maxX){ p.vx *= -1; p.x = Math.max(p.minX, Math.min(p.maxX,p.x)); }
      }
      // collision from top
      if(player.vy > 0 && py >= p.y - p.h/2 && py <= p.y + p.h/2 + 10*DPR && Math.abs(player.x - p.x) < (p.w+player.w)*0.4){
        player.y = p.y - p.h/2 - player.h*0.5;
        player.vy = JUMP;
        player.onGround = true;
        if(p.type==='break'){
          p.breaking = true;
          p.breakTime = 150;
        }
      }
      // remove far below
      if(p.y - cameraY > H + 200*DPR) platforms.splice(i,1);
      if(p.breaking){
        p.breakTime -= dt;
        if(p.breakTime<=0) platforms.splice(i,1);
      }
    }

    // stars
    for(const s of stars){
      if(!s.taken && Math.hypot(player.x - s.x, player.y - s.y) < 40*DPR){
        s.taken = true;
        sessionCoins += 5;
        coins += 5;
        save.set('coins', coins);
        updateHUD();
      }
      s.rot += 0.05;
    }
    stars = stars.filter(s=> !s.taken && s.y - cameraY < H+100*DPR);

    // generate new platforms above
    let topY = Math.min(...platforms.map(p=>p.y));
    while(topY > cameraY - 200*DPR){
      topY -= 70*DPR + Math.random()*50*DPR;
      spawnPlatform(topY);
    }

    // game over
    if(player.y - cameraY > H + 100*DPR){
      gameOver();
    }
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    // sky gradient already via css, draw hills
    ctx.save();
    ctx.translate(0, -cameraY);
    // soft hills in background
    drawHills();

    // platforms
    for(const p of platforms){
      ctx.save();
      ctx.translate(p.x, p.y);
      const w = p.w, h = p.h;
      ctx.shadowColor = 'rgba(0,0,0,.25)';
      ctx.shadowBlur = 20*DPR;
      if(p.type==='break'){
        // wood
        ctx.fillStyle = p.breaking ? '#8b5a3c' : '#a86f4a';
        roundRect(-w/2, -h/2, w, h, 8*DPR);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.15)';
        for(let i=-w/2+10;i<w/2;i+=18) ctx.fillRect(i, -h/2+4, 4, h-8);
      }else if(p.type==='move'){
        ctx.fillStyle = '#7CFC00';
        roundRect(-w/2, -h/2, w, h, 8*DPR);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        roundRect(-w/2+6, -h/2+4, w-12, 6, 3);
        ctx.fill();
      }else{
        ctx.fillStyle = '#5eff9c';
        roundRect(-w/2, -h/2, w, h, 8*DPR);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        roundRect(-w/2+6, -h/2+4, w-12, 6, 3);
        ctx.fill();
      }
      ctx.restore();
    }

    // stars
    for(const s of stars){
      if(s.taken) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.font = `${28*DPR}px serif`;
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.shadowColor='rgba(255,215,0,.8)';
      ctx.shadowBlur=20*DPR;
      ctx.fillText('⭐',0,0);
      ctx.restore();
    }

    // player
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.font = `${PLAYER_H*0.9}px serif`;
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,.35)';
    ctx.shadowBlur=25*DPR;
    const skin = skins.find(s=>s.id===currentSkin) || skins[0];
    ctx.fillText(skin.emoji,0,4*DPR);
    // eyes blink? simple
    ctx.restore();

    ctx.restore();
  }

  function drawHills(){
    const base = H + cameraY + 200*DPR;
    ctx.globalAlpha=0.25;
    ctx.fillStyle='#136a3a';
    ctx.beginPath();
    ctx.moveTo(0, base);
    for(let x=0;x<=W;x+=40*DPR){
      const y = base - 120*DPR - Math.sin((x+cameraY*0.1)*0.002)*60*DPR;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(W, base); ctx.fill();
    ctx.globalAlpha=1;
  }

  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  function startGame(){
    resetGame();
    running = true; paused = false;
    ui.startOverlay.classList.add('hidden');
    ui.pauseOverlay.classList.add('hidden');
    ui.gameOverOverlay.classList.add('hidden');
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function togglePause(){
    if(!running) return;
    paused = !paused;
    ui.pauseOverlay.classList.toggle('hidden', !paused);
  }

  function gameOver(){
    running = false;
    const heightM = Math.floor(maxHeight/(10*DPR));
    if(heightM > best){ best = heightM; save.set('best', best); }
    updateHUD();
    document.getElementById('goHeight').textContent = heightM + 'm';
    document.getElementById('goCoins').textContent = '+' + sessionCoins;
    document.getElementById('goBest').textContent = best + 'm';
    ui.gameOverOverlay.classList.remove('hidden');
  }

  // Buttons
  document.getElementById('playBtn').onclick = startGame;
  document.getElementById('pauseBtn').onclick = togglePause;
  document.getElementById('resumeBtn').onclick = togglePause;
  document.getElementById('restartBtn').onclick = ()=>{ ui.pauseOverlay.classList.add('hidden'); startGame(); };
  document.getElementById('againBtn').onclick = ()=>{ ui.gameOverOverlay.classList.add('hidden'); startGame(); };
  document.getElementById('menuBtn').onclick = ()=>{ ui.gameOverOverlay.classList.add('hidden'); ui.startOverlay.classList.remove('hidden'); };
  document.getElementById('shopBtn').onclick = ()=>{ openShop(); };
  document.getElementById('closeShopBtn').onclick = ()=>{ ui.shopOverlay.classList.add('hidden'); updateHUD(); };
  document.getElementById('howBtn').onclick = ()=> ui.howOverlay.classList.remove('hidden');
  document.getElementById('closeHowBtn').onclick = ()=> ui.howOverlay.classList.add('hidden');

  function openShop(){
    ui.shopOverlay.classList.remove('hidden');
    const list = document.getElementById('skinList');
    list.innerHTML = '';
    for(const s of skins){
      const div = document.createElement('div');
      const isOwned = owned.includes(s.id);
      const isActive = currentSkin === s.id;
      div.className = 'skin' + (isActive?' active':'') + (!isOwned?' locked':'');
      div.innerHTML = `<div class="emo">${s.emoji}</div><div class="price">${isOwned ? (isActive?'Em uso':'Possuído') : '🪙 '+s.price}</div>`;
      div.onclick = ()=>{
        if(isOwned){
          currentSkin = s.id;
          save.set('skin', currentSkin);
          openShop();
        }else if(coins >= s.price){
          coins -= s.price;
          owned.push(s.id);
          currentSkin = s.id;
          save.set('coins', coins);
          save.set('owned', owned);
          save.set('skin', currentSkin);
          updateHUD();
          openShop();
        }
      };
      list.appendChild(div);
    }
  }

  // Prevent scroll
  document.addEventListener('touchmove', e=>{ if(running) e.preventDefault(); }, {passive:false});

  // Init render
  render();
})();
