import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NetpayCandidatoMovimiento } from '../../../../core/models/netpay-transaccion.model';
import {
  NetpayReporte, NetpayReporteFolio, NetpayReporteEstatus, NetpayReporteUploadResultado,
} from '../../../../core/models/netpay-reporte.model';

// netpay-reporte-panel — Netpay: carga manual del reporte como fuente de verdad
// (Implementación 1). Componente HERMANO de netpay-panel (no una 3ra pestaña ahí): es un
// flujo distinto (carga de archivo vs. consulta en vivo), montado igual en
// banks.component.html/.ts. Coexiste con netpay-panel — NO lo reemplaza.
//
// Flujo de confirmación 1:1 (a diferencia de netpay-panel, que puede requerir 1 o 2
// BankMovement por split): el reporte YA trae el monto exacto depositado por Netpay, así que
// basta UN solo candidato. Los candidatos viajan en la respuesta de la carga (cargarReporte)
// PARA el reporte recién subido; para uno 'pendiente' reabierto en una sesión posterior (sin
// esos candidatos ya en memoria), se recalculan EN VIVO con GET .../candidatos
// (buscarCandidatosNetpayReporte) — misma búsqueda exacta que corrió cargarReporte, ver
// netpay-reporte.service.js#_buscarCandidatosParaReporte. En ambos casos, el backend
// re-valida elegibilidad y monto server-side al confirmar — nunca confía en lo que manda el
// cliente.
@Component({
  standalone: false,
  selector: 'app-netpay-reporte-panel',
  templateUrl: './netpay-reporte-panel.component.html',
  styleUrls: ['./netpay-reporte-panel.component.css'],
})
export class NetpayReportePanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();

  view: 'lista' | 'detalle' = 'lista';

  // ── Lista ──────────────────────────────────────────────────────────────────
  reportes: NetpayReporte[] | null = null;
  loadingLista = false;
  listaError: string | null = null;
  filtroEstatus: NetpayReporteEstatus | '' = '';

  // ── Carga (dropzone) ───────────────────────────────────────────────────────
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  uploadError: string | null = null;
  // Resultado de la carga recién hecha — solo se usa para saber si reporteActivo ES el
  // reporte recién subido (evita un GET .../candidatos redundante, ya los trae este mismo
  // resultado). Se limpia al abrir el detalle de cualquier OTRO reporte.
  uploadResultado: NetpayReporteUploadResultado | null = null;

  // ── Detalle ────────────────────────────────────────────────────────────────
  reporteActivo: NetpayReporte | null = null;
  detalleLoading = false;
  detalleError: string | null = null;

  // Candidatos del reporte ACTIVO — de la carga recién hecha (uploadResultado) si aplica, o
  // recalculados en vivo vía GET .../candidatos para un 'pendiente' reabierto (ver
  // comentario de la clase). Misma UX de radio buttons en ambos casos.
  candidatosActivo: NetpayCandidatoMovimiento[] = [];
  candidatosLoading = false;
  candidatosError: string | null = null;

  seleccionCandidato: number | null = null;
  confirmando = false;
  confirmError: string | null = null;

  pideMotivoDescarte = false;
  motivoDescarte = '';
  descartando = false;
  descartarError: string | null = null;

  exportando = false;
  exportError: string | null = null;

  // ── Revertir (Fix 2b) ────────────────────────────────────────────────────────
  // NO hay lógica nueva de backend acá — reusa PATCH .../erp-ids {action:'remove'} (mismo
  // wrapper que el resto de la app, bankService.removeErpId), que ya dispara el hook de
  // netpay-reporte-revert.service.js y vuelve el reporte a 'pendiente' server-side. Este
  // componente solo pide confirmación y refresca su propio estado tras el éxito.
  pideConfirmarRevertir = false;
  revirtiendo = false;
  revertirError: string | null = null;

  consultandoFolio: string | null = null;
  folioKoreError: Record<string, string> = {};
  folioExpandido: string | null = null;

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._reset();
  }

  private _reset(): void {
    this.view = 'lista';
    this.reportes = null;
    this.listaError = null;
    this.filtroEstatus = '';
    this.selectedFile = null;
    this.uploadError = null;
    this.uploadResultado = null;
    this.reporteActivo = null;
    this.detalleError = null;
    this._resetDetalleUiState();
    this.cargarLista();
  }

  private _resetDetalleUiState(): void {
    this.candidatosActivo = [];
    this.candidatosLoading = false;
    this.candidatosError = null;
    this.seleccionCandidato = null;
    this.confirmError = null;
    this.pideMotivoDescarte = false;
    this.motivoDescarte = '';
    this.descartarError = null;
    this.exportError = null;
    this.consultandoFolio = null;
    this.folioKoreError = {};
    this.folioExpandido = null;
    this.pideConfirmarRevertir = false;
    this.revirtiendo = false;
    this.revertirError = null;
  }

  cerrar(): void {
    this.closed.emit();
  }

  // ── Lista ──────────────────────────────────────────────────────────────────
  cargarLista(): void {
    this.loadingLista = true;
    this.listaError = null;
    this.bankService.listarNetpayReportes(this.filtroEstatus || undefined).subscribe({
      next: (res) => { this.reportes = res.reportes; this.loadingLista = false; },
      error: (err) => {
        this.listaError = err?.error?.error || 'Error al cargar los reportes Netpay';
        this.loadingLista = false;
      },
    });
  }

  cambiarFiltro(estatus: NetpayReporteEstatus | ''): void {
    this.filtroEstatus = estatus;
    this.cargarLista();
  }

  // ── Dropzone (mismo patrón que import-modal.component.ts) ───────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this._setFile(file);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) this._setFile(file);
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); this.isDragging = true; }
  onDragLeave(): void { this.isDragging = false; }

  // Fix 1 (2026-09-25, pedido explícito del usuario tras probarlo en el navegador): el botón
  // separado "Cargar reporte" era un paso extra redundante — soltar/elegir el archivo ya es
  // una acción suficientemente explícita. Dispara subir() automáticamente al final, en vez de
  // esperar un click aparte (el botón se quitó del template; `uploading` sigue existiendo
  // como spinner/feedback visual, ver template).
  private _setFile(file: File | null): void {
    this.selectedFile = file;
    this.uploadError = null;
    if (file) this.subir();
  }

  subir(): void {
    if (!this.selectedFile || this.uploading) return;
    this.uploading = true;
    this.uploadError = null;

    this.bankService.uploadNetpayReporte(this.selectedFile).subscribe({
      next: (resultado) => {
        this.uploading = false;
        this.selectedFile = null;
        this.uploadResultado = resultado;
        this.cargarLista();
        this.abrirDetalle(resultado.reporte);
      },
      error: (err) => {
        this.uploading = false;
        this.uploadError = err?.error?.error || 'Error al procesar el archivo';
      },
    });
  }

  // ── Detalle ────────────────────────────────────────────────────────────────
  abrirDetalle(reporte: NetpayReporte): void {
    this._resetDetalleUiState();
    this.view = 'detalle';
    this.reporteActivo = reporte;

    if (this.uploadResultado?.reporte._id === reporte._id) {
      // Ya los trae la respuesta de la carga recién hecha — no hace falta pegarle de nuevo
      // al backend.
      this.candidatosActivo = this.uploadResultado.candidatos;
    } else {
      this.uploadResultado = null;
      if (reporte.estatus === 'pendiente') this._cargarCandidatos(reporte._id);
    }

    this._refrescarDetalle(reporte._id);
  }

  private _cargarCandidatos(id: string): void {
    this.candidatosLoading = true;
    this.candidatosError = null;
    this.bankService.buscarCandidatosNetpayReporte(id).subscribe({
      next: (res) => {
        this.candidatosActivo = res.candidatos;
        this.candidatosLoading = false;
      },
      error: (err) => {
        this.candidatosError = err?.error?.error || 'Error al buscar candidatos para este reporte';
        this.candidatosLoading = false;
      },
    });
  }

  // Público (a diferencia de _cargarCandidatos) para que el botón "Reintentar" del template
  // pueda llamarlo — mismo criterio que el resto de los .np-retry de este panel.
  reintentarCandidatos(): void {
    if (!this.reporteActivo) return;
    this._cargarCandidatos(this.reporteActivo._id);
  }

  private _refrescarDetalle(id: string): void {
    this.detalleLoading = true;
    this.detalleError = null;
    this.bankService.obtenerNetpayReporteDetalle(id).subscribe({
      next: (res) => {
        this.reporteActivo = res.reporte;
        this.detalleLoading = false;
      },
      error: (err) => {
        this.detalleError = err?.error?.error || 'Error al cargar el detalle del reporte';
        this.detalleLoading = false;
      },
    });
  }

  volverALista(): void {
    this.view = 'lista';
    this.reporteActivo = null;
    this.cargarLista();
  }

  seleccionar(index: number): void {
    this.seleccionCandidato = index;
  }

  confirmarCandidato(movementId: string): void {
    if (!this.reporteActivo || this.confirmando) return;
    this._confirmar(this.reporteActivo._id, movementId);
  }

  confirmarSeleccionActiva(): void {
    if (this.seleccionCandidato === null || !this.candidatosActivo[this.seleccionCandidato]) return;
    this.confirmarCandidato(this.candidatosActivo[this.seleccionCandidato]._id);
  }

  private _confirmar(id: string, movementId: string): void {
    this.confirmando = true;
    this.confirmError = null;
    this.bankService.confirmarNetpayReporte(id, movementId).subscribe({
      next: (res) => {
        this.confirmando = false;
        this.reporteActivo = res.reporte;
        this.uploadResultado = null;
        this.candidatosActivo = [];
        this.seleccionCandidato = null;
      },
      error: (err) => {
        this.confirmando = false;
        this.confirmError = err?.error?.error || 'Error al confirmar el reporte';
      },
    });
  }

  // ── Descarte (2 pasos, nunca window.confirm() nativo) ───────────────────────
  togglePedirMotivoDescarte(): void {
    this.pideMotivoDescarte = !this.pideMotivoDescarte;
  }

  descartar(): void {
    if (!this.reporteActivo || this.descartando) return;
    this.descartando = true;
    this.descartarError = null;
    this.bankService.descartarNetpayReporte(this.reporteActivo._id, this.motivoDescarte).subscribe({
      next: (res) => {
        this.descartando = false;
        this.reporteActivo = res.reporte;
        this.pideMotivoDescarte = false;
        this.motivoDescarte = '';
      },
      error: (err) => {
        this.descartando = false;
        this.descartarError = err?.error?.error || 'Error al descartar el reporte';
      },
    });
  }

  // ── Consulta puntual a Kore por folio ────────────────────────────────────────
  toggleFolio(referencia: string | null): void {
    if (!referencia) return;
    this.folioExpandido = this.folioExpandido === referencia ? null : referencia;
  }

  consultarKore(folio: NetpayReporteFolio): void {
    if (!this.reporteActivo || !folio.referencia || this.consultandoFolio) return;
    const referencia = folio.referencia;
    this.consultandoFolio = referencia;
    delete this.folioKoreError[referencia];

    this.bankService.consultarFolioNetpayKore(this.reporteActivo._id, referencia).subscribe({
      next: (res) => {
        this.consultandoFolio = null;
        folio.koreCache = { consultadoEn: res.consultadoEn, cuenta: res.cuenta };
        this.folioExpandido = referencia;
      },
      error: (err) => {
        this.consultandoFolio = null;
        this.folioKoreError[referencia] = err?.error?.error || 'Error al consultar Kore para este folio';
      },
    });
  }

  // ── Revertir (Fix 2b) — solo visible para 'confirmado', mismo mecanismo que desvincular
  // cualquier otro erpId sintético (ver PATCH .../erp-ids, banks:erp:unlink) ────────────────
  togglePedirConfirmarRevertir(): void {
    this.pideConfirmarRevertir = !this.pideConfirmarRevertir;
  }

  revertir(): void {
    if (!this.reporteActivo || this.revirtiendo) return;
    if (this.reporteActivo.estatus !== 'confirmado' || !this.reporteActivo.movementIdConfirmado) return;
    this.revirtiendo = true;
    this.revertirError = null;
    const id = this.reporteActivo._id;
    const erpId = `NETPAYRPT-${this.reporteActivo.claveRastreo}`;

    this.bankService.removeErpId(this.reporteActivo.movementIdConfirmado, erpId).subscribe({
      next: () => {
        this.revirtiendo = false;
        this.pideConfirmarRevertir = false;
        // El hook de netpay-reporte-revert.service.js ya volvió el reporte a 'pendiente'
        // server-side — se refresca el detalle (trae el estatus real) y se recalculan
        // candidatos EN VIVO (mismo camino que reabrir un 'pendiente', ver abrirDetalle()).
        this._refrescarDetalle(id);
        this._cargarCandidatos(id);
      },
      error: (err) => {
        this.revirtiendo = false;
        this.revertirError = err?.error?.error || 'Error al revertir la confirmación de este reporte';
      },
    });
  }

  // ── Exportar Excel ────────────────────────────────────────────────────────
  exportar(): void {
    if (!this.reporteActivo || this.exportando) return;
    this.exportando = true;
    this.exportError = null;

    this.bankService.exportarNetpayReporte(this.reporteActivo._id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpay-reporte-${this.reporteActivo!.claveRastreo}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportando = false;
      },
      error: (err) => {
        this.exportando = false;
        // exportarNetpayReporte pide responseType:'blob' (ver ApiService#downloadBlob) —
        // Angular también entrega el cuerpo de ERROR como Blob en vez de JSON ya parseado.
        // Mismo patrón que report-panel.component.ts#_ejecutarExport.
        if (err?.error instanceof Blob) {
          err.error.text().then((text: string) => {
            let msg = 'Error al generar el Excel del reporte';
            try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
            this.exportError = msg;
          });
          return;
        }
        this.exportError = err?.error?.error || err?.message || 'Error al generar el Excel del reporte';
      },
    });
  }
}
