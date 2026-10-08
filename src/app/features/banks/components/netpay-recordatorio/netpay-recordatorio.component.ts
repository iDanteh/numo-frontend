import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SocketService } from '../../../../core/services/socket.service';
import { NetpayUltimaCarga } from '../../../../core/models/netpay-reporte.model';

// netpay-recordatorio — pedido explícito del usuario (2026-10-08): recordarle a contabilidad
// que cargue el reporte de Netpay, de lunes a viernes, mientras no se haya cargado el de HOY.
// Vive dentro de banks.component (no global) — decisión explícita del usuario. México es
// UTC-6 fijo (sin DST desde 2022, mismo criterio que _inicioDeHoy()/_medianocheMx() del
// backend) — Intl con timeZone resuelve esto sin librería de zonas horarias.
const ZONA_MX = 'America/Mexico_City';
const DIAS_HABILES = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

// Exportadas para tests unitarios directos (fecha de referencia fija, sin depender del día
// real en que corra la suite).
export function _hoyMX(ref: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_MX }).format(ref);
}

export function _esDiaHabilMX(ref: Date): boolean {
  const dia = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_MX, weekday: 'short' }).format(ref);
  return DIAS_HABILES.has(dia);
}

type EstadoRecordatorio = 'oculto' | 'pendiente' | 'confirmado';

@Component({
  standalone: false,
  selector: 'app-netpay-recordatorio',
  templateUrl: './netpay-recordatorio.component.html',
  styleUrls: ['./netpay-recordatorio.component.css'],
})
export class NetpayRecordatorioComponent implements OnInit, OnDestroy {
  // banks.component decide qué hacer (abrir el panel de Netpay) — este componente no conoce
  // ni le importa cómo se abre, solo avisa.
  @Output() abrirNetpay = new EventEmitter<void>();

  estado: EstadoRecordatorio = 'oculto';
  saliendo = false;
  nombrePersona: string | null = null;

  private _destroy$ = new Subject<void>();
  private _autoOcultarTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private bankService:   BankService,
    private auth:          AuthService,
    private socketService: SocketService,
  ) {}

  ngOnInit(): void {
    if (!this._aplica()) return;

    // Best-effort: un fallo acá nunca debe mostrar nada roto — simplemente no aparece el
    // recordatorio (igual criterio que el mensaje "último reporte cargado" del propio panel).
    this.bankService.obtenerUltimaCargaNetpay().subscribe({
      next:  (res) => this._evaluar(res.ultimaCarga),
      error: () => { /* silencioso a propósito */ },
    });

    // En vivo: si YA está mostrando el recordatorio y otro contador carga el reporte mientras
    // este usuario sigue en Bancos, se entera sin recargar la página.
    this.socketService.netpayReporteCargado$.pipe(takeUntil(this._destroy$)).subscribe((evt) => {
      if (!this._aplica()) return;
      this._mostrarConfirmado(evt.cargadoPor?.nombre ?? null);
    });
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
    if (this._autoOcultarTimeout) clearTimeout(this._autoOcultarTimeout);
  }

  // Método (no inline) para poder mockear "ahora" en tests sin depender del día real en que
  // corra la suite — ver netpay-recordatorio.component.spec.ts.
  _ahora(): Date {
    return new Date();
  }

  private _aplica(): boolean {
    return this.auth.hasRole('contabilidad') && _esDiaHabilMX(this._ahora());
  }

  private _evaluar(ultimaCarga: NetpayUltimaCarga | null): void {
    if (!ultimaCarga?.cargadoEn) {
      this.estado = 'pendiente';
      return;
    }
    const fechaCargaMX = _hoyMX(new Date(ultimaCarga.cargadoEn));
    if (fechaCargaMX === _hoyMX(this._ahora())) {
      this._mostrarConfirmado(ultimaCarga.cargadoPor?.nombre ?? null);
    } else {
      this.estado = 'pendiente';
    }
  }

  private _mostrarConfirmado(nombre: string | null): void {
    this.estado = 'confirmado';
    this.saliendo = false;
    this.nombrePersona = nombre;
    // Es una buena noticia transitoria, no una acción pendiente — se retira sola; igual se
    // puede cerrar a mano antes con el botón ✕.
    if (this._autoOcultarTimeout) clearTimeout(this._autoOcultarTimeout);
    this._autoOcultarTimeout = setTimeout(() => this.cerrar(), 10000);
  }

  irANetpay(): void {
    this.abrirNetpay.emit();
    this.cerrar();
  }

  cerrar(): void {
    if (this.saliendo || this.estado === 'oculto') return;
    this.saliendo = true;
    setTimeout(() => {
      this.estado = 'oculto';
      this.saliendo = false;
    }, 250);
  }
}
