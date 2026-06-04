import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs';
import { ImportFacade } from '../../../core/facades';
import { UploadResult, ImportSource } from '../../../core/models/import.model';
import { PeriodoSeleccionado } from '../../../shared/components/selector-periodo-modal/selector-periodo-modal.component';
import { PeriodoActivoService } from '../../../core/services/periodo-activo.service';
import {
  SAT_STATUS_CLASS,
  COMPARISON_STATUS_LABEL,
  COMPARISON_STATUS_CLASS,
  MESES_LABELS,
} from '../../../core/constants/cfdi-labels';

@Component({
  standalone: false,
  selector: 'app-subir-manual',
  templateUrl: './subir-manual.component.html',
})
export class SubirManualComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('excelZone') excelZoneRef!: ElementRef<HTMLDivElement>;

  readonly satStatusClass  = SAT_STATUS_CLASS;
  readonly compStatusLabel = COMPARISON_STATUS_LABEL;
  readonly compStatusClass = COMPARISON_STATUS_CLASS;

  // ── Archivos seleccionados ────────────────────────────────────────────────
  selectedFiles: File[] = [];
  source: ImportSource = 'SAT';
  dragOver = false;
  error    = '';

  // ── Estado de la subida ───────────────────────────────────────────────────
  loading = false;
  result: UploadResult | null = null;

  // ── Excel ─────────────────────────────────────────────────────────────────
  excelFile: File | null = null;
  excelDragOver = false;
  excelSource: ImportSource = 'SAT';
  excelLoading = false;
  excelResult: UploadResult | null = null;
  excelError   = '';

  // ── Periodo activo ────────────────────────────────────────────────────────
  ejercicioActual?: number;
  periodoActual?:   number;
  nombrePeriodoActual = '';
  mostrarSelectorPeriodo = false;
  periodoLabel = '';

  private pendingUpload      = false;
  private pendingExcelUpload = false;
  private readonly destroy$ = new Subject<void>();
  private excelDragListeners: (() => void)[] = [];

  // ── Comparar ahora ────────────────────────────────────────────────────────
  comparing = false;

  constructor(
    private importFacade: ImportFacade,
    private route: ActivatedRoute,
    private router: Router,
    private periodoActivoService: PeriodoActivoService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const ej = qp.get('ejercicio');
    const pe = qp.get('periodo');
    if (ej && pe) {
      this.ejercicioActual     = +ej;
      this.periodoActual       = +pe;
      this.nombrePeriodoActual = MESES_LABELS[+pe - 1] ?? '';
      this.periodoLabel        = `${this.nombrePeriodoActual} ${ej}`;
    } else if (ej) {
      this.periodoLabel = `Año ${ej}`;
    } else {
      const saved = this.periodoActivoService.snapshot;
      if (saved.ejercicio != null) {
        this.ejercicioActual = saved.ejercicio;
        if (saved.periodo != null) {
          this.periodoActual       = saved.periodo;
          this.nombrePeriodoActual = MESES_LABELS[saved.periodo - 1] ?? '';
          this.periodoLabel        = `${this.nombrePeriodoActual} ${saved.ejercicio}`;
        } else {
          this.periodoLabel = `Año ${saved.ejercicio}`;
        }
      }
    }
  }

  ngAfterViewInit(): void {
    const el = this.excelZoneRef.nativeElement;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.excelDragOver) { this.excelDragOver = true; this.cdr.detectChanges(); }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node)) {
        this.excelDragOver = false;
        this.cdr.detectChanges();
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.excelDragOver = false;
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls'))) {
        this.excelFile = file;
        this.excelResult = null;
        this.excelError = '';
      } else if (file) {
        this.excelError = 'Solo se aceptan archivos .xlsx o .xls';
      }
      this.cdr.detectChanges();
    };

    el.addEventListener('dragover',  onDragOver);
    el.addEventListener('dragenter', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop',      onDrop);

    this.excelDragListeners = [
      () => el.removeEventListener('dragover',  onDragOver),
      () => el.removeEventListener('dragenter', onDragOver),
      () => el.removeEventListener('dragleave', onDragLeave),
      () => el.removeEventListener('drop',      onDrop),
    ];
  }

  ngOnDestroy(): void {
    this.excelDragListeners.forEach(fn => fn());
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:dragover', ['$event'])
  @HostListener('document:drop', ['$event'])
  preventBrowserDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  // ─── Selección de periodo ─────────────────────────────────────────────────

  abrirSelectorPeriodo(): void {
    this.mostrarSelectorPeriodo = true;
  }

  onPeriodoConfirmado(datos: PeriodoSeleccionado): void {
    this.ejercicioActual        = datos.ejercicio;
    this.periodoActual          = datos.periodo;
    this.nombrePeriodoActual    = datos.nombrePeriodo;
    this.periodoLabel           = `${datos.nombrePeriodo} ${datos.ejercicio}`;
    this.mostrarSelectorPeriodo = false;

    if (this.pendingUpload) {
      this.pendingUpload = false;
      this.upload();
    } else if (this.pendingExcelUpload) {
      this.pendingExcelUpload = false;
      this.uploadExcel();
    }
  }

  // ─── Manejo de archivos ───────────────────────────────────────────────────

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(): void {
    this.dragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    if (event.dataTransfer?.files) this.addFiles(Array.from(event.dataTransfer.files));
  }

  removeFile(i: number): void {
    this.selectedFiles = this.selectedFiles.filter((_, idx) => idx !== i);
  }

  clear(): void {
    this.selectedFiles = [];
    this.error         = '';
    this.result        = null;
  }

  totalSize(): string {
    const bytes = this.selectedFiles.reduce((acc, f) => acc + f.size, 0);
    return bytes > 1_048_576
      ? (bytes / 1_048_576).toFixed(1) + ' MB'
      : (bytes / 1024).toFixed(0) + ' KB';
  }

  private addFiles(files: File[]): void {
    const xmlFiles = files.filter(f => f.name.toLowerCase().endsWith('.xml'));
    this.selectedFiles = [...this.selectedFiles, ...xmlFiles];
    this.error  = '';
    this.result = null;
  }

  // ─── Subida XML ───────────────────────────────────────────────────────────

  upload(): void {
    if (!this.selectedFiles.length) return;

    if (!this.ejercicioActual || !this.periodoActual) {
      this.pendingUpload = true;
      this.mostrarSelectorPeriodo = true;
      return;
    }

    this.loading = true;
    this.error   = '';
    this.result  = null;

    this.importFacade.uploadFiles(
      this.selectedFiles,
      this.source,
      this.ejercicioActual,
      this.periodoActual,
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.result        = res;
        this.loading       = false;
        this.selectedFiles = [];
      },
      error: (err) => {
        this.error   = err?.error?.error ?? 'Error al subir los archivos';
        this.loading = false;
      },
    });
  }

  // ─── Excel ────────────────────────────────────────────────────────────────

  onExcelSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (file) { this.excelFile = file; this.excelResult = null; this.excelError = ''; }
  }

  uploadExcel(): void {
    if (!this.excelFile) return;
    if (!this.ejercicioActual || !this.periodoActual) {
      this.pendingExcelUpload = true;
      this.mostrarSelectorPeriodo = true;
      return;
    }
    this.excelLoading = true;
    this.excelResult  = null;
    this.excelError   = '';
    this.importFacade.importFromExcel(this.excelFile, this.excelSource, this.ejercicioActual, this.periodoActual).subscribe({
      next:  (res) => { this.excelResult = res; this.excelLoading = false; this.excelFile = null; },
      error: (err) => { this.excelError  = err?.error?.error ?? 'Error al procesar el Excel'; this.excelLoading = false; },
    });
  }

  compareNow(): void {
    this.comparing = true;
    this.importFacade.runBatchComparison().subscribe({
      next:  () => { this.comparing = false; },
      error: () => { this.comparing = false; },
    });
  }
}
