import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  CajaTransferenciaBandeja, CajaTransferenciaPendiente, CajaTransferenciaCandidatoMovimiento,
} from '../../../../core/models/caja-transferencia.model';

type Seccion = 'pendientes' | 'huerfanas';

@Component({
  standalone: false,
  selector: 'app-transferencias-caja-panel',
  templateUrl: './transferencias-caja-panel.component.html',
  styleUrls: ['./transferencias-caja-panel.component.css'],
})
export class TransferenciasCajaPanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  bandeja: CajaTransferenciaBandeja | null = null;
  loading = false;
  error: string | null = null;
  seccion: Seccion = 'pendientes';

  // _id de la transferencia con una confirmación en curso — deshabilita SOLO sus propios
  // botones (evita doble-click sobre el mismo grupo mientras el resto de la bandeja sigue usable).
  confirmandoId: string | null = null;
  confirmError: string | null = null;

  // Sincronización manual (banks:admin) — pedido explícito del usuario 2026-09-01: elegir
  // fechaDesde/fechaHasta a mano en vez de esperar al cron diario.
  syncFechaDesde = '';
  syncFechaHasta = '';
  syncing        = false;
  syncError:   string | null = null;
  syncResultado: { sincronizadas: number; descartadas: number } | null = null;

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  // Bug real (reportado por el usuario): con el guard "!this.bandeja" original, reabrir el
  // panel en la MISMA sesión (sin recargar la página) mostraba la bandeja vieja, cacheada
  // desde la primera apertura — un movimiento recién importado (o una transferencia recién
  // sincronizada) no aparecía como candidato hasta refrescar el navegador. Mismo criterio que
  // report-panel/rules-panel: recargar SIEMPRE que el panel se vuelve a mostrar.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._cargar();
  }

  private _cargar(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.getTransferenciasCajaBandeja().subscribe({
      next: (bandeja) => { this.bandeja = bandeja; this.loading = false; },
      error: (err) => {
        this.error   = err?.error?.error || 'Error al cargar las transferencias entre cajas';
        this.loading = false;
      },
    });
  }

  recargar(): void {
    this.bandeja = null;
    this._cargar();
  }

  cerrar(): void {
    this.closed.emit();
  }

  cambiarSeccion(s: Seccion): void {
    this.seccion = s;
  }

  sumaGrupo(grupo: CajaTransferenciaCandidatoMovimiento[]): number {
    return grupo.reduce((acc, m) => acc + (m.deposito ?? 0), 0);
  }

  confirmar(item: CajaTransferenciaPendiente, grupo: CajaTransferenciaCandidatoMovimiento[]): void {
    if (this.confirmandoId) return;
    this.confirmandoId = item.transferencia._id;
    this.confirmError  = null;

    this.bankService.confirmarTransferenciaCajaMatch(
      item.transferencia._id, grupo.map(m => m._id),
    ).subscribe({
      next: () => {
        this.confirmandoId = null;
        // Quita esta transferencia de "pendientes" — ya no aplica sin recargar toda la
        // bandeja (los candidatos de las demás no cambiaron).
        if (this.bandeja) {
          this.bandeja = {
            ...this.bandeja,
            pendientes: this.bandeja.pendientes.filter(p => p.transferencia._id !== item.transferencia._id),
          };
        }
      },
      error: (err) => {
        this.confirmandoId = null;
        this.confirmError  = err?.error?.error || 'Error al confirmar el match';
      },
    });
  }

  sincronizarManual(): void {
    if (this.syncing || !this.syncFechaDesde || !this.syncFechaHasta) return;
    this.syncing        = true;
    this.syncError      = null;
    this.syncResultado  = null;

    this.bankService.sincronizarTransferenciasCajaManual(this.syncFechaDesde, this.syncFechaHasta).subscribe({
      next: (resultado) => {
        this.syncing       = false;
        this.syncResultado = resultado;
        this.recargar();
      },
      error: (err) => {
        this.syncing   = false;
        this.syncError = err?.error?.error || 'Error al sincronizar el rango elegido';
      },
    });
  }

}
