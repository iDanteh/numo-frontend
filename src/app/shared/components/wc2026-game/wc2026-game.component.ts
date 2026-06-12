import {
  AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild,
} from '@angular/core';

type PenaltyPhase = 'idle' | 'shooting' | 'result' | 'over';
type JugglesPhase = 'waiting' | 'playing' | 'over';
type KickResult   = 'goal' | 'miss';

interface Particle  { x:number; y:number; vx:number; vy:number; r:number; life:number; color:string; }
interface JBall     { x:number; y:number; vx:number; vy:number; r:number; }
interface KickFlash { x:number; y:number; r:number; alpha:number; }
interface Milestone { text:string; y:number; alpha:number; }

@Component({
  selector:    'app-wc2026-game',
  standalone:  false,
  templateUrl: './wc2026-game.component.html',
  styleUrls:   ['./wc2026-game.component.scss'],
})
export class Wc2026GameComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  // ── Angular-bound UI ────────────────────────────────────────────────────
  isOpen    = false;
  activeTab: 'penalties' | 'juggles' = 'penalties';

  // Penalties
  goals = 0; saves = 0; kicksLeft = 5;
  results: KickResult[] = [];
  message = 'Haz clic en la portería para disparar';
  msgClass = '';
  showRestart = false;
  readonly TOTAL  = 5;
  readonly dotIdx = [0, 1, 2, 3, 4];

  // Juggles
  jBest = 0;

  // ── Canvas constants ────────────────────────────────────────────────────
  private readonly W = 296;
  private readonly H = 180;
  private readonly G = { l:52, t:16, r:244, b:88 };
  private get gw() { return this.G.r - this.G.l; }
  private get gh() { return this.G.b - this.G.t; }

  private ctx!: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private lastTs = 0;

  // ── Penalties private state ─────────────────────────────────────────────
  private pPhase: PenaltyPhase = 'idle';
  private bx=148; private by=152; private br=9;
  private bSx=148; private bSy=152; private bTx=148; private bTy=152;
  private bProg=0;
  private kx=148; private kTarget=148; private kProg=0; private kDir=0;
  private hovCol=-1; private hovRow=-1;
  private flashAlpha=0; private flashColor='#22c55e';
  private particles: Particle[] = [];
  private resultTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Juggles private state ───────────────────────────────────────────────
  private jPhase: JugglesPhase = 'waiting';
  private jScore = 0;
  private jBall: JBall = { x:148, y:76, vx:0, vy:0, r:13 };
  private jBob  = 0;
  private jFlash: KickFlash | null = null;
  private jMile:  Milestone  | null = null;

  constructor(private zone: NgZone) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngAfterViewInit(): void {
    this.ctx   = this.canvasRef.nativeElement.getContext('2d')!;
    this.jBest = parseInt(localStorage.getItem('wc2026_best') || '0', 10);
    this.zone.runOutsideAngular(() => this.bindCanvas(this.canvasRef.nativeElement));
  }

  ngOnDestroy(): void {
    this.stopLoop();
    if (this.resultTimer) clearTimeout(this.resultTimer);
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      // Reset active game to a clean state each time the panel opens
      if (this.activeTab === 'penalties') {
        if (this.pPhase === 'over') { this.restart(); }
      } else {
        if (this.jPhase === 'over') { this.initJuggles(); }
      }
      this.zone.runOutsideAngular(() => this.startLoop());
    } else {
      this.stopLoop();
    }
  }

  close(): void { this.isOpen = false; this.stopLoop(); }

  // ── Tabs ─────────────────────────────────────────────────────────────────
  switchTab(tab: 'penalties' | 'juggles'): void {
    if (this.activeTab === tab) return;
    // Cancel any in-progress penalty timer before switching
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; }
    this.activeTab = tab;
    if (tab === 'juggles') {
      this.pPhase = 'idle';
      this.resetForKick();
      this.initJuggles();
    } else {
      this.goals = 0; this.saves = 0; this.kicksLeft = this.TOTAL; this.results = [];
      this.message = 'Haz clic en la portería para disparar';
      this.msgClass = ''; this.showRestart = false;
      this.pPhase = 'idle';
      this.resetForKick();
    }
  }

  // ── Penalties public ──────────────────────────────────────────────────────
  restart(): void {
    this.goals=0; this.saves=0; this.kicksLeft=this.TOTAL; this.results=[];
    this.message='Haz clic en la portería para disparar';
    this.msgClass=''; this.showRestart=false;
    this.resetForKick(); this.pPhase='idle';
  }

  // ── Canvas binding ────────────────────────────────────────────────────────
  private bindCanvas(cv: HTMLCanvasElement): void {
    cv.addEventListener('mousemove', e => {
      if (this.activeTab === 'penalties') {
        if (this.pPhase !== 'idle') { this.hovCol=-1; this.hovRow=-1; return; }
        const {x,y} = this.toCanvas(e, cv);
        const z = this.hitZone(x,y);
        this.hovCol = z?.col ?? -1; this.hovRow = z?.row ?? -1;
        cv.style.cursor = z ? 'pointer' : 'default';
      } else {
        if (this.jPhase === 'playing') {
          const {x,y} = this.toCanvas(e, cv);
          cv.style.cursor = Math.hypot(x-this.jBall.x, y-this.jBall.y) < this.jBall.r+22
            ? 'pointer' : 'crosshair';
        } else { cv.style.cursor = 'pointer'; }
      }
    });
    cv.addEventListener('mouseleave', () => { this.hovCol=-1; this.hovRow=-1; cv.style.cursor='default'; });
    cv.addEventListener('click', e => {
      const {x,y} = this.toCanvas(e, cv);
      if (this.activeTab === 'penalties') {
        if (this.pPhase !== 'idle') return;
        const z = this.hitZone(x,y);
        if (z) this.shoot(z.col, z.row);
      } else { this.handleJClick(x,y); }
    });
  }

  private toCanvas(e: MouseEvent, cv: HTMLCanvasElement) {
    const r = cv.getBoundingClientRect();
    return { x:(e.clientX-r.left)*(this.W/r.width), y:(e.clientY-r.top)*(this.H/r.height) };
  }

  // ── Penalties logic ───────────────────────────────────────────────────────
  private hitZone(mx:number, my:number): {col:number;row:number}|null {
    const {l,t,r,b}=this.G;
    if (mx<l||mx>r||my<t||my>b) return null;
    return { col:Math.min(2,Math.floor((mx-l)/(this.gw/3))), row:Math.min(1,Math.floor((my-t)/(this.gh/2))) };
  }
  private zoneCx(c:number) { return this.G.l+(c+0.5)*(this.gw/3); }
  private zoneCy(r:number) { return this.G.t+(r+0.5)*(this.gh/2); }
  private kXForCol(c:number) { return this.G.l+(c+0.5)*(this.gw/3); }

  private shoot(col:number, row:number): void {
    const tx=this.zoneCx(col), ty=this.zoneCy(row);
    const kc=Math.floor(Math.random()*3), saved=kc===col;
    this.bSx=this.bx; this.bSy=this.by;
    this.bTx=tx; this.bTy=ty; this.bProg=0;
    this.kTarget=this.kXForCol(kc); this.kProg=0;
    this.kDir = kc===0?-1 : kc===2?1 : 0;
    this.pPhase='shooting';

    this.resultTimer = setTimeout(() => {
      this.zone.run(() => {
        if (saved) {
          this.saves++; this.results=[...this.results,'miss'];
          this.message='¡Atajada! 🧤'; this.msgClass='save-msg'; this.flashColor='#f97316';
        } else {
          this.goals++; this.results=[...this.results,'goal'];
          this.message='¡ G O L ! 🎉'; this.msgClass='goal-msg'; this.flashColor='#22c55e';
          this.spawnParticles(tx,ty);
        }
        this.flashAlpha=0.35; this.kicksLeft--; this.pPhase='result';

        this.resultTimer = setTimeout(() => {
          this.zone.run(() => {
            if (this.kicksLeft<=0) { this.pPhase='over'; this.endPenalties(); }
            else {
              this.resetForKick();
              const n=this.kicksLeft;
              this.message=`Dispara · ${n} tiro${n!==1?'s':''} restante${n!==1?'s':''}`;
              this.msgClass=''; this.pPhase='idle';
            }
          });
        }, 900);
      });
    }, 560);
  }

  private endPenalties(): void {
    const rows:[string,string][] = [
      ['🧤','¡El portero es un muro!'],['😅','El portero fue mejor hoy.'],
      ['💪','Sigue practicando.'],['⚽','¡Buen partido!'],
      ['⭐','¡Excelente penaltista!'],['🏆','¡Crack mundial! Perfecto.'],
    ];
    const [e,m]=rows[this.goals];
    this.message=`${e}  ${this.goals}/${this.TOTAL} goles — ${m}`;
    this.msgClass='over-msg'; this.showRestart=true;
  }

  private resetForKick(): void {
    this.bx=this.W/2; this.by=this.H-28; this.br=9;
    this.kx=this.W/2; this.kDir=0; this.flashAlpha=0; this.particles=[];
  }

  private spawnParticles(ox:number, oy:number): void {
    const cls=['#ffd700','#22c55e','#fff','#f97316'];
    for (let i=0;i<22;i++) {
      const a=Math.random()*Math.PI*2, s=40+Math.random()*70;
      this.particles.push({x:ox,y:oy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:2+Math.random()*3,life:1,color:cls[i%4]});
    }
  }

  // ── Juggles logic ─────────────────────────────────────────────────────────
  private initJuggles(): void {
    this.jPhase='waiting'; this.jScore=0;
    this.jBall={x:this.W/2,y:this.H*0.42,vx:0,vy:0,r:13};
    this.jBob=0; this.jFlash=null; this.jMile=null;
  }

  private handleJClick(mx:number, my:number): void {
    if (this.jPhase==='over')     { this.initJuggles(); return; }
    if (this.jPhase==='waiting')  {
      this.jPhase='playing';
      this.jBall.vy=-265; this.jBall.vx=(Math.random()-0.5)*60;
      this.jFlash={x:this.jBall.x,y:this.jBall.y,r:this.jBall.r,alpha:0.7};
      return;
    }
    if (this.jPhase==='playing') {
      if (Math.hypot(mx-this.jBall.x, my-this.jBall.y) < this.jBall.r+22)
        this.kickJuggle();
    }
  }

  private kickJuggle(): void {
    this.jScore++;
    this.jBall.vy = -(270 + Math.min(this.jScore*2, 70));
    const drift   = Math.min(30+this.jScore*1.5, 90);
    this.jBall.vx += (Math.random()-0.5)*drift*2;
    this.jBall.vx  = Math.max(-200, Math.min(200, this.jBall.vx));
    this.jFlash    = {x:this.jBall.x,y:this.jBall.y,r:this.jBall.r,alpha:0.8};
    if (this.jScore%10===0)
      this.jMile = {text:`${this.jScore} 🔥`,y:this.H/2-10,alpha:1};
  }

  // ── Loop ─────────────────────────────────────────────────────────────────
  private startLoop(): void {
    if (this.rafId!==null) return;
    this.lastTs=performance.now();
    const tick=(ts:number)=>{
      const dt=Math.min((ts-this.lastTs)/1000,0.05); this.lastTs=ts;
      this.update(dt); this.render();
      this.rafId=requestAnimationFrame(tick);
    };
    this.rafId=requestAnimationFrame(tick);
  }
  private stopLoop(): void {
    if (this.rafId!==null) { cancelAnimationFrame(this.rafId); this.rafId=null; }
  }

  // ── Update ────────────────────────────────────────────────────────────────
  private lerp(a:number,b:number,t:number){return a+(b-a)*t;}
  private eo(t:number){return t*(2-t);}

  private update(dt:number): void {
    if (this.activeTab==='penalties') this.updateP(dt);
    else                              this.updateJ(dt);
  }

  private updateP(dt:number): void {
    if (this.pPhase==='shooting') {
      this.bProg=Math.min(this.bProg+dt*1.8,1); this.kProg=Math.min(this.kProg+dt*3,1);
      const bt=this.eo(this.bProg);
      this.bx=this.lerp(this.bSx,this.bTx,bt); this.by=this.lerp(this.bSy,this.bTy,bt);
      this.br=this.lerp(9,5,bt);
      this.kx=this.lerp(this.W/2,this.kTarget,this.eo(this.kProg));
    }
    if (this.flashAlpha>0) this.flashAlpha=Math.max(0,this.flashAlpha-dt*1.8);
    this.particles=this.particles.filter(p=>p.life>0).map(p=>({
      ...p,x:p.x+p.vx*dt,y:p.y+p.vy*dt,vy:p.vy+160*dt,life:p.life-dt*1.8
    }));
  }

  private updateJ(dt:number): void {
    if (this.jPhase==='waiting') {
      this.jBob+=dt*2.2;
      this.jBall.y=this.H*0.42+Math.sin(this.jBob)*8;
      this.jBall.x=this.W/2; return;
    }
    if (this.jPhase!=='playing') return;

    const grav=400+Math.min(this.jScore*1.5,140);
    this.jBall.vy+=grav*dt;
    this.jBall.x+=this.jBall.vx*dt;
    this.jBall.y+=this.jBall.vy*dt;

    if (this.jBall.x-this.jBall.r<0)       { this.jBall.x=this.jBall.r;        this.jBall.vx=Math.abs(this.jBall.vx)*0.78; }
    if (this.jBall.x+this.jBall.r>this.W)  { this.jBall.x=this.W-this.jBall.r; this.jBall.vx=-Math.abs(this.jBall.vx)*0.78; }
    if (this.jBall.y-this.jBall.r<0)       { this.jBall.y=this.jBall.r;        this.jBall.vy=Math.abs(this.jBall.vy)*0.65; }

    if (this.jBall.y+this.jBall.r>=this.H) {
      this.jBall.y=this.H-this.jBall.r; this.jBall.vx=0; this.jBall.vy=0;
      this.jPhase='over';
      if (this.jScore>this.jBest) {
        this.jBest=this.jScore;
        localStorage.setItem('wc2026_best',String(this.jBest));
      }
      this.zone.run(()=>{});
    }

    if (this.jFlash) {
      this.jFlash.r+=38*dt; this.jFlash.alpha=Math.max(0,this.jFlash.alpha-dt*4.5);
      if (this.jFlash.alpha<=0) this.jFlash=null;
    }
    if (this.jMile) {
      this.jMile.y-=50*dt; this.jMile.alpha=Math.max(0,this.jMile.alpha-dt*1.4);
      if (this.jMile.alpha<=0) this.jMile=null;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  private render(): void {
    this.ctx.clearRect(0,0,this.W,this.H);
    if (this.activeTab==='penalties') this.renderP();
    else                              this.renderJ();
  }

  private renderP(): void {
    const c=this.ctx,W=this.W,H=this.H;
    this.drawField(c,W,H); this.drawNet(c); this.drawPosts(c); this.drawZones(c); this.drawKeeper(c,this.kx);
    const sh=this.lerp(1,0.06,this.eo(this.bProg));
    c.beginPath(); c.ellipse(this.bx,H-24,this.br*sh*1.6,this.br*sh*0.5,0,0,Math.PI*2);
    c.fillStyle='rgba(0,0,0,0.2)'; c.fill();
    this.drawBall(c,this.bx,this.by,this.br);
    if (this.flashAlpha>0) { c.globalAlpha=this.flashAlpha; c.fillStyle=this.flashColor; c.fillRect(0,0,W,H); c.globalAlpha=1; }
    for (const p of this.particles) { c.globalAlpha=Math.max(0,p.life); c.fillStyle=p.color; c.beginPath(); c.arc(p.x,p.y,p.r,0,Math.PI*2); c.fill(); }
    c.globalAlpha=1;
  }

  private renderJ(): void {
    const c=this.ctx,W=this.W,H=this.H;
    // Field
    const g=c.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#0d3320'); g.addColorStop(1,'#175225');
    c.fillStyle=g; c.fillRect(0,0,W,H);
    c.fillStyle='rgba(0,0,0,0.04)';
    for (let x=0;x<W;x+=30) c.fillRect(x,0,15,H);
    c.strokeStyle='rgba(255,255,255,0.18)'; c.lineWidth=2;
    c.beginPath(); c.moveTo(10,H-3); c.lineTo(W-10,H-3); c.stroke();

    // Background score number
    if (this.jPhase!=='waiting') {
      c.save(); c.font=`bold 72px 'Segoe UI',sans-serif`;
      c.textAlign='center'; c.textBaseline='middle';
      c.fillStyle='rgba(255,255,255,0.07)';
      c.fillText(String(this.jScore),W/2,H/2); c.restore();
    }

    // Kick flash ring
    if (this.jFlash) {
      c.save(); c.globalAlpha=this.jFlash.alpha;
      c.beginPath(); c.arc(this.jFlash.x,this.jFlash.y,this.jFlash.r,0,Math.PI*2);
      c.strokeStyle='#ffd700'; c.lineWidth=2.5; c.stroke(); c.restore();
    }

    // Dynamic ground shadow
    const hFrac=Math.max(0,1-(this.jBall.y/(H-this.jBall.r)));
    const sR=this.jBall.r*(0.15+hFrac*0.7);
    c.save(); c.globalAlpha=0.25-hFrac*0.12;
    c.beginPath(); c.ellipse(this.jBall.x,H-4,sR*1.6,sR*0.5,0,0,Math.PI*2);
    c.fillStyle='#000'; c.fill(); c.restore();

    this.drawBall(c,this.jBall.x,this.jBall.y,this.jBall.r);

    // Milestone float
    if (this.jMile) {
      c.save(); c.font=`bold 26px 'Segoe UI',sans-serif`;
      c.textAlign='center'; c.textBaseline='middle';
      c.globalAlpha=this.jMile.alpha; c.fillStyle='#ffd700';
      c.shadowColor='rgba(0,0,0,0.5)'; c.shadowBlur=4;
      c.fillText(this.jMile.text,W/2,this.jMile.y); c.restore();
    }

    // Waiting hint
    if (this.jPhase==='waiting') {
      const pulse=0.45+Math.abs(Math.sin(this.jBob*2.5))*0.45;
      c.save(); c.font=`11px 'Segoe UI',sans-serif`;
      c.textAlign='center'; c.textBaseline='bottom';
      c.globalAlpha=pulse; c.fillStyle='#fff';
      c.fillText('Toca el balón para jugar',W/2,H-8); c.restore();
    }

    // Game over overlay
    if (this.jPhase==='over') {
      c.fillStyle='rgba(1,14,32,0.72)'; c.fillRect(0,0,W,H);
      const isRec=this.jScore>0&&this.jScore>=this.jBest;
      c.save(); c.textAlign='center'; c.textBaseline='middle';
      c.font=`bold 54px 'Segoe UI',sans-serif`;
      c.fillStyle=isRec?'#ffd700':'#fff';
      if (isRec) { c.shadowColor='#ffd700'; c.shadowBlur=20; }
      c.fillText(String(this.jScore),W/2,H/2-22); c.shadowBlur=0;
      c.font=`500 11px 'Segoe UI',sans-serif`;
      c.fillStyle='rgba(255,255,255,0.5)';
      c.fillText(`toque${this.jScore!==1?'s':''}`,W/2,H/2+10);
      if (isRec&&this.jBest>0) {
        c.font=`bold 10px 'Segoe UI',sans-serif`; c.fillStyle='#ffd700';
        c.fillText('¡ N U E V O   R É C O R D !',W/2,H/2+28);
      }
      c.font=`10px 'Segoe UI',sans-serif`; c.fillStyle='rgba(255,255,255,0.28)';
      c.fillText('toca para reiniciar',W/2,H-10); c.restore();
    }
  }

  // ── Draw helpers ──────────────────────────────────────────────────────────
  private drawField(c:CanvasRenderingContext2D,W:number,H:number): void {
    const g=c.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#175225'); g.addColorStop(0.5,'#1e6830'); g.addColorStop(1,'#175225');
    c.fillStyle=g; c.fillRect(0,0,W,H);
    c.fillStyle='rgba(0,0,0,0.04)';
    for (let x=0;x<W;x+=30) c.fillRect(x,0,15,H);
    c.strokeStyle='rgba(255,255,255,0.12)'; c.lineWidth=1;
    c.strokeRect(20,5,W-40,132); c.strokeRect(78,5,140,60);
    c.beginPath(); c.arc(W/2,H-28,3,0,Math.PI*2);
    c.fillStyle='rgba(255,255,255,0.3)'; c.fill();
  }

  private drawNet(c:CanvasRenderingContext2D): void {
    const {l,t,r,b}=this.G;
    c.strokeStyle='rgba(255,255,255,0.07)'; c.lineWidth=0.5;
    for (let x=l;x<=r;x+=12) { c.beginPath(); c.moveTo(x,t); c.lineTo(x,b); c.stroke(); }
    for (let y=t;y<=b;y+=12) { c.beginPath(); c.moveTo(l,y); c.lineTo(r,y); c.stroke(); }
  }

  private drawPosts(c:CanvasRenderingContext2D): void {
    const {l,t,r,b}=this.G;
    c.strokeStyle='rgba(0,0,0,0.3)'; c.lineWidth=5; c.lineJoin='round';
    c.beginPath(); c.moveTo(l+2,b+2); c.lineTo(l+2,t+2); c.lineTo(r+2,t+2); c.lineTo(r+2,b+2); c.stroke();
    c.strokeStyle='#fff'; c.lineWidth=4;
    c.beginPath(); c.moveTo(l,b); c.lineTo(l,t); c.lineTo(r,t); c.lineTo(r,b); c.stroke();
  }

  private drawZones(c:CanvasRenderingContext2D): void {
    if (this.pPhase!=='idle') return;
    const zW=this.gw/3, zH=this.gh/2;
    for (let col=0;col<3;col++) for (let row=0;row<2;row++) {
      const hov=col===this.hovCol&&row===this.hovRow;
      const zx=this.G.l+col*zW, zy=this.G.t+row*zH;
      c.fillStyle=hov?'rgba(255,215,0,0.18)':'rgba(255,255,255,0.02)';
      c.fillRect(zx+1,zy+1,zW-2,zH-2);
      if (hov) {
        c.strokeStyle='rgba(255,215,0,0.55)'; c.lineWidth=1.5;
        c.strokeRect(zx+1,zy+1,zW-2,zH-2);
        c.beginPath(); c.arc(zx+zW/2,zy+zH/2,6,0,Math.PI*2);
        c.fillStyle='rgba(255,215,0,0.6)'; c.fill();
      }
    }
  }

  private drawKeeper(c:CanvasRenderingContext2D, x:number): void {
    const ky=this.G.t+2;
    c.fillStyle='#f59e0b'; c.fillRect(x-10,ky+10,20,26);
    c.fillStyle='#fde68a'; c.beginPath(); c.arc(x,ky+6,9,0,Math.PI*2); c.fill();
    c.fillStyle='#92400e'; c.beginPath(); c.arc(x,ky+2,9,Math.PI,0); c.fill();
    if (this.kDir!==0) {
      const ax=x+this.kDir*23;
      c.fillStyle='#f59e0b'; c.beginPath(); c.ellipse(ax,ky+15,14,7,this.kDir*0.3,0,Math.PI*2); c.fill();
      c.fillStyle='#16a34a'; c.beginPath(); c.arc(ax+this.kDir*12,ky+15,7,0,Math.PI*2); c.fill();
    } else {
      c.fillStyle='#f59e0b';
      c.fillRect(x-21,ky+12,11,14); c.fillRect(x+10,ky+12,11,14);
      c.fillStyle='#16a34a';
      c.fillRect(x-23,ky+23,11,7); c.fillRect(x+12,ky+23,11,7);
    }
    c.fillStyle='#1d4ed8'; c.fillRect(x-10,ky+30,20,10);
  }

  private drawBall(c:CanvasRenderingContext2D, x:number, y:number, r:number): void {
    const g=c.createRadialGradient(x-r*0.3,y-r*0.3,r*0.05,x,y,r);
    g.addColorStop(0,'#fff'); g.addColorStop(0.5,'#ddd'); g.addColorStop(1,'#888');
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fillStyle=g; c.fill();
    c.strokeStyle='rgba(0,0,0,0.18)'; c.lineWidth=0.7;
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.stroke();
    for (let i=0;i<5;i++) {
      const a=(Math.PI*2/5)*i-Math.PI/2;
      c.beginPath(); c.moveTo(x,y); c.lineTo(x+Math.cos(a)*r*0.6,y+Math.sin(a)*r*0.6); c.stroke();
    }
  }
}
