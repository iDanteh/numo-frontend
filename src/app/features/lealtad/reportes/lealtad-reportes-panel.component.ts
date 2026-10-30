import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyAdjustmentReason, LoyaltyCard, LoyaltyNivel,
  LoyaltyMovimientoTipo, LoyaltyLedgerExportRow,
} from '../../../core/services/loyalty.service';

type ReportTipo = 'movimientos' | 'tarjetas';
type TriValor = '' | 'true' | 'false';

/**
 * Panel de Reportes de Lealtad (2026-10-29) — sidebar deslizable con selector de tipo de reporte
 * ("Movimientos"/"Tarjetas") y exportación 100% frontend a Excel vía exceljs dinámico, mismo
 * patrón que _generarExcel() en clientes-pendientes.component.ts. Reusa el markup/clases
 * genéricas de Bancos (.report-sidebar, .fgroup, .chips, .digest, etc. — ver styles.css) con el
 * acento ámbar propio de Lealtad sobrescrito solo dentro de `.lr-panel` (ver .css).
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
  readonly NIVELES: LoyaltyNivel[] = ['Bronce', 'Plata', 'Oro'];

  reportTipo: ReportTipo = 'movimientos';

  // ── Filtros de "Movimientos" ────────────────────────────────────────────
  movFechaInicio = '';
  movFechaFin = '';
  // Default: los 4 seleccionados (= sin filtro, mismo criterio que reportTipos en report-panel).
  movTipos: LoyaltyMovimientoTipo[] = [...this.MOV_TIPOS];
  movNivelAplicado: LoyaltyNivel | '' = '';
  movOrigen = '';
  movReasonId: number | null = null;
  movUsuarioNombre = '';
  movPuntosMin: number | null = null;
  movPuntosMax: number | null = null;

  reasons: LoyaltyAdjustmentReason[] = [];
  private _reasonsLoaded = false;

  // ── Filtros de "Tarjetas" ────────────────────────────────────────────────
  tarNivel: LoyaltyNivel | '' = '';
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
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get showMotivo(): boolean {
    return this.movTipos.includes('AJUSTE');
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

  selectMovNivel(n: LoyaltyNivel | ''): void {
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

  selectTarNivel(n: LoyaltyNivel | ''): void {
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
    return this.reportTipo === 'movimientos' ? this._digestMovimientos() : this._digestTarjetas();
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

  get digestIsCustom(): boolean {
    if (this.reportTipo === 'movimientos') {
      return !!(this.movFechaInicio || this.movFechaFin)
        || this.movTipos.length !== this.MOV_TIPOS.length
        || !!this.movNivelAplicado
        || !!this.movOrigen
        || this.movReasonId != null
        || !!this.movUsuarioNombre.trim()
        || this.movPuntosMin != null
        || this.movPuntosMax != null;
    }
    return !!this.tarNivel
      || this.tarActiva !== ''
      || this.tarOrigen !== ''
      || !!(this.tarFechaAltaInicio || this.tarFechaAltaFin)
      || this.tarRevisionPendiente !== '';
  }

  // ── Exportar ─────────────────────────────────────────────────────────────

  exportarExcel(): void {
    if (this.exportando) return;
    if (this.reportTipo === 'movimientos' && !this.movTipos.length) return;

    this.exportando = true;
    this.errorExportar = '';

    if (this.reportTipo === 'tarjetas') {
      this.loyalty.exportarTarjetas({
        nivel: this.tarNivel || undefined,
        activa: this.tarActiva === '' ? undefined : this.tarActiva === 'true',
        origen: this.tarOrigen || undefined,
        fechaAltaInicio: this.tarFechaAltaInicio || undefined,
        fechaAltaFin: this.tarFechaAltaFin || undefined,
        revisionPendiente: this.tarRevisionPendiente === '' ? undefined : this.tarRevisionPendiente === 'true',
      }).pipe(takeUntil(this.destroy$)).subscribe({
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
      return;
    }

    const allTipos = this.movTipos.length === this.MOV_TIPOS.length;
    this.loyalty.exportarMovimientos({
      fechaInicio: this.movFechaInicio || undefined,
      fechaFin: this.movFechaFin || undefined,
      tipo: allTipos ? undefined : this.movTipos.join(','),
      nivelAplicado: this.movNivelAplicado || undefined,
      origen: this.movOrigen || undefined,
      reasonId: this.showMotivo && this.movReasonId != null ? this.movReasonId : undefined,
      usuarioNombre: this.movUsuarioNombre.trim() || undefined,
      puntosMin: this.movPuntosMin ?? undefined,
      puntosMax: this.movPuntosMax ?? undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
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

  private async _generarExcelTarjetas(cards: LoyaltyCard[]): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tarjetas');

    ws.columns = [
      { header: 'Teléfono', key: 'telefono', width: 16 },
      { header: 'Nombre', key: 'nombre', width: 32 },
      { header: 'Nivel', key: 'nivel', width: 12 },
      { header: 'Saldo de puntos', key: 'saldo', width: 16 },
      { header: 'Activa', key: 'activa', width: 10 },
      { header: 'Origen', key: 'origen', width: 12 },
      { header: 'Fecha de alta', key: 'fechaAlta', width: 16 },
      { header: 'Revisión pendiente', key: 'revisionPendiente', width: 18 },
    ];
    ws.getRow(1).font = { bold: true };

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

    this._descargar(await wb.xlsx.writeBuffer(), `lealtad-tarjetas-${this._fechaHoy()}.xlsx`);
  }

  private async _generarExcelMovimientos(rows: LoyaltyLedgerExportRow[]): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Movimientos');

    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 18 },
      { header: 'Teléfono', key: 'telefono', width: 16 },
      { header: 'Nombre', key: 'nombre', width: 32 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Puntos', key: 'puntos', width: 12 },
      { header: 'Saldo resultante', key: 'saldoResultante', width: 16 },
      { header: 'Nivel aplicado', key: 'nivelAplicado', width: 14 },
      { header: 'Origen', key: 'origen', width: 12 },
      { header: 'Motivo', key: 'motivo', width: 24 },
      { header: 'Justificación', key: 'justificacion', width: 28 },
      { header: 'Centro de costo', key: 'centroCosto', width: 20 },
      { header: 'Usuario', key: 'usuario', width: 22 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const m of rows) {
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

    this._descargar(await wb.xlsx.writeBuffer(), `lealtad-movimientos-${this._fechaHoy()}.xlsx`);
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
