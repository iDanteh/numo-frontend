import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup }       from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ReportService, PagoBancoRow, PagosBancoResumen, PagosBancoDetalle, CuentaPorCobrarAfectada } from '../../../core/services/report.service';
import { PeriodoActivoService } from '../../../core/services/periodo-activo.service';

type TabEstado = 'todos' | 'con_pago' | 'sin_pago';

@Component({
  standalone: false,
  selector: 'app-pagos-banco',
  templateUrl: './pagos-banco.component.html',
})
export class PagosBancoComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  filterForm: FormGroup;
  activeTab: TabEstado = 'todos';

  rows:    PagoBancoRow[] = [];
  loading = false;
  resumen: PagosBancoResumen = { conPago: { cantidad: 0, monto: 0 }, sinPago: { cantidad: 0, monto: 0 } };

  pagination = { total: 0, page: 1, limit: 20, pages: 0 };

  serieFilter          = '';
  folioFilter          = '';
  bancoFilter          = '';
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

  switchTab(tab: TabEstado): void {
    this.activeTab = tab;
    this.load(1);
  }

  load(page = this.pagination.page): void {
    this.loading = true;
    const f = this.filterForm.value;

    this.reportService.getPagosBanco({
      uuid:             f.uuid        || undefined,
      fechaInicio:      f.fechaInicio || undefined,
      fechaFin:         f.fechaFin    || undefined,
      serie:            this.serieFilter            || undefined,
      folio:            this.folioFilter            || undefined,
      banco:            this.bancoFilter            || undefined,
      numAutorizacion:  this.numAutorizacionFilter  || undefined,
      idNumo:           this.idNumoFilter            || undefined,
      serieCxc:         this.serieCxcFilter          || undefined,
      folioCxc:         this.folioCxcFilter          || undefined,
      ejercicio:        this.ejercicioActual,
      periodo:          this.periodoActual,
      estado:           this.activeTab,
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

  selectedRow:    PagoBancoRow | null = null;
  detalle:        PagosBancoDetalle | null = null;
  detalleLoading  = false;
  showFilterPanel = false;
  mostrarTodosMov   = false;
  showEstadoCuenta  = false;
  showCuentasPorCobrar = false;

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

  selectRow(row: PagoBancoRow): void {
    if (this.selectedRow === row) { this.closePanel(); return; }
    this.selectedRow    = row;
    this.detalle        = null;
    this.detalleLoading = true;
    this.mostrarTodosMov = false;
    this.reportService.getDetalle(row.facturaUuid)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (d) => { this.detalle = d; this.detalleLoading = false; },
        error: ()  => { this.detalleLoading = false; },
      });
  }

  closePanel(): void {
    this.selectedRow          = null;
    this.detalle              = null;
    this.detalleLoading       = false;
    this.mostrarTodosMov      = false;
    this.showEstadoCuenta     = false;
    this.showCuentasPorCobrar = false;
    this.cxcExpandido         = null;
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
    this.reportService.exportPagosBanco({
      uuid:             f.uuid        || undefined,
      fechaInicio:      f.fechaInicio || undefined,
      fechaFin:         f.fechaFin    || undefined,
      serie:            this.serieFilter            || undefined,
      folio:            this.folioFilter            || undefined,
      banco:            this.bancoFilter            || undefined,
      numAutorizacion:  this.numAutorizacionFilter  || undefined,
      idNumo:           this.idNumoFilter            || undefined,
      serieCxc:         this.serieCxcFilter          || undefined,
      folioCxc:         this.folioCxcFilter          || undefined,
      ejercicio:        this.ejercicioActual,
      periodo:          this.periodoActual,
      estado:           this.activeTab,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        const per  = this.periodoActual ?? '';
        const ej   = this.ejercicioActual ?? '';
        link.download = `pagos_banco_${ej}_${per}_${this.activeTab}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        this.exportLoading = false;
      },
      error: () => { this.exportLoading = false; },
    });
  }

  get hasActiveFilters(): boolean {
    const f = this.filterForm.value;
    return !!(f.uuid || f.fechaInicio || f.fechaFin || this.serieFilter || this.folioFilter || this.bancoFilter || this.numAutorizacionFilter || this.idNumoFilter || this.serieCxcFilter || this.folioCxcFilter || this.activeTab !== 'todos');
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
    this.numAutorizacionFilter  = '';
    this.idNumoFilter           = '';
    this.serieCxcFilter         = '';
    this.folioCxcFilter         = '';
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

  ultimoMovimiento(cxc: CuentaPorCobrarAfectada) {
    const movs = cxc.movimientos ?? [];
    return movs.length ? movs[movs.length - 1] : null;
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

  get historialCuenta(): { num: number; numParcialidad: number | null; serie: string; folio: string; fecha: string | null; saldoAnterior: number; movimiento: number; saldoInsoluto: number; esPago: boolean }[] {
    const filas: any[] = [];
    if (this.detalle?.factura?.total != null) {
      filas.push({
        num:            1,
        numParcialidad: null,
        serie:          this.detalle.factura.serie || '',
        folio:          this.detalle.factura.folio || '',
        fecha:          this.detalle.factura.fecha,
        saldoAnterior:  0,
        movimiento:     this.detalle.factura.total,
        saldoInsoluto:  this.detalle.factura.total,
        esPago:         false,
      });
    }
    for (const p of this.detalle?.parcialidades ?? []) {
      filas.push({
        num:            filas.length + 1,
        numParcialidad: p.numParcialidad,
        serie:          p.serie || '',
        folio:          p.folio || '',
        fecha:          p.fecha,
        saldoAnterior:  p.impSaldoAnt ?? 0,
        movimiento:     -(p.impPagado ?? 0),
        saldoInsoluto:  p.impSaldoInsoluto ?? 0,
        esPago:         true,
      });
    }
    return filas;
  }

  get tabCount(): { todos: number; conPago: number; sinPago: number } {
    return {
      todos:   this.resumen.conPago.cantidad + this.resumen.sinPago.cantidad,
      conPago: this.resumen.conPago.cantidad,
      sinPago: this.resumen.sinPago.cantidad,
    };
  }
}
