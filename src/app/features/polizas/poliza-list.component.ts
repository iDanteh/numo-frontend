import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, EMPTY } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, switchMap, map, timeout, skip, catchError } from 'rxjs/operators';
import { PolizaService, Poliza, PolizaTipo, PolizaEstado, CfdiAlertInfo, CfdiMetaInfo } from '../../core/services/poliza.service';
import { CfdiMappingService, CfdiMappingRule, PolizaPropuesta, GenerarYGuardarResult, BalanzaPreliminar, BalanzaCuenta, BalanceGeneral } from '../../core/services/cfdi-mapping.service';
import { AccountPlanService, AccountPlan } from '../../core/services/account-plan.service';
import { ToastService } from '../../core/services/toast.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: false,
  selector: 'app-poliza-list',
  templateUrl: './poliza-list.component.html',
})
export class PolizaListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // ── Lista ──────────────────────────────────────────────────────────────────
  polizas:    Poliza[] = [];
  pagination = { total: 0, page: 1, limit: 15, pages: 0 };
  loading    = false;
  filterForm: FormGroup;

  // ── Contexto activo ────────────────────────────────────────────────────────
  ejercicioActual?: number;
  periodoActual?:   number;
  rfcActual?:       string;

  // ── Modal editor ───────────────────────────────────────────────────────────
  showModal    = false;
  editingId:   number | null = null;
  viewMode     = false;
  saving       = false;
  modalError:  string | null = null;

  // ── Modal confirmación ─────────────────────────────────────────────────────
  showConfirm      = false;
  confirmTitle     = '';
  confirmMsg       = '';
  confirmBtn       = '';
  confirmClass     = '';
  confirmIcon      = '';
  confirmShowMotivo = false;
  confirmMotivo     = '';
  private confirmCb: (() => void) | null = null;

  polizaForm:  FormGroup;
  movimientos: {
    cuentaId:    number | null;
    cuenta:      AccountPlan | null;
    concepto:    string;
    serie:       string;
    ventaFecha:  string;
    centroCosto: string;
    debe:        number | null;
    haber:       number | null;
    cfdiUuid:          string;
    rfcTercero:        string;
    _sinRegla?:        boolean;
    cuentaFaltante?:   boolean;
    comparisonStatus?: string | null;
  }[] = [];

  // ── Búsqueda de cuentas ────────────────────────────────────────────────────
  cuentaSearch:    string[] = [];
  cuentaResults:   AccountPlan[][] = [];
  private cuentaSearch$ = new Subject<{ i: number; term: string }>();

  // ── Catálogos ──────────────────────────────────────────────────────────────
  readonly tiposPoliza = [
    { value: 'I', label: 'Ingreso' },
    { value: 'E', label: 'Egreso' },
    { value: 'P', label: 'Pago' },
  ];

  readonly Math  = Math;
  readonly meses = [
    { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' }, { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' }, { value: 5, label: 'Mayo' },    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },  { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' }, { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
  ];

  generando          = false;
  descargandoReporte = false;
  tipoCfdi: 'I' | 'E' | 'P' = 'I';
  propuestaMeta: PolizaPropuesta['_meta'] | null = null;
  generarAviso: GenerarYGuardarResult | null = null;

  // ── Tabs ───────────────────────────────────────────────────────────────────
  activeTab: 'polizas' | 'reglas' | 'balanza' | 'balance' | 'saldos' = 'polizas';

  // ── Balanza preliminar ─────────────────────────────────────────────────────
  balanza:          BalanzaPreliminar | null = null;
  balanzaLoading    = false;
  balanzaTipoCfdi   = '';          // '' = todos, 'I', 'E', 'P'
  balanzaFiltro     = '';          // búsqueda en tabla
  exportandoBalanza = false;

  get balanzaCuentasFiltradas(): BalanzaCuenta[] {
    if (!this.balanza) return [];
    const q = this.balanzaFiltro.toLowerCase().trim();
    if (!q) return this.balanza.cuentas;
    return this.balanza.cuentas.filter(c =>
      c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q),
    );
  }

  // Agrupación por tipo de cuenta con subtotales
  get balanzaGrupos(): { tipo: string; cuentas: BalanzaCuenta[]; sub: { saldoInicial: number; debe: number; haber: number; saldo: number; movCount: number } }[] {
    const tipoOrder = ['Activo', 'Pasivo', 'Capital', 'Ingreso', 'Gasto', 'Costo'];
    const cuentas   = this.balanzaCuentasFiltradas;
    const map       = new Map<string, BalanzaCuenta[]>();
    for (const c of cuentas) {
      const t = c.tipo || 'Otros';
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(c);
    }
    const ordered = [
      ...tipoOrder.filter(t => map.has(t)),
      ...[...map.keys()].filter(t => !tipoOrder.includes(t)),
    ];
    return ordered.map(tipo => {
      const cs  = map.get(tipo)!;
      const sub = cs.reduce(
        (a, c) => ({
          saldoInicial: a.saldoInicial + (c.saldoInicial ?? 0),
          debe:         a.debe + c.debe,
          haber:        a.haber + c.haber,
          saldo:        a.saldo + c.saldo,
          movCount:     a.movCount + (c.movCount ?? 0),
        }),
        { saldoInicial: 0, debe: 0, haber: 0, saldo: 0, movCount: 0 },
      );
      return { tipo, cuentas: cs, sub };
    });
  }

  // Naturaleza anormal: saldo contrario al esperado por tipo de cuenta
  private readonly TIPOS_DEUDOR   = ['Activo', 'Gasto', 'Costo'];
  private readonly TIPOS_ACREEDOR = ['Pasivo', 'Capital', 'Ingreso'];

  isNaturalezaAnormal(c: BalanzaCuenta): boolean {
    if (Math.abs(c.saldo) < 0.005) return false;           // saldo cero: no anormal
    if (this.TIPOS_DEUDOR.includes(c.tipo)   && c.saldo < 0) return true;  // activo/gasto con saldo acreedor
    if (this.TIPOS_ACREEDOR.includes(c.tipo) && c.saldo > 0) return true;  // pasivo/capital/ingreso con saldo deudor
    return false;
  }

  get balanzaAnormalesCount(): number {
    return this.balanzaCuentasFiltradas.filter(c => this.isNaturalezaAnormal(c)).length;
  }

  // Totales de las cuentas mostradas (respeta filtro)
  get balanzaTotalesFiltrados() {
    return this.balanzaGrupos.reduce(
      (a, g) => ({
        saldoInicial: a.saldoInicial + g.sub.saldoInicial,
        debe:         a.debe + g.sub.debe,
        haber:        a.haber + g.sub.haber,
        saldo:        a.saldo + g.sub.saldo,
        movCount:     a.movCount + g.sub.movCount,
      }),
      { saldoInicial: 0, debe: 0, haber: 0, saldo: 0, movCount: 0 },
    );
  }

  // ── Balance General ────────────────────────────────────────────────────────
  balanceG:          BalanceGeneral | null = null;
  balanceGLoading    = false;
  exportandoBalanceG = false;

  cargarBalanceGeneral(): void {
    if (!this.rfcActual || !this.ejercicioActual || !this.periodoActual) {
      this.toast.error('Selecciona una entidad y periodo activo primero');
      return;
    }
    this.balanceGLoading = true;
    this.balanceG        = null;
    this.cfdiMappingSvc.balanceGeneral({
      rfc:       this.rfcActual,
      ejercicio: this.ejercicioActual,
      periodo:   this.periodoActual,
    }).pipe(timeout(120000)).subscribe({
      next:  (b) => { this.balanceG = b; this.balanceGLoading = false; },
      error: (err) => {
        this.balanceGLoading = false;
        this.toast.error(err?.error?.error || 'Error al generar balance general');
      },
    });
  }

  async exportarBalanceGeneral(): Promise<void> {
    if (!this.balanceG || this.exportandoBalanceG) return;
    this.exportandoBalanceG = true;
    try {
      const ExcelJS = await import('exceljs').then(m => m.default ?? m);
      const bg = this.balanceG;
      const { ejercicio, periodo } = bg.meta;
      const mesLabel = this.meses.find(m => m.value === periodo)?.label ?? '';

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Balance General', { views: [{ state: 'frozen', ySplit: 3 }] });

      const HDR_ACTIVO  = '059669';
      const HDR_PASIVO  = '7C3AED';
      const SUBHDR_BG   = 'F0FDF4';
      const SUBHDR_BG2  = 'F5F3FF';
      const borderThin  = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
      const borders     = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

      ws.columns = [
        { width: 14 }, { width: 38 }, { width: 16 },
        { width: 2  },
        { width: 14 }, { width: 38 }, { width: 16 },
      ];

      // Fila 1: Título
      ws.mergeCells('A1:G1');
      const t = ws.getCell('A1');
      t.value = `BALANCE GENERAL — ${ejercicio} · ${mesLabel}`;
      t.font  = { bold: true, size: 14, color: { argb: 'FF1E40AF' } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 28;

      // Fila 2: Meta
      ws.mergeCells('A2:G2');
      const m2 = ws.getCell('A2');
      m2.value = `${bg.meta.totalCfdis} CFDIs procesados · ${bg.meta.sinRegla} sin regla · ${bg.totales.cuadra ? '✓ Cuadra' : '✗ No cuadra'}`;
      m2.font  = { size: 9, color: { argb: bg.totales.cuadra ? 'FF059669' : 'FFDC2626' } };
      m2.alignment = { horizontal: 'center' };
      ws.getRow(2).height = 16;

      // Fila 3: Encabezados columnas
      const row3 = ws.getRow(3);
      row3.height = 20;
      ['Código','Cuenta','Saldo'].forEach((h, i) => {
        const cell = row3.getCell(i + 1);
        cell.value = h;
        cell.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + HDR_ACTIVO } };
        cell.alignment = { vertical: 'middle', horizontal: i === 2 ? 'right' : 'left' };
        cell.border = borders;
      });
      ['Código','Cuenta','Saldo'].forEach((h, i) => {
        const cell = row3.getCell(i + 5);
        cell.value = h;
        cell.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + HDR_PASIVO } };
        cell.alignment = { vertical: 'middle', horizontal: i === 2 ? 'right' : 'left' };
        cell.border = borders;
      });

      let rowA = 4; // cursor activo (lado izquierdo)
      let rowP = 4; // cursor pasivo (lado derecho)

      const addSubHeader = (rowIdx: number, label: string, isLeft: boolean, bg: string) => {
        const colStart = isLeft ? 1 : 5;
        const r = ws.getRow(rowIdx);
        r.height = 17;
        for (let c = 0; c < 3; c++) {
          const cell = r.getCell(colStart + c);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
          cell.border = borders;
        }
        r.getCell(colStart).value = label;
        r.getCell(colStart).font = { bold: true, size: 10 };
      };

      const addCuentaRow = (rowIdx: number, c: BalanzaCuenta, monto: number, isLeft: boolean) => {
        const colStart = isLeft ? 1 : 5;
        const r = ws.getRow(rowIdx);
        r.height = 14;
        r.getCell(colStart).value     = c.codigo;
        r.getCell(colStart + 1).value = c.nombre;
        r.getCell(colStart + 2).value = monto;
        r.getCell(colStart + 2).numFmt = '#,##0.00';
        r.getCell(colStart + 2).alignment = { horizontal: 'right' };
        [0, 1, 2].forEach(i => { r.getCell(colStart + i).border = borders; });
      };

      const addTotalRow = (rowIdx: number, label: string, total: number, isLeft: boolean, color: string) => {
        const colStart = isLeft ? 1 : 5;
        const r = ws.getRow(rowIdx);
        r.height = 16;
        [0, 1, 2].forEach(i => {
          const cell = r.getCell(colStart + i);
          cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
          cell.font   = { bold: true, size: 10 };
          cell.border = borders;
        });
        r.getCell(colStart).value     = label;
        r.getCell(colStart + 2).value = total;
        r.getCell(colStart + 2).numFmt = '#,##0.00';
        r.getCell(colStart + 2).alignment = { horizontal: 'right' };
      };

      // ── ACTIVO (izquierda) ──
      addSubHeader(rowA++, 'ACTIVO', true, SUBHDR_BG);
      bg.activo.cuentas.forEach(c => addCuentaRow(rowA++, c, c.saldo, true));
      addTotalRow(rowA++, 'TOTAL ACTIVO', bg.totales.activo, true, 'D1FAE5');

      // ── PASIVO (derecha) ──
      addSubHeader(rowP++, 'PASIVO', false, SUBHDR_BG2);
      bg.pasivo.cuentas.forEach(c => addCuentaRow(rowP++, c, Math.abs(c.saldo), false));
      addTotalRow(rowP++, 'TOTAL PASIVO', bg.pasivo.total, false, 'EDE9FE');

      // ── CAPITAL (derecha) ──
      addSubHeader(rowP++, 'CAPITAL', false, SUBHDR_BG2);
      bg.capital.cuentas.forEach(c => addCuentaRow(rowP++, c, Math.abs(c.saldo), false));
      addTotalRow(rowP++, 'TOTAL CAPITAL', bg.capital.total, false, 'EDE9FE');

      // ── RESULTADO DEL EJERCICIO (derecha) ──
      addSubHeader(rowP++, 'RESULTADO DEL EJERCICIO', false, SUBHDR_BG2);
      bg.resultados.ingresos.cuentas.forEach(c => addCuentaRow(rowP++, c, Math.abs(c.saldo), false));
      addSubHeader(rowP++, '  Menos: Gastos', false, 'FFF7ED');
      bg.resultados.gastos.cuentas.forEach(c => addCuentaRow(rowP++, c, c.saldo, false));
      addTotalRow(rowP++, bg.resultados.utilidad >= 0 ? 'UTILIDAD DEL EJERCICIO' : 'PÉRDIDA DEL EJERCICIO',
        Math.abs(bg.resultados.utilidad), false, bg.resultados.utilidad >= 0 ? 'D1FAE5' : 'FEE2E2');

      // ── TOTAL PASIVO + CAPITAL (derecha) ──
      rowP++;
      addTotalRow(rowP++, 'TOTAL PASIVO + CAPITAL', bg.totales.pasivoCapital, false,
        bg.totales.cuadra ? 'A7F3D0' : 'FECACA');

      const buf  = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `Balance_General_${ejercicio}_${String(periodo).padStart(2, '0')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      this.exportandoBalanceG = false;
    }
  }

  cargarBalanza(): void {
    if (!this.rfcActual || !this.ejercicioActual || !this.periodoActual) {
      this.toast.error('Selecciona una entidad y periodo activo primero');
      return;
    }
    this.balanzaLoading = true;
    this.balanza        = null;
    this.cfdiMappingSvc.balanzaPreliminar({
      rfc:       this.rfcActual,
      ejercicio: this.ejercicioActual,
      periodo:   this.periodoActual,
      tipoCfdi:  this.balanzaTipoCfdi || undefined,
    }).pipe(timeout(120000)).subscribe({
      next:  (b) => { this.balanza = b; this.balanzaLoading = false; },
      error: (err) => {
        this.balanzaLoading = false;
        this.toast.error(err?.error?.error || 'Error al generar balanza');
      },
    });
  }

  async exportarBalanza(): Promise<void> {
    if (!this.balanza || this.exportandoBalanza) return;
    this.exportandoBalanza = true;
    try {
    const ExcelJS  = await import('exceljs').then(m => m.default ?? m);
    const { ejercicio, periodo } = this.balanza.meta;
    const mesLabel = this.meses.find(m => m.value === periodo)?.label ?? '';
    const nom      = `Balanza_Preliminar_${ejercicio}_${String(periodo).padStart(2, '0')}`;
    const grupos   = this.balanzaGrupos;
    const totales  = this.balanzaTotalesFiltrados;

    // Helpers para split Deudor / Acreedor
    const deudor   = (v: number) => v > 0.005 ? v : (undefined as unknown as number);
    const acreedor = (v: number) => v < -0.005 ? Math.abs(v) : (undefined as unknown as number);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Balanza', { views: [{ state: 'frozen', ySplit: 4 }] });

    const borderThin  = { style: 'thin'   as const, color: { argb: 'FFD1D5DB' } };
    const borderMed   = { style: 'medium' as const, color: { argb: 'FF4F46E5' } };
    const borders     = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    const bordersHdr  = { top: borderMed,  left: borderMed,  bottom: borderMed,  right: borderMed  };
    const tipoColor: Record<string, string> = {
      Activo: 'FFDBEAFE', Pasivo: 'FFFCE7F3', Capital: 'FFD1FAE5',
      Ingreso: 'FFDCFCE7', Gasto: 'FFFEE2E2', Costo: 'FFFFF7ED',
    };
    const NUM_FMT = '#,##0.00';
    const HDR_BG  = 'FF4F46E5';
    const HDR_FG  = 'FFFFFFFF';

    // ── Fila 1: Empresa / RFC ────────────────────────────────────────────────
    ws.mergeCells('A1:H1');
    const r1 = ws.getCell('A1');
    r1.value     = `RFC: ${this.rfcActual ?? ''}`;
    r1.font      = { bold: true, size: 12 };
    r1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 22;

    // ── Fila 2: Título / periodo ──────────────────────────────────────────────
    ws.mergeCells('A2:H2');
    const r2 = ws.getCell('A2');
    r2.value     = `Balanza de comprobación — ${mesLabel} ${ejercicio}`;
    r2.font      = { bold: true, size: 11, color: { argb: 'FF4F46E5' } };
    r2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    // ── Fila 3: Grupos de encabezado ──────────────────────────────────────────
    ws.getRow(3).height = 16;
    // A3:B3 — span Cuenta / Nombre
    ws.mergeCells('A3:B3');
    // C3:D3 — Saldos Iniciales
    ws.mergeCells('C3:D3');
    // E3:F3 — Movimientos
    ws.mergeCells('E3:F3');
    // G3:H3 — Saldos Actuales
    ws.mergeCells('G3:H3');

    const grpHdrs: { cell: string; label: string }[] = [
      { cell: 'A3', label: 'Cuenta / Nombre' },
      { cell: 'C3', label: 'Saldos Iniciales' },
      { cell: 'E3', label: 'Movimientos' },
      { cell: 'G3', label: 'Saldos Actuales' },
    ];
    grpHdrs.forEach(({ cell, label }) => {
      const c  = ws.getCell(cell);
      c.value     = label;
      c.font      = { bold: true, size: 9, color: { argb: HDR_FG } };
      c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border    = bordersHdr;
    });

    // ── Fila 4: Subencabezados ────────────────────────────────────────────────
    ws.getRow(4).height = 18;
    const subHdrs = ['Cuenta', 'Nombre', 'Deudor', 'Acreedor', 'Cargos', 'Abonos', 'Deudor', 'Acreedor'];
    subHdrs.forEach((h, i) => {
      const cell = ws.getRow(4).getCell(i + 1);
      cell.value     = h;
      cell.font      = { bold: true, size: 9, color: { argb: HDR_FG } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
      cell.alignment = { vertical: 'middle', horizontal: i >= 2 ? 'right' : 'left' };
      cell.border    = bordersHdr;
    });

    // ── Datos por grupo ───────────────────────────────────────────────────────
    let rowIdx = 5;

    for (const grupo of grupos) {
      // Encabezado de grupo
      const gr = ws.getRow(rowIdx++);
      gr.height = 14;
      ws.mergeCells(`A${gr.number}:H${gr.number}`);
      const gc = gr.getCell(1);
      gc.value     = grupo.tipo.toUpperCase();
      gc.font      = { bold: true, size: 9, color: { argb: 'FF374151' } };
      gc.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: tipoColor[grupo.tipo] ?? 'FFF3F4F6' } };
      gc.alignment = { horizontal: 'left', vertical: 'middle' };
      gc.border    = borders;

      // Filas de cuentas
      grupo.cuentas.forEach((c, i) => {
        const row  = ws.getRow(rowIdx++);
        row.height = 14;
        const anorm = this.isNaturalezaAnormal(c);
        const bg    = anorm ? 'FFFFF7ED' : (i % 2 === 1 ? 'FFF9FAFB' : 'FFFFFFFF');
        const si    = c.saldoInicial ?? 0;
        const sf    = c.saldo        ?? 0;

        const vals: (number | string | undefined)[] = [
          c.codigo, c.nombre,
          deudor(si),   acreedor(si),
          c.debe,        c.haber,
          deudor(sf),   acreedor(sf),
        ];
        vals.forEach((v, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value     = v ?? null;
          cell.border    = borders;
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          cell.alignment = { vertical: 'middle', horizontal: ci >= 2 ? 'right' : 'left' };
          if (ci >= 2) cell.numFmt = NUM_FMT;
          if (anorm && (ci === 2 || ci === 3 || ci === 6 || ci === 7)) {
            cell.font = { color: { argb: 'FFC2410C' } };
          }
        });
      });

      // Subtotal del grupo
      const sr = ws.getRow(rowIdx++);
      sr.height = 15;
      ws.mergeCells(`A${sr.number}:B${sr.number}`);
      const sl = sr.getCell(1);
      sl.value     = `Subtotal ${grupo.tipo}`;
      sl.font      = { bold: true, size: 9, color: { argb: 'FF4F46E5' } };
      sl.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
      sl.alignment = { horizontal: 'right', vertical: 'middle' };
      sl.border    = borders;

      const gsi = grupo.sub.saldoInicial;
      const gsf = grupo.sub.saldo;
      [
        { col: 3, val: deudor(gsi)   },
        { col: 4, val: acreedor(gsi) },
        { col: 5, val: grupo.sub.debe  },
        { col: 6, val: grupo.sub.haber },
        { col: 7, val: deudor(gsf)   },
        { col: 8, val: acreedor(gsf) },
      ].forEach(({ col, val }) => {
        const cell = sr.getCell(col);
        cell.value     = val ?? null;
        cell.numFmt    = NUM_FMT;
        cell.font      = { bold: true, color: { argb: 'FF4F46E5' } };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.border    = borders;
      });
    }

    // ── Sumas iguales ─────────────────────────────────────────────────────────
    const tr = ws.getRow(rowIdx);
    tr.height = 22;
    ws.mergeCells(`A${tr.number}:B${tr.number}`);
    const tl = tr.getCell(1);
    tl.value     = 'Sumas Iguales';
    tl.font      = { bold: true, size: 10, color: { argb: HDR_FG } };
    tl.alignment = { horizontal: 'right', vertical: 'middle' };
    tl.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
    tl.border    = bordersHdr;

    const tsi = totales.saldoInicial;
    const tsf = totales.saldo;
    const cuadra = Math.abs(totales.debe - totales.haber) < 0.01;
    [
      { col: 3, val: deudor(tsi)   },
      { col: 4, val: acreedor(tsi) },
      { col: 5, val: totales.debe  },
      { col: 6, val: totales.haber },
      { col: 7, val: deudor(tsf)   },
      { col: 8, val: acreedor(tsf) },
    ].forEach(({ col, val }) => {
      const cell = tr.getCell(col);
      cell.value     = val ?? null;
      cell.numFmt    = NUM_FMT;
      cell.font      = { bold: true, size: 10, color: { argb: HDR_FG } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: cuadra ? 'FF15803D' : 'FFDC2626' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border    = bordersHdr;
    });

    ws.columns = [
      { width: 16 }, { width: 42 },
      { width: 16 }, { width: 16 },
      { width: 16 }, { width: 16 },
      { width: 16 }, { width: 16 },
    ];
    ws.autoFilter = { from: 'A4', to: 'H4' };

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = `${nom}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    } catch (err) {
      console.error('exportarBalanza error:', err);
      this.toast.error('Error al generar el Excel. Revisa la consola para más detalles.');
    } finally {
      this.exportandoBalanza = false;
    }
  }

  // ── Reglas CFDI ────────────────────────────────────────────────────────────
  rules:          CfdiMappingRule[] = [];
  loadingRules    = false;
  showRuleModal   = false;
  editingRuleId:  number | null = null;
  savingRule      = false;
  ruleModalError: string | null = null;
  ruleForm:       FormGroup;
  showDeleteRuleConfirm = false;
  deletingRule:   CfdiMappingRule | null = null;
  deletingRuleInProgress = false;

  readonly tiposCfdiOpts = [
    { value: '',  label: 'Cualquiera (comodín)' },
    { value: 'I', label: 'I — Ingreso' },
    { value: 'E', label: 'E — Egreso' },
    { value: 'P', label: 'P — Pago' },
  ];

  readonly metodoPagoOpts = [
    { value: '',    label: 'Cualquiera' },
    { value: 'PPD', label: 'PPD — Pago en parcialidades o diferido' },
    { value: 'PUE', label: 'PUE — Pago en una sola exhibición' },
  ];

  readonly formasPagoOpts = [
    { value: '',   label: 'Cualquiera' },
    { value: '01', label: '01 — Efectivo' },
    { value: '02', label: '02 — Cheque nominativo' },
    { value: '03', label: '03 — Transferencia electrónica' },
    { value: '04', label: '04 — Tarjeta de crédito' },
    { value: '28', label: '28 — Tarjeta de débito' },
    { value: '29', label: '29 — Tarjeta de servicios' },
    { value: '99', label: '99 — Por definir' },
  ];

  // ── Búsqueda de cuentas en modal de regla ──────────────────────────────────
  readonly ruleAccountFields = ['cuentaCargo','cuentaAbono','cuentaIva','cuentaIvaPPD','cuentaIvaRetenido','cuentaIsrRetenido'] as const;
  ruleAccountSearch:  Record<string, string>       = {};
  ruleAccountResults: Record<string, AccountPlan[]> = {};
  private ruleAccountSearch$ = new Subject<{ field: string; term: string }>();

  constructor(
    private svc:           PolizaService,
    private cfdiMappingSvc: CfdiMappingService,
    private accountSvc:    AccountPlanService,
    private toast:         ToastService,
    private entidadSvc:    EntidadActivaService,
    private periodoSvc:    PeriodoActivoService,
    public  auth:          AuthService,
    private fb:            FormBuilder,
  ) {
    this.filterForm = this.fb.group({
      tipo:   [''],
      estado: [''],
    });

    this.polizaForm = this.fb.group({
      tipo:        ['I'],
      fecha:       [new Date().toISOString().slice(0, 10)],
      concepto:    [''],
      ejercicio:   [null],
      periodo:     [null],
      folio:       [''],
      centroCosto: [''],
    });

    this.ruleForm = this.fb.group({
      nombre:            ['', Validators.required],
      tipoComprobante:   [null],
      rfcEmisor:         [''],
      metodoPago:        [null],
      formaPago:         [null],
      cuentaCargo:       ['', Validators.required],
      cuentaAbono:       ['', Validators.required],
      cuentaIva:         [''],
      cuentaIvaPPD:      [''],
      cuentaIvaRetenido: [''],
      cuentaIsrRetenido: [''],
      centroCosto:       [''],
      prioridad:         [10, [Validators.required, Validators.min(1)]],
      isActive:          [true],
    });
  }

  isAdmin = false;

  ngOnInit(): void {
    this.isAdmin = this.auth.currentUser.role === 'admin';
    this.auth.roleLoaded$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.isAdmin = this.auth.currentUser.role === 'admin';
    });

    this.entidadSvc.entidadActiva$.pipe(takeUntil(this.destroy$)).subscribe(e => {
      this.rfcActual = e?.rfc;
    });
    this.periodoSvc.periodoActivo$.pipe(takeUntil(this.destroy$)).subscribe(p => {
      this.ejercicioActual = p?.ejercicio ?? undefined;
      this.periodoActual   = p?.periodo   ?? undefined;
      // Recargar lista cuando cambia el periodo activo (y ya hay datos suficientes)
      if (this.rfcActual && this.ejercicioActual && this.periodoActual) {
        this.load(1);
      }
    });

    this.filterForm.valueChanges.pipe(
      skip(1), debounceTime(200), distinctUntilChanged(), takeUntil(this.destroy$),
      switchMap(() => {
        this.loading = true;
        return this.svc.list({
          rfc: this.rfcActual, ejercicio: this.ejercicioActual, periodo: this.periodoActual,
          tipo: this.filterForm.value.tipo || undefined, estado: this.filterForm.value.estado || undefined,
          page: 1, limit: this.pagination.limit,
        }).pipe(catchError(() => { this.loading = false; return EMPTY; }));
      }),
    ).subscribe({
      next: (res) => {
        this.polizas    = [...res.polizas];
        this.pagination = { total: res.total, page: 1, limit: res.limit, pages: res.pages };
        this.loading    = false;
      },
    });

    // Búsqueda de cuenta con debounce y cancelación del request anterior
    this.cuentaSearch$.pipe(
      debounceTime(200),
      switchMap(({ i, term }) => {
        if (!term || term.length < 2) {
          this.cuentaResults[i] = [];
          return EMPTY;
        }
        return this.accountSvc.search(term).pipe(map(results => ({ i, results })));
      }),
      takeUntil(this.destroy$),
    ).subscribe(({ i, results }) => {
      this.cuentaResults[i] = results;
    });

    this.ruleAccountSearch$.pipe(
      debounceTime(200),
      switchMap(({ field, term }) => {
        if (!term || term.length < 2) {
          this.ruleAccountResults[field] = [];
          return EMPTY;
        }
        return this.accountSvc.search(term).pipe(map(results => ({ field, results })));
      }),
      takeUntil(this.destroy$),
    ).subscribe(({ field, results }) => {
      this.ruleAccountResults[field] = results;
    });

    // load(1) se dispara desde periodoActivo$ cuando los filtros estén listos
    // Las reglas se cargan lazy al abrir la pestaña, no al entrar a la página
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  // ── Carga ──────────────────────────────────────────────────────────────────
  load(page = 1): void {
    this.loading = true;
    const f = this.filterForm.value;
    this.svc.list({
      rfc:       this.rfcActual,
      ejercicio: this.ejercicioActual,
      periodo:   this.periodoActual,
      tipo:   f.tipo   || undefined,
      estado: f.estado || undefined,
      page,
      limit:            this.pagination.limit,
    }).subscribe({
      next: (res) => {
        this.polizas    = [...res.polizas];
        this.pagination = { total: res.total, page: res.page, limit: res.limit, pages: res.pages };
        this.loading    = false;
      },
      error: (err) => {
        this.loading = false;
        const msg = err?.error?.error || err?.error?.message || err?.message || `HTTP ${err?.status}`;
        this.toast.error(`Error cargando lista: ${msg}`);
      },
    });
  }

  // ── Estado / tipo helpers ──────────────────────────────────────────────────
  tipoLabel(t: PolizaTipo): string {
    return this.tiposPoliza.find(x => x.value === t)?.label ?? t;
  }

  estadoClass(e: PolizaEstado | undefined): string {
    const map: Record<string, string> = {
      borrador:       'badge-warning',
      contabilizada:  'badge-success',
      cancelada:      'badge-danger',
    };
    return map[e ?? ''] ?? 'badge-secondary';
  }

  // Metadatos del modal (número/estado de la póliza editada)
  editingNumero?: number;
  editingEstado?: string;

  // ── Modal: abrir/cerrar ────────────────────────────────────────────────────
  openCreate(): void {
    this.editingId     = null;
    this.editingNumero = undefined;
    this.editingEstado = undefined;
    this.modalError    = null;
    this.viewMode = false;
    this.polizaForm.reset({
      tipo:        'I',
      fecha:       new Date().toISOString().slice(0, 10),
      concepto:    '',
      ejercicio:   this.ejercicioActual ?? null,
      periodo:     this.periodoActual   ?? null,
      folio:       '',
      centroCosto: '',
    });
    this.movimientos  = [this.emptyMovimiento(), this.emptyMovimiento()];
    this.cuentaSearch = this.movimientos.map(() => '');
    this.cuentaResults = this.movimientos.map(() => []);
    this.cfdiAlertMap = {};
    this.movFiltroSerie = ''; this.movFiltroCentro = ''; this.movFiltroFormaPago = '';
    this.movPageIdx = 0; this.recalcTotales();
    this.showModal = true;
  }

  openEdit(p: Poliza): void {
    if (!p.id) return;
    this.loading = true;
    this.svc.getById(p.id).subscribe({
      next: (full) => {
        this.loading       = false;
        this.editingId     = full.id ?? null;
        this.editingNumero = full.numero;
        this.editingEstado = full.estado;
        this.modalError    = null;
        this.polizaForm.patchValue({
          tipo:        full.tipo,
          fecha:       full.fecha,
          concepto:    full.concepto,
          ejercicio:   full.ejercicio,
          periodo:     full.periodo,
          folio:       full.folio        ?? '',
          centroCosto: full.centroCosto  ?? '',
        });
        const rawMovs = (full.movimientos ?? []).map(m => ({
          cuentaId:       m.cuentaId,
          cuenta:         m.cuenta as any ?? null,
          concepto:       m.concepto,
          serie:          m.serie        ?? '',
          ventaFecha:     m.ventaFecha   ?? '',
          centroCosto:    m.centroCosto  ?? '',
          debe:           Number(m.debe),
          haber:          Number(m.haber),
          cfdiUuid:       m.cfdiUuid     ?? '',
          rfcTercero:     m.rfcTercero   ?? '',
          cuentaFaltante: m.cuentaFaltante ?? false,
        }));
        // Reagrupar para que todos los movimientos del mismo CFDI queden juntos,
        // respetando el orden de primera aparición de cada UUID (los movimientos
        // pueden llegar dispersos desde la BD cuando cargo y abono no son consecutivos)
        const uuidGroups = new Map<string, typeof rawMovs>();
        for (const m of rawMovs) {
          const k = m.cfdiUuid || '\x00';
          if (!uuidGroups.has(k)) uuidGroups.set(k, []);
          uuidGroups.get(k)!.push(m);
        }
        this.movimientos = [...uuidGroups.values()].flat();
        if (this.movimientos.length === 0) this.movimientos = [this.emptyMovimiento(), this.emptyMovimiento()];
        this.cuentaSearch  = this.movimientos.map(m =>
          m.cuentaFaltante ? '⚠ Cuenta no encontrada' :
          m.cuenta ? `${(m.cuenta as any).codigo} - ${(m.cuenta as any).nombre}` : '');
        this.cuentaResults = this.movimientos.map(() => []);
        this.cfdiAlertMap  = full.cfdiAlertMap ?? {};
        this.cfdiMetaMap   = full.cfdiMetaMap  ?? {};
        this.viewMode = true;
        this.movFiltroSerie = ''; this.movFiltroCentro = ''; this.movFiltroFormaPago = '';
        this.soloDescuadradosModal = false;
        this.movPageIdx = 0; this.recalcTotales();
        this.showModal = true;
      },
      error: () => { this.loading = false; },
    });
  }

  closeModal(): void { this.showModal = false; this.propuestaMeta = null; }

  // ── Movimientos ────────────────────────────────────────────────────────────
  private emptyMovimiento() {
    return {
      cuentaId:   null as number | null,
      cuenta:     null as AccountPlan | null,
      concepto:   '',
      serie:      '',
      ventaFecha: '',
      centroCosto:'',
      debe:       null as number | null,
      haber:      null as number | null,
      cfdiUuid:   '',
      rfcTercero: '',
      _sinRegla:  false,
    };
  }

  addMovimiento(): void {
    this.movimientos.push(this.emptyMovimiento());
    this.cuentaSearch.push('');
    this.cuentaResults.push([]);
    // Ir a la última página para que el usuario vea la fila nueva
    const lastPage = this.movPageCount - 1;
    this.movPageIdx = lastPage;
    this.movOffset  = lastPage * this.MOV_PAGE_SIZE;
    this.recalcTotales();
  }

  removeMovimiento(i: number): void {
    if (this.movimientos.length <= 2) return;
    this.movimientos.splice(i, 1);
    this.cuentaSearch.splice(i, 1);
    this.cuentaResults.splice(i, 1);
    if (this.movPageIdx >= this.movPageCount) this.movGoPage(this.movPageCount - 1);
    this.recalcTotales();
  }

  // ── Búsqueda de cuenta ─────────────────────────────────────────────────────
  searchCuenta(i: number, term: string): void {
    this.cuentaSearch[i] = term;
    this.movimientos[i].cuentaId = null;
    this.movimientos[i].cuenta   = null;
    this.cuentaSearch$.next({ i, term });
  }

  selectCuenta(i: number, c: AccountPlan): void {
    this.movimientos[i].cuentaId = c.id;
    this.movimientos[i].cuenta   = c;
    this.cuentaSearch[i]         = `${c.codigo} - ${c.nombre}`;
    this.cuentaResults[i]        = [];
  }

  // ── Totales (cacheados — no getters para evitar O(n) en cada CD) ──────────
  totalDebe  = 0;
  totalHaber = 0;
  isBalanced = true;

  /** CFDIs cuyo asiento interno no balancea (debe ≠ haber del grupo) */
  imbalancedUuids = new Set<string>();
  /** true = fondo gris, false = fondo blanco — alterna por grupo CFDI */
  cfdiAsientoGris = new Map<string, boolean>();
  /** Alertas SAT/ERP por UUID — poblado al abrir una póliza existente */
  cfdiAlertMap: Record<string, CfdiAlertInfo> = {};
  cfdiMetaMap:  Record<string, CfdiMetaInfo>  = {};
  /** Índice absoluto de la primera fila de cada grupo CFDI (para mostrar badge solo una vez) */
  cfdiFirstRowIdx = new Map<string, number>();

  tieneCuentasFaltantes = false;

  // ── Filtros de movimientos ──────────────────────────────────────────────
  movFiltroSerie       = '';
  movFiltroCentro      = '';
  movFiltroFormaPago   = '';
  soloDescuadradosModal = false;
  movimientosFiltrados: typeof this.movimientos = [];
  movFilterOpen        = { serie: false, centro: false, formaPago: false };

  @HostListener('document:click')
  onDocumentClick(): void {
    this.movFilterOpen.serie   = false;
    this.movFilterOpen.centro  = false;
  }

  toggleMovFilter(col: 'serie' | 'centro' | 'formaPago', event: MouseEvent): void {
    event.stopPropagation();
    const wasOpen = this.movFilterOpen[col];
    this.movFilterOpen.serie     = false;
    this.movFilterOpen.centro    = false;
    this.movFilterOpen.formaPago = false;
    this.movFilterOpen[col]      = !wasOpen;
  }

  toggleSoloDescuadrados(): void {
    this.soloDescuadradosModal = !this.soloDescuadradosModal;
    this.aplicarFiltros();
  }

  aplicarFiltros(): void {
    const s  = this.movFiltroSerie.toLowerCase().trim();
    const c  = this.movFiltroCentro.toLowerCase().trim();
    const fp = this.movFiltroFormaPago.toLowerCase().trim();
    let filtered = (s || c || fp)
      ? this.movimientos.filter(m => {
          const metaFp = (m.cfdiUuid ? (this.cfdiMetaMap[m.cfdiUuid]?.formaPago ?? '') : '').toLowerCase();
          return (!s  || (m.serie       ?? '').toLowerCase().includes(s))
              && (!c  || (m.centroCosto ?? '').toLowerCase().includes(c))
              && (!fp || metaFp.includes(fp));
        })
      : this.movimientos;
    if (this.soloDescuadradosModal) {
      filtered = filtered.filter(m => m.cfdiUuid && this.imbalancedUuids.has(m.cfdiUuid));
    }
    this.movimientosFiltrados = filtered;
    this.movPageIdx = 0;
    this._computePageStarts();
    this.movOffset   = 0;
    this.movSliceEnd = this.pageStarts[1] ?? this.movimientosFiltrados.length;
  }

  /** Devuelve el índice REAL en this.movimientos para la posición filtIdx en movimientosFiltrados. */
  getMovIdx(filtIdx: number): number {
    const m = this.movimientosFiltrados[filtIdx];
    return m ? this.movimientos.indexOf(m) : -1;
  }

  /** Texto de cuenta para la fila filtIdx (resuelve el índice real aunque haya filtro activo). */
  getCuentaSearch(filtIdx: number): string {
    const idx = this.getMovIdx(filtIdx);
    return idx >= 0 ? (this.cuentaSearch[idx] ?? '') : '';
  }

  recalcTotales(): void {
    this.totalDebe  = this.movimientos.reduce((s, m) => s + (Number(m.debe)  || 0), 0);
    this.totalHaber = this.movimientos.reduce((s, m) => s + (Number(m.haber) || 0), 0);
    this.isBalanced = Math.abs(this.totalDebe - this.totalHaber) < 0.01;
    this.tieneCuentasFaltantes = this.movimientos.some(m => m.cuentaFaltante);

    // Un solo recorrido: detectar descuadre Y asignar color alternado por asiento
    const byUuid: Record<string, { d: number; h: number }> = {};
    const gris     = new Map<string, boolean>();
    const firstRow = new Map<string, number>();
    let idx = 0;
    let absIdx = 0;
    for (const m of this.movimientos) {
      if (m.cfdiUuid) {
        if (!byUuid[m.cfdiUuid]) {
          byUuid[m.cfdiUuid] = { d: 0, h: 0 };
          gris.set(m.cfdiUuid, idx++ % 2 === 1);   // 0→blanco, 1→gris, 2→blanco…
          firstRow.set(m.cfdiUuid, absIdx);
        }
        byUuid[m.cfdiUuid].d += Number(m.debe)  || 0;
        byUuid[m.cfdiUuid].h += Number(m.haber) || 0;
      }
      absIdx++;
    }
    this.cfdiAsientoGris  = gris;
    this.cfdiFirstRowIdx  = firstRow;
    this.imbalancedUuids  = new Set(
      Object.entries(byUuid)
        .filter(([, v]) => Math.abs(v.d - v.h) > 0.01)
        .map(([uuid]) => uuid),
    );
    // aplicarFiltros usa imbalancedUuids (soloDescuadradosModal) — se llama DESPUÉS de calcularlo
    this.aplicarFiltros();
    // Mantener la página actual si sigue siendo válida, si no volver a la 0
    const p = this.movPageIdx < this.pageStarts.length ? this.movPageIdx : 0;
    this.movPageIdx  = p;
    this.movOffset   = this.pageStarts[p];
    this.movSliceEnd = this.pageStarts[p + 1] ?? this.movimientosFiltrados.length;
  }

  // ── Paginación de movimientos — corta siempre en límites de asiento CFDI ──
  readonly MOV_PAGE_SIZE = 150;
  movPageIdx  = 0;
  movOffset   = 0;
  movSliceEnd = 150;
  /** Índices de inicio de cada página, calculados para no cortar un asiento CFDI */
  pageStarts: number[] = [0];

  get movPageCount(): number { return this.pageStarts.length; }

  get movPaginationPages(): (number | null)[] {
    const total = this.movPageCount;
    const cur   = this.movPageIdx + 1;
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 3)        return [1, 2, 3, null, total];
    if (cur >= total - 2) return [1, null, total - 2, total - 1, total];
    return [1, null, cur, null, total];
  }

  private _computePageStarts(): void {
    const movs = this.movimientosFiltrados;
    const starts: number[] = [0];
    let pageStart   = 0;
    let lastSafeCut = 0;
    for (let i = 1; i < movs.length; i++) {
      const uuid     = movs[i].cfdiUuid;
      const prevUuid = movs[i - 1].cfdiUuid;
      if (uuid !== prevUuid) lastSafeCut = i;
      if (i - pageStart >= this.MOV_PAGE_SIZE) {
        const cut = lastSafeCut > pageStart ? lastSafeCut : i;
        starts.push(cut);
        pageStart   = cut;
        lastSafeCut = cut;
      }
    }
    this.pageStarts = starts;
  }

  movGoPage(p: number): void {
    if (p < 0 || p >= this.pageStarts.length) return;
    this.movPageIdx  = p;
    this.movOffset   = this.pageStarts[p];
    this.movSliceEnd = this.pageStarts[p + 1] ?? this.movimientosFiltrados.length;
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  save(): void {
    if (this.saving) return;
    this.recalcTotales(); // garantizar que los totales están al día antes de validar
    const fv = this.polizaForm.value;

    if (!this.rfcActual)       { this.modalError = 'No hay una entidad activa seleccionada'; return; }
    if (!fv.concepto?.trim()) { this.modalError = 'El concepto es requerido'; return; }
    if (!fv.fecha)             { this.modalError = 'La fecha es requerida';    return; }
    if (!fv.ejercicio)         { this.modalError = 'El ejercicio es requerido'; return; }
    if (!fv.periodo)           { this.modalError = 'El periodo es requerido';   return; }
    const validMov = this.movimientos.filter(m => m.cuentaId);
    if (validMov.length < 2)   { this.modalError = 'Se necesitan al menos 2 movimientos con cuenta'; return; }
    if (this.movimientos.some(m => m.cuentaFaltante)) { this.modalError = 'Hay movimientos con cuenta no encontrada en catálogo. Asigna las cuentas manualmente antes de guardar.'; return; }
    if (!this.isBalanced)      { this.modalError = `La póliza no está balanceada. Debe: ${this.totalDebe.toFixed(2)}, Haber: ${this.totalHaber.toFixed(2)}`; return; }

    const payload: Poliza = {
      ...fv,
      rfc:         this.rfcActual!,
      creadoPor:   this.auth.currentUser.name || this.auth.currentUser.email,
      movimientos: validMov.map((m, i) => ({
        orden:       i + 1,
        cuentaId:    m.cuentaId!,
        concepto:    m.concepto || fv.concepto,
        serie:       m.serie       || undefined,
        ventaFecha:  m.ventaFecha  || undefined,
        centroCosto: m.centroCosto || undefined,
        debe:        Number(m.debe)  || 0,
        haber:       Number(m.haber) || 0,
        cfdiUuid:    m.cfdiUuid   || undefined,
        rfcTercero:  m.rfcTercero || undefined,
      })),
    };

    this.saving     = true;
    this.modalError = null;

    const obs = this.editingId
      ? this.svc.update(this.editingId, payload)
      : this.svc.create(payload);

    obs.subscribe({
      next: () => {
        this.saving    = false;
        this.showModal = false;
        this.toast.success(this.editingId ? 'Póliza actualizada' : 'Póliza creada');
        this.load(this.pagination.page);
      },
      error: (err) => {
        this.saving     = false;
        this.modalError = err?.error?.error || 'Error al guardar la póliza';
      },
    });
  }

  // ── Confirmación modal ─────────────────────────────────────────────────────
  private openConfirm(opts: { title: string; msg: string; btn: string; cls: string; icon: string; showMotivo?: boolean; cb: () => void }): void {
    this.confirmTitle      = opts.title;
    this.confirmMsg        = opts.msg;
    this.confirmBtn        = opts.btn;
    this.confirmClass      = opts.cls;
    this.confirmIcon       = opts.icon;
    this.confirmShowMotivo = opts.showMotivo ?? false;
    this.confirmMotivo     = '';
    this.confirmCb         = opts.cb;
    this.showConfirm       = true;
  }

  closeConfirm(): void { this.showConfirm = false; this.confirmCb = null; this.confirmMotivo = ''; }

  runConfirm(): void {
    if (this.confirmCb) this.confirmCb();
    this.showConfirm = false;
    this.confirmCb   = null;
  }

  // ── Contabilizar ───────────────────────────────────────────────────────────
  contabilizar(p: Poliza): void {
    if (!p.id) return;
    this.openConfirm({
      title: 'Contabilizar póliza',
      msg:   `¿Deseas contabilizar la póliza ${this.tipoLabel(p.tipo)}-${p.numero}? Esta acción cambiará su estado a <strong>Contabilizada</strong> y no podrá editarse.`,
      btn:   'Contabilizar',
      cls:   'btn-confirm-success',
      icon:  '✓',
      cb:    () => this.svc.contabilizar(p.id!).subscribe({
        next:  () => { this.toast.success('Póliza contabilizada'); this.load(this.pagination.page); },
        error: (err) => this.toast.error(err?.error?.error || 'Error al contabilizar'),
      }),
    });
  }

  // ── Cancelar ───────────────────────────────────────────────────────────────
  cancelar(p: Poliza): void {
    if (!p.id) return;
    this.openConfirm({
      title:      'Cancelar asientos',
      msg:        `¿Deseas cancelar los asientos de la póliza ${this.tipoLabel(p.tipo)}-${p.numero}? Esta acción es <strong>irreversible</strong>.`,
      btn:        'Cancelar asientos',
      cls:        'btn-confirm-danger',
      icon:       '✕',
      showMotivo: true,
      cb:         () => this.svc.cancelar(p.id!, this.confirmMotivo || undefined).subscribe({
        next:  () => { this.toast.success('Asientos cancelados'); this.load(this.pagination.page); },
        error: (err) => this.toast.error(err?.error?.error || 'Error al cancelar'),
      }),
    });
  }

  // ── Rol ────────────────────────────────────────────────────────────────────
  canEdit(p: Poliza): boolean {
    return p.estado === 'borrador' || this.isAdmin;
  }

  // ── Revertir a borrador (solo admin) ───────────────────────────────────────
  revertir(p: Poliza): void {
    if (!p.id) return;
    this.openConfirm({
      title:      'Revertir a borrador',
      msg:        `¿Revertir la póliza ${this.tipoLabel(p.tipo)}-${p.numero} a estado <strong>Borrador</strong>? Quedará editable nuevamente.`,
      btn:        'Revertir',
      cls:        'btn-confirm-warning',
      icon:       '↺',
      showMotivo: true,
      cb:         () => this.svc.revertir(p.id!, this.confirmMotivo || undefined).subscribe({
        next:  () => { this.toast.success('Póliza revertida a borrador'); this.load(this.pagination.page); },
        error: (err) => this.toast.error(err?.error?.error || 'Error al revertir'),
      }),
    });
  }

  private readonly _alertLabels: Record<string, string> = {
    solo_sat:                  'Solo en SAT (sin ERP)',
    cancelado_sat:             'Cancelado en SAT',
    cancelacion_pendiente:     'Cancelación Pendiente en ERP',
    cancelado_erp_vigente_sat: 'Cancelado en ERP / Vigente en SAT',
    deshabilitado_erp:         'Deshabilitado en ERP / Vigente en SAT',
    no_encontrado:             'No encontrado en ningún sistema',
  };

  cfdiAlertLabel(uuid: string): string {
    const info = this.cfdiAlertMap[uuid];
    if (!info?.alerts?.length) return '';
    const lines = info.alerts.map(a => this._alertLabels[a] ?? a);
    if (info.satStatus) lines.push(`SAT: ${info.satStatus}`);
    if (info.erpStatus) lines.push(`ERP: ${info.erpStatus}`);
    return lines.join('\n');
  }

  cfdiTooltip(s: NonNullable<Poliza['cfdiSummary']>): string {
    const parts: string[] = [`${s.total} CFDI(s) vinculados`];
    if (s.cancelados > 0)  parts.push(`⚠ ${s.cancelados} cancelado(s) en SAT`);
    if (s.soloSat > 0)     parts.push(`${s.soloSat} solo en SAT (sin ERP)`);
    if (s.ambosLados > 0)  parts.push(`✓ ${s.ambosLados} verificado(s) en ambos lados`);
    return parts.join(' · ');
  }

  trackById(_: number, p: Poliza): number | undefined { return p.id; }

  // ── Reporte de asientos descuadrados ──────────────────────────────────────
  downloadReporteDescuadradas(): void {
    if (!this.rfcActual || !this.ejercicioActual || !this.periodoActual) {
      this.toast.error('Selecciona una entidad y periodo activo primero');
      return;
    }
    this.descargandoReporte = true;
    this.svc.downloadReporteDescuadradas({
      rfc:       this.rfcActual,
      ejercicio: this.ejercicioActual,
      periodo:   this.periodoActual,
    }).subscribe({
      next: (blob) => {
        this.descargandoReporte = false;
        const mes  = String(this.periodoActual!).padStart(2, '0');
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `DescuadradosCFDI_${this.ejercicioActual}_${mes}_${this.rfcActual}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.descargandoReporte = false;
        this.toast.error(err?.error?.message ?? 'Error al generar el reporte');
      },
    });
  }

  // ── Generar y guardar póliza desde CFDIs ──────────────────────────────────
  generarDesdeCfdis(): void {
    if (!this.rfcActual || !this.ejercicioActual || !this.periodoActual) {
      this.toast.error('Selecciona una entidad y periodo activo primero');
      return;
    }
    this.generando = true;
    this.cfdiMappingSvc.generarYGuardar({
      rfc:           this.rfcActual,
      ejercicio:     this.ejercicioActual,
      periodo:       this.periodoActual,
      tipoCfdi:      this.tipoCfdi,
      tipoPropuesta: this.tipoCfdi === 'P' ? 'D' : this.tipoCfdi,  // I→I, E→E, P→D
    }).pipe(
      timeout(300000),
    ).subscribe({
      next: (res: GenerarYGuardarResult) => {
        this.generando = false;
        this.generarAviso = res.sinRegla > 0 ? res : null;
        this.toast.success(`Póliza borrador creada con ${res.totalCfdis} CFDIs — ábrela desde la lista para revisarla`);
        this.load(1);
      },
      error: (err) => {
        this.generando = false;
        const msg = err?.name === 'TimeoutError'
          ? 'La operación tardó demasiado. Intenta de nuevo o contacta a soporte.'
          : (err?.error?.error || err?.message || 'Error al generar póliza');
        this.toast.error(msg);
      },
    });
  }

  private _abrirPropuesta(p: PolizaPropuesta): void {
    this.editingId  = null;
    this.modalError = null;
    this.polizaForm.reset({
      tipo:        p.tipo,
      fecha:       p.fecha,
      concepto:    p.concepto,
      ejercicio:   p.ejercicio,
      periodo:     p.periodo,
      folio:       '',
      centroCosto: '',
    });
    this.movimientos = (p.movimientos ?? []).map((m: any) => ({
      cuentaId:    m.cuentaId ?? null,
      cuenta:      null,
      concepto:    m.concepto,
      serie:       '',
      ventaFecha:  '',
      centroCosto: '',
      debe:        Number(m.debe)  || 0,
      haber:       Number(m.haber) || 0,
      cfdiUuid:          m.cfdiUuid  ?? '',
      rfcTercero:        m.rfcTercero ?? '',
      _sinRegla:         m._sinRegla ?? false,
      comparisonStatus:  m._cfdiInfo?.comparisonStatus ?? null,
    }));
    if (this.movimientos.length === 0) this.movimientos = [this.emptyMovimiento(), this.emptyMovimiento()];
    this.cuentaSearch  = this.movimientos.map(() => '');
    this.cuentaResults = this.movimientos.map(() => []);
    this.movPageIdx = 0; this.recalcTotales();
    this.showModal = true;
  }

  // ── XML SAT ────────────────────────────────────────────────────────────────
  exportandoXml = false;

  descargarXmlSat(): void {
    if (!this.rfcActual || !this.ejercicioActual || !this.periodoActual) {
      this.toast.error('Selecciona una entidad y periodo activo primero');
      return;
    }
    this.exportandoXml = true;
    this.svc.xmlSat({
      rfc:       this.rfcActual,
      ejercicio: this.ejercicioActual,
      periodo:   this.periodoActual,
    }).subscribe({
      next: (blob) => {
        const mes = String(this.periodoActual).padStart(2, '0');
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `Polizas_${this.ejercicioActual}_${mes}_${this.rfcActual}.xml`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportandoXml = false;
      },
      error: (err) => {
        this.exportandoXml = false;
        this.toast.error(err?.error?.error || 'Error al generar XML SAT');
      },
    });
  }

  // ── Paginación ─────────────────────────────────────────────────────────────
  goPage(p: number): void { if (p >= 1 && p <= this.pagination.pages) this.load(p); }

  get paginationPages(): (number | null)[] {
    const total = this.pagination.pages;
    const cur   = this.pagination.page;
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 3)        return [1, 2, 3, null, total];
    if (cur >= total - 2) return [1, null, total - 2, total - 1, total];
    return [1, null, cur, null, total];
  }

  // ── Reglas CFDI ────────────────────────────────────────────────────────────
  switchToReglas(): void {
    this.activeTab = 'reglas';
    if (!this.rules.length && !this.loadingRules) this.loadRules();
  }

  loadRules(): void {
    this.loadingRules = true;
    this.cfdiMappingSvc.listRules().subscribe({
      next:  (r) => { this.rules = r; this.loadingRules = false; },
      error: () => { this.loadingRules = false; },
    });
  }

  openCreateRule(): void {
    this.editingRuleId  = null;
    this.ruleModalError = null;
    this.ruleForm.reset({
      nombre: '', tipoComprobante: null, rfcEmisor: '',
      metodoPago: null, formaPago: null,
      cuentaCargo: '', cuentaAbono: '', cuentaIva: '',
      cuentaIvaPPD: '', cuentaIvaRetenido: '', cuentaIsrRetenido: '',
      centroCosto: '', prioridad: 10, isActive: true,
    });
    this._resetRuleAccountSearch();
    this.showRuleModal = true;
  }

  openEditRule(rule: CfdiMappingRule): void {
    this.editingRuleId  = rule.id ?? null;
    this.ruleModalError = null;
    this.ruleForm.patchValue({
      nombre:            rule.nombre,
      tipoComprobante:   rule.tipoComprobante  ?? null,
      rfcEmisor:         rule.rfcEmisor         ?? '',
      metodoPago:        rule.metodoPago        ?? null,
      formaPago:         rule.formaPago         ?? null,
      cuentaCargo:       rule.cuentaCargo,
      cuentaAbono:       rule.cuentaAbono,
      cuentaIva:         rule.cuentaIva          ?? '',
      cuentaIvaPPD:      rule.cuentaIvaPPD       ?? '',
      cuentaIvaRetenido: rule.cuentaIvaRetenido  ?? '',
      cuentaIsrRetenido: rule.cuentaIsrRetenido  ?? '',
      centroCosto:       rule.centroCosto         ?? '',
      prioridad:         rule.prioridad,
      isActive:          rule.isActive,
    });
    // Precargar los inputs de búsqueda con el código actual
    this.ruleAccountSearch = {
      cuentaCargo:       rule.cuentaCargo       ?? '',
      cuentaAbono:       rule.cuentaAbono       ?? '',
      cuentaIva:         rule.cuentaIva          ?? '',
      cuentaIvaPPD:      rule.cuentaIvaPPD       ?? '',
      cuentaIvaRetenido: rule.cuentaIvaRetenido  ?? '',
      cuentaIsrRetenido: rule.cuentaIsrRetenido  ?? '',
    };
    this.ruleAccountResults = {};
    this.showRuleModal = true;
  }

  closeRuleModal(): void { this.showRuleModal = false; }

  saveRule(): void {
    if (this.savingRule || this.ruleForm.invalid) return;
    this.savingRule     = true;
    this.ruleModalError = null;

    const raw = this.ruleForm.value;
    const data: CfdiMappingRule = {
      ...raw,
      tipoComprobante:   raw.tipoComprobante   || null,
      rfcEmisor:         raw.rfcEmisor?.trim() || undefined,
      metodoPago:        raw.metodoPago        || null,
      formaPago:         raw.formaPago         || null,
      cuentaIva:         raw.cuentaIva?.trim()          || undefined,
      cuentaIvaPPD:      raw.cuentaIvaPPD?.trim()      || undefined,
      cuentaIvaRetenido: raw.cuentaIvaRetenido?.trim()  || undefined,
      cuentaIsrRetenido: raw.cuentaIsrRetenido?.trim()  || undefined,
      centroCosto:       raw.centroCosto?.trim()         || undefined,
    };

    const obs = this.editingRuleId
      ? this.cfdiMappingSvc.updateRule(this.editingRuleId, data)
      : this.cfdiMappingSvc.createRule(data);

    obs.subscribe({
      next: () => {
        this.savingRule    = false;
        this.showRuleModal = false;
        this.toast.success(this.editingRuleId ? 'Regla actualizada' : 'Regla creada');
        this.loadRules();
      },
      error: (err) => {
        this.savingRule     = false;
        this.ruleModalError = err?.error?.error || 'Error al guardar';
      },
    });
  }

  askDeleteRule(rule: CfdiMappingRule): void {
    this.deletingRule = rule;
    this.showDeleteRuleConfirm = true;
  }

  confirmDeleteRule(): void {
    if (!this.deletingRule?.id) return;
    this.deletingRuleInProgress = true;
    this.cfdiMappingSvc.deleteRule(this.deletingRule.id).subscribe({
      next: () => {
        this.deletingRuleInProgress  = false;
        this.showDeleteRuleConfirm   = false;
        this.deletingRule            = null;
        this.toast.success('Regla eliminada');
        this.loadRules();
      },
      error: (err) => {
        this.deletingRuleInProgress = false;
        this.toast.error(err?.error?.error || 'Error al eliminar');
      },
    });
  }

  cancelDeleteRule(): void { this.showDeleteRuleConfirm = false; this.deletingRule = null; }

  cfdiTipoLabel(t: string | null | undefined): string {
    return this.tiposCfdiOpts.find(x => x.value === (t ?? ''))?.label ?? '—';
  }

  trackByRuleId(_: number, r: CfdiMappingRule): number | undefined { return r.id; }

  get rulesActiveCount(): number { return this.rules.filter(r => r.isActive).length; }

  // ── Exportar póliza como Excel (.xlsx con ExcelJS) ────────────────────────
  async exportarPoliza(): Promise<void> {
    if (this.exportando) return;
    this.exportando = true;
    const ExcelJS = await import('exceljs').then(m => m.default ?? m);
    const fv  = this.polizaForm.value;
    const nom = `Poliza_${fv.tipo || 'X'}_${fv.ejercicio || ''}_${String(fv.periodo || '').padStart(2, '0')}_${fv.folio || this.editingId || 'nueva'}`;
    const mesLabel = this.meses.find(m => m.value === fv.periodo)?.label ?? '';

    const wb = new ExcelJS.Workbook();
    wb.creator = this.auth.currentUser.name || this.auth.currentUser.email;
    wb.created = new Date();

    const ws = wb.addWorksheet('Póliza', { views: [{ state: 'frozen', ySplit: 5 }] });

    // ── Paleta ──────────────────────────────────────────────────────────────
    const COLOR_HEADER  = '4F46E5'; // indigo-600
    const COLOR_DEBE    = 'EFF6FF'; // blue-50
    const COLOR_HABER   = 'F0FDF4'; // green-50
    const COLOR_TOTAL   = 'EEF2FF'; // indigo-50
    const COLOR_WARN    = 'FEF3C7'; // amber-100
    const COLOR_ERR     = 'FEE2E2'; // red-100

    const borderThin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
    const allBorders = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };

    // ── Fila 1: Título ──────────────────────────────────────────────────────
    ws.mergeCells('A1:K1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `PÓLIZA ${this.tipoLabel(fv.tipo)} — ${fv.ejercicio} · ${mesLabel}`;
    titleCell.font  = { bold: true, size: 14, color: { argb: 'FF' + COLOR_HEADER } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 28;

    // ── Fila 2: Metadatos ───────────────────────────────────────────────────
    ws.mergeCells('A2:K2');
    const metaCell = ws.getCell('A2');
    metaCell.value = [
      `Concepto: ${fv.concepto || '—'}`,
      `Folio: ${fv.folio || '—'}`,
      `Fecha: ${fv.fecha || '—'}`,
      `Centro costo: ${fv.centroCosto || '—'}`,
      `Creado por: ${this.auth.currentUser.name || this.auth.currentUser.email}`,
    ].join('    |    ');
    metaCell.font = { size: 9, color: { argb: 'FF6B7280' } };
    metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 18;

    // ── Fila 3: Balance ─────────────────────────────────────────────────────
    ws.mergeCells('A3:K3');
    const balCell  = ws.getCell('A3');
    const balDiff  = Math.abs(this.totalDebe - this.totalHaber);
    balCell.value  = this.isBalanced
      ? `✓  Póliza balanceada — Total: $${this.totalDebe.toFixed(2)}`
      : `⚠  Desbalanceada — Debe: $${this.totalDebe.toFixed(2)}  Haber: $${this.totalHaber.toFixed(2)}  Diferencia: $${balDiff.toFixed(2)}`;
    balCell.font   = { bold: true, size: 10, color: { argb: this.isBalanced ? 'FF10B981' : 'FFEF4444' } };
    balCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.isBalanced ? 'FFD1FAE5' : 'FFFEE2E2' } };
    balCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(3).height = 20;

    // ── Fila 4: Encabezados de columna ──────────────────────────────────────
    const COLS = ['#','Cta. Código','Nombre Cuenta','Concepto del movimiento','Serie','Fecha Venta','Centro Costo','Debe','Haber','CFDI UUID','RFC Tercero'];
    const headerRow = ws.getRow(4);
    headerRow.height = 22;
    COLS.forEach((h, ci) => {
      const cell = headerRow.getCell(ci + 1);
      cell.value = h;
      cell.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR_HEADER } };
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'center' : ci >= 7 && ci <= 8 ? 'right' : 'left' };
      cell.border = allBorders;
    });

    // ── Filas de datos ──────────────────────────────────────────────────────
    // Agrupar por CFDI para color alternado
    let cfdiColorIdx = -1;
    let lastUuid = '';

    this.movimientos.forEach((m, i) => {
      const row = ws.getRow(i + 5);
      row.height = 16;

      // Color de fondo por asiento CFDI
      if (m.cfdiUuid && m.cfdiUuid !== lastUuid) { cfdiColorIdx++; lastUuid = m.cfdiUuid; }
      const isCuentaFaltante = m.cuentaFaltante;
      const isImbalanced     = m.cfdiUuid ? this.imbalancedUuids.has(m.cfdiUuid) : false;
      const bgColor = isCuentaFaltante ? COLOR_WARN
                    : isImbalanced     ? COLOR_ERR
                    : (cfdiColorIdx % 2 === 1) ? 'F3F4F6' : 'FFFFFF';

      const rowData = [
        i + 1,
        (m.cuenta as any)?.codigo ?? m.cuentaId ?? '',
        (m.cuenta as any)?.nombre ?? '',
        m.concepto ?? '',
        m.serie ?? '',
        m.ventaFecha ?? '',
        m.centroCosto ?? '',
        Number(m.debe)  || 0,
        Number(m.haber) || 0,
        m.cfdiUuid   ?? '',
        m.rfcTercero ?? '',
      ];

      rowData.forEach((val, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = val;
        cell.border = allBorders;
        cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'center' : ci >= 7 && ci <= 8 ? 'right' : 'left' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (ci === 7 ? COLOR_DEBE : ci === 8 ? COLOR_HABER : bgColor) } };
        if (ci >= 7) cell.numFmt = '#,##0.00';
        if (ci === 0) cell.font = { size: 9, color: { argb: 'FF9CA3AF' } };
      });
    });

    // ── Fila de totales ─────────────────────────────────────────────────────
    const totalRowIdx = this.movimientos.length + 5;
    const totalRow    = ws.getRow(totalRowIdx);
    totalRow.height   = 20;
    ws.mergeCells(`A${totalRowIdx}:G${totalRowIdx}`);
    const totLabel = totalRow.getCell(1);
    totLabel.value = 'TOTALES';
    totLabel.font  = { bold: true, size: 10 };
    totLabel.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR_TOTAL } };
    totLabel.alignment = { horizontal: 'right', vertical: 'middle' };
    totLabel.border = allBorders;

    [8, 9].forEach(ci => {
      const cell = totalRow.getCell(ci);
      cell.value  = ci === 8 ? this.totalDebe : this.totalHaber;
      cell.numFmt = '#,##0.00';
      cell.font   = { bold: true, size: 10, color: { argb: this.isBalanced ? 'FF10B981' : 'FFEF4444' } };
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR_TOTAL } };
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = allBorders;
    });
    [10, 11].forEach(ci => {
      const cell = totalRow.getCell(ci);
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR_TOTAL } };
      cell.border = allBorders;
    });

    // ── Anchos de columna ───────────────────────────────────────────────────
    ws.columns = [
      { width: 5  }, // #
      { width: 14 }, // Código
      { width: 28 }, // Nombre
      { width: 38 }, // Concepto
      { width: 8  }, // Serie
      { width: 13 }, // Fecha
      { width: 14 }, // CC
      { width: 14 }, // Debe
      { width: 14 }, // Haber
      { width: 38 }, // UUID
      { width: 14 }, // RFC
    ];

    // ── Autofilter sobre encabezados ────────────────────────────────────────
    ws.autoFilter = { from: 'A4', to: 'K4' };

    // ── Descargar ───────────────────────────────────────────────────────────
    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${nom}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    this.exportando = false;
  }

  // ── Reporte descuadrados Excel (client-side ExcelJS) ─────────────────────
  exportandoDescuadrados = false;

  exportarDescuadrados(): void {
    if (this.exportandoDescuadrados) return;
    if (this.imbalancedUuids.size === 0) {
      this.toast.error('No hay asientos descuadrados en esta póliza');
      return;
    }
    if (!this.rfcActual || !this.editingId) {
      this.toast.error('Guarda la póliza antes de exportar');
      return;
    }
    this.exportandoDescuadrados = true;

    this.svc.reporteDescuadradas({
      rfc:      this.rfcActual,
      polizaId: this.editingId,
    }).subscribe({
      next: async (res) => {
        try {
          const ExcelJS  = await import('exceljs').then(m => m.default ?? m);
          const fv       = this.polizaForm.value;
          const mesLabel = this.meses.find(m => m.value === fv.periodo)?.label ?? String(fv.periodo);
          const mes      = String(fv.periodo ?? '').padStart(2, '0');

          const wb = new ExcelJS.Workbook();
          wb.creator = this.auth.currentUser.name || this.auth.currentUser.email;
          wb.created = new Date();

          const ws = wb.addWorksheet('Descuadrados', { views: [{ state: 'frozen', ySplit: 4 }] });

          const COLOR_HEADER = '4F46E5';
          const COLOR_MOV    = 'EEF2FF';
          const borderThin   = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
          const allBorders   = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
          const NUM_FMT      = '#,##0.00';

          const NCOLS = 18;

          // Fila 1: Título
          ws.mergeCells(`A1:R1`);
          const titleCell = ws.getCell('A1');
          titleCell.value = `ASIENTOS DESCUADRADOS — Póliza ${this.tipoLabel(fv.tipo)} #${fv.folio || this.editingId}  ·  ${fv.ejercicio} ${mesLabel}`;
          titleCell.font  = { bold: true, size: 13, color: { argb: 'FF' + COLOR_HEADER } };
          titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
          ws.getRow(1).height = 26;

          // Fila 2: Meta
          ws.mergeCells('A2:R2');
          const metaCell = ws.getCell('A2');
          metaCell.value = `${fv.concepto || ''}   |   CFDIs descuadrados: ${res.total}   |   Generado: ${new Date().toLocaleString('es-MX')}`;
          metaCell.font  = { size: 9, color: { argb: 'FF6B7280' } };
          metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
          ws.getRow(2).height = 16;

          // Fila 3: Encabezados CFDI (bloque datos del comprobante)
          const CFDI_COLS = [
            '#','UUID','Tipo','Serie','Folio','Fecha CFDI','Moneda',
            'Emisor RFC','Emisor Nombre','Receptor RFC','Receptor Nombre',
            'Uso CFDI','Método Pago','Forma Pago',
            'Subtotal','IVA','Total','SAT Status',
          ];
          // Fila 3: Encabezados bloque CFDI
          const hdr3 = ws.getRow(3);
          hdr3.height = 18;
          CFDI_COLS.forEach((h, ci) => {
            const cell = hdr3.getCell(ci + 1);
            cell.value = h;
            cell.font  = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR_HEADER } };
            cell.alignment = { vertical: 'middle', horizontal: ci >= 14 ? 'right' : 'center' };
            cell.border = allBorders;
          });

          // Fila 4: Encabezados bloque movimientos (mismas columnas, segunda línea de header)
          const MOV_COLS = [
            '','','','','','','',
            '','','','',
            '','','',
            'Total Debe','Total Haber','Diferencia','Alertas',
          ];
          const hdr4 = ws.getRow(4);
          hdr4.height = 16;
          MOV_COLS.forEach((h, ci) => {
            const cell = hdr4.getCell(ci + 1);
            cell.value = h || undefined;
            cell.font  = { bold: true, size: 8, italic: true, color: { argb: 'FF4F46E5' } };
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
            cell.border = allBorders;
          });

          // Datos
          let rowIdx = 5;
          let n      = 0;

          for (const r of res.rows) {
            const c    = r.cfdi;
            const diff = Number(r.diferencia);
            const bgHex = diff > 100 ? 'FEE2E2' : diff > 10 ? 'FEF3C7' : 'FEF9C3';
            n++;

            // Fila CFDI — datos completos del comprobante + totales del asiento
            const cfdiRow = ws.getRow(rowIdx++);
            cfdiRow.height = 16;
            const cfdiVals: (string | number | null | undefined)[] = [
              n,
              r.cfdiUuid,
              c?.tipoDeComprobante                          ?? '',
              c?.serie                                      ?? '',
              c?.folio                                      ?? '',
              c?.fecha ? new Date(c.fecha).toISOString().slice(0,10) : '',
              c?.moneda                                     ?? '',
              c?.emisor?.rfc                                ?? '',
              c?.emisor?.nombre                             ?? '',
              c?.receptor?.rfc                              ?? '',
              c?.receptor?.nombre                           ?? '',
              c?.receptor?.usoCfdi                          ?? '',
              c?.metodoPago                                 ?? '',
              c?.formaPago                                  ?? '',
              c?.subTotal                                   ?? null,
              c?.impuestos?.totalImpuestosTrasladados        ?? null,
              c?.total                                      ?? null,
              c?.satStatus                                  ?? '',
            ];
            cfdiVals.forEach((v, ci) => {
              const cell = cfdiRow.getCell(ci + 1);
              cell.value  = v ?? '';
              cell.font   = { bold: true, size: 9 };
              cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgHex } };
              cell.border = allBorders;
              if (ci >= 14 && ci <= 16) cell.numFmt = NUM_FMT;
            });

            // Fila de totales del asiento (Total Debe / Haber / Diferencia / Alertas)
            const totRow = ws.getRow(rowIdx++);
            totRow.height = 14;
            Array.from({ length: NCOLS }).forEach((_, ci) => {
              const cell = totRow.getCell(ci + 1);
              cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
              cell.border = allBorders;
              cell.font   = { size: 9 };
            });
            const totDebe  = totRow.getCell(15);
            const totHaber = totRow.getCell(16);
            const totDiff  = totRow.getCell(17);
            const totAlert = totRow.getCell(18);
            totDebe.value  = Number(r.totalDebe);  totDebe.numFmt  = NUM_FMT; totDebe.font  = { bold: true, size: 9 };
            totHaber.value = Number(r.totalHaber); totHaber.numFmt = NUM_FMT; totHaber.font = { bold: true, size: 9 };
            totDiff.value  = diff;                 totDiff.numFmt  = NUM_FMT;
            totDiff.font   = { bold: true, size: 9, color: { argb: 'FFEF4444' } };
            totAlert.value = (this.cfdiAlertMap[r.cfdiUuid]?.alerts ?? []).join(', ') || '';
            totAlert.font  = { size: 8, italic: true, color: { argb: 'FFB45309' } };

            // Filas de movimientos del CFDI
            const movs = this.movimientos.filter(m => m.cfdiUuid === r.cfdiUuid);
            movs.forEach(m => {
              const mRow = ws.getRow(rowIdx++);
              mRow.height = 13;
              Array.from({ length: NCOLS }).forEach((_, ci) => {
                const cell = mRow.getCell(ci + 1);
                cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR_MOV } };
                cell.border = allBorders;
                cell.font   = { size: 8 };
              });
              mRow.getCell(8).value  = m.cuenta?.codigo ?? '';
              mRow.getCell(9).value  = m.cuenta?.nombre ?? '';
              mRow.getCell(10).value = m.concepto       ?? '';
              mRow.getCell(15).value = Number(m.debe  || 0); mRow.getCell(15).numFmt = NUM_FMT;
              mRow.getCell(16).value = Number(m.haber || 0); mRow.getCell(16).numFmt = NUM_FMT;
            });
          }

          // Anchos de columna
          const widths = [4,38,6,8,10,12,8,16,32,16,32,10,12,10,13,13,13,30];
          widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

          const buf  = await wb.xlsx.writeBuffer();
          const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href     = url;
          a.download = `Descuadrados_${fv.tipo}_${fv.ejercicio}_${mes}_${fv.folio || this.editingId}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        } finally {
          this.exportandoDescuadrados = false;
        }
      },
      error: (err) => {
        this.exportandoDescuadrados = false;
        this.toast.error(err?.error?.message ?? 'Error al generar el reporte');
      },
    });
  }

  // ── Cuentas T ──────────────────────────────────────────────────────────────
  readonly CUENTAS_T_MAX = 15;
  exportando      = false;
  showCuentasT    = false;
  expandedCuentasT = new Set<string>();
  cuentasTData: {
    codigo:     string;
    nombre:     string;
    debeMov:    { concepto: string; monto: number }[];
    haberMov:   { concepto: string; monto: number }[];
    totalDebe:  number;
    totalHaber: number;
    saldo:      number;
  }[] = [];

  abrirCuentasT(): void {
    const byAccount = new Map<string, typeof this.cuentasTData[0]>();
    for (const m of this.movimientos) {
      const codigo = (m.cuenta as any)?.codigo ?? String(m.cuentaId ?? '?');
      const nombre = (m.cuenta as any)?.nombre ?? '';
      if (!byAccount.has(codigo)) {
        byAccount.set(codigo, { codigo, nombre, debeMov: [], haberMov: [], totalDebe: 0, totalHaber: 0, saldo: 0 });
      }
      const t = byAccount.get(codigo)!;
      const d = Number(m.debe)  || 0;
      const h = Number(m.haber) || 0;
      if (d > 0) { t.debeMov.push({ concepto: m.concepto, monto: d }); t.totalDebe  += d; }
      if (h > 0) { t.haberMov.push({ concepto: m.concepto, monto: h }); t.totalHaber += h; }
    }
    for (const t of byAccount.values()) t.saldo = t.totalDebe - t.totalHaber;
    this.cuentasTData = [...byAccount.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
    this.expandedCuentasT.clear();
    this.showCuentasT = true;
  }

  toggleCuentaT(codigo: string): void {
    if (this.expandedCuentasT.has(codigo)) this.expandedCuentasT.delete(codigo);
    else this.expandedCuentasT.add(codigo);
  }

  cerrarCuentasT(): void { this.showCuentasT = false; }

  // ── Popup CFDI vinculado al movimiento ────────────────────────────────────
  selectedMovCfdi: typeof this.movimientos[0] | null = null;

  openMovCfdiInfo(m: typeof this.movimientos[0]): void {
    this.selectedMovCfdi = m;
  }

  closeMovCfdiInfo(): void {
    this.selectedMovCfdi = null;
  }

  // ── Búsqueda de cuentas en el modal de regla ───────────────────────────────
  searchRuleAccount(field: string, term: string): void {
    this.ruleAccountSearch[field] = term;
    // Si el usuario borra el campo, limpiar el valor en el form
    if (!term) this.ruleForm.get(field)?.setValue('');
    this.ruleAccountSearch$.next({ field, term });
  }

  selectRuleAccount(field: string, account: AccountPlan): void {
    this.ruleForm.get(field)?.setValue(account.codigo);
    this.ruleAccountSearch[field]  = `${account.codigo} — ${account.nombre}`;
    this.ruleAccountResults[field] = [];
  }

  closeRuleAccountDropdown(field: string): void {
    // Si el input no coincide con ninguna cuenta seleccionada, restaurar el código guardado
    const currentCode = this.ruleForm.get(field)?.value ?? '';
    if (currentCode) this.ruleAccountSearch[field] = currentCode;
    this.ruleAccountResults[field] = [];
  }

  private _resetRuleAccountSearch(): void {
    this.ruleAccountSearch  = {};
    this.ruleAccountResults = {};
  }

  // ── Saldos Iniciales ────────────────────────────────────────────────────────
  saldosCuentas:    AccountPlan[] = [];
  saldosMap:        Partial<Record<number, { debe: number; haber: number }>> = {};
  saldosLoading     = false;
  saldosGuardando   = false;
  saldosFiltroTipo  = '';
  saldosBusqueda    = '';
  saldosExistenteId: number | null = null;

  get saldosTotalDebe():  number { return Object.values(this.saldosMap).reduce((s, v) => s + (Number(v?.debe)  || 0), 0); }
  get saldosTotalHaber(): number { return Object.values(this.saldosMap).reduce((s, v) => s + (Number(v?.haber) || 0), 0); }
  get saldosBalanced():   boolean { return Math.abs(this.saldosTotalDebe - this.saldosTotalHaber) < 0.01; }

  get saldosCuentasFiltradas(): AccountPlan[] {
    let list = this.saldosCuentas;
    if (this.saldosFiltroTipo) list = list.filter(c => c.tipo === this.saldosFiltroTipo);
    const q = this.saldosBusqueda.toLowerCase().trim();
    if (q) list = list.filter(c => c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q));
    return list;
  }

  switchToSaldos(): void {
    this.activeTab = 'saldos';
    if (!this.saldosCuentas.length && !this.saldosLoading) this.cargarSaldosIniciales();
  }

  cargarSaldosIniciales(): void {
    if (!this.rfcActual || !this.ejercicioActual) {
      this.toast.error('Selecciona una entidad y ejercicio activo primero');
      return;
    }
    this.saldosLoading = true;
    this.accountSvc.list().subscribe({
      next: (cuentas) => {
        this.saldosCuentas = cuentas;
        this.svc.list({ rfc: this.rfcActual, ejercicio: this.ejercicioActual, tipo: 'A', periodo: 1, limit: 5 }).subscribe({
          next: (res) => {
            if (res.polizas.length > 0) {
              this.svc.getById(res.polizas[0].id!).subscribe({
                next: (p) => {
                  this.saldosExistenteId = p.id ?? null;
                  this.saldosMap = {};
                  for (const m of p.movimientos ?? []) {
                    if (m.cuentaId) this.saldosMap[m.cuentaId] = { debe: Number(m.debe) || 0, haber: Number(m.haber) || 0 };
                  }
                  this.saldosLoading = false;
                },
                error: () => { this.saldosLoading = false; },
              });
            } else {
              this.saldosExistenteId = null;
              this.saldosMap = {};
              this.saldosLoading = false;
            }
          },
          error: () => { this.saldosLoading = false; },
        });
      },
      error: () => { this.saldosLoading = false; },
    });
  }

  setSaldoDebe(id: number, event: Event): void {
    const v = parseFloat((event.target as HTMLInputElement).value) || 0;
    if (!this.saldosMap[id]) this.saldosMap[id] = { debe: 0, haber: 0 };
    this.saldosMap[id] = { ...this.saldosMap[id], debe: v };
  }

  setSaldoHaber(id: number, event: Event): void {
    const v = parseFloat((event.target as HTMLInputElement).value) || 0;
    if (!this.saldosMap[id]) this.saldosMap[id] = { debe: 0, haber: 0 };
    this.saldosMap[id] = { ...this.saldosMap[id], haber: v };
  }

  guardarSaldosIniciales(): void {
    if (!this.rfcActual || !this.ejercicioActual) return;
    if (!this.saldosBalanced) {
      this.toast.error(`Saldos desbalanceados — Debe: ${this.saldosTotalDebe.toFixed(2)}, Haber: ${this.saldosTotalHaber.toFixed(2)}`);
      return;
    }
    const movimientos = this.saldosCuentas
      .filter(c => (this.saldosMap[c.id]?.debe || 0) > 0 || (this.saldosMap[c.id]?.haber || 0) > 0)
      .map((c, i) => ({
        orden:    i + 1,
        cuentaId: c.id,
        concepto: `Saldo inicial ${c.codigo}`,
        debe:     Number(this.saldosMap[c.id]?.debe)  || 0,
        haber:    Number(this.saldosMap[c.id]?.haber) || 0,
      }));

    if (movimientos.length < 2) { this.toast.error('Ingresa al menos 2 cuentas con saldo'); return; }

    const poliza: Poliza = {
      tipo:      'A',
      fecha:     `${this.ejercicioActual}-01-01`,
      concepto:  `Saldos iniciales ${this.ejercicioActual}`,
      ejercicio: this.ejercicioActual,
      periodo:   1,
      rfc:       this.rfcActual!,
      creadoPor: this.auth.currentUser.name || this.auth.currentUser.email,
      movimientos,
    };

    this.saldosGuardando = true;
    const obs = this.saldosExistenteId
      ? this.svc.update(this.saldosExistenteId, poliza)
      : this.svc.create(poliza);

    obs.subscribe({
      next: (p) => {
        this.saldosGuardando   = false;
        this.saldosExistenteId = p.id ?? null;
        this.toast.success('Asiento de apertura guardado');
      },
      error: (err) => {
        this.saldosGuardando = false;
        this.toast.error(err?.error?.error || 'Error al guardar saldos iniciales');
      },
    });
  }
}
