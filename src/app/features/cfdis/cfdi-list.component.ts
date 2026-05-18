import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, EMPTY } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { CfdisFacade, SatFacade } from '../../core/facades';
import { ToastService } from '../../core/services/toast.service';
import { CFDI, CFDIFilter, CfdiTotales, Discrepancy, PaginatedResponse } from '../../core/models/cfdi.model';
import { SAT_STATUS_CLASS, ERP_STATUS_CLASS, COMPARISON_STATUS_CLASS, COMPARISON_STATUS_LABEL, SEVERITY_CLASS, SEVERITY_LABEL, DISCREPANCY_TYPE_LABEL, DISCREPANCY_TYPE_EXPLANATION, FIELD_LABEL } from '../../core/constants/cfdi-labels';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';
import { AuthService } from '../../core/services/auth.service';
import { CacheService } from '../../core/services/cache.service';

@Component({
  standalone: false,
  selector: 'app-cfdi-list',
  templateUrl: './cfdi-list.component.html',
})
export class CfdiListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private discrepanciasUuid$ = new Subject<string | null>();
  cfdis: CFDI[] = [];
  pagination = { total: 0, page: 1, limit: 20, pages: 0 };
  loading = false;
  totales: CfdiTotales | null = null;
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

  // Modal conciliar not_in_erp
  modalConciliarVisible = false;
  cfdiConciliar: CFDI | null = null;
  conciliarCausa = '';
  conciliarNotas = '';
  conciliando = false;

  readonly CAUSAS_CONCILIACION = [
    { valor: 'proveedor_sin_registro',      label: 'Factura de proveedor registrada fuera del ERP' },
    { valor: 'cancelada_antes_de_registro', label: 'Cancelada antes de registrarse en ERP' },
    { valor: 'periodo_anterior',            label: 'Factura de período anterior no migrada' },
    { valor: 'factura_global_sat',          label: 'Factura global / ticket de caja del SAT' },
    { valor: 'error_descarga_sat',          label: 'Error en descarga SAT (duplicado o registro incorrecto)' },
    { valor: 'tercero_sin_impacto',         label: 'Factura de tercero sin impacto contable en ERP' },
    { valor: 'otra',                        label: 'Otra razón' },
  ];

  // Modal comentario
  modalComentarioVisible = false;
  comentarioDiscId: string | null = null;
  comentarioMotivo = '';
  comentarioDescripcion = '';
  guardandoComentario = false;
  verificandoBatch = false;
  verificandoSatMsg: string | null = null;
  consultandoErpId: string | null = null;
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
  activeTab: 'ERP' | 'SAT' | 'GLOBALES' = 'ERP';
  satDireccion: 'emitidos' | 'recibidos' = 'emitidos';
  private satBatchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Filtros de monto por pestaña (independientes)
  erpSubTotalMin: number | null = null;
  erpSubTotalMax: number | null = null;
  erpTotalMin: number | null = null;
  erpTotalMax: number | null = null;

  subTotalMin: number | null = null;
  subTotalMax: number | null = null;
  totalMin: number | null = null;
  totalMax: number | null = null;

  // Estado de filtros independiente por pestaña
  private filterStateERP: Record<string, any> = {};
  private filterStateSAT: Record<string, any> = {};

  private montoStateERP = { subTotalMin: null as number | null, subTotalMax: null as number | null, totalMin: null as number | null, totalMax: null as number | null };
  private montoStateSAT = { subTotalMin: null as number | null, subTotalMax: null as number | null, totalMin: null as number | null, totalMax: null as number | null };

  // ── Pestaña Globales ──
  globalesLoading = false;
  globalesPlan: any = null;
  globalesPage = 1;
  globalesPagination = { total: 0, page: 1, limit: 20, pages: 1 };
  globalesFiltroUuid = '';
  globalesFiltroMes: number | null = null;
  globalesFiltroAnio: number | null = null;
  readonly globalesMeses = [
    { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' }, { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' }, { value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' }, { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' }, { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' },
  ];
  readonly globalesAnios: number[] = (() => {
    const y = new Date().getFullYear(); const r = []; for (let i = y; i >= 2020; i--) r.push(i); return r;
  })();

  // ── Modal Migrar Periodo (individual) ──
  modalMigrarVisible = false;
  cfdiMigrar: CFDI | null = null;
  migrarEjercicio: number | null = null;
  migrarPeriodo: number | null = null;
  migrandoPeriodo = false;
  buscandoContraparte = false;
  contraparteErp: { encontrado: boolean; esGlobal?: boolean; periodoDistinto?: boolean; ejercicio?: number; periodo?: number } | null = null;

  // ── Selección múltiple / Migrar Bulk ──
  seleccionados = new Set<string>();
  modalMigrarBulkVisible = false;
  migrarBulkEjercicio: number | null = null;
  migrarBulkPeriodo: number | null = null;
  migrandoBulk = false;

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
    private periodoActivoService: PeriodoActivoService,
    private entidadActivaService: EntidadActivaService,
    private authService: AuthService,
    private cache: CacheService,
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
    } else {
      // Usar el periodo activo global como default cuando no vienen query params
      const saved = this.periodoActivoService.snapshot;
      if (saved.ejercicio != null) {
        this.ejercicioActual = saved.ejercicio;
        this.periodoLabel = saved.periodo != null
          ? `${this.mesLabel(saved.periodo)} ${saved.ejercicio}`
          : `Año ${saved.ejercicio}`;
      }
    }
    if (pe) this.periodoActual = parseInt(pe);
    else if (!ej && this.periodoActivoService.snapshot.periodo != null) {
      this.periodoActual = this.periodoActivoService.snapshot.periodo;
    }
    const patchValues: Record<string, string> = {};
    if (qp['fechaInicio'])           patchValues['fechaInicio']           = qp['fechaInicio'];
    if (qp['fechaFin'])              patchValues['fechaFin']              = qp['fechaFin'];
    if (qp['source'])                patchValues['source']                = qp['source'];
    if (qp['lastComparisonStatus'])  patchValues['lastComparisonStatus']  = qp['lastComparisonStatus'];
    // Pre-fill rfcEmisor from global entity if not coming from query params
    if (!qp['rfcEmisor']) {
      const entidad = this.entidadActivaService.snapshot;
      if (entidad) patchValues['rfcEmisor'] = entidad.rfc;
    }
    if (Object.keys(patchValues).length) {
      this.filterForm.patchValue(patchValues, { emitEvent: false });
    }
    this.loadCFDIs();

    // switchMap cancela la petición anterior si el usuario cambia de CFDI rápidamente
    this.discrepanciasUuid$.pipe(
      switchMap(uuid => {
        if (!uuid) {
          this.loadingDiscrepancias = false;
          this.discrepanciasCfdi = [];
          return EMPTY;
        }
        this.loadingDiscrepancias = true;
        return this.cfdisFacade.getDiscrepanciasPorUUID(uuid).pipe(
          catchError(() => {
            this.loadingDiscrepancias = false;
            return EMPTY;
          }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe({
      next: (res) => {
        const order: Record<string, number> = { critical: 0, high: 1, warning: 2, medium: 3, low: 4, info: 5 };
        this.discrepanciasCfdi = res.data.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
        this.loadingDiscrepancias = false;
      },
    });

    this.filterForm.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadCFDIs(1));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.satBatchTimeoutId !== null) clearTimeout(this.satBatchTimeoutId);
  }

  mesLabel(n: number): string {
    const nombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return nombres[n - 1] ?? '';
  }

  switchSatDireccion(dir: 'emitidos' | 'recibidos'): void {
    if (this.satDireccion === dir) return;
    this.satDireccion = dir;
    const rfc = this.entidadActivaService.snapshot?.rfc ?? '';
    if (dir === 'emitidos') {
      this.filterForm.patchValue({ rfcEmisor: rfc, rfcReceptor: '' }, { emitEvent: false });
    } else {
      this.filterForm.patchValue({ rfcEmisor: '', rfcReceptor: rfc }, { emitEvent: false });
    }
    this.loadCFDIs(1);
  }

  switchTab(tab: 'ERP' | 'SAT' | 'GLOBALES'): void {
    // Guardar filtros de la pestaña actual antes de cambiar (form + montos)
    if (this.activeTab === 'ERP') {
      this.filterStateERP = { ...this.filterForm.value };
      this.montoStateERP  = { subTotalMin: this.erpSubTotalMin, subTotalMax: this.erpSubTotalMax, totalMin: this.erpTotalMin, totalMax: this.erpTotalMax };
    } else if (this.activeTab === 'SAT') {
      this.filterStateSAT = { ...this.filterForm.value };
      this.montoStateSAT  = { subTotalMin: this.subTotalMin, subTotalMax: this.subTotalMax, totalMin: this.totalMin, totalMax: this.totalMax };
    }

    this.activeTab = tab;
    if (tab !== 'SAT') this.satDireccion = 'emitidos';
    this.discrepanciasUuid$.next(null); // cancela petición en vuelo al cambiar de tab
    this.selectedCfdi = null;
    this.discrepanciasCfdi = [];
    this.seleccionados = new Set();

    if (tab === 'GLOBALES') {
      this.cargarGlobales();
    } else {
      // Restaurar los filtros guardados de la pestaña destino (sin disparar valueChanges).
      // Se hace merge con defaults vacíos para evitar que reset({}) deje los campos como null.
      const emptyFilters = {
        source: '', tipoDeComprobante: '', rfcEmisor: '', rfcReceptor: '',
        satStatus: '', erpStatus: '', lastComparisonStatus: '',
        fechaInicio: '', fechaFin: '', search: '', uuid: '',
        subTotalMin: '', subTotalMax: '', totalMin: '', totalMax: '',
      };
      const saved      = tab === 'ERP' ? this.filterStateERP : this.filterStateSAT;
      const savedMontos = tab === 'ERP' ? this.montoStateERP  : this.montoStateSAT;
      this.filterForm.reset({ ...emptyFilters, ...saved }, { emitEvent: false });
      // Restaurar filtros de monto de la pestaña destino
      if (tab === 'ERP') {
        this.erpSubTotalMin = savedMontos.subTotalMin;
        this.erpSubTotalMax = savedMontos.subTotalMax;
        this.erpTotalMin    = savedMontos.totalMin;
        this.erpTotalMax    = savedMontos.totalMax;
      } else {
        this.subTotalMin = savedMontos.subTotalMin;
        this.subTotalMax = savedMontos.subTotalMax;
        this.totalMin    = savedMontos.totalMin;
        this.totalMax    = savedMontos.totalMax;
      }
      this.loadCFDIs(1);
    }
  }

  seleccionarGlobal(d: any): void {
    if (this.selectedCfdi?._id === d._id) {
      this.selectedCfdi = null;
      return;
    }
    this.cfdisFacade.getById(d._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (cfdi) => { this.selectedCfdi = cfdi; },
      error: () => {},
    });
  }

  cargarGlobales(page = 1): void {
    if (!this.ejercicioActual) return;
    this.globalesLoading = true;
    if (page === 1) this.globalesPlan = null;
    this.cfdisFacade.getReclasificacionPlan(
      this.ejercicioActual, undefined,
      this.globalesFiltroMes ?? this.periodoActual,
      page, 20,
      this.globalesFiltroUuid.trim().toUpperCase() || undefined,
      this.globalesFiltroAnio ?? undefined,
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.globalesPlan = res?.data ?? res;
          this.globalesPagination = res?.pagination ?? { total: 0, page: 1, limit: 20, pages: 1 };
          this.globalesPage = this.globalesPagination.page;
          this.globalesLoading = false;
        },
        error: () => { this.globalesLoading = false; },
      });
  }

  changeGlobalesPage(page: number): void {
    if (page < 1 || page > this.globalesPagination.pages) return;
    this.cargarGlobales(page);
  }

  get globalesPageNumbers(): (number | null)[] {
    const { page, pages } = this.globalesPagination;
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const left  = Math.max(2, page - 2);
    const right = Math.min(pages - 1, page + 2);
    const result: (number | null)[] = [1];
    if (left > 2)          result.push(null);
    for (let i = left; i <= right; i++) result.push(i);
    if (right < pages - 1) result.push(null);
    result.push(pages);
    return result;
  }

  loadCFDIs(page = 1): void {
    this.loading = true;
    const filters: CFDIFilter = { ...this.filterForm.value, page, limit: this.pagination.limit };
    filters.source = this.activeTab === 'SAT' ? 'SAT,MANUAL' : 'ERP';
    if (this.activeTab === 'ERP') filters.excludeSinUUID = true;
    if (this.activeTab === 'ERP') {
      if (this.erpSubTotalMin != null) filters.subTotalMin = this.erpSubTotalMin;
      if (this.erpSubTotalMax != null) filters.subTotalMax = this.erpSubTotalMax;
      if (this.erpTotalMin    != null) filters.totalMin    = this.erpTotalMin;
      if (this.erpTotalMax    != null) filters.totalMax    = this.erpTotalMax;
    } else {
      if (this.subTotalMin != null) filters.subTotalMin = this.subTotalMin;
      if (this.subTotalMax != null) filters.subTotalMax = this.subTotalMax;
      if (this.totalMin    != null) filters.totalMin    = this.totalMin;
      if (this.totalMax    != null) filters.totalMax    = this.totalMax;
    }
    if (this.ejercicioActual) filters.ejercicio = this.ejercicioActual;
    if (this.periodoActual)   filters.periodo   = this.periodoActual;
    this.cfdisFacade.list(filters).subscribe({
      next: (res: PaginatedResponse<CFDI>) => {
        this.cfdis = res.data;
        this.pagination = res.pagination;
        this.totales = res.totales ?? null;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  resetFilters(): void {
    if (this.activeTab === 'ERP') this.filterStateERP = {};
    else if (this.activeTab === 'SAT') this.filterStateSAT = {};
    this.filterForm.reset({
      source: '', tipoDeComprobante: '', rfcEmisor: '', rfcReceptor: '',
      satStatus: '', erpStatus: '', lastComparisonStatus: '',
      fechaInicio: '', fechaFin: '', search: '', uuid: '',
      subTotalMin: '', subTotalMax: '', totalMin: '', totalMax: '',
    });
    if (this.activeTab === 'ERP') {
      this.erpSubTotalMin = null;
      this.erpSubTotalMax = null;
      this.erpTotalMin    = null;
      this.erpTotalMax    = null;
    } else {
      this.subTotalMin = null;
      this.subTotalMax = null;
      this.totalMin    = null;
      this.totalMax    = null;
    }
  }

  changePage(page: number): void {
    this.loadCFDIs(page);
  }

  downloadXML(cfdi: CFDI): void {
    this.cfdisFacade.downloadXML(cfdi._id).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = `${cfdi.uuid ?? cfdi._id}.xml`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        const blob: Blob = err?.error;
        if (blob instanceof Blob) {
          blob.text().then(text => {
            try {
              const json = JSON.parse(text);
              alert(json.error ?? 'El XML no está disponible para este CFDI.');
            } catch {
              alert('El XML no está disponible para este CFDI.');
            }
          });
        } else {
          alert('El XML no está disponible para este CFDI.');
        }
      },
    });
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
      this.discrepanciasUuid$.next(null); // cancela petición en vuelo al deseleccionar
      this.selectedCfdi = null;
      this.discrepanciasCfdi = [];
      this.discrepanciaEstadoLocal = null;
      return;
    }
    // Mostrar datos básicos de la lista inmediatamente para que el panel abra rápido
    this.selectedCfdi = cfdi;
    this.discrepanciasCfdi = [];
    this.discrepanciaEstadoLocal = this.tieneDiscrepanciaEstado(cfdi)
      ? { erpStatus: cfdi.erpStatus!, satStatus: cfdi.satStatus! }
      : null;

    // Fetch completo — invalida caché antes para garantizar datos frescos (conciliación, etc.)
    this.cache.invalidatePattern(cfdi._id);
    this.cfdisFacade.getById(cfdi._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (full) => {
        if (this.selectedCfdi?._id === full._id) this.selectedCfdi = full;
      },
      error: () => {},
    });

    const necesitaDiscrepancias = cfdi.lastComparisonStatus === 'discrepancy' ||
      cfdi.lastComparisonStatus === 'warning' || cfdi.lastComparisonStatus === 'cancelled' ||
      cfdi.lastComparisonStatus === 'not_in_sat' || cfdi.lastComparisonStatus === 'not_in_erp';
    this.discrepanciasUuid$.next(necesitaDiscrepancias ? cfdi.uuid : null);
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
        this.satBatchTimeoutId = setTimeout(() => {
          this.satBatchTimeoutId = null;
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

  consultarEstadoERP(cfdi: CFDI): void {
    this.consultandoErpId = cfdi._id;
    this.cfdisFacade.estadoCfdi(cfdi._id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.consultandoErpId = null;
        if (!res.encontrado) {
          this.toast.error('El CFDI no fue encontrado en el ERP para esa fecha');
          return;
        }
        if (res.actualizado) {
          // Actualizar el objeto local para que el badge se refresque sin recargar la lista
          if (this.selectedCfdi && this.selectedCfdi._id === cfdi._id) {
            (this.selectedCfdi as any).erpStatus = res.erpStatus;
          }
          const inList = this.cfdis.find(c => c._id === cfdi._id);
          if (inList) (inList as any).erpStatus = res.erpStatus;
          this.toast.success(`Estatus ERP actualizado: ${res.erpStatusAnterior} → ${res.erpStatus}`);
        } else {
          this.toast.success(`Estatus ERP sin cambios: ${res.erpStatus}`);
        }
      },
      error: () => {
        this.consultandoErpId = null;
        this.toast.error('Error al consultar el ERP');
      },
    });
  }

  abrirModalConciliar(cfdi: CFDI, event: Event): void {
    event.stopPropagation();
    this.cfdiConciliar  = cfdi;
    this.conciliarCausa = this.CAUSAS_CONCILIACION[0].valor;
    this.conciliarNotas = '';
    this.modalConciliarVisible = true;
  }

  cerrarModalConciliar(): void {
    this.modalConciliarVisible = false;
    this.cfdiConciliar  = null;
  }

  confirmarConciliacion(): void {
    if (!this.cfdiConciliar || !this.conciliarCausa || this.conciliando) return;
    this.conciliando = true;
    this.cfdisFacade.conciliarNotInErp(this.cfdiConciliar._id, this.conciliarCausa, this.conciliarNotas || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.conciliando = false;
          // Actualizar el objeto local para que el panel de detalle refleje la conciliación
          if (this.cfdiConciliar) {
            const ahora = new Date();
            this.cfdiConciliar.lastComparisonStatus = 'conciliado';
            this.cfdiConciliar.conciliadoPor        = this.authService.currentUser.name || this.authService.currentUser.email || this.authService.currentUser.id;
            this.cfdiConciliar.conciliadoEn         = ahora;
            this.cfdiConciliar.conciliacionCausa    = this.conciliarCausa ?? undefined;
            this.cfdiConciliar.conciliacionNotas    = this.conciliarNotas || undefined;
          }
          this.cerrarModalConciliar();
          this.toast.success('CFDI conciliado correctamente');
          this.loadCFDIs(this.pagination.page);
        },
        error: () => {
          this.conciliando = false;
          this.toast.error('Error al conciliar el CFDI');
        },
      });
  }

  labelCausa(valor?: string): string {
    if (!valor) return '—';
    return this.CAUSAS_CONCILIACION.find(c => c.valor === valor)?.label ?? valor;
  }

  closeDetail(): void {
    this.discrepanciasUuid$.next(null); // cancela petición en vuelo
    this.selectedCfdi = null;
    this.discrepanciaEstadoLocal = null;
    this.discrepanciasCfdi = [];
    this.loadingDiscrepancias = false;
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
      if (cfdi.complementoPago.pagos?.length) {
        return cfdi.complementoPago.pagos.reduce((sum: number, p: any) => sum + (p.monto ?? 0), 0);
      }
    }
    return null;
  }

  soloAdvertencias(): boolean {
    return this.discrepanciasCfdi.length > 0 && this.discrepanciasCfdi.every(d => d.severity === 'warning');
  }

  discPorTipo(type: string): Discrepancy | null {
    return this.discrepanciasCfdi.find(d => d.type === type) ?? null;
  }

  abrirModalComentario(discId: string, event?: Event): void {
    event?.stopPropagation();
    this.comentarioDiscId = discId;
    this.comentarioMotivo = '';
    this.comentarioDescripcion = '';
    this.modalComentarioVisible = true;
  }

  cerrarModalComentario(): void {
    this.modalComentarioVisible = false;
    this.comentarioDiscId = null;
  }

  guardarComentario(): void {
    if (!this.comentarioDiscId || !this.comentarioMotivo.trim()) return;
    this.guardandoComentario = true;
    this.cfdisFacade.addComentarioDiscrepancia(this.comentarioDiscId, this.comentarioMotivo, this.comentarioDescripcion)
      .subscribe({
        next: (res) => {
          const disc = this.discrepanciasCfdi.find(d => d._id === this.comentarioDiscId);
          if (disc) disc.comentarios = res.comentarios as any;
          this.guardandoComentario = false;
          this.cerrarModalComentario();
          this.toast.success('Comentario guardado');
        },
        error: () => {
          this.guardandoComentario = false;
          this.toast.error('Error al guardar el comentario');
        },
      });
  }

  monedaDisplay(cfdi: CFDI): string {
    if (cfdi.tipoDeComprobante !== 'P') return 'MXN';
    return cfdi.complementoPago?.pagos?.[0]?.monedaP ?? 'MXN';
  }

  // ── Migrar Periodo ────────────────────────────────────────────────────────

  esFracturaGlobal(cfdi: CFDI): boolean {
    return !!(cfdi as any).informacionGlobal?.mes;
  }

  /**
   * Un CFDI SAT/MANUAL puede migrar si:
   * - Tiene InformacionGlobal (factura global) y su status es not_in_erp o match.
   * - El filtro activo es 'migrar': el backend ya verificó que hay contraparte ERP
   *   en otro periodo (cross-period). En ese caso el botón se muestra para todos
   *   los resultados de la búsqueda.
   *
   * CFDIs not_in_erp sin InformacionGlobal NO muestran el botón porque el backend
   * los rechazará con "Solo se pueden migrar facturas globales".
   */
  puedeMigrar(cfdi: CFDI): boolean {
    if (cfdi.source !== 'SAT' && cfdi.source !== 'MANUAL') return false;
    // Facturas globales propias pueden migrar si están en not_in_erp o match
    if (this.esFracturaGlobal(cfdi) &&
        (cfdi.lastComparisonStatus === 'not_in_erp' || cfdi.lastComparisonStatus === 'match')) return true;
    // Si el filtro activo es 'migrar', el backend ya verificó la elegibilidad cross-period
    const filtroActivo = this.filterForm.get('lastComparisonStatus')?.value;
    if (filtroActivo === 'migrar' &&
        (cfdi.lastComparisonStatus === 'not_in_erp' || cfdi.lastComparisonStatus === 'match')) return true;
    return false;
  }

  abrirModalMigrar(cfdi: CFDI, event: Event): void {
    event.stopPropagation();
    this.cfdiMigrar = cfdi;
    this.contraparteErp = null;
    const ig = (cfdi as any).informacionGlobal;
    this.migrarEjercicio = ig?.anio ? Number(ig.anio) : (cfdi.ejercicio ?? this.ejercicioActual ?? null);
    this.migrarPeriodo   = ig?.mes  ? Number(ig.mes)  : null;
    this.modalMigrarVisible = true;

    // Si no tiene informacionGlobal propia, buscar contraparte ERP
    if (!ig?.mes) {
      this.buscandoContraparte = true;
      this.cfdisFacade.erpContraparte(cfdi._id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res: any) => {
            this.contraparteErp = res;
            this.buscandoContraparte = false;
            if (res.encontrado && res.esGlobal && res.periodoDistinto) {
              this.migrarEjercicio = res.ejercicio;
              this.migrarPeriodo   = res.periodo;
            }
          },
          error: () => {
            this.buscandoContraparte = false;
            this.contraparteErp = { encontrado: false };
          },
        });
    }
  }

  cerrarModalMigrar(): void {
    this.modalMigrarVisible = false;
    this.cfdiMigrar = null;
    this.migrarEjercicio = null;
    this.migrarPeriodo = null;
    this.contraparteErp = null;
    this.buscandoContraparte = false;
  }

  confirmarMigrar(): void {
    if (!this.cfdiMigrar || !this.migrarEjercicio || !this.migrarPeriodo) return;
    this.migrandoPeriodo = true;
    this.cfdisFacade.migrarPeriodo(this.cfdiMigrar._id, this.migrarEjercicio, this.migrarPeriodo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.migrandoPeriodo = false;
          this.cerrarModalMigrar();
          this.toast.success('CFDI migrado al nuevo periodo');
          this.loadCFDIs(this.pagination.page);
        },
        error: (err: any) => {
          this.migrandoPeriodo = false;
          this.toast.error(err?.error?.error || 'Error al migrar el CFDI');
        },
      });
  }

  // ── Selección múltiple ─────────────────────────────────────────────────────

  toggleSeleccion(cfdi: CFDI, event: Event): void {
    event.stopPropagation();
    if (this.seleccionados.has(cfdi._id)) {
      this.seleccionados.delete(cfdi._id);
    } else {
      this.seleccionados.add(cfdi._id);
    }
    this.seleccionados = new Set(this.seleccionados);
  }

  toggleSeleccionTodos(): void {
    const migrables = this.cfdis.filter(c => this.puedeMigrar(c));
    const todosSeleccionados = migrables.every(c => this.seleccionados.has(c._id));
    if (todosSeleccionados) {
      migrables.forEach(c => this.seleccionados.delete(c._id));
    } else {
      migrables.forEach(c => this.seleccionados.add(c._id));
    }
    this.seleccionados = new Set(this.seleccionados);
  }

  get todosMigrablesSeleccionados(): boolean {
    const migrables = this.cfdis.filter(c => this.puedeMigrar(c));
    return migrables.length > 0 && migrables.every(c => this.seleccionados.has(c._id));
  }

  get hayMigrables(): boolean {
    return this.cfdis.some(c => this.puedeMigrar(c));
  }

  get tiposConSuma(): string[] {
    if (!this.totales) return [];
    return Object.keys(this.totales.porTipo)
      .filter(t => this.totales!.porTipo[t].suma > 0)
      .sort();
  }

  get pageNumbers(): (number | null)[] {
    const { page, pages } = this.pagination;
    if (pages <= 7) {
      return Array.from({ length: pages }, (_, i) => i + 1);
    }
    const left  = Math.max(2, page - 2);
    const right = Math.min(pages - 1, page + 2);
    const result: (number | null)[] = [1];
    if (left > 2)        result.push(null);
    for (let i = left; i <= right; i++) result.push(i);
    if (right < pages - 1) result.push(null);
    result.push(pages);
    return result;
  }

  limpiarSeleccion(): void {
    this.seleccionados = new Set();
  }

  abrirModalMigrarBulk(): void {
    this.migrarBulkEjercicio = this.ejercicioActual ?? null;
    this.migrarBulkPeriodo   = this.periodoActual   ?? null;
    this.modalMigrarBulkVisible = true;
  }

  cerrarModalMigrarBulk(): void {
    this.modalMigrarBulkVisible = false;
    this.migrarBulkEjercicio = null;
    this.migrarBulkPeriodo = null;
  }

  confirmarMigrarBulk(): void {
    if (!this.migrarBulkEjercicio || !this.migrarBulkPeriodo || this.seleccionados.size === 0) return;
    this.migrandoBulk = true;
    const ids = Array.from(this.seleccionados);
    this.cfdisFacade.migrarPeriodoBulk(ids, this.migrarBulkEjercicio, this.migrarBulkPeriodo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.migrandoBulk = false;
          this.cerrarModalMigrarBulk();
          this.seleccionados = new Set();
          this.toast.success(`${res.migrados ?? ids.length} CFDIs migrados al nuevo periodo`);
          this.loadCFDIs(this.pagination.page);
        },
        error: (err: any) => {
          this.migrandoBulk = false;
          this.toast.error(err?.error?.error || 'Error al migrar los CFDIs');
        },
      });
  }

  // ── Conciliar (not_in_erp → conciliado por usuario) ──────────────────────

  confirmarConciliar(): void {
    if (!this.cfdiConciliar || !this.conciliarCausa || !this.conciliarNotas.trim() || this.conciliando) return;
    this.conciliando = true;
    const cfdiId = this.cfdiConciliar._id;
    this.cfdisFacade.conciliarNotInErp(cfdiId, this.conciliarCausa, this.conciliarNotas)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.conciliando = false;
          this.cerrarModalConciliar();
          this.toast.success('CFDI conciliado correctamente');
          // Limpiar caché y recargar lista
          this.cache.invalidatePattern('/cfdis');
          this.loadCFDIs(this.pagination.page);
          // Usar el CFDI actualizado que devuelve el backend directamente
          if (res?.cfdi) {
            this.selectedCfdi = res.cfdi;
          } else {
            this.cfdisFacade.getById(cfdiId)
              .pipe(takeUntil(this.destroy$))
              .subscribe(updated => { this.selectedCfdi = updated; });
          }
        },
        error: (err: any) => {
          this.conciliando = false;
          this.toast.error(err?.error?.error || 'Error al conciliar el CFDI');
        },
      });
  }

  actualizarEstadoERP(cfdi: CFDI, event: Event): void {
    event.stopPropagation();
    if (this.consultandoErpId) return;
    this.consultandoErpId = cfdi._id;
    this.cfdisFacade.getEstadoCfdi(cfdi._id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.consultandoErpId = null;
          this.toast.success(`Estado ERP actualizado: ${res.erpStatus ?? 'sin cambio'}`);
          this.loadCFDIs(this.pagination.page);
        },
        error: (err: any) => {
          this.consultandoErpId = null;
          this.toast.error(err?.error?.error || 'Error al consultar estado ERP');
        },
      });
  }

  // ── Excel ──────────────────────────────────────────────────────────────────

  abrirModalExcel(): void {
    if (this.activeTab !== 'ERP') {
      // SAT/MANUAL: no hay filtro erpStatus relevante, descargar directamente
      this.downloadExcel();
      return;
    }
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
    // Respetar la pestaña activa igual que en loadCfdis()
    filters.source = this.activeTab === 'SAT' ? 'SAT,MANUAL' : 'ERP';
    if (this.activeTab === 'ERP') filters.excludeSinUUID = true;

    // Sobreescribir erpStatus con la selección del modal (solo aplica en pestaña ERP)
    if (this.activeTab === 'ERP' && this.erpStatusExcel.size < this.erpStatusOpciones.length) {
      filters.erpStatus = [...this.erpStatusExcel].join(',');
    } else {
      delete filters.erpStatus; // todos = sin filtro, y SAT nunca filtra por erpStatus
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
