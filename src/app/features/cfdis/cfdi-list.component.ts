import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CfdisFacade, SatFacade } from '../../core/facades';
import { ToastService } from '../../core/services/toast.service';
import { CFDI, CFDIFilter, Discrepancy, PaginatedResponse } from '../../core/models/cfdi.model';
import { SAT_STATUS_CLASS, ERP_STATUS_CLASS, COMPARISON_STATUS_CLASS, COMPARISON_STATUS_LABEL, SEVERITY_CLASS, SEVERITY_LABEL, DISCREPANCY_TYPE_LABEL, DISCREPANCY_TYPE_EXPLANATION, FIELD_LABEL } from '../../core/constants/cfdi-labels';

@Component({
  standalone: false,
  selector: 'app-cfdi-list',
  templateUrl: './cfdi-list.component.html',
})
export class CfdiListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  cfdis: CFDI[] = [];
  pagination = { total: 0, page: 1, limit: 20, pages: 0 };
  loading = false;
  filterForm: FormGroup;

  ejercicioActual?: number;
  periodoActual?: number;
  periodoLabel = '';

  readonly satStatusColors = SAT_STATUS_CLASS;
  readonly erpStatusColors = ERP_STATUS_CLASS;
  readonly compStatusColors = COMPARISON_STATUS_CLASS;
  readonly compStatusLabel = COMPARISON_STATUS_LABEL;

  selectedCfdi: CFDI | null = null;
  discrepanciasCfdi: Discrepancy[] = [];
  loadingDiscrepancias = false;
  discrepanciaEstadoLocal: { erpStatus: string; satStatus: string } | null = null;
  comparandoId: string | null = null;
  verificandoBatch = false;
  verificandoSatMsg: string | null = null;
  enriqueciendo = false;
  enriquecerMsg = '';
  downloadingExcel = false;
  mostrarModalExcel = false;
  readonly erpStatusOpciones = ['Timbrado', 'Cancelado', 'Habilitado', 'Deshabilitado', 'Cancelacion Pendiente'];
  erpStatusExcel: Set<string> = new Set(this.erpStatusOpciones);

  readonly severityColors  = SEVERITY_CLASS;
  readonly severityLabel   = SEVERITY_LABEL;
  readonly typeLabel       = DISCREPANCY_TYPE_LABEL;
  readonly typeExplanation = DISCREPANCY_TYPE_EXPLANATION;
  readonly fieldLabel      = FIELD_LABEL;

  readonly tiposComparables = new Set(['I', 'E', 'P']);
  activeTab: 'ERP' | 'SAT' = 'ERP';

  private readonly ERP_ACTIVOS   = new Set(['Timbrado', 'Habilitado']);
  private readonly ERP_CANCELADOS = new Set(['Cancelado', 'Deshabilitado', 'Cancelacion Pendiente']);

  tieneDiscrepanciaEstado(cfdi: CFDI): boolean {
    const erp = cfdi.erpStatus;
    const sat = cfdi.satStatus;
    if (!erp || !sat) return false;
    if (this.ERP_ACTIVOS.has(erp) && sat === 'Cancelado') return true;
    if (this.ERP_CANCELADOS.has(erp) && sat === 'Vigente') return true;
    return false;
  }

  constructor(
    private cfdisFacade: CfdisFacade,
    private satFacade: SatFacade,
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private toast: ToastService,
  ) {
    this.filterForm = this.fb.group({
      source: [''],
      tipoDeComprobante: [''],
      rfcEmisor: [''],
      rfcReceptor: [''],
      satStatus: [''],
      erpStatus: [''],
      lastComparisonStatus: [''],
      fechaInicio: [''],
      fechaFin: [''],
      search: [''],
      uuid: [''],
    });
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParams;
    const ej = qp['ejercicio'];
    const pe = qp['periodo'];
    if (ej) {
      this.ejercicioActual = parseInt(ej);
      this.periodoLabel = pe
        ? `${this.mesLabel(parseInt(pe))} ${ej}`
        : `Año ${ej}`;
    }
    if (pe) this.periodoActual = parseInt(pe);
    if (qp['fechaInicio'] || qp['fechaFin'] || qp['source']) {
      this.filterForm.patchValue({
        fechaInicio: qp['fechaInicio'] ?? '',
        fechaFin:    qp['fechaFin']    ?? '',
        source:      qp['source']      ?? '',
      }, { emitEvent: false });
    }
    this.loadCFDIs();
    this.filterForm.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadCFDIs(1));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  mesLabel(n: number): string {
    const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return nombres[n - 1] ?? '';
  }

  switchTab(tab: 'ERP' | 'SAT'): void {
    this.activeTab = tab;
    this.selectedCfdi = null;
    this.discrepanciasCfdi = [];
    this.loadCFDIs(1);
  }

  loadCFDIs(page = 1): void {
    this.loading = true;
    const filters: CFDIFilter = { ...this.filterForm.value, page, limit: this.pagination.limit };
    filters.source = this.activeTab === 'SAT' ? 'SAT,MANUAL' : 'ERP';
    if (this.ejercicioActual) filters.ejercicio = this.ejercicioActual;
    if (this.periodoActual)   filters.periodo   = this.periodoActual;
    this.cfdisFacade.list(filters).subscribe({
      next: (res: PaginatedResponse<CFDI>) => {
        this.cfdis = res.data;
        this.pagination = res.pagination;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  resetFilters(): void {
    this.filterForm.reset({ source: '' });
  }

  changePage(page: number): void {
    this.loadCFDIs(page);
  }

  downloadXML(cfdi: CFDI): void {
    this.cfdisFacade.downloadXML(cfdi._id);
  }

  comparar(cfdi: CFDI, event: Event): void {
    event.stopPropagation();
    this.comparandoId = cfdi._id;
    this.cfdisFacade.compare(cfdi._id).subscribe({
      next: () => {
        this.comparandoId = null;
        this.loadCFDIs(this.pagination.page);
        this.toast.success('CFDI comparado');
      },
      error: () => {
        this.comparandoId = null;
        this.toast.error('Error al comparar CFDI');
      },
    });
  }

  selectCfdi(cfdi: CFDI): void {
    if (this.selectedCfdi?._id === cfdi._id) {
      this.selectedCfdi = null;
      this.discrepanciasCfdi = [];
      this.discrepanciaEstadoLocal = null;
      return;
    }
    this.selectedCfdi = cfdi;
    this.discrepanciasCfdi = [];
    this.discrepanciaEstadoLocal = this.tieneDiscrepanciaEstado(cfdi)
      ? { erpStatus: cfdi.erpStatus!, satStatus: cfdi.satStatus! }
      : null;
    if (cfdi.lastComparisonStatus === 'discrepancy' || cfdi.lastComparisonStatus === 'warning' ||
        cfdi.lastComparisonStatus === 'cancelled' ||
        cfdi.lastComparisonStatus === 'not_in_sat' || cfdi.lastComparisonStatus === 'not_in_erp') {
      this.loadingDiscrepancias = true;
      this.cfdisFacade.getDiscrepanciasPorUUID(cfdi.uuid).subscribe({
        next: (res) => { this.discrepanciasCfdi = res.data; this.loadingDiscrepancias = false; },
        error: () => { this.loadingDiscrepancias = false; },
      });
    }
  }

  actualizarEstadoSAT(): void {
    const uuids = this.cfdis
      .map(c => c.uuid)
      .filter(u => !u.startsWith('SINUUID'));
    if (!uuids.length) return;
    this.verificandoBatch = true;
    // 600ms por CFDI (500ms delay + overhead SAT) + 2s de margen
    const waitMs = uuids.length * 600 + 2000;
    this.satFacade.verificarBatch(uuids).subscribe({
      next: () => {
        setTimeout(() => {
          this.verificandoBatch = false;
          this.loadCFDIs(this.pagination.page);
          this.toast.success('Estados SAT actualizados');
        }, waitMs);
      },
      error: (err) => {
        this.verificandoBatch = false;
        this.toast.error(err?.error?.error || 'Error al verificar estados SAT');
      },
    });
  }

  closeDetail(): void {
    this.selectedCfdi = null;
    this.discrepanciaEstadoLocal = null;
  }

  enriquecerPagos(): void {
    this.enriqueciendo = true;
    this.enriquecerMsg = '';
    this.cfdisFacade.enriquecerPagos(this.ejercicioActual, this.periodoActual).subscribe({
      next: (res) => {
        this.enriqueciendo = false;
        this.enriquecerMsg = `${res.enriquecidos} complementos de pago procesados.`;
        this.toast.success(`${res.enriquecidos} complementos de pago procesados`);
        this.loadCFDIs(this.pagination.page);
      },
      error: () => {
        this.enriqueciendo = false;
        this.enriquecerMsg = 'Error al enriquecer complementos de pago.';
        this.toast.error('Error al enriquecer complementos de pago');
      },
    });
  }

  montoDisplay(cfdi: CFDI): number | null {
    if (cfdi.total > 0) return cfdi.total;
    // Fallback para pagos SAT con complemento pero sin total en raíz
    if (cfdi.tipoDeComprobante === 'P' && cfdi.complementoPago) {
      if (cfdi.complementoPago.totales?.montoTotalPagos != null) return cfdi.complementoPago.totales.montoTotalPagos;
      if (cfdi.complementoPago.pagos?.length) return cfdi.complementoPago.pagos[0].monto ?? null;
    }
    return null;
  }

  soloAdvertencias(): boolean {
    return this.discrepanciasCfdi.length > 0 && this.discrepanciasCfdi.every(d => d.severity === 'warning');
  }

  monedaDisplay(cfdi: CFDI): string {
    if (cfdi.tipoDeComprobante !== 'P') return 'MXN';
    return cfdi.complementoPago?.pagos?.[0]?.monedaP ?? 'MXN';
  }

  abrirModalExcel(): void {
    this.erpStatusExcel = new Set(this.erpStatusOpciones);
    this.mostrarModalExcel = true;
  }

  toggleErpStatusExcel(est: string): void {
    if (this.erpStatusExcel.has(est)) {
      this.erpStatusExcel.delete(est);
    } else {
      this.erpStatusExcel.add(est);
    }
    this.erpStatusExcel = new Set(this.erpStatusExcel);
  }

  confirmarExcel(): void {
    this.mostrarModalExcel = false;
    this.downloadExcel();
  }

  downloadExcel(): void {
    this.downloadingExcel = true;
    const filters: CFDIFilter = { ...this.filterForm.value };
    if (this.ejercicioActual) filters.ejercicio = this.ejercicioActual;
    if (this.periodoActual)   filters.periodo   = this.periodoActual;

    // Sobreescribir erpStatus con la selección del modal
    if (this.erpStatusExcel.size < this.erpStatusOpciones.length) {
      filters.erpStatus = [...this.erpStatusExcel].join(',');
    } else {
      delete filters.erpStatus; // todos = sin filtro
    }

    this.cfdisFacade.exportExcel(filters).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const periodo = this.periodoLabel
          ? this.periodoLabel.replace(/\s+/g, '_')
          : new Date().toISOString().slice(0, 7);
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `cfdis_${periodo}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.downloadingExcel = false;
        this.toast.success('Excel descargado');
      },
      error: () => {
        this.downloadingExcel = false;
        this.toast.error('Error al generar el Excel');
      },
    });
  }
}
