import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyAdjustmentReason, LoyaltyCard, LoyaltyKoreNivel,
  LoyaltyMovimientoTipo, LoyaltyLedgerExportRow, LoyaltyLedgerExportFilter,
  LoyaltyCardsExportFilter,
} from '../../../core/services/loyalty.service';
import { insertarLogoExcel } from '../../../shared/utils/excel-logo.util';

type ReportTipo =
  | 'movimientos'
  | 'tarjetas'
  | 'transacciones-tarjeta'
  | 'saldos-totales'
  | 'saldo-cero'
  | 'puntos-vencidos'
  | 'por-centro';
type TriValor = '' | 'true' | 'false';

const REASON_CLAVE_CONGELAMIENTO = 'congelamiento_inactividad';

/** Una fila agregada del reporte "Transacciones por tarjeta" (2026-11-03) — construida 100% del
 *  lado del cliente agrupando la respuesta plana de GET /loyalty/ledger/export por teléfono (la
 *  identidad real de la tarjeta, D1). No existe endpoint propio para esto. */
interface TransaccionesPorTarjetaRow {
  telefono: string;
  nombre: string;
  movimientos: number;
  puntosAcumulados: number;
  puntosCanjeados: number;
  puntosAjustados: number;
  saldoActual: number;
}

/** Una fila agregada del reporte "Movimientos por centro" (2026-11-20) — igual criterio que
 *  TransaccionesPorTarjetaRow: construida 100% del lado del cliente agrupando la respuesta plana
 *  de GET /loyalty/ledger/export por centro de costo. Sin endpoint propio. */
interface PorCentroRow {
  centro: string;
  sucursal: string;
  movimientos: number;
  clientesUnicos: number;
  puntosAcumulados: number;
  puntosCanjeados: number;
  puntosAjustados: number;
}

