import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SatFacade } from '../../../core/facades';
import { SatCredencialesEstado } from '../../../core/models/sat.model';

const SAT_SYNC_HOUR_SECONDS = 1 * 3600; // 01:00:00 AM hora México

@Component({
  standalone: false,
  selector: 'app-cierre-dia',
  templateUrl: './cierre-dia.component.html',
})
export class CierreDiaComponent implements OnInit, OnDestroy {
  rfc = '';
  cerFile: File | null = null;
  keyFile: File | null = null;
  password = '';
  showPassword = false;

  loading = false;
  success = '';
  error = '';

  estadoCredenciales: SatCredencialesEstado | null = null;
  countdownStr = '--:--:--';

  private destroy$ = new Subject<void>();
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private satFacade: SatFacade) {}

  ngOnInit(): void {
    this.updateCountdown();
    this.countdownInterval = setInterval(() => this.updateCountdown(), 1000);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.countdownInterval) clearInterval(this.countdownInterval);
  }

  private updateCountdown(): void {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
    const s = parseInt(parts.find(p => p.type === 'second')?.value ?? '0');

    const elapsed = h * 3600 + m * 60 + s;
    const remaining = elapsed < SAT_SYNC_HOUR_SECONDS
      ? SAT_SYNC_HOUR_SECONDS - elapsed
      : 24 * 3600 - elapsed + SAT_SYNC_HOUR_SECONDS;

    const rh = Math.floor(remaining / 3600);
    const rm = Math.floor((remaining % 3600) / 60);
    const rs = remaining % 60;
    this.countdownStr = `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}:${String(rs).padStart(2, '0')}`;
  }

  verificarEstado(): void {
    const rfc = this.rfc.trim().toUpperCase();
    if (!rfc) return;
    this.satFacade.estadoCredenciales(rfc).pipe(takeUntil(this.destroy$)).subscribe({
      next: (estado) => { this.estadoCredenciales = estado; },
      error: () => { this.estadoCredenciales = null; },
    });
  }

  registrar(): void {
    this.success = '';
    this.error = '';

    const rfc = this.rfc.trim().toUpperCase();
    if (!rfc || !this.cerFile || !this.keyFile || !this.password) {
      this.error = 'Todos los campos son obligatorios';
      return;
    }

    this.loading = true;
    this.satFacade.registrarCredenciales(rfc, this.cerFile, this.keyFile, this.password).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.loading = false;
        this.success = `Credenciales registradas. Válidas por ${Math.round(res.ttlSegundos / 3600)} horas.`;
        this.password = '';
        this.cerFile = null;
        this.keyFile = null;
        this.estadoCredenciales = {
          rfc,
          tieneCredenciales: true,
          ttlSegundos: res.ttlSegundos,
          expiraEn: res.expiraEn,
        };
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error ?? 'Error al registrar credenciales';
      },
    });
  }

  ttlHoras(ttl: number | null): string {
    if (!ttl) return '—';
    const h = Math.floor(ttl / 3600);
    const m = Math.floor((ttl % 3600) / 60);
    return `${h}h ${m}m`;
  }
}
