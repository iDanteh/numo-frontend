import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ImportFacade, ComparisonFacade } from '../../../core/facades';
import { UploadResult, DriveFolderItem, ImportSource } from '../../../core/models/import.model';
import { MESES } from '../../../core/constants/cfdi-labels';

interface PeriodoFiscal { _id: string; ejercicio: number; periodo: number | null; label?: string; }

@Component({
  standalone: false,
  selector: 'app-drive-import',
  templateUrl: './drive-import.component.html',
})
export class DriveImportComponent implements OnInit {
  readonly MESES = MESES;

  // Periodos creados en el sistema
  periodosFiscales: PeriodoFiscal[] = [];
  periodosLoading = false;
  ejerciciosDisponibles: number[] = [];
  periodosDelEjercicio: PeriodoFiscal[] = [];

  ejercicio: number | null = null;
  periodo: number | null = null;

  folderId = '';
  source: ImportSource = 'ERP';

  folders: DriveFolderItem[] = [];
  foldersLoading = false;
  foldersError = '';
  foldersLoaded = false;

  importing = false;
  comparing = false;
  result: UploadResult | null = null;
  error = '';
  showSuccessModal = false;

  get sinPeriodos(): boolean {
    return !this.periodosLoading && this.periodosFiscales.length === 0;
  }

  get canImport(): boolean {
    const folderOk = this.source === 'ERP' || !!this.folderId.trim();
    return !!this.ejercicio && !!this.periodo && folderOk && !this.importing && !this.sinPeriodos;
  }

  constructor(
    private importFacade: ImportFacade,
    private comparisonFacade: ComparisonFacade,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cargarPeriodos();
  }

  cargarPeriodos(): void {
    this.periodosLoading = true;
    this.comparisonFacade.listPeriodosFiscales().subscribe({
      next: (res) => {
        this.periodosFiscales = res.data;
        // Ejercicios únicos ordenados desc
        this.ejerciciosDisponibles = [...new Set(res.data.map((p: PeriodoFiscal) => p.ejercicio))].sort((a, b) => b - a);
        this.periodosLoading = false;
      },
      error: () => { this.periodosLoading = false; },
    });
  }

  onEjercicioChange(ej: number | null): void {
    this.ejercicio = ej;
    this.periodo = null;
    this.periodosDelEjercicio = ej
      ? this.periodosFiscales.filter(p => p.ejercicio === ej && p.periodo !== null)
      : [];
  }

  onSourceChange(source: ImportSource): void {
    this.source = source;
    if (source === 'ERP') this.folderId = '';
  }

  loadFolders(): void {
    this.foldersLoading = true;
    this.foldersError = '';
    this.importFacade.listDriveFolders().subscribe({
      next: (res) => {
        this.folders = res.folders;
        this.foldersLoaded = true;
        this.foldersLoading = false;
      },
      error: (err) => {
        this.foldersError = err?.error?.message ?? 'No se pudieron cargar las carpetas.';
        this.foldersLoading = false;
      },
    });
  }

  selectFolder(folder: DriveFolderItem): void {
    this.folderId = folder.id;
  }

  importar(): void {
    if (!this.canImport) return;
    this.importing = true;
    this.result = null;
    this.error = '';

    this.importFacade.importFromDrive({ folderId: this.folderId.trim(), source: this.source, ejercicio: this.ejercicio!, periodo: this.periodo! }).subscribe({
      next: (res) => {
        this.result = res;
        this.importing = false;
        if (res.procesados > 0) this.showSuccessModal = true;
      },
      error: (err) => {
        this.error = err?.error?.error ?? err?.error?.message ?? 'Error al importar desde Drive';
        this.importing = false;
      },
    });
  }

  irAlVisor(): void {
    const yr = this.ejercicio!;
    const mo = this.periodo!;
    const fechaInicio = `${yr}-${String(mo).padStart(2, '0')}-01`;
    const lastDay = new Date(yr, mo, 0).getDate();
    const fechaFin = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    this.showSuccessModal = false;
    this.router.navigate(['/cfdis'], { queryParams: { fechaInicio, fechaFin, source: this.source } });
  }

  cerrarModal(): void {
    this.showSuccessModal = false;
  }

  compareNow(): void {
    this.comparing = true;
    this.importFacade.runBatchComparison().subscribe({
      next: () => { this.comparing = false; },
      error: () => { this.comparing = false; },
    });
  }

  getLabelMes(num: number | null): string {
    if (!num) return '';
    return this.MESES.find(m => m.value === num)?.label ?? String(num);
  }
}
