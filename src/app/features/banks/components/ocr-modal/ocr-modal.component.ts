import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  CollectionRequestService, ExtractedReceiptData, MovementCandidate,
} from '../../../../core/services/collection-request.service';

@Component({
  standalone: false,
  selector: 'app-ocr-modal',
  templateUrl: './ocr-modal.component.html',
  styleUrls: ['./ocr-modal.component.css'],
})
export class OcrModalComponent implements OnInit, OnDestroy {
  @Input() activeBanco: string | null = null;
  @Input() view: 'cards' | 'detail'  = 'cards';

  @Output() closed            = new EventEmitter<void>();
  @Output() candidateSelected = new EventEmitter<{ banco: string; movId: string }>();

  ocrPhase: 'idle' | 'analyzing' | 'results' = 'idle';
  ocrFile: File | null               = null;
  ocrPreviewUrl: string | null       = null;
  ocrExtracted: ExtractedReceiptData | null = null;
  ocrCandidates: MovementCandidate[] = [];
  ocrError: string | null            = null;
  ocrIsDragging                      = false;

  private destroy$ = new Subject<void>();

  constructor(private crService: CollectionRequestService) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.ocrPreviewUrl) URL.revokeObjectURL(this.ocrPreviewUrl);
  }

  ocrOnDragOver(event: DragEvent): void { event.preventDefault(); this.ocrIsDragging = true; }
  ocrOnDragLeave(): void { this.ocrIsDragging = false; }

  ocrOnDrop(event: DragEvent): void {
    event.preventDefault();
    this.ocrIsDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) this.analyzeComprobante(file);
  }

  ocrOnFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    input.value = '';
    if (file) this.analyzeComprobante(file);
  }

  resetToUpload(): void {
    this.ocrPhase      = 'idle';
    this.ocrFile       = null;
    if (this.ocrPreviewUrl) URL.revokeObjectURL(this.ocrPreviewUrl);
    this.ocrPreviewUrl = null;
    this.ocrExtracted  = null;
    this.ocrCandidates = [];
    this.ocrError      = null;
  }

  private analyzeComprobante(file: File): void {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      this.ocrError = 'Formato no soportado. Usa JPG, PNG, WEBP o PDF.';
      return;
    }
    this.ocrFile       = file;
    this.ocrError      = null;
    this.ocrPhase      = 'analyzing';
    this.ocrPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

    this.crService.analyzeReceipt(file).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.ocrExtracted  = res.extracted;
        this.ocrCandidates = [...res.candidates]
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        this.ocrPhase = 'results';
      },
      error: (err) => {
        this.ocrError = err?.error?.error || 'Error al analizar el comprobante';
        this.ocrPhase = 'idle';
      },
    });
  }

  selectOcrCandidate(candidate: MovementCandidate): void {
    this.candidateSelected.emit({
      banco: candidate.movement.banco,
      movId: candidate.movement._id,
    });
  }

  ocrNivelClass(nivel: 'alto' | 'medio' | 'bajo'): string {
    return { alto: 'ocr-nivel-alto', medio: 'ocr-nivel-medio', bajo: 'ocr-nivel-bajo' }[nivel];
  }
}
