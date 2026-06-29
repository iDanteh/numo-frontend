import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { forkJoin, of } from 'rxjs';
import { BankService } from '../../../../core/services/bank.service';
import { SocketService, BankImportProgressEvent } from '../../../../core/services/socket.service';

type ImportResult = {
  importados: number;
  duplicados: number;
  softDuplicados?: number;
  categorizados?: number;
  sinReglas?: boolean;
  resumen: Record<string, number>;
  sinFecha?: { banco: string; concepto: string; deposito: number | null; retiro: number | null }[];
  sinImporte?: { banco: string; concepto: string; fecha: string | null }[];
};

@Component({
  standalone: false,
  selector: 'app-import-modal',
  templateUrl: './import-modal.component.html',
  styleUrls: ['./import-modal.component.css'],
})
export class ImportModalComponent implements OnInit, OnDestroy {
  @Input() bancos:      string[] = [];
  @Input() bancoAccent: Record<string, string> = {};
  @Input() activeBanco: string | null = null;

  @Output() closed         = new EventEmitter<void>();
  @Output() importComplete = new EventEmitter<void>();

  importBanco         = '';
  selectedFile: File | null = null;
  uploading           = false;
  isDragging          = false;
  uploadResult: ImportResult | null = null;
  downloadingTemplate = false;
  uploadError: string | null = null;
  importProgress: BankImportProgressEvent | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private bankService:   BankService,
    private socketService: SocketService,
  ) {}

  ngOnInit(): void {
    this.importBanco = this.activeBanco || '';

    this.socketService.importProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => { this.importProgress = progress; });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0] ?? null;
    input.value = '';
    this.setFile(file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) this.setFile(file);
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.isDragging = true; }
  onDragLeave(): void { this.isDragging = false; }

  private setFile(file: File | null): void {
    this.selectedFile = file;
    this.uploadResult = null;
    this.uploadError  = null;
  }

  downloadTemplate(): void {
    if (this.downloadingTemplate) return;
    this.downloadingTemplate = true;
    this.bankService.downloadTemplate().pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href     = url;
        a.download = `plantilla-bancos-${date}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.downloadingTemplate = false;
      },
      error: () => { this.downloadingTemplate = false; },
    });
  }

  uploadExcel(): void {
    if (!this.selectedFile || this.uploading) return;
    this.uploading      = true;
    this.uploadError    = null;
    this.importProgress = null;

    this.bankService.upload(this.selectedFile, this.importBanco || undefined).subscribe({
      next: (res) => {
        this.uploadResult   = res as ImportResult;
        this.uploading      = false;
        this.importProgress = null;
        this.selectedFile   = null;

        if (res.importados > 0) {
          const bancoFijo = this.importBanco || this.activeBanco || null;
          const bancosDestino: string[] = bancoFijo
            ? [bancoFijo]
            : Object.keys(res.resumen).filter(b => (res.resumen[b] ?? 0) > 0);

          if (bancosDestino.length > 0) {
            forkJoin(
              bancosDestino.map(b =>
                this.bankService.applyRules(b, true).pipe(
                  catchError(() => of({ actualizados: 0, sinCambio: 0 }))
                )
              )
            ).pipe(takeUntil(this.destroy$)).subscribe({
              next: (results) => {
                const totalActualizados = results.reduce((s, r) => s + r.actualizados, 0);
                if (this.uploadResult && totalActualizados > 0) {
                  this.uploadResult = {
                    ...this.uploadResult,
                    categorizados: (this.uploadResult.categorizados ?? 0) + totalActualizados,
                  };
                }
                this.importComplete.emit();
              },
            });
            return;
          }
        }

        this.importComplete.emit();
      },
      error: (err) => {
        this.uploadError    = err?.error?.error || 'Error al procesar el archivo';
        this.uploading      = false;
        this.importProgress = null;
      },
    });
  }
}
