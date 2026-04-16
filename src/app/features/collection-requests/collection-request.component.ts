import { Component, OnInit, OnDestroy, ElementRef, ViewChild, HostListener } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import {
  CollectionRequestService,
  ExtractedReceiptData,
  MovementCandidate,
} from '../../core/services/collection-request.service';

type Phase = 'idle' | 'analyzing' | 'results' | 'saving' | 'saved';
export type PaymentMethod = 'transferencia' | 'efectivo' | 'cheque' | 'tarjeta' | 'otro';

export interface PaymentForm {
  metodo:          PaymentMethod;
  monto:           number | null;
  // Transferencia
  claveRastreo:    string;
  referencia:      string;
  bancoOrigen:     string;
  bancoDestino:    string;
  clabe:           string;
  // Cheque
  numeroCheque:    string;
  bancoCheque:     string;
  // Tarjeta
  ultimos4:        string;
  tipoTarjeta:     'credito' | 'debito' | '';
  // Otro
  descripcion:     string;
  // Comunes
  clienteNombre:   string;
  clienteRFC:      string;
  cfdiReferencia:  string;
  notas:           string;
}

@Component({
  standalone: false,
  selector: 'app-collection-request',
  templateUrl: './collection-request.component.html',
})
export class CollectionRequestComponent implements OnInit, OnDestroy {

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  // ── Estado principal ───────────────────────────────────────────────────────
  phase:      Phase  = 'idle';
  error:      string | null = null;
  isDragging  = false;
  previewUrl: string | null = null;

  // ── Resultados del análisis ────────────────────────────────────────────────
  extracted:  ExtractedReceiptData | null = null;
  candidates: MovementCandidate[]         = [];
  selected:   MovementCandidate | null    = null;

  // ── Buscador de candidatos ─────────────────────────────────────────────────
  candidateSearch      = '';
  showOtherCandidates  = false;

  // ── Búsqueda manual de movimientos ─────────────────────────────────────────
  showManualSearch      = false;
  manualQuery           = '';
  manualBanco           = '';
  manualTipo            = '';
  manualFechaInicio     = '';
  manualFechaFin        = '';
  manualMovements:any[] = [];
  manualLoading         = false;
  manualPage            = 1;
  manualTotal           = 0;
  readonly manualLimit  = 20;

  private manualSearch$ = new Subject<void>();

  readonly bancosList = [
    'Banamex','BBVA','Santander','Banorte','HSBC','Azteca',
    'Inbursa','Scotiabank','BanBajío','Afirme','Intercam',
    'Nu','Spin','Hey Banco','Albo',
  ];

  get filteredCandidates(): MovementCandidate[] {
    const q = this.candidateSearch.trim().toLowerCase();
    if (!q) return this.candidates;
    return this.candidates.filter(c => {
      const m = c.movement;
      return (
        (m.banco        || '').toLowerCase().includes(q) ||
        (m.concepto     || '').toLowerCase().includes(q) ||
        String(m.deposito ?? m.retiro ?? '').includes(q) ||
        (m.numeroAutorizacion || '').toLowerCase().includes(q) ||
        (m.referenciaNumerica || '').toLowerCase().includes(q)
      );
    });
  }

  // ── Modal de aplicación de cobro ──────────────────────────────────────────
  showPaymentModal = false;

  readonly paymentMethods: { value: PaymentMethod; label: string; icon: string }[] = [
    { value: 'transferencia', label: 'Transferencia', icon: '🏦' },
    { value: 'efectivo',      label: 'Efectivo',      icon: '💵' },
    { value: 'cheque',        label: 'Cheque',        icon: '📋' },
    { value: 'tarjeta',       label: 'Tarjeta',       icon: '💳' },
    { value: 'otro',          label: 'Otro',          icon: '📌' },
  ];

  private destroy$ = new Subject<void>();

  constructor(private svc: CollectionRequestService) {}

