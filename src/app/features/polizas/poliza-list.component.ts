import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, EMPTY } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, switchMap, map, timeout, skip } from 'rxjs/operators';
import { PolizaService, Poliza, PolizaTipo, PolizaEstado, CfdiAlertInfo } from '../../core/services/poliza.service';
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
    { value: 'A', label: 'Apertura' },
    { value: 'I', label: 'Ingreso' },
    { value: 'E', label: 'Egreso' },
    { value: 'D', label: 'Diario' },
    { value: 'N', label: 'Nómina' },
    { value: 'C', label: 'Cheque' },
  ];

  readonly meses = [
    { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' }, { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' }, { value: 5, label: 'Mayo' },    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },  { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' }, { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
  ];

  generando = false;
  tipoCfdi: 'I' | 'E' | 'P' = 'I';
  propuestaMeta: PolizaPropuesta['_meta'] | null = null;
  generarAviso: GenerarYGuardarResult | null = null;

  // ── Tabs ───────────────────────────────────────────────────────────────────
  activeTab: 'polizas' | 'reglas' | 'balanza' | 'balance' = 'polizas';

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
      const ExcelJS = await import('exceljs');
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

    const ExcelJS  = await import('exceljs');
    const { ejercicio, periodo } = this.balanza.meta;
    const mesLabel = this.meses.find(m => m.value === periodo)?.label ?? '';
    const nom      = `Balanza_Preliminar_${ejercicio}_${String(periodo).padStart(2, '0')}`;
    const grupos   = this.balanzaGrupos;
    const totales  = this.balanzaTotalesFiltrados;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Balanza', { views: [{ state: 'frozen', ySplit: 3 }] });

    const borderThin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
    const borders    = { top: borderThin, left: borderThin, bottom: borderThin, right: borderThin };
    const tipoColor: Record<string, string> = {
      Activo: 'FFDBEAFE', Pasivo: 'FFFCE7F3', Capital: 'FFD1FAE5',
      Ingreso: 'FFDCFCE7', Gasto: 'FFFEE2E2', Costo: 'FFFFF7ED',
    };

    // ── Fila 1: Título ────────────────────────────────────────────────────────
    ws.mergeCells('A1:I1');
    const t1 = ws.getCell('A1');
    t1.value = `BALANZA DE COMPROBACIÓN PRELIMINAR — ${mesLabel} ${ejercicio} · RFC: ${this.rfcActual ?? ''} · Basada en CFDIs`;
    t1.font  = { bold: true, size: 12, color: { argb: 'FF4F46E5' } };
    t1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    // ── Fila 2: Meta ──────────────────────────────────────────────────────────
    ws.mergeCells('A2:I2');
    const m2   = ws.getCell('A2');
    const anom = this.balanzaAnormalesCount;
    m2.value   = `${this.balanza.meta.totalCfdis} CFDIs · ${this.balanza.meta.sinRegla} sin regla · ` +
                 `${this.balanzaCuentasFiltradas.length} cuentas` +
                 (anom > 0 ? ` · ⚠ ${anom} con naturaleza anormal` : '');
    m2.font  = { size: 9, color: { argb: 'FF6B7280' } };
    m2.alignment = { horizontal: 'center' };
    ws.getRow(2).height = 16;

    // ── Fila 3: Encabezados ───────────────────────────────────────────────────
    const hdrs = ['Código', 'Nombre de cuenta', 'Tipo', 'Mvtos',
                  'Saldo Inicial', 'Cargos (Debe)', 'Abonos (Haber)', 'Saldo Final', 'Naturaleza'];
    ws.getRow(3).height = 20;
    hdrs.forEach((h, i) => {
      const cell = ws.getRow(3).getCell(i + 1);
      cell.value = h;
      cell.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      cell.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'right' : 'left' };
      cell.border = borders;
    });

    // ── Datos por grupo ───────────────────────────────────────────────────────
    let rowIdx = 4;

    for (const grupo of grupos) {
      // Encabezado de grupo
      const gr = ws.getRow(rowIdx++);
      gr.height = 15;
      ws.mergeCells(`A${gr.number}:I${gr.number}`);
      const gc = gr.getCell(1);
      gc.value = grupo.tipo.toUpperCase();
      gc.font  = { bold: true, size: 9, color: { argb: 'FF374151' } };
      gc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: tipoColor[grupo.tipo] ?? 'FFF3F4F6' } };
      gc.alignment = { horizontal: 'left', vertical: 'middle' };
      gc.border = borders;

      // Filas de cuentas
      grupo.cuentas.forEach((c, i) => {
        const row    = ws.getRow(rowIdx++);
        row.height   = 15;
        const anorm  = this.isNaturalezaAnormal(c);
        const bg     = anorm ? 'FFFFF7ED' : (i % 2 === 1 ? 'FFF9FAFB' : 'FFFFFFFF');
        const natTxt = anorm
          ? `⚠ ${c.saldo > 0 ? 'Deudor' : 'Acreedor'}`
          : (c.saldo > 0.005 ? 'Deudor' : c.saldo < -0.005 ? 'Acreedor' : '—');

        const vals: (string | number)[] = [
          c.codigo, c.nombre, c.tipo,
          c.movCount ?? 0,
          c.saldoInicial ?? 0,
          c.debe, c.haber,
          Math.abs(c.saldo),
          natTxt,
        ];
        vals.forEach((v, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value  = v;
          cell.border = borders;
          cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          cell.alignment = { vertical: 'middle', horizontal: ci >= 3 ? 'right' : 'left' };
          if (ci >= 4 && ci <= 7) cell.numFmt = '#,##0.00';
          if (ci === 8) {
            cell.font      = { bold: true, color: { argb: anorm ? 'FFC2410C' : c.saldo > 0.005 ? 'FF1D4ED8' : c.saldo < -0.005 ? 'FF15803D' : 'FF6B7280' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      });

      // Subtotal del grupo
      const sr = ws.getRow(rowIdx++);
      sr.height = 16;
      ws.mergeCells(`A${sr.number}:C${sr.number}`);
      const sl = sr.getCell(1);
      sl.value = `Subtotal ${grupo.tipo}`;
      sl.font  = { bold: true, size: 9, color: { argb: 'FF4F46E5' } };
      sl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
      sl.alignment = { horizontal: 'right', vertical: 'middle' };
      sl.border = borders;
      [
        { col: 4, val: grupo.sub.movCount,     fmt: '0' },
        { col: 5, val: grupo.sub.saldoInicial, fmt: '#,##0.00' },
        { col: 6, val: grupo.sub.debe,         fmt: '#,##0.00' },
        { col: 7, val: grupo.sub.haber,        fmt: '#,##0.00' },
        { col: 8, val: grupo.sub.saldo,        fmt: '#,##0.00' },
      ].forEach(({ col, val, fmt }) => {
        const cell = sr.getCell(col);
        cell.value  = val; cell.numFmt = fmt;
        cell.font   = { bold: true, color: { argb: 'FF4F46E5' } };
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.border = borders;
      });
      sr.getCell(9).fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
      sr.getCell(9).border = borders;
    }

    // ── Totales generales ─────────────────────────────────────────────────────
    const tr = ws.getRow(rowIdx);
    tr.height = 22;
    ws.mergeCells(`A${tr.number}:C${tr.number}`);
    const tl = tr.getCell(1);
    tl.value = 'TOTALES GENERALES';
    tl.font  = { bold: true, size: 10 };
    tl.alignment = { horizontal: 'right', vertical: 'middle' };
    tl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    tl.border = borders;
    [
      { col: 4, val: totales.movCount,     fmt: '0' },
      { col: 5, val: totales.saldoInicial, fmt: '#,##0.00' },
      { col: 6, val: totales.debe,         fmt: '#,##0.00' },
      { col: 7, val: totales.haber,        fmt: '#,##0.00' },
      { col: 8, val: totales.saldo,        fmt: '#,##0.00' },
    ].forEach(({ col, val, fmt }) => {
      const cell = tr.getCell(col);
      cell.value  = val; cell.numFmt = fmt;
      cell.font   = { bold: true, size: 10, color: { argb: 'FF4F46E5' } };
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = borders;
    });
    const cuadra = Math.abs(totales.debe - totales.haber) < 0.01;
    const vc = tr.getCell(9);
    vc.value = cuadra ? '✓ Cuadra' : `⚠ Dif: ${(totales.debe - totales.haber).toFixed(2)}`;
    vc.font  = { bold: true, color: { argb: cuadra ? 'FF15803D' : 'FFDC2626' } };
    vc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: cuadra ? 'FFD1FAE5' : 'FFFEE2E2' } };
    vc.alignment = { horizontal: 'center', vertical: 'middle' };
    vc.border = borders;

    ws.columns = [
      { width: 14 }, { width: 38 }, { width: 12 }, { width: 8 },
      { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 },
    ];
    ws.autoFilter = { from: 'A3', to: 'I3' };

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = `${nom}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    this.exportandoBalanza = false;
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
    });

    this.filterForm.valueChanges.pipe(
      skip(1), debounceTime(200), distinctUntilChanged(), takeUntil(this.destroy$),
      switchMap(() => { this.loading = true; return this.svc.list({
        rfc: this.rfcActual, ejercicio: this.ejercicioActual, periodo: this.periodoActual,
        tipo: this.filterForm.value.tipo || undefined, estado: this.filterForm.value.estado || undefined,
        page: 1, limit: this.pagination.limit,
      }); }),
    ).subscribe({
      next: (res) => {
        this.polizas    = [...res.polizas];
        this.pagination = { total: res.total, page: 1, limit: res.limit, pages: res.pages };
        this.loading    = false;
      },
      error: () => { this.loading = false; },
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

    this.load(1);
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
      tipo:      f.tipo   || undefined,
      estado:    f.estado || undefined,
      page,
      limit:     this.pagination.limit,
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
    this.movFiltroSerie = ''; this.movFiltroCentro = '';
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
        this.viewMode = true;
        this.movFiltroSerie = ''; this.movFiltroCentro = '';
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
  /** Índice absoluto de la primera fila de cada grupo CFDI (para mostrar badge solo una vez) */
  cfdiFirstRowIdx = new Map<string, number>();

  tieneCuentasFaltantes = false;

  // ── Filtros de movimientos ──────────────────────────────────────────────
  movFiltroSerie   = '';
  movFiltroCentro  = '';
  movimientosFiltrados: typeof this.movimientos = [];
  movFilterOpen    = { serie: false, centro: false };

  @HostListener('document:click')
  onDocumentClick(): void {
    this.movFilterOpen.serie   = false;
    this.movFilterOpen.centro  = false;
  }

  toggleMovFilter(col: 'serie' | 'centro', event: MouseEvent): void {
    event.stopPropagation();
    const wasOpen = this.movFilterOpen[col];
    this.movFilterOpen.serie  = false;
    this.movFilterOpen.centro = false;
    this.movFilterOpen[col]   = !wasOpen;
  }

  aplicarFiltros(): void {
    const s = this.movFiltroSerie.toLowerCase().trim();
    const c = this.movFiltroCentro.toLowerCase().trim();
    this.movimientosFiltrados = (s || c)
      ? this.movimientos.filter(m =>
          (!s || (m.serie       ?? '').toLowerCase().includes(s)) &&
          (!c || (m.centroCosto ?? '').toLowerCase().includes(c)))
      : this.movimientos;
    this.movPageIdx = 0;
    this._computePageStarts();
    this.movOffset   = 0;
    this.movSliceEnd = this.pageStarts[1] ?? this.movimientosFiltrados.length;
  }

  recalcTotales(): void {
    this.totalDebe  = this.movimientos.reduce((s, m) => s + (Number(m.debe)  || 0), 0);
    this.totalHaber = this.movimientos.reduce((s, m) => s + (Number(m.haber) || 0), 0);
    this.isBalanced = Math.abs(this.totalDebe - this.totalHaber) < 0.01;
    this.tieneCuentasFaltantes = this.movimientos.some(m => m.cuentaFaltante);
    this.aplicarFiltros();

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
    // aplicarFiltros llama a _computePageStarts internamente
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
      title:      'Cancelar póliza',
      msg:        `¿Deseas cancelar la póliza ${this.tipoLabel(p.tipo)}-${p.numero}? Esta acción es <strong>irreversible</strong>.`,
      btn:        'Cancelar póliza',
      cls:        'btn-confirm-danger',
      icon:       '✕',
      showMotivo: true,
      cb:         () => this.svc.cancelar(p.id!, this.confirmMotivo || undefined).subscribe({
        next:  () => { this.toast.success('Póliza cancelada'); this.load(this.pagination.page); },
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
    const ExcelJS = await import('exceljs');
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
}
