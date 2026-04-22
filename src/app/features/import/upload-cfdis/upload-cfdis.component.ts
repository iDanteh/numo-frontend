import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ImportFacade } from '../../../core/facades';
import { UploadResult, ImportSource } from '../../../core/models/import.model';
import { ToastService } from '../../../core/services/toast.service';
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
  selector: 'app-upload-cfdis',
  templateUrl: './upload-cfdis.component.html',
})
export class UploadCfdisComponent implements OnInit {
  readonly satStatusClass   = SAT_STATUS_CLASS;
  readonly compStatusLabel  = COMPARISON_STATUS_LABEL;
  readonly compStatusClass  = COMPARISON_STATUS_CLASS;

  selectedFiles: File[] = [];
  source: ImportSource = 'SAT';
  dragOver = false;
  loading = false;
  comparing = false;
  result: UploadResult | null = null;
  error = '';

  excelFile: File | null = null;
  excelSource: ImportSource = 'ERP';
  excelLoading = false;
  excelResult: UploadResult | null = null;
  excelError = '';

  // Periodo activo
  ejercicioActual?: number;
  periodoActual?: number;
  nombrePeriodoActual = '';
  mostrarSelectorPeriodo = false;
  private pendingUpload = false;
  private pendingExcelUpload = false;

  /** Label de solo lectura para compatibilidad con navegación desde ejercicios */
  periodoLabel = '';

  constructor(
    private importFacade: ImportFacade,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastService,
    private periodoActivoService: PeriodoActivoService,
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const ej = qp.get('ejercicio');
    const pe = qp.get('periodo');
    if (ej && pe) {
      this.ejercicioActual = +ej;
      this.periodoActual   = +pe;
      this.nombrePeriodoActual = MESES_LABELS[+pe - 1] ?? '';
      this.periodoLabel = `${this.nombrePeriodoActual} ${ej}`;
    } else if (ej) {
      this.periodoLabel = `Año ${ej}`;
    } else {
      // Usar el periodo activo global como default
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

  abrirSelectorPeriodo(): void {
    this.mostrarSelectorPeriodo = true;
  }

  onPeriodoConfirmado(datos: PeriodoSeleccionado): void {
    this.ejercicioActual     = datos.ejercicio;
    this.periodoActual       = datos.periodo;
    this.nombrePeriodoActual = datos.nombrePeriodo;
    this.periodoLabel        = `${datos.nombrePeriodo} ${datos.ejercicio}`;
    this.mostrarSelectorPeriodo = false;

    if (this.pendingUpload) {
      this.pendingUpload = false;
      this.upload();
    } else if (this.pendingExcelUpload) {
      this.pendingExcelUpload = false;
      this.uploadExcel();
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(Array.from(input.files));
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    if (event.dataTransfer?.files) this.addFiles(Array.from(event.dataTransfer.files));
  }

  private addFiles(files: File[]): void {
    const valid = files.filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.xml') || name.endsWith('.zip');
    });
    this.selectedFiles = [...this.selectedFiles, ...valid];
    this.result = null;
    this.error = '';
  }

  removeFile(index: number): void {
    this.selectedFiles = this.selectedFiles.filter((_, i) => i !== index);
  }

  clear(): void {
    this.selectedFiles = [];
    this.result = null;
    this.error = '';
  }

  upload(): void {
    if (!this.selectedFiles.length) return;

    if (!this.ejercicioActual || !this.periodoActual) {
      this.pendingUpload = true;
      this.mostrarSelectorPeriodo = true;
      return;
    }

    this.loading = true;
    this.result = null;
    this.error = '';
    this.importFacade.uploadFiles(this.selectedFiles, this.source, this.ejercicioActual, this.periodoActual).subscribe({
      next: (res) => {
        this.result = res;
        this.loading = false;
        this.selectedFiles = [];
        this.toast.success(`${res.nuevos ?? 0} CFDIs importados correctamente`);
        this.router.navigate(['/ejercicios']);
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Error al subir los archivos';
        this.loading = false;
        this.toast.error(this.error);
      },
    });
  }

  onExcelSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
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
    this.excelResult = null;
    this.excelError = '';
    this.importFacade.importFromExcel(this.excelFile, this.excelSource, this.ejercicioActual, this.periodoActual).subscribe({
      next: (res) => {
        this.excelResult = res;
        this.excelLoading = false;
        this.excelFile = null;
        this.toast.success(`Excel importado — ${res.nuevos ?? 0} CFDIs procesados`);
        this.router.navigate(['/ejercicios']);
      },
      error: (err) => {
        this.excelError = err?.error?.error ?? 'Error al procesar el archivo Excel';
        this.excelLoading = false;
        this.toast.error(this.excelError);
      },
    });
  }

  compareNow(): void {
    this.comparing = true;
    this.importFacade.runBatchComparison().subscribe({
      next: () => { this.comparing = false; },
      error: () => { this.comparing = false; },
    });
  }

  totalSize(): string {
    const bytes = this.selectedFiles.reduce((acc, f) => acc + f.size, 0);
    return bytes > 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
      : (bytes / 1024).toFixed(0) + ' KB';
  }
}
