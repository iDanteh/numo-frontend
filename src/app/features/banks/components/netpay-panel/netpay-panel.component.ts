import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  NetpayConsultaResultado, NetpayBandejaResultado, NetpayMatchPendiente, NetpayCandidatoMovimiento,
} from '../../../../core/models/netpay-transaccion.model';

@Component({
  standalone: false,
  selector: 'app-netpay-panel',
  templateUrl: './netpay-panel.component.html',
  styleUrls: ['./netpay-panel.component.css'],
})
export class NetpayPanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  // Pestañas: "Consulta" (Fase 1, sin cambios) y "Matching" (bandeja Netpay↔BBVA, ver
  // netpay-match.service.js) — comparten dateFrom/dateTo/terminalID, responseCode/almacenes
  // son exclusivos de Consulta (no aplican a la bandeja).
  tab: 'consulta' | 'matching' = 'consulta';

  // Filtros manuales (Fase 1) — el usuario todavía está diseñando el resto del catálogo
  // de parámetros de Kore, por ahora estos 5. terminalID (2026-09-15): primer paso
  // hacia el matching contra BankMovement.
  responseCode = '';
  almacenes    = '';
  terminalID   = '';
  // Bindeados a <app-date-range-popover> (2026-09-08: antes 2 <input type="date">
  // sueltos) — YYYY-MM-DD, se completan a inicio/fin de día en ISO (T00:00:00Z/
  // T23:59:59Z) recién al armar la consulta, ver buscar().
  dateFrom = '';
  dateTo   = '';

  resultado: NetpayConsultaResultado | null = null;
  loading = false;
  error: string | null = null;

  // ── Matching (bandeja Netpay↔BBVA) — TODO EN VIVO, sin sync/cron: cada "Buscar" en esta
  // pestaña recalcula contra Kore. Mismo patrón de interacción que transferencias-caja-panel
  // (candidatos por grupo, ambigüedad con selección por radio, descarte manual en 2 pasos),
  // adaptado a que acá un grupo se identifica por terminalID+día en vez de un _id propio.
  bandeja: NetpayBandejaResultado | null = null;
  bandejaLoading = false;
  bandejaError: string | null = null;

  confirmandoClave: string | null = null;
  confirmError: string | null = null;
  descartandoClave: string | null = null;
  descartarError: string | null = null;

  private _expandidas = new Set<string>();
  private _seleccionAmbiguo = new Map<string, number>();
  private _pidiendoConfirmacionDescarte = new Set<string>();

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  // Mismo criterio que transferencias-caja-panel: recargar SIEMPRE que el panel se
  // vuelve a mostrar, sin guardar estado cacheado de una apertura anterior — nunca un
  // guard tipo "if (!this.resultado)".
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._reset();
  }

  private _reset(): void {
    this.resultado = null;
    this.error     = null;
    this.bandeja      = null;
    this.bandejaError = null;
    this._expandidas.clear();
    this._seleccionAmbiguo.clear();
    this._pidiendoConfirmacionDescarte.clear();
  }

  cambiarTab(tab: 'consulta' | 'matching'): void {
    this.tab = tab;
  }

  // Un solo botón "Buscar" en el head — dispara la consulta de la pestaña activa.
  buscar(): void {
    if (this.tab === 'consulta') this._buscarTransacciones();
    else this._buscarBandeja();
  }

  private _buscarTransacciones(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.consultarNetpayTransacciones(
      this.responseCode.trim() || undefined,
      this.almacenes.trim() || undefined,
      this.dateFrom ? `${this.dateFrom}T00:00:00Z` : undefined,
      this.dateTo ? `${this.dateTo}T23:59:59Z` : undefined,
      this.terminalID.trim() || undefined,
    ).subscribe({
      next: (resultado) => { this.resultado = resultado; this.loading = false; },
      error: (err) => {
        this.error   = err?.error?.error || 'Error al consultar transacciones Netpay';
        this.loading = false;
      },
    });
  }

  private _buscarBandeja(): void {
    this.bandejaLoading = true;
    this.bandejaError   = null;
    this.bankService.obtenerNetpayBandeja(
      this.dateFrom ? `${this.dateFrom}T00:00:00Z` : undefined,
      this.dateTo ? `${this.dateTo}T23:59:59Z` : undefined,
      this.terminalID.trim() || undefined,
    ).subscribe({
      next: (bandeja) => { this.bandeja = bandeja; this.bandejaLoading = false; },
      error: (err) => {
        this.bandejaError   = err?.error?.error || 'Error al cargar la bandeja de matching Netpay';
        this.bandejaLoading = false;
      },
    });
  }

  cerrar(): void {
    this.closed.emit();
  }

  // Clave estable de un grupo (terminalID+día, ver netpay-match.service.js#_claveGrupo) —
  // un grupo pendiente no tiene ningún _id propio en Mongo, así que esta clave hace las
  // veces de identificador para el estado de UI (expandido/seleccionado/confirmando).
  clave(item: NetpayMatchPendiente): string {
    return `${item.grupo.terminalID}|${item.grupo.dia}`;
  }

  sumaGrupo(grupo: NetpayCandidatoMovimiento[]): number {
    return grupo.reduce((acc, m) => acc + (m.deposito ?? 0), 0);
  }

  estaExpandido(clave: string): boolean {
    return this._expandidas.has(clave);
  }

  toggleExpandido(clave: string): void {
    if (this._expandidas.has(clave)) this._expandidas.delete(clave);
    else this._expandidas.add(clave);
  }

  seleccionActiva(clave: string): number | null {
    return this._seleccionAmbiguo.get(clave) ?? null;
  }

  seleccionar(clave: string, index: number): void {
    this._seleccionAmbiguo.set(clave, index);
  }

  confirmarSeleccionActiva(item: NetpayMatchPendiente): void {
    const idx = this.seleccionActiva(this.clave(item));
    if (idx === null) return;
    this.confirmar(item, item.candidatos[idx]);
  }

  confirmar(item: NetpayMatchPendiente, grupo: NetpayCandidatoMovimiento[]): void {
    const clave = this.clave(item);
    if (this.confirmandoClave) return;
    this.confirmandoClave = clave;
    this.confirmError     = null;

    this.bankService.confirmarNetpayMatch({
      terminalID: item.grupo.terminalID, almacen: item.grupo.almacen, dia: item.grupo.dia,
      movementIds: grupo.map(m => m._id),
    }).subscribe({
      next: () => {
        this.confirmandoClave = null;
        if (this.bandeja) {
          this.bandeja = { ...this.bandeja, pendientes: this.bandeja.pendientes.filter(p => this.clave(p) !== clave) };
        }
        this._expandidas.delete(clave);
        this._seleccionAmbiguo.delete(clave);
      },
      error: (err) => {
        this.confirmandoClave = null;
        this.confirmError     = err?.error?.error || 'Error al confirmar el match';
      },
    });
  }

  pideConfirmacionDescarte(clave: string): boolean {
    return this._pidiendoConfirmacionDescarte.has(clave);
  }

  togglePedirConfirmacionDescarte(clave: string): void {
    if (this._pidiendoConfirmacionDescarte.has(clave)) this._pidiendoConfirmacionDescarte.delete(clave);
    else this._pidiendoConfirmacionDescarte.add(clave);
  }

  descartarManual(item: NetpayMatchPendiente): void {
    const clave = this.clave(item);
    if (this.descartandoClave) return;
    this.descartandoClave = clave;
    this.descartarError   = null;

    this.bankService.descartarNetpayMatch({
      terminalID: item.grupo.terminalID, almacen: item.grupo.almacen, dia: item.grupo.dia,
    }).subscribe({
      next: () => {
        this.descartandoClave = null;
        if (this.bandeja) {
          this.bandeja = { ...this.bandeja, pendientes: this.bandeja.pendientes.filter(p => this.clave(p) !== clave) };
        }
        this._pidiendoConfirmacionDescarte.delete(clave);
      },
      error: (err) => {
        this.descartandoClave = null;
        this.descartarError   = err?.error?.error || 'Error al descartar el grupo manualmente';
      },
    });
  }
}
