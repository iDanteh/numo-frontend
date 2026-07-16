import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup }       from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ReportService, DepositoIngresoRow, DepositosIngresosResumen, DepositosIngresosDetalle, CuentaPorCobrarAfectada } from '../../../core/services/report.service';
import { PeriodoActivoService } from '../../../core/services/periodo-activo.service';

type TabVenta = 'todos' | 'contado' | 'credito';
type FiltroDeposito = 'todos' | 'con_deposito' | 'sin_deposito';

@Component({
  standalone: false,
  selector: 'app-deposito-ingresos',
  templateUrl: './deposito-ingresos.component.html',
})
export class DepositoIngresosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  filterForm: FormGroup;
  activeTab: TabVenta = 'todos';
  tieneDepositoFilter: FiltroDeposito = 'todos';

  rows:    DepositoIngresoRow[] = [];
  loading = false;
  resumen: DepositosIngresosResumen = { contado: { cantidad: 0, monto: 0 }, credito: { cantidad: 0, monto: 0 } };

  pagination = { total: 0, page: 1, limit: 20, pages: 0 };

  serieFilter           = '';
  folioFilter           = '';
  bancoFilter           = '';
  numAutorizacionFilter = '';
  idNumoFilter          = '';
  serieCxcFilter        = '';
  folioCxcFilter        = '';
  bancos:      string[] = [];

  ejercicioActual?: number;
  periodoActual?:   number;
  periodoLabel = '';

  private readonly MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  constructor(
    private fb:                  FormBuilder,
    private reportService:       ReportService,
    private periodoActivoService: PeriodoActivoService,
  ) {
    this.filterForm = this.fb.group({
      uuid:        [''],
      fechaInicio: [''],
      fechaFin:    [''],
    });
  }

  ngOnInit(): void {
    const { ejercicio, periodo } = this.periodoActivoService.snapshot;
    this.ejercicioActual = ejercicio ?? undefined;
    this.periodoActual   = periodo   ?? undefined;
    if (ejercicio) {
      this.periodoLabel = periodo
        ? `${this.MESES[periodo]} ${ejercicio}`
        : `Año ${ejercicio}`;
    }

    this.filterForm.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      takeUntil(this.destroy$),
    ).subscribe(() => this.load(1));

    this.load(1);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  switchTab(tab: TabVenta): void {
    this.activeTab = tab;
    this.load(1);
  }

  load(page = this.pagination.page): void {
    this.loading = true;
    const f = this.filterForm.value;

    this.reportService.getDepositosIngresos({
      uuid:             f.uuid        || undefined,
      fechaInicio:      f.fechaInicio || undefined,
      fechaFin:         f.fechaFin    || undefined,
      serie:            this.serieFilter           || undefined,
      folio:            this.folioFilter           || undefined,
      banco:            this.bancoFilter           || undefined,
      numAutorizacion:  this.numAutorizacionFilter || undefined,
      idNumo:           this.idNumoFilter          || undefined,
      serieCxc:         this.serieCxcFilter        || undefined,
      folioCxc:         this.folioCxcFilter        || undefined,
      ejercicio:        this.ejercicioActual,
      periodo:          this.periodoActual,
      tipoVenta:        this.activeTab,
      tieneDeposito:    this.tieneDepositoFilter,
      page,
      limit: this.pagination.limit,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.rows       = res.data;
        this.resumen    = res.resumen;
        this.pagination = { total: res.total, page: res.page, limit: res.limit, pages: res.pages };
        this.loading    = false;
      },
      error: () => { this.loading = false; },
    });
  }

  selectedRow:        DepositoIngresoRow | null = null;
  detalle:            DepositosIngresosDetalle | null = null;
  detalleLoading      = false;
  showFilterPanel     = false;
  mostrarTodosMov     = false;
  mostrarTodosDepositos = false;
  showEstadoCuenta    = false;
  showCuentasPorCobrar = false;

  // Depósitos a mostrar en el panel: por defecto solo el más reciente
  // (el backend ya ordena `movimientos` por fecha desc); "ver más" expande el resto.
  get movimientosMostrados() {
    const movs = this.movimientosDetalle;
    if (this.mostrarTodosDepositos || movs.length <= 1) return movs;
    return movs.slice(0, 1);
  }

  get movimientosDetalle() {
    const movs = this.detalle?.movimientos ?? [];
    if (!this.bancoFilter || this.mostrarTodosMov) return movs;
    const filtrados = movs.filter(m =>
      m.banco?.toLowerCase().includes(this.bancoFilter.toLowerCase())
    );
    return filtrados.length ? filtrados : movs;
  }

  get tieneMovsOcultos(): boolean {
    if (!this.bancoFilter || this.mostrarTodosMov) return false;
    const total     = this.detalle?.movimientos?.length ?? 0;
    const filtrados = this.detalle?.movimientos?.filter(m =>
      m.banco?.toLowerCase().includes(this.bancoFilter.toLowerCase())
    )?.length ?? 0;
    return total > filtrados && filtrados > 0;
  }

  selectRow(row: DepositoIngresoRow): void {
    if (this.selectedRow === row) { this.closePanel(); return; }
    this.selectedRow     = row;
    this.detalle         = null;
    this.detalleLoading  = true;
    this.mostrarTodosMov = false;
    this.mostrarTodosDepositos = false;
    this.reportService.getDepositoIngresoDetalle(row.cfdiUuid)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (d) => { this.detalle = d; this.detalleLoading = false; },
        error: ()  => { this.detalleLoading = false; },
      });
  }

  closePanel(): void {
    this.selectedRow          = null;
    this.detalle               = null;
    this.detalleLoading        = false;
    this.mostrarTodosMov       = false;
    this.mostrarTodosDepositos = false;
    this.showEstadoCuenta      = false;
    this.showCuentasPorCobrar  = false;
    this.cxcExpandido          = null;
  }

  get historialCuenta(): { num: number; fecha: string | null; concepto: string; monto: number; saldo: number | null; esDeposito: boolean }[] {
    const filas: { num: number; fecha: string | null; concepto: string; monto: number; saldo: number | null; esDeposito: boolean }[] = [];
    const factura = this.detalle?.factura;

    // Saldo corrido real: cada fila resta su monto sobre el saldo de la fila
    // anterior, empezando en el total de la factura. El backend devuelve los
    // movimientos ordenados por fecha desc (para la vista "más reciente"), así
    // que aquí se reordenan cronológicamente asc para que la resta tenga sentido.
    let saldoCorrido = factura?.total ?? null;

    if (factura?.total != null) {
      filas.push({
        num:        1,
        fecha:      factura.fecha,
        concepto:   `Factura ${factura.serie || ''}-${factura.folio || ''}`,
        monto:      factura.total,
        saldo:      saldoCorrido,
        esDeposito: false,
      });
    }

    const movsAsc = [...(this.detalle?.movimientos ?? [])].sort((a, b) =>
      new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    for (const mov of movsAsc) {
      const monto = -(mov.deposito ?? 0);
      if (saldoCorrido != null) saldoCorrido = Math.round((saldoCorrido + monto) * 100) / 100;
      filas.push({
        num:        filas.length + 1,
        fecha:      mov.fecha,
        concepto:   mov.concepto || mov.banco,
        monto,
        saldo:      saldoCorrido,
        esDeposito: true,
      });
    }
    return filas;
  }

  toggleFilterPanel(): void {
    this.showFilterPanel = !this.showFilterPanel;
    if (this.showFilterPanel) {
      this.selectedRow = null;
      this.detalle = null;
      if (!this.bancos.length) {
        this.reportService.getBancosDistintos()
          .pipe(takeUntil(this.destroy$))
          .subscribe({ next: (b) => { this.bancos = b; }, error: () => {} });
      }
    }
  }

  closeFilterPanel(): void { this.showFilterPanel = false; }

  applyFilters(): void { this.showFilterPanel = false; this.load(1); }

  exportLoading = false;

  downloadExcel(): void {
    this.exportLoading = true;
    const f = this.filterForm.value;
    this.reportService.exportDepositosIngresos({
      uuid:             f.uuid        || undefined,
      fechaInicio:      f.fechaInicio || undefined,
      fechaFin:         f.fechaFin    || undefined,
      serie:            this.serieFilter           || undefined,
      folio:            this.folioFilter           || undefined,
      banco:            this.bancoFilter           || undefined,
      numAutorizacion:  this.numAutorizacionFilter || undefined,
      idNumo:           this.idNumoFilter          || undefined,
      serieCxc:         this.serieCxcFilter        || undefined,
      folioCxc:         this.folioCxcFilter        || undefined,
      ejercicio:        this.ejercicioActual,
      periodo:          this.periodoActual,
      tipoVenta:        this.activeTab,
      tieneDeposito:    this.tieneDepositoFilter,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        const per  = this.periodoActual ?? '';
        const ej   = this.ejercicioActual ?? '';
        link.download = `depositos_ingresos_${ej}_${per}_${this.activeTab}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        this.exportLoading = false;
      },
      error: () => { this.exportLoading = false; },
    });
  }

  get hasActiveFilters(): boolean {
    const f = this.filterForm.value;
    return !!(f.uuid || f.fechaInicio || f.fechaFin || this.serieFilter || this.folioFilter || this.bancoFilter || this.numAutorizacionFilter || this.idNumoFilter || this.serieCxcFilter || this.folioCxcFilter || this.activeTab !== 'todos' || this.tieneDepositoFilter !== 'todos');
  }

  get facturaCancelada(): boolean {
    return this.detalle?.factura?.satStatus === 'Cancelado';
  }

  applyColumnFilter(): void { this.load(1); }

  resetFilters(): void {
    this.filterForm.reset({ uuid: '', fechaInicio: '', fechaFin: '' });
    this.serieFilter           = '';
    this.folioFilter           = '';
    this.bancoFilter           = '';
    this.numAutorizacionFilter = '';
    this.idNumoFilter          = '';
    this.serieCxcFilter        = '';
    this.folioCxcFilter        = '';
    this.tieneDepositoFilter   = 'todos';
    this.load(1);
  }

  get pages(): number[] {
    const total = this.pagination.pages;
    const cur   = this.pagination.page;
    const range: number[] = [];
    for (let i = Math.max(1, cur - 2); i <= Math.min(total, cur + 2); i++) range.push(i);
    return range;
  }

  uuidCorto(uuid: string): string {
    return uuid ? uuid.slice(0, 8) + '…' : '—';
  }

  // En Facturas Globales con varias CxC (una por venta de mostrador), mostrar
  // todos los detalles de golpe es abrumador — se colapsan y solo el Folio
  // origen CxC queda visible hasta que el usuario le da click.
  cxcExpandido: string | null = null;

  get modoCompactoCxc(): boolean {
    return !!this.detalle?.facturaEsGlobal && (this.detalle?.cuentasPorCobrar?.length ?? 0) > 1;
  }

  toggleCxc(erpId: string): void {
    this.cxcExpandido = this.cxcExpandido === erpId ? null : erpId;
  }

  get tabCount(): { todos: number; contado: number; credito: number } {
    return {
      todos:   this.resumen.contado.cantidad + this.resumen.credito.cantidad,
      contado: this.resumen.contado.cantidad,
      credito: this.resumen.credito.cantidad,
    };
  }
}