/**
 * Panel de Reportes de Lealtad (2026-10-29, ampliado 2026-11-03) — sidebar deslizable con selector
 * de tipo de reporte y exportación 100% frontend a Excel vía exceljs dinámico, mismo patrón que
 * _generarExcel() en clientes-pendientes.component.ts. Reusa el markup/clases genéricas de Bancos
 * (.report-sidebar, .fgroup, .chips, .digest, etc. — ver styles.css) con el acento ámbar propio de
 * Lealtad sobrescrito solo dentro de `.lr-panel` (ver .css).
 *
 * 4 reportes nuevos (2026-11-03, pedido explícito del usuario), ninguno con endpoint propio
 * (el quinto, "Puntos por vencer", se retiró 2026-11-26 junto con el config CONGELAMIENTO_MESES —
 * ver loyalty-kore-congelamiento.service.js en el backend):
 *   - "Transacciones por tarjeta": agrega exportarMovimientos() por teléfono.
 *   - "Saldos totales"/"Clientes con saldo 0": agregan/filtran exportarTarjetas().
 *   - "Puntos que se vencieron": exportarMovimientos() filtrado al motivo de congelamiento,
 *     resuelto dinámicamente vía listarReasons({categoria:'ajuste'}) — nunca hardcodeado por id.
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-reportes-panel',
  templateUrl: './lealtad-reportes-panel.component.html',
  styleUrls: ['./lealtad-reportes-panel.component.css'],
})
export class LealtadReportesPanelComponent implements OnChanges, OnDestroy {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  readonly MOV_TIPOS: LoyaltyMovimientoTipo[] = ['ACUMULACION', 'CANJE', 'AJUSTE', 'MIGRACION'];
  readonly MOV_TIPO_LABELS: Record<LoyaltyMovimientoTipo, string> = {
    ACUMULACION: 'Acumulación', CANJE: 'Canje', AJUSTE: 'Ajuste', MIGRACION: 'Migración',
  };
  // Origen PROPIO del movimiento (ledger.origen) — distinto del origen de la tarjeta
  // (LoyaltyCardOrigen: solo 'numo'/'kore'). Ver contrato de GET /loyalty/ledger/export.
  readonly MOV_ORIGENES: { value: string; label: string }[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'kore', label: 'Kore' },
    { value: 'migracion', label: 'Migración' },
  ];
  // Catálogo real de niveles de Kore (2026-11-17) — reemplaza el array fijo
  // Bronce/Plata/Oro/Azul, desincronizado del catálogo que gestiona Kore (le faltaba Esmeralda y
  // cualquier nivel nuevo). Se carga una sola vez, mismo criterio lazy que `reasons` (ver
  // ngOnChanges) — no depende del tipo de reporte seleccionado.
  nivelesCatalogo: LoyaltyKoreNivel[] = [];
  private _nivelesLoaded = false;

  readonly REPORT_TIPOS: { value: ReportTipo; label: string }[] = [
    { value: 'movimientos', label: 'Movimientos' },
    { value: 'tarjetas', label: 'Tarjetas' },
    { value: 'transacciones-tarjeta', label: 'Transacciones por tarjeta' },
    { value: 'saldos-totales', label: 'Saldos totales' },
    { value: 'saldo-cero', label: 'Clientes con saldo 0' },
    { value: 'puntos-vencidos', label: 'Puntos que se vencieron' },
    { value: 'por-centro', label: 'Movimientos por centro' },
  ];

  reportTipo: ReportTipo = 'movimientos';

  // ── Filtros de "Movimientos" (reusados también por "Transacciones por tarjeta") ────────────
  movFechaInicio = '';
  movFechaFin = '';
  // Default: los 4 seleccionados (= sin filtro, mismo criterio que reportTipos en report-panel).
  movTipos: LoyaltyMovimientoTipo[] = [...this.MOV_TIPOS];
  movNivelAplicado: string = '';
  movOrigen = '';
  movReasonId: number | null = null;
  movUsuarioNombre = '';
  // Teléfono/tarjeta del CLIENTE (2026-11-20, pedido explícito del usuario) — distinto de
  // `movUsuarioNombre` (ese filtra por el OPERADOR/staff que registró el movimiento). No reemplaza
  // ese filtro: ambos conviven, cada uno filtra una identidad distinta.
  movTelefono = '';
  movPuntosMin: number | null = null;
  movPuntosMax: number | null = null;

  reasons: LoyaltyAdjustmentReason[] = [];
  private _reasonsLoaded = false;

  // ── Filtros de "Tarjetas" (reusados también por "Saldos totales"/"Clientes con saldo 0") ───
  tarNivel: string = '';
  tarActiva: TriValor = '';
  tarOrigen: '' | 'numo' | 'kore' = '';
  tarFechaAltaInicio = '';
  tarFechaAltaFin = '';
  tarRevisionPendiente: TriValor = '';

  exportando = false;
  errorExportar = '';

  private destroy$ = new Subject<void>();

  constructor(private loyalty: LoyaltyService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.errorExportar = '';
      // Se carga una sola vez (motivo cambia de "oculto" a "visible" según `movTipos`, pero el
      // catálogo de reasons no depende del filtro — no hace falta recargarlo cada vez que se abre).
      if (!this._reasonsLoaded) {
        this.loyalty.listarReasons().pipe(takeUntil(this.destroy$)).subscribe({
          next: (r) => { this.reasons = r; this._reasonsLoaded = true; },
          error: (err) => {
            // No bloquea el resto del panel — solo el combo de "Motivo" queda vacío.
            // eslint-disable-next-line no-console
            console.error('[LealtadReportes] No se pudieron cargar los motivos de ajuste:', err);
          },
        });
      }
      if (!this._nivelesLoaded) {
        this.loyalty.listarNivelesKore(true).pipe(takeUntil(this.destroy$)).subscribe({
          next: (n) => { this.nivelesCatalogo = n; this._nivelesLoaded = true; },
          error: (err) => {
            // No bloquea el resto del panel — solo los chips de "Nivel" quedan sin opciones.
            // eslint-disable-next-line no-console
            console.error('[LealtadReportes] No se pudo cargar el catálogo de niveles de Kore:', err);
          },
        });
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get showMotivo(): boolean {
    return this.movTipos.includes('AJUSTE');
  }

  // Filtros de Movimientos visibles para "movimientos", "transacciones-tarjeta" Y "por-centro"
  // (misma fuente, GET /loyalty/ledger/export).
  get usaFiltrosMovimientos(): boolean {
    return this.reportTipo === 'movimientos' || this.reportTipo === 'transacciones-tarjeta' || this.reportTipo === 'por-centro';
  }

  // Filtros de Tarjetas visibles para "tarjetas", "saldos-totales" Y "saldo-cero" (misma fuente).
  get usaFiltrosTarjetas(): boolean {
    return this.reportTipo === 'tarjetas' || this.reportTipo === 'saldos-totales' || this.reportTipo === 'saldo-cero';
  }

  // ── Tipo de reporte ──────────────────────────────────────────────────────

  selectReportTipo(tipo: ReportTipo): void {
    this.reportTipo = tipo;
  }

  // ── Movimientos: toggles ─────────────────────────────────────────────────

  toggleMovTipo(t: LoyaltyMovimientoTipo): void {
    const i = this.movTipos.indexOf(t);
    i === -1 ? this.movTipos.push(t) : this.movTipos.splice(i, 1);
    if (!this.showMotivo) this.movReasonId = null;
  }

  selectMovNivel(n: string): void {
    this.movNivelAplicado = n;
  }

  selectMovOrigen(o: string): void {
    this.movOrigen = o;
  }

  onMovPuntosMinChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.movPuntosMin = v ? Number(v) : null;
  }

  onMovPuntosMaxChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.movPuntosMax = v ? Number(v) : null;
  }

  // ── Tarjetas: toggles ────────────────────────────────────────────────────

  selectTarNivel(n: string): void {
    this.tarNivel = n;
  }

  selectTarActiva(v: TriValor): void {
    this.tarActiva = v;
  }

  selectTarOrigen(v: '' | 'numo' | 'kore'): void {
    this.tarOrigen = v;
  }

  selectTarRevisionPendiente(v: TriValor): void {
    this.tarRevisionPendiente = v;
  }

  // ── Digest ───────────────────────────────────────────────────────────────

  private _fmtFecha(s: string): string {
    return s.split('-').reverse().join('/');
  }

  private _rangoTexto(inicio: string, fin: string): string {
    if (!inicio && !fin) return 'cualquier fecha';
    if (inicio && fin) return `${this._fmtFecha(inicio)}–${this._fmtFecha(fin)}`;
    return inicio ? `desde ${this._fmtFecha(inicio)}` : `hasta ${this._fmtFecha(fin)}`;
  }

  get digestText(): string {
    switch (this.reportTipo) {
      case 'tarjetas':
      case 'saldos-totales':
      case 'saldo-cero':
        return this._digestTarjetas();
      case 'puntos-vencidos':
        return 'Movimientos de AJUSTE con el motivo "Congelamiento por inactividad"';
      default:
        return this._digestMovimientos();
    }
  }

  private _digestMovimientos(): string {
    const parts: string[] = [];
    parts.push(this._rangoTexto(this.movFechaInicio, this.movFechaFin));

    if (this.movTipos.length === this.MOV_TIPOS.length) {
      parts.push('todos los tipos');
    } else if (!this.movTipos.length) {
      parts.push('ningún tipo seleccionado');
    } else {
      parts.push(this.movTipos.map((t) => this.MOV_TIPO_LABELS[t]).join(', '));
    }

    if (this.movNivelAplicado) parts.push(`nivel ${this.movNivelAplicado}`);

    if (this.movOrigen) {
      const label = this.MOV_ORIGENES.find((o) => o.value === this.movOrigen)?.label ?? this.movOrigen;
      parts.push(`origen ${label}`);
    }

    if (this.showMotivo && this.movReasonId != null) {
      const nombre = this.reasons.find((r) => r.id === this.movReasonId)?.nombre;
      if (nombre) parts.push(`motivo "${nombre}"`);
    }

    if (this.movUsuarioNombre.trim()) parts.push(`usuario: ${this.movUsuarioNombre.trim()}`);

    if (this.movTelefono.trim()) parts.push(`teléfono: ${this.movTelefono.trim()}`);

    if (this.movPuntosMin != null || this.movPuntosMax != null) {
      const fmtNum = (v: number) => v.toLocaleString('es-MX');
      if (this.movPuntosMin != null && this.movPuntosMax != null) {
        parts.push(`${fmtNum(this.movPuntosMin)}–${fmtNum(this.movPuntosMax)} pts`);
      } else if (this.movPuntosMin != null) {
        parts.push(`desde ${fmtNum(this.movPuntosMin)} pts`);
      } else {
        parts.push(`hasta ${fmtNum(this.movPuntosMax!)} pts`);
      }
    }

    return parts.join(' · ');
  }

  private _digestTarjetas(): string {
    const parts: string[] = [];
    parts.push(this.tarNivel ? `nivel ${this.tarNivel}` : 'todos los niveles');

    if (this.tarActiva === 'true') parts.push('solo activas');
    else if (this.tarActiva === 'false') parts.push('solo inactivas');
    else parts.push('activas e inactivas');

    if (this.tarOrigen === 'numo') parts.push('origen Numo');
    else if (this.tarOrigen === 'kore') parts.push('origen Kore');
    else parts.push('cualquier origen');

    parts.push(this._rangoTexto(this.tarFechaAltaInicio, this.tarFechaAltaFin));

    if (this.tarRevisionPendiente === 'true') parts.push('pendientes de revisión');
    else if (this.tarRevisionPendiente === 'false') parts.push('ya revisadas');

    return parts.join(' · ');
  }

  private _movimientosFiltrosActivos(): boolean {
    return !!(this.movFechaInicio || this.movFechaFin)
      || this.movTipos.length !== this.MOV_TIPOS.length
      || !!this.movNivelAplicado
      || !!this.movOrigen
      || this.movReasonId != null
      || !!this.movUsuarioNombre.trim()
      || !!this.movTelefono.trim()
      || this.movPuntosMin != null
      || this.movPuntosMax != null;
  }

  private _tarjetasFiltrosActivos(): boolean {
    return !!this.tarNivel
      || this.tarActiva !== ''
      || this.tarOrigen !== ''
      || !!(this.tarFechaAltaInicio || this.tarFechaAltaFin)
      || this.tarRevisionPendiente !== '';
  }

  get digestIsCustom(): boolean {
    switch (this.reportTipo) {
      case 'tarjetas':
      case 'saldos-totales':
      case 'saldo-cero':
        return this._tarjetasFiltrosActivos();
      case 'puntos-vencidos':
        return false; // sin filtros propios — siempre el mismo universo (motivo fijo)
      default:
        return this._movimientosFiltrosActivos();
    }
  }

  // ── Exportar ─────────────────────────────────────────────────────────────

  private _filtrosMovimientos(): LoyaltyLedgerExportFilter {
    const allTipos = this.movTipos.length === this.MOV_TIPOS.length;
    return {
      fechaInicio: this.movFechaInicio || undefined,
      fechaFin: this.movFechaFin || undefined,
      tipo: allTipos ? undefined : this.movTipos.join(','),
      nivelAplicado: this.movNivelAplicado || undefined,
      origen: this.movOrigen || undefined,
      reasonId: this.showMotivo && this.movReasonId != null ? this.movReasonId : undefined,
      usuarioNombre: this.movUsuarioNombre.trim() || undefined,
      telefono: this.movTelefono.trim() || undefined,
      puntosMin: this.movPuntosMin ?? undefined,
      puntosMax: this.movPuntosMax ?? undefined,
    };
  }

  private _filtrosTarjetas(): LoyaltyCardsExportFilter {
    return {
      nivel: this.tarNivel || undefined,
      activa: this.tarActiva === '' ? undefined : this.tarActiva === 'true',
      origen: this.tarOrigen || undefined,
      fechaAltaInicio: this.tarFechaAltaInicio || undefined,
      fechaAltaFin: this.tarFechaAltaFin || undefined,
      revisionPendiente: this.tarRevisionPendiente === '' ? undefined : this.tarRevisionPendiente === 'true',
    };
  }

  exportarExcel(): void {
    if (this.exportando) return;
    if (this.usaFiltrosMovimientos && !this.movTipos.length) return;

    this.exportando = true;
    this.errorExportar = '';

    switch (this.reportTipo) {
      case 'tarjetas':
        this._exportarTarjetasReporte();
        return;
      case 'saldos-totales':
        this._exportarSaldosTotales();
        return;
      case 'saldo-cero':
        this._exportarSaldoCero();
        return;
      case 'puntos-vencidos':
        this._exportarPuntosVencidos();
        return;
      case 'transacciones-tarjeta':
        this._exportarTransaccionesPorTarjeta();
        return;
      case 'por-centro':
        this._exportarPorCentro();
        return;
      default:
        this._exportarMovimientosReporte();
    }
  }

  private _exportarTarjetasReporte(): void {
    this.loyalty.exportarTarjetas(this._filtrosTarjetas()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        try {
          await this._generarExcelTarjetas(res.cards);
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console
          console.error('[LealtadReportes] Falló la generación del Excel de tarjetas:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer las tarjetas para exportar.';
      },
    });
  }

  private _exportarMovimientosReporte(): void {
    this.loyalty.exportarMovimientos(this._filtrosMovimientos()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        try {
          await this._generarExcelMovimientos(res.movimientos);
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console
          console.error('[LealtadReportes] Falló la generación del Excel de movimientos:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer los movimientos para exportar.';
      },
    });
  }

  // "Transacciones por tarjeta" (2026-11-03) — mismo endpoint/filtros que "Movimientos",
  // agregado por teléfono del lado del cliente (sin backend nuevo).
  private _exportarTransaccionesPorTarjeta(): void {
    this.loyalty.exportarMovimientos(this._filtrosMovimientos()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        try {
          await this._generarExcelTransaccionesPorTarjeta(this._agruparPorTarjeta(res.movimientos));
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console
          console.error('[LealtadReportes] Falló la generación del Excel de transacciones por tarjeta:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer los movimientos para exportar.';
      },
    });
  }

  // "Movimientos por centro" (2026-11-20, pedido explícito del usuario) — mismo endpoint/filtros
  // que "Movimientos", agregado por centro de costo del lado del cliente (sin backend nuevo, salvo
  // sumar serieFacturacion al include de CentroCosto en loyalty-ledger.service.js).
  private _exportarPorCentro(): void {
    this.loyalty.exportarMovimientos(this._filtrosMovimientos()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        try {
          // El agregado (_agruparPorCentro) sigue igual; el detalle crudo por movimiento (2026-11-20,
          // pedido explícito del usuario) se conserva aparte para la segunda hoja — antes se
          // descartaba acá mismo sin usarse.
          await this._generarExcelPorCentro(this._agruparPorCentro(res.movimientos), res.movimientos);
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console
          console.error('[LealtadReportes] Falló la generación del Excel de movimientos por centro:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer los movimientos para exportar.';
      },
    });
  }

  // "Saldos totales" (2026-11-03) — mismo endpoint/filtros que "Tarjetas", con una fila de total
  // general agregada al final del Excel (sin backend nuevo).
  private _exportarSaldosTotales(): void {
    this.loyalty.exportarTarjetas(this._filtrosTarjetas()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        try {
          await this._generarExcelSaldosTotales(res.cards);
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console
          console.error('[LealtadReportes] Falló la generación del Excel de saldos totales:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer las tarjetas para exportar.';
      },
    });
  }

  // "Clientes con saldo 0" (2026-11-03) — mismo endpoint/filtros que "Tarjetas", filtrado
  // client-side a saldoPuntos === 0 (sin backend nuevo).
  private _exportarSaldoCero(): void {
    this.loyalty.exportarTarjetas(this._filtrosTarjetas()).pipe(takeUntil(this.destroy$)).subscribe({
      next: async (res) => {
        try {
          const ceros = res.cards.filter((c) => Number(c.saldoPuntos) === 0);
          await this._generarExcelTarjetas(ceros, { sheetName: 'Saldo 0', filenamePrefix: 'saldo-cero' });
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console
          console.error('[LealtadReportes] Falló la generación del Excel de clientes con saldo 0:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer las tarjetas para exportar.';
      },
    });
  }

  // "Puntos que se vencieron" (2026-11-03) — tarjetas que YA tuvieron un reset por congelamiento:
  // movimientos de AJUSTE con el motivo 'congelamiento_inactividad', resuelto dinámicamente (nunca
  // hardcodeado por id, el id puede variar entre ambientes/seeds).
  private _exportarPuntosVencidos(): void {
    this.loyalty.listarReasons({ categoria: 'ajuste' }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (reasons) => {
        const motivo = reasons.find((r) => r.clave === REASON_CLAVE_CONGELAMIENTO);
        if (!motivo) {
          this.exportando = false;
          this.errorExportar = 'No se encontró el motivo de congelamiento por inactividad (revisa el seed de motivos).';
          return;
        }

        this.loyalty.exportarMovimientos({ reasonId: motivo.id }).pipe(takeUntil(this.destroy$)).subscribe({
          next: async (res) => {
            try {
              await this._generarExcelMovimientos(res.movimientos, {
                sheetName: 'Puntos vencidos', filenamePrefix: 'puntos-vencidos',
              });
            } catch (err) {
              this.errorExportar = 'No se pudo generar el Excel.';
              // eslint-disable-next-line no-console
              console.error('[LealtadReportes] Falló la generación del Excel de puntos vencidos:', err);
            } finally {
              this.exportando = false;
            }
          },
          error: (err) => {
            this.exportando = false;
            this.errorExportar = err?.error?.error || 'No se pudieron traer los movimientos para exportar.';
          },
        });
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = 'No se pudo resolver el motivo de congelamiento por inactividad.';
        // eslint-disable-next-line no-console
        console.error('[LealtadReportes] Falló listarReasons para Puntos vencidos:', err);
      },
    });
  }

  // Agrega filas planas de GET /loyalty/ledger/export por teléfono (identidad real de la tarjeta,
  // D1) — `rows` viene ordenado DESC por fecha (contrato del backend), así que la PRIMERA fila que
  // aparece para cada teléfono es su movimiento más reciente → `saldoActual` correcto sin un
  // segundo pase ni ordenar de nuevo.
  private _agruparPorTarjeta(rows: LoyaltyLedgerExportRow[]): TransaccionesPorTarjetaRow[] {
    const mapa = new Map<string, TransaccionesPorTarjetaRow>();
    // Movimiento más ANTIGUO visto por teléfono, solo para ordenar las filas de SALIDA
    // (2026-11-23, pedido explícito del usuario). `rows` viene DESC por fecha (ver comentario
    // arriba), así que sobreescribir sin condición en cada vuelta deja, al terminar el loop, la
    // ÚLTIMA aparición de cada teléfono — que es su movimiento más antiguo. No afecta saldoActual,
    // que sigue dependiendo únicamente del orden DESC original de `rows`.
    const primerMovimiento = new Map<string, string>();

    for (const m of rows) {
      const telefono = m.card?.telefono ?? '';
      let fila = mapa.get(telefono);
      if (!fila) {
        fila = {
          telefono,
          nombre: m.card?.nombre ?? '',
          movimientos: 0,
          puntosAcumulados: 0,
          puntosCanjeados: 0,
          puntosAjustados: 0,
          saldoActual: Number(m.saldoResultante),
        };
        mapa.set(telefono, fila);
      }

      fila.movimientos += 1;
      if (m.tipo === 'ACUMULACION') {
        fila.puntosAcumulados += Number(m.puntos);
      } else if (m.tipo === 'CANJE') {
        fila.puntosCanjeados += Math.abs(Number(m.puntos));
      } else {
        // AJUSTE/MIGRACION — puntos ajustados/bonificados (puede incluir negativos, ej. congelamiento).
        fila.puntosAjustados += Number(m.puntos);
      }
      primerMovimiento.set(telefono, m.createdAt ?? '');
    }

    // Ascendente por el movimiento más antiguo de cada tarjeta — más antiguo primero, más
    // reciente al final.
    return [...mapa.values()].sort((a, b) =>
      (primerMovimiento.get(a.telefono) ?? '').localeCompare(primerMovimiento.get(b.telefono) ?? ''));
  }

  // Llave de agrupación para "Movimientos por centro" — hoja 1 (_agruparPorCentro, agregado).
  // `serieFacturacion` (el código real que usa Kore, ej. "A0") y NO `centroCosto.nombre`: ni
  // `sucursal` (alias `nombre`) ni `serieFacturacion` tienen constraint de unicidad en el modelo
  // (ver CentroCosto.js), así que dos centros distintos pueden compartir `nombre` difiriendo solo
  // en `serieFacturacion` — usar `nombre` como llave mezclaría esos dos centros en un mismo bucket.
  // Movimientos sin centro resuelto caen en "Sin centro".
  private _claveCentro(m: LoyaltyLedgerExportRow): string {
    return m.centroCosto?.serieFacturacion || 'Sin centro';
  }

  // Llave de agrupación/color para la hoja 2 "Detalle de movimientos" (2026-11-20, decisión de
  // producto confirmada). A diferencia de _claveCentro(), cuando falta `serieFacturacion` NO
  // colapsa directo a 'Sin centro': cae a `nombre` para que dos centros reales distintos que
  // comparten la ausencia de `serieFacturacion` sigan recibiendo colores distintos fila por fila
  // (en el detalle importa la distinción visual más que bucketear igual que la hoja 1). Solo si
  // `nombre` también falta cae a 'Sin centro'. Usada SOLO por el loop de detalle; _agruparPorCentro
  // sigue usando _claveCentro sin cambios.
  private _claveColorDetalle(m: LoyaltyLedgerExportRow): string {
    return m.centroCosto?.serieFacturacion || m.centroCosto?.nombre || 'Sin centro';
  }

  // Orden de filas en los reportes de movimientos (2026-11-23, pedido explícito del usuario): el
  // backend regresa GET /loyalty/ledger/export en DESC por fecha; los Excel descargados deben
  // mostrar el movimiento más ANTIGUO primero y el más reciente al final. Comparación directa de
  // los ISO string de `createdAt` alcanza (mismo formato siempre), sin necesidad de parsear a
  // Date. Devuelve una copia nueva — nunca muta el array recibido, porque algunos llamadores
  // (ej. _agruparPorCentro ya corrió antes sobre el mismo `rows`, o el propio `res.movimientos`
  // se reusa en otro lado) siguen necesitando el orden original DESC.
  private _ordenarAscPorFecha(rows: LoyaltyLedgerExportRow[]): LoyaltyLedgerExportRow[] {
    return [...rows].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }

  // Serie-Folio real de Kore viene a veces sufijado ":CANJE"/":PROMOCION" (2026-11-20) para
  // desambiguar movimientos que comparten folio de venta bajo un índice único en BD (ver
  // comentario de `referenciaExterna` en loyalty.model.ts y _resolverCentroCostoPorSerieFolio en
  // el backend). La columna "Serie-Folio" del detalle debe mostrar solo la parte limpia (antes
  // del ":"); el sufijo (si existe) se combina con el tipo de movimiento (MOV_TIPO_LABELS) en una
  // columna nueva — 2026-11-23, pedido explícito del usuario. Sin sufijo, se muestra solo el tipo
  // (nunca paréntesis vacíos).
  private _serieFolioYTipo(m: LoyaltyLedgerExportRow): { serieFolio: string; tipoMovimiento: string } {
    const referencia = m.referenciaExterna ?? '';
    const idxSufijo = referencia.indexOf(':');
    const serieFolio = idxSufijo === -1 ? referencia : referencia.slice(0, idxSufijo);
    const sufijo = idxSufijo === -1 ? '' : referencia.slice(idxSufijo + 1);
    const tipoLabel = this.MOV_TIPO_LABELS[m.tipo] ?? m.tipo;
    return { serieFolio, tipoMovimiento: sufijo ? `${tipoLabel} (${sufijo})` : tipoLabel };
  }

  // Agrega filas planas de GET /loyalty/ledger/export por centro de costo (2026-11-20) — misma
  // fuente/criterio que _agruparPorTarjeta, agrupando por _claveCentro() (serieFacturacion, el
  // código real que usa Kore, ej. "A0") en vez de por tarjeta.
  private _agruparPorCentro(rows: LoyaltyLedgerExportRow[]): PorCentroRow[] {
    const mapa = new Map<string, PorCentroRow & { telefonos: Set<string> }>();

    for (const m of rows) {
      const centro = this._claveCentro(m);
      let fila = mapa.get(centro);
      if (!fila) {
        fila = {
          centro,
          sucursal: m.centroCosto?.nombre ?? '',
          movimientos: 0,
          clientesUnicos: 0,
          puntosAcumulados: 0,
          puntosCanjeados: 0,
          puntosAjustados: 0,
          telefonos: new Set<string>(),
        };
        mapa.set(centro, fila);
      }

      fila.movimientos += 1;
      if (m.card?.telefono) fila.telefonos.add(m.card.telefono);
      if (m.tipo === 'ACUMULACION') {
        fila.puntosAcumulados += Number(m.puntos);
      } else if (m.tipo === 'CANJE') {
        fila.puntosCanjeados += Math.abs(Number(m.puntos));
      } else {
        fila.puntosAjustados += Number(m.puntos);
      }
    }

    // Más movimientos primero — responde directo "qué centro vende más" sin tener que ordenar
    // en Excel.
    return [...mapa.values()]
      .map(({ telefonos, ...resto }) => ({ ...resto, clientesUnicos: telefonos.size }))
      .sort((a, b) => b.movimientos - a.movimientos);
  }

  private async _generarExcelTarjetas(
    cards: LoyaltyCard[],
    opts: { sheetName?: string; filenamePrefix?: string } = {},
  ): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(opts.sheetName ?? 'Tarjetas');
    await insertarLogoExcel(wb, ws);

    const FILA_HEADER = 4;
    ws.columns = [
      { key: 'telefono', width: 16 },
      { key: 'nombre', width: 32 },
      { key: 'nivel', width: 12 },
      { key: 'saldo', width: 16 },
      { key: 'activa', width: 10 },
      { key: 'origen', width: 12 },
      { key: 'fechaAlta', width: 16 },
      { key: 'revisionPendiente', width: 18 },
    ];
    const header = ws.getRow(FILA_HEADER);
    header.values = ['Teléfono', 'Nombre', 'Nivel', 'Saldo de puntos', 'Activa', 'Origen', 'Fecha de alta', 'Revisión pendiente'];
    header.font = { bold: true };

    for (const c of cards) {
      ws.addRow({
        telefono: c.telefono,
        nombre: c.nombre,
        nivel: c.nivel,
        saldo: Number(c.saldoPuntos),
        activa: c.activa ? 'Sí' : 'No',
        origen: c.createdById === 'kore-webhook' ? 'Kore' : 'Numo',
        fechaAlta: c.createdAt ? c.createdAt.slice(0, 10) : '',
        revisionPendiente: c.revisionPendiente ? 'Sí' : 'No',
      });
    }

    this._descargar(await wb.xlsx.writeBuffer(), `tuberos-${opts.filenamePrefix ?? 'tarjetas'}-${this._fechaHoy()}.xlsx`);
  }

  private async _generarExcelMovimientos(
    rows: LoyaltyLedgerExportRow[],
    opts: { sheetName?: string; filenamePrefix?: string } = {},
  ): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(opts.sheetName ?? 'Movimientos');
    await insertarLogoExcel(wb, ws);

    const FILA_HEADER = 4;
    ws.columns = [
      { key: 'fecha', width: 18 },
      { key: 'telefono', width: 16 },
      { key: 'nombre', width: 32 },
      { key: 'tipo', width: 14 },
      { key: 'puntos', width: 12 },
      { key: 'saldoResultante', width: 16 },
      { key: 'nivelAplicado', width: 14 },
      { key: 'origen', width: 12 },
      { key: 'motivo', width: 24 },
      { key: 'justificacion', width: 28 },
      { key: 'centroCosto', width: 20 },
      { key: 'usuario', width: 22 },
    ];
    const header = ws.getRow(FILA_HEADER);
    header.values = [
      'Fecha', 'Teléfono', 'Nombre', 'Tipo', 'Puntos', 'Saldo resultante', 'Nivel aplicado',
      'Origen', 'Motivo', 'Justificación', 'Centro de costo', 'Usuario',
    ];
    header.font = { bold: true };

    // Orden ascendente por fecha (2026-11-23, pedido explícito del usuario: el movimiento más
    // ANTIGUO primero, el más reciente al final) — el backend regresa `rows` en DESC, así que se
    // ordena acá antes de escribir. Se ordena una copia para no mutar `rows`, que otros
    // llamadores (p. ej. "Puntos vencidos") también reciben del mismo observable.
    const filas = this._ordenarAscPorFecha(rows);

    for (const m of filas) {
      ws.addRow({
        fecha: m.createdAt ? m.createdAt.slice(0, 10) : '',
        telefono: m.card?.telefono ?? '',
        nombre: m.card?.nombre ?? '',
        tipo: this.MOV_TIPO_LABELS[m.tipo] ?? m.tipo,
        puntos: Number(m.puntos),
        saldoResultante: Number(m.saldoResultante),
        nivelAplicado: m.nivelAplicado ?? '',
        origen: m.origen ?? '',
        motivo: m.reason?.nombre ?? '',
        justificacion: m.justificacion ?? '',
        centroCosto: m.centroCosto?.nombre ?? '',
        usuario: m.usuarioNombre ?? '',
      });
    }

    this._descargar(await wb.xlsx.writeBuffer(), `tuberos-${opts.filenamePrefix ?? 'movimientos'}-${this._fechaHoy()}.xlsx`);
  }

  private async _generarExcelTransaccionesPorTarjeta(filas: TransaccionesPorTarjetaRow[]): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Transacciones por tarjeta');
    await insertarLogoExcel(wb, ws);

    const FILA_HEADER = 4;
    ws.columns = [
      { key: 'telefono', width: 16 },
      { key: 'nombre', width: 32 },
      { key: 'movimientos', width: 14 },
      { key: 'puntosAcumulados', width: 18 },
      { key: 'puntosCanjeados', width: 18 },
      { key: 'puntosAjustados', width: 24 },
      { key: 'saldoActual', width: 16 },
    ];
    const header = ws.getRow(FILA_HEADER);
    header.values = [
      'Teléfono', 'Nombre', 'Cantidad de movimientos', 'Puntos acumulados',
      'Puntos canjeados', 'Puntos ajustados/bonificados', 'Saldo actual',
    ];
    header.font = { bold: true };

    for (const f of filas) {
      ws.addRow(f);
    }

    this._descargar(await wb.xlsx.writeBuffer(), `tuberos-transacciones-por-tarjeta-${this._fechaHoy()}.xlsx`);
  }

  // Paleta cíclica de colores de fondo para el detalle de "Movimientos por centro" (2026-11-20) —
  // mismo patrón de `cell.fill` sólido que poliza-list.component.ts#reporteSustitutos, pero un
  // color por CENTRO (no por tipo de comprobante fijo) dentro de una sola hoja en vez de una hoja
  // por categoría. Si hay más centros que colores, se repite desde el principio.
  private static readonly PALETA_CENTROS = [
    'FFDBEAFE', // azul claro
    'FFDCFCE7', // verde claro
    'FFEDE9FE', // morado claro
    'FFFEF3C7', // ámbar claro
    'FFFCE7F3', // rosa claro
    'FFE0F2FE', // celeste claro
    'FFFFE4E6', // rojo claro
    'FFECFCCB', // lima claro
  ];

  private async _generarExcelPorCentro(filas: PorCentroRow[], rows: LoyaltyLedgerExportRow[]): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();

    // ── Hoja 1: agregado por centro (sin cambios) ───────────────────────────
    const ws = wb.addWorksheet('Movimientos por centro');
    await insertarLogoExcel(wb, ws);

    const FILA_HEADER = 4;
    ws.columns = [
      { key: 'centro', width: 12 },
      { key: 'sucursal', width: 28 },
      { key: 'movimientos', width: 14 },
      { key: 'clientesUnicos', width: 16 },
      { key: 'puntosAcumulados', width: 18 },
      { key: 'puntosCanjeados', width: 18 },
      { key: 'puntosAjustados', width: 24 },
    ];
    const header = ws.getRow(FILA_HEADER);
    header.values = [
      'Centro', 'Sucursal', 'Cantidad de movimientos', 'Clientes únicos',
      'Puntos acumulados', 'Puntos canjeados', 'Puntos ajustados/bonificados',
    ];
    header.font = { bold: true };

    for (const f of filas) {
      ws.addRow(f);
    }

    // ── Hoja 2: detalle por movimiento (2026-11-20, pedido explícito del usuario) — una fila por
    // movimiento crudo, coloreada por centro. Antes `rows` se agregaba en _agruparPorCentro() y el
    // detalle se perdía sin usarse; ahora se conserva acá.
    const wsDetalle = wb.addWorksheet('Detalle de movimientos');
    wsDetalle.columns = [
      { key: 'cliente', width: 28 },
      { key: 'telefono', width: 16 },
      { key: 'serieFolio', width: 18 },
      { key: 'tipoMovimiento', width: 22 },
      { key: 'fecha', width: 14 },
      { key: 'venta', width: 14 },
      { key: 'puntos', width: 12 },
      { key: 'centro', width: 24 },
    ];
    const headerDetalle = wsDetalle.getRow(1);
    headerDetalle.values = [
      'Cliente', 'Teléfono/Tarjeta', 'Serie-Folio', 'Tipo', 'Fecha', 'Venta', 'Puntos', 'Centro',
    ];
    headerDetalle.font = { bold: true };

    // Un color por centro distinto, asignado en el orden en que cada uno aparece por primera vez,
    // usando _claveColorDetalle() (serieFacturacion, con fallback a nombre y luego a 'Sin centro' —
    // ver comentario de _claveColorDetalle). El valor MOSTRADO en la columna "Centro" sigue siendo
    // el nombre legible de sucursal; solo la llave de agrupación/color usa el fallback. Cicla la
    // paleta si hay más centros que colores.
    const colorPorCentro = new Map<string, string>();
    const paleta = LealtadReportesPanelComponent.PALETA_CENTROS;

    // Orden ascendente por fecha (2026-11-23, pedido explícito del usuario: el movimiento más
    // ANTIGUO primero) — se ordena una copia de `rows` antes de recorrer; la asignación de color
    // por centro (orden de primera aparición) queda definida sobre este mismo orden ascendente.
    const filasOrdenadas = this._ordenarAscPorFecha(rows);

    for (const m of filasOrdenadas) {
      const clave = this._claveColorDetalle(m);
      const centroDisplay = m.centroCosto?.nombre || 'Sin centro';
      let color = colorPorCentro.get(clave);
      if (!color) {
        color = paleta[colorPorCentro.size % paleta.length];
        colorPorCentro.set(clave, color);
      }

      const { serieFolio, tipoMovimiento } = this._serieFolioYTipo(m);

      const row = wsDetalle.addRow({
        cliente: m.card?.nombre ?? '',
        telefono: m.card?.telefono ?? '',
        serieFolio,
        tipoMovimiento,
        fecha: m.createdAt ? m.createdAt.slice(0, 10) : '',
        venta: m.montoVenta != null ? Number(m.montoVenta) : null,
        puntos: Number(m.puntos),
        centro: centroDisplay,
      });
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color! } };
      });
    }

    this._descargar(await wb.xlsx.writeBuffer(), `tuberos-movimientos-por-centro-${this._fechaHoy()}.xlsx`);
  }

  private async _generarExcelSaldosTotales(cards: LoyaltyCard[]): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Saldos totales');
    await insertarLogoExcel(wb, ws);

    const FILA_HEADER = 4;
    ws.columns = [
      { key: 'telefono', width: 16 },
      { key: 'nombre', width: 32 },
      { key: 'nivel', width: 12 },
      { key: 'saldo', width: 16 },
    ];
    const header = ws.getRow(FILA_HEADER);
    header.values = ['Teléfono', 'Nombre', 'Nivel', 'Saldo de puntos'];
    header.font = { bold: true };

    let total = 0;
    for (const c of cards) {
      const saldo = Number(c.saldoPuntos);
      total += saldo;
      ws.addRow({ telefono: c.telefono, nombre: c.nombre, nivel: c.nivel, saldo });
    }

    const filaTotal = ws.addRow({ nombre: 'Total general', saldo: total });
    filaTotal.font = { bold: true };

    this._descargar(await wb.xlsx.writeBuffer(), `tuberos-saldos-totales-${this._fechaHoy()}.xlsx`);
  }

  private _fechaHoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private _descargar(buf: BlobPart, filename: string): void {
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