  ngOnInit(): void {
    this.manualSearch$
      .pipe(debounceTime(380), takeUntil(this.destroy$))
      .subscribe(() => {
        this.manualPage = 1;
        this.loadManualMovements();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.releasePreview();
  }

  // ── Ctrl+V paste ───────────────────────────────────────────────────────────

  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    if (this.phase !== 'idle') return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) { this.processFile(file); break; }
      }
    }
  }

  // ── Drag & drop (incluye imágenes de WhatsApp Web) ─────────────────────────

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(): void {
    this.isDragging = false;
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = false;
    const dt = e.dataTransfer;
    if (!dt) return;

    // Caso 1: archivo real (carga estándar, compartir pantalla, etc.)
    if (dt.files.length > 0) {
      const file = dt.files[0];
      if (this.isAllowedType(file.type)) { this.processFile(file); return; }
    }

    // Caso 2: WhatsApp Web arrastra como HTML con <img src="blob:...">
    const html = dt.getData('text/html');
    if (html) {
      const match = html.match(/src="([^"]+)"/i);
      if (match) { this.fetchFromUrl(match[1]); return; }
    }

    // Caso 3: items individuales (Firefox, algunos escenarios de WA)
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { this.processFile(file); return; }
      }
    }

    this.error = 'No se pudo leer el archivo arrastrado. Guárdalo y cárgalo desde el selector.';
  }

  private fetchFromUrl(url: string): void {
    if (this.phase !== 'idle') return;
    this.phase = 'analyzing';
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const type = blob.type || 'image/jpeg';
        const file = new File([blob], 'whatsapp.jpg', { type });
        this.phase = 'idle';
        this.processFile(file);
      })
      .catch(() => {
        this.phase = 'idle';
        this.error = 'No se pudo cargar la imagen de WhatsApp. Descárgala y cárgala manualmente.';
      });
  }

  private isAllowedType(type: string): boolean {
    return ['image/jpeg','image/png','image/webp','image/gif','application/pdf'].includes(type);
  }

  onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.processFile(file);
    (e.target as HTMLInputElement).value = '';
  }

  triggerFileInput(): void {
    this.fileInputRef.nativeElement.click();
  }

  // ── Análisis ───────────────────────────────────────────────────────────────

  private processFile(file: File): void {
    if (!this.isAllowedType(file.type)) {
      this.error = `Tipo de archivo no soportado (${file.type}). Usa JPG, PNG, WEBP o PDF.`;
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.error = 'El archivo no debe superar 20 MB.';
      return;
    }

    this.error           = null;
    this.extracted       = null;
    this.candidates      = [];
    this.selected        = null;
    this.candidateSearch = '';

    this.releasePreview();
    this.previewUrl = URL.createObjectURL(file);
    this.analyze(file);
  }

  private analyze(file: File): void {
    this.phase = 'analyzing';

    this.svc.analyzeReceipt(file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.extracted  = res.extracted;
          this.candidates = res.candidates;
          this.phase      = 'results';

          if (res.candidates.length > 0 && res.candidates[0].score >= 80) {
            this.selected = res.candidates[0];
          }
        },
        error: (err) => {
          this.phase = 'idle';
          this.error = err.error?.error || err.message || 'Error al analizar la imagen';
        },
      });
  }

  // ── Coincidencia exacta ────────────────────────────────────────────────────

  get hasExactMatch(): boolean {
    return this.candidates.length > 0 && this.candidates[0].score >= 80;
  }

  // ── Selección de candidato ─────────────────────────────────────────────────

  selectCandidate(c: MovementCandidate): void {
    this.selected = this.selected?.movement._id === c.movement._id ? null : c;
  }

  get selectedId(): string | null {
    return (this.selected as any)?.movement?._id ?? null;
  }

  // ── Búsqueda manual de movimientos ─────────────────────────────────────────

  openManualSearch(): void {
    this.showManualSearch = true;
    this.manualPage       = 1;
    this.manualMovements  = [];
    this.loadManualMovements();
  }

  closeManualSearch(): void {
    this.showManualSearch = false;
  }

  onManualFilterChange(): void {
    this.manualSearch$.next();
  }

  clearManualFilters(): void {
    this.manualQuery      = '';
    this.manualBanco      = '';
    this.manualTipo       = '';
    this.manualFechaInicio = '';
    this.manualFechaFin   = '';
    this.manualPage       = 1;
    this.loadManualMovements();
  }

  loadManualMovements(): void {
    this.manualLoading = true;
    this.svc.listBankMovements({
      search:       this.manualQuery       || undefined,
      banco:        this.manualBanco       || undefined,
      tipo:         (this.manualTipo as any) || undefined,
      fechaInicio:  this.manualFechaInicio || undefined,
      fechaFin:     this.manualFechaFin    || undefined,
      page:         this.manualPage,
      limit:        this.manualLimit,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.manualMovements = res.data;
        this.manualTotal     = res.pagination?.total ?? 0;
        this.manualLoading   = false;
      },
      error: () => { this.manualLoading = false; },
    });
  }

  selectManualMovement(mov: any): void {
    this.selected = {
      movement: mov,
      score:    0,
      reasons:  ['Seleccionado manualmente'],
      nivel:    'bajo',
    };
    this.showManualSearch = false;
  }

  manualChangePage(page: number): void {
    this.manualPage = page;
    this.loadManualMovements();
  }

  get manualPages(): number {
    return Math.ceil(this.manualTotal / this.manualLimit);
  }

  get manualPageRange(): number[] {
    const total = this.manualPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = new Set<number>([1, total]);
    for (let i = Math.max(2, this.manualPage - 2); i <= Math.min(total - 1, this.manualPage + 2); i++) {
      pages.add(i);
    }

    const sorted = [...pages].sort((a, b) => a - b);
    const result: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push(-1); // ellipsis
      result.push(sorted[i]);
    }
    return result;
  }

  reset(): void {
    this.phase               = 'idle';
    this.extracted           = null;
    this.candidates          = [];
    this.selected            = null;
    this.error               = null;
    this.candidateSearch     = '';
    this.showOtherCandidates = false;
    this.showPaymentModal    = false;
    this.showManualSearch    = false;
    this.manualMovements     = [];
    this.manualQuery         = '';
    this.manualBanco         = '';
    this.manualTipo          = '';
    this.manualFechaInicio   = '';
    this.manualFechaFin      = '';
    this.releasePreview();
  }

  // ── Helpers de UI ──────────────────────────────────────────────────────────

  scoreBadgeClass(score: number): string {
    if (score >= 80) return 'score-high';
    if (score >= 50) return 'score-mid';
    return 'score-low';
  }

  confianzaClass(c: number): string {
    if (c >= 80) return 'conf-high';
    if (c >= 50) return 'conf-mid';
    return 'conf-low';
  }

  private releasePreview(): void {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
  }
}
