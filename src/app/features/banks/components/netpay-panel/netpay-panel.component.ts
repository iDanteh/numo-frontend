import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  NetpayConsultaResultado, NetpayBandejaResultado, NetpayMatch, NetpayEstatusMatch,
  NetpayCandidatoMovimiento, NetpayStatusFiltro,
} from '../../../../core/models/netpay-transaccion.model';

// Los 6 estados válidos de un bucket NetpayMatch (ver design.md "Reconciliation State
// Model") — usados tanto para los chips de filtro como para las etiquetas de la tabla de
// auditoría. Orden: automáticos primero, luego pendientes/discrepancia, luego terminales.
const ESTADOS_BANDEJA: NetpayEstatusMatch[] = [
  'confirmado_automatico', 'pendiente_por_marca', 'discrepancia',
  'resuelto_por_reporte', 'resuelto_manual', 'rechazado',
];

const MAX_MOVIMIENTOS_RESOLVER = 2;

@Component({
  standalone: false,
  selector: 'app-netpay-panel',
  templateUrl: './netpay-panel.component.html',
  styleUrls: ['./netpay-panel.component.css'],
})
export class NetpayPanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  // Pestañas: "Consulta" (Fase 1, sin cambios), "Matching" (bandeja Netpay↔BBVA, ver
  // netpay-evaluacion.service.js) y "Reportes" (consolidación 2026-09-29, pedido explícito
  // del usuario: netpay-reporte-panel deja de ser un sidebar propio en banks.component y se
  // anida acá como 3ra pestaña — mismo componente, sin reescribir su lógica interna).
  // Consulta/Matching comparten dateFrom/dateTo/terminalID (responseCode/almacenes son
  // exclusivos de Consulta); Reportes tiene sus propios filtros internos (chips de estatus,
  // dropzone) — no comparte NADA de los filtros de arriba (ver .np-filtros en el HTML).
  tab: 'consulta' | 'matching' | 'reportes' = 'consulta';

  // Filtros manuales (Fase 1) — el usuario todavía está diseñando el resto del catálogo
  // de parámetros de Kore, por ahora estos 6. terminalID (2026-09-15): primer paso
  // hacia el matching contra BankMovement. status (2026-09-21): filtra por el estatus
  // de Kore tal cual viene en NetpayTransaccion.status.
  responseCode = '';
  almacenes    = '';
  terminalID   = '';
  status: NetpayStatusFiltro | '' = '';
  // Bindeados a <app-date-range-popover> — YYYY-MM-DD, se mandan pelados al backend (ver
  // buscar()); es netpay-transacciones.service.js quien arma el instante UTC real de
  // inicio/fin de día en hora MX.
  dateFrom = '';
  dateTo   = '';

  resultado: NetpayConsultaResultado | null = null;
  loading = false;
  error: string | null = null;

  // ── Matching (bandeja Netpay↔BBVA, netpay-matching-v2) — GET /netpay/bandeja YA NO
  // llama a Kore: solo lee buckets NetpayMatch ya evaluados por POST .../evaluar. El
  // candidate picker manual (confirmar/descartarManual) fue reemplazado por Resolver/
  // Rechazar sobre un bucket 'discrepancia' identificado por :id.
  bandeja: NetpayBandejaResultado | null = null;
  bandejaLoading = false;
  bandejaError: string | null = null;
  estatusFiltro: NetpayEstatusMatch | '' = '';
  readonly estados = ESTADOS_BANDEJA;

  evaluando = false;
  evaluarError: string | null = null;

  // ── Resolver — cierra un bucket 'discrepancia' con justificación humana obligatoria,
  // opcionalmente vinculando 0-2 movimientos elegidos desde /candidatos (preserva la
  // capacidad de split manual de v1). NUNCA produce 'confirmado_automatico'.
  resolviendoId: string | null = null;
  resolverJustificacion = '';
  resolverCandidatos: NetpayCandidatoMovimiento[] = [];
  resolverCandidatosLoading = false;
  resolverCandidatosError: string | null = null;
  resolverSeleccion = new Set<string>();
  resolverEnviando = false;
  resolverError: string | null = null;

  // ── Rechazar — permitido desde cualquier estado activo (spec.md "any active state ->
  // rechazado"), nunca vincula nada contra Kore/CxC.
  rechazandoId: string | null = null;
  rechazarMotivo = '';
  rechazarEnviando = false;
  rechazarError: string | null = null;

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
    this.estatusFiltro = '';
    this.evaluarError = null;
    this._cerrarResolverEstado();
    this._cerrarRechazarEstado();
  }

  cambiarTab(tab: 'consulta' | 'matching' | 'reportes'): void {
    this.tab = tab;
  }

  // Un solo botón "Buscar" en el head — dispara la consulta de la pestaña activa. Reportes
  // no tiene botón "Buscar" propio (usa su propia carga/filtros internos), así que nunca
  // llega acá con tab==='reportes'.
  buscar(): void {
    if (this.tab === 'consulta') this._buscarTransacciones();
    else if (this.tab === 'matching') this._buscarBandeja();
  }

  private _buscarTransacciones(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.consultarNetpayTransacciones(
      this.responseCode.trim() || undefined,
      this.almacenes.trim() || undefined,
      this.dateFrom || undefined,
      this.dateTo || undefined,
      this.terminalID.trim() || undefined,
      this.status || undefined,
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
      this.dateFrom || undefined,
      this.dateTo || undefined,
      this.terminalID.trim() || undefined,
      this.estatusFiltro || undefined,
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

  // ── Chips de filtro por estatus (6 estados + "Todos") ───────────────────────────────
  cambiarFiltroEstatus(estatus: NetpayEstatusMatch | ''): void {
    this.estatusFiltro = estatus;
    this._buscarBandeja();
  }

  // ── Evaluar — POST /netpay/bandeja/evaluar: persiste una decisión (incluida
  // discrepancia) por cada bucket todavía reevaluable, nunca side effects en el GET.
  evaluar(): void {
    if (this.evaluando) return;
    this.evaluando    = true;
    this.evaluarError = null;
    this.bankService.evaluarNetpayBandeja({
      dateFrom: this.dateFrom || undefined,
      dateTo: this.dateTo || undefined,
      terminalID: this.terminalID.trim() || undefined,
    }).subscribe({
      next: () => {
        this.evaluando = false;
        this._buscarBandeja();
      },
      error: (err) => {
        this.evaluando    = false;
        this.evaluarError = err?.error?.error || 'Error al evaluar la bandeja Netpay';
      },
    });
  }

  // ── Resolver ─────────────────────────────────────────────────────────────────────────
  abrirResolver(bucket: NetpayMatch): void {
    this.resolviendoId          = bucket._id;
    this.resolverJustificacion  = '';
    this.resolverSeleccion      = new Set<string>();
    this.resolverError          = null;
    this._cargarResolverCandidatos(bucket._id);
  }

  private _cargarResolverCandidatos(id: string): void {
    this.resolverCandidatosLoading = true;
    this.resolverCandidatosError   = null;
    this.bankService.candidatosNetpayMatch(id).subscribe({
      next: (res) => {
        this.resolverCandidatos        = res.candidatos;
        this.resolverCandidatosLoading = false;
      },
      error: (err) => {
        this.resolverCandidatosError   = err?.error?.error || 'Error al buscar candidatos para este bucket';
        this.resolverCandidatosLoading = false;
      },
    });
  }

  cerrarResolver(): void {
    this._cerrarResolverEstado();
  }

  private _cerrarResolverEstado(): void {
    this.resolviendoId             = null;
    this.resolverJustificacion     = '';
    this.resolverCandidatos        = [];
    this.resolverCandidatosLoading = false;
    this.resolverCandidatosError   = null;
    this.resolverSeleccion         = new Set<string>();
    this.resolverEnviando          = false;
    this.resolverError             = null;
  }

  puedeResolver(): boolean {
    return this.resolverJustificacion.trim().length > 0 && !this.resolverEnviando;
  }

  // A lo sumo 2 movimientos (design.md "Resolve movement cardinality") — preserva la
  // capacidad de split manual de v1. Un 3er intento se ignora (no reemplaza selección).
  toggleSeleccionCandidato(movementId: string): void {
    if (this.resolverSeleccion.has(movementId)) {
      this.resolverSeleccion.delete(movementId);
      return;
    }
    if (this.resolverSeleccion.size >= MAX_MOVIMIENTOS_RESOLVER) return;
    this.resolverSeleccion.add(movementId);
  }

  confirmarResolver(bucket: NetpayMatch): void {
    if (!this.puedeResolver()) return;
    this.resolverEnviando = true;
    this.resolverError    = null;
    this.bankService.resolverNetpayMatch(bucket._id, {
      justificacion: this.resolverJustificacion.trim(),
      movementIds: [...this.resolverSeleccion],
    }).subscribe({
      next: (res) => {
        this._reemplazarBucket(res.bucket);
        this._cerrarResolverEstado();
      },
      error: (err) => {
        this.resolverEnviando = false;
        this.resolverError    = err?.error?.error || 'Error al resolver este bucket';
      },
    });
  }

  // ── Rechazar ─────────────────────────────────────────────────────────────────────────
  abrirRechazar(bucket: NetpayMatch): void {
    this.rechazandoId  = bucket._id;
    this.rechazarMotivo = '';
    this.rechazarError  = null;
  }

  cerrarRechazar(): void {
    this._cerrarRechazarEstado();
  }

  private _cerrarRechazarEstado(): void {
    this.rechazandoId    = null;
    this.rechazarMotivo  = '';
    this.rechazarEnviando = false;
    this.rechazarError   = null;
  }

  confirmarRechazar(bucket: NetpayMatch): void {
    if (this.rechazarEnviando) return;
    this.rechazarEnviando = true;
    this.rechazarError    = null;
    this.bankService.rechazarNetpayMatch(bucket._id, { motivo: this.rechazarMotivo.trim() || undefined }).subscribe({
      next: (res) => {
        this._reemplazarBucket(res.bucket);
        this._cerrarRechazarEstado();
      },
      error: (err) => {
        this.rechazarEnviando = false;
        this.rechazarError    = err?.error?.error || 'Error al rechazar este bucket';
      },
    });
  }

  private _reemplazarBucket(actualizado: NetpayMatch): void {
    if (!this.bandeja) return;
    this.bandeja = {
      buckets: this.bandeja.buckets.map(b => (b._id === actualizado._id ? actualizado : b)),
    };
  }

  // ── Presentación (tabla de auditoría) ───────────────────────────────────────────────
  quienCuando(bucket: NetpayMatch): { nombre: string | null; en: string | null } | null {
    if (bucket.estatusMatch === 'confirmado_automatico' && bucket.confirmadoPor) {
      return { nombre: bucket.confirmadoPor.nombre, en: bucket.confirmadoEn };
    }
    if (bucket.estatusMatch === 'resuelto_manual' && bucket.resueltoManualPor) {
      return { nombre: bucket.resueltoManualPor.nombre, en: bucket.resueltoManualEn };
    }
    if (bucket.estatusMatch === 'rechazado' && bucket.descartadoManualmentePor) {
      return { nombre: bucket.descartadoManualmentePor.nombre, en: bucket.descartadoManualmenteEn };
    }
    return null;
  }
}
