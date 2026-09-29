import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NetpayCandidatoMovimiento } from '../../../../core/models/netpay-transaccion.model';
import {
  NetpayReporte, NetpayReporteFolio, NetpayReporteEstatus,
} from '../../../../core/models/netpay-reporte.model';

// netpay-reporte-panel — Netpay: carga manual del reporte como fuente de verdad.
// Consolidación 2026-09-29 (pedido explícito del usuario — "dejar todo en una sola vista"):
// dejó de ser un sidebar propio montado en banks.component y ahora se anida como 3ra pestaña
// ("Reportes") dentro de netpay-panel.component.html — sin reescribir la lógica interna, solo
// se sacó el wrapper .np-sidebar/head propios (netpay-panel ya provee esos). @Input() visible
// sigue significando "estoy activo, resetéate" (ngOnChanges), ahora atado a
// `visible && tab==='reportes'` del lado del padre.
//
// netpay-matching-v2 (design.md "Frontend"): el reporte ya llega decidido automáticamente
// (evaluarReporte(), disparado por cargarReporte()/Reevaluar) — el flujo de "elegir un
// candidato y confirmar" (v1) fue eliminado. Un reporte 'discrepancia' se cierra con
// Resolver (justificación obligatoria, 0-1 movimiento — el modelo solo soporta 1, a
// diferencia del bucket que soporta 0-2) o Rechazar. Soft-delete ("Ocultar"/"Restaurar")
// nunca cambia estatus/links.
@Component({
  standalone: false,
  selector: 'app-netpay-reporte-panel',
  templateUrl: './netpay-reporte-panel.component.html',
  styleUrls: ['./netpay-reporte-panel.component.css'],
})
export class NetpayReportePanelComponent implements OnChanges {
  @Input() visible = false;

  view: 'lista' | 'detalle' = 'lista';

  // ── Lista ──────────────────────────────────────────────────────────────────
  reportes: NetpayReporte[] | null = null;
  loadingLista = false;
  listaError: string | null = null;
  filtroEstatus: NetpayReporteEstatus | '' = '';
  // "Mostrar ocultos" — expone reportes con eliminado:true (soft-delete), ocultos por
  // default (ver design.md "Report Soft-Delete").
  mostrarOcultos = false;

  // ── Carga (dropzone) ───────────────────────────────────────────────────────
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  uploadError: string | null = null;

  // ── Detalle ────────────────────────────────────────────────────────────────
  reporteActivo: NetpayReporte | null = null;
  detalleLoading = false;
  detalleError: string | null = null;

  // "Reevaluar" — re-dispara evaluarReporte() del lado del backend para un reporte ya
  // persistido (ej. tras corregir manualmente algo fuera de este flujo).
  reevaluando = false;
  reevaluarError: string | null = null;

  // ── Resolver — cierra un reporte 'discrepancia' con justificación humana obligatoria,
  // opcionalmente vinculando UN movimiento (cardinalidad real de NetpayReporte, distinta
  // de la del bucket). NUNCA produce 'confirmado_automatico'/'resuelto_por_reporte'.
  resolviendo = false;
  resolverJustificacion = '';
  resolverCandidatos: NetpayCandidatoMovimiento[] = [];
  resolverCandidatosLoading = false;
  resolverCandidatosError: string | null = null;
  resolverSeleccion = new Set<string>();
  resolverEnviando = false;
  resolverError: string | null = null;

  // ── Rechazar — permitido desde cualquier estado activo, nunca vincula nada.
  rechazando = false;
  rechazarMotivo = '';
  rechazarEnviando = false;
  rechazarError: string | null = null;

  // ── Ocultar (soft-delete, 2 pasos) / Restaurar ──────────────────────────────
  pideOcultar = false;
  motivoOcultar = '';
  ocultando = false;
  ocultarError: string | null = null;
  restaurando = false;
  restaurarError: string | null = null;

  exportando = false;
  exportError: string | null = null;

  // ── Revertir — reusa PATCH .../erp-ids {action:'remove'} (mismo wrapper que el resto de
  // la app, bankService.removeErpId), que dispara netpay-reporte-revert.service.js server-
  // side. Guard v2: la presencia de movementIdConfirmado (no un estatus fijo — 'corroborado'
  // nunca lo puebla, ahí no hay nada que revertir).
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
    this.mostrarOcultos = false;
    this.selectedFile = null;
    this.uploadError = null;
    this.reporteActivo = null;
    this.detalleError = null;
    this._resetDetalleUiState();
    this.cargarLista();
  }

  private _resetDetalleUiState(): void {
    this.reevaluando = false;
    this.reevaluarError = null;
    this._cerrarResolverEstado();
    this._cerrarRechazarEstado();
    this.pideOcultar = false;
    this.motivoOcultar = '';
    this.ocultando = false;
    this.ocultarError = null;
    this.restaurando = false;
    this.restaurarError = null;
    this.exportError = null;
    this.consultandoFolio = null;
    this.folioKoreError = {};
    this.folioExpandido = null;
    this.pideConfirmarRevertir = false;
    this.revirtiendo = false;
    this.revertirError = null;
  }

  // ── Lista ──────────────────────────────────────────────────────────────────
  cargarLista(): void {
    this.loadingLista = true;
    this.listaError = null;
    this.bankService.listarNetpayReportes(this.filtroEstatus || undefined, this.mostrarOcultos || undefined).subscribe({
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

  toggleMostrarOcultos(): void {
    this.mostrarOcultos = !this.mostrarOcultos;
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
    this._refrescarDetalle(reporte._id);
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

  // ── Reevaluar ────────────────────────────────────────────────────────────────
  reevaluar(): void {
    if (!this.reporteActivo || this.reevaluando) return;
    this.reevaluando = true;
    this.reevaluarError = null;
    this.bankService.reevaluarNetpayReporte(this.reporteActivo._id).subscribe({
      next: (res) => {
        this.reporteActivo = res.reporte;
        this.reevaluando = false;
      },
      error: (err) => {
        this.reevaluando = false;
        this.reevaluarError = err?.error?.error || 'Error al reevaluar este reporte';
      },
    });
  }

  // ── Resolver ─────────────────────────────────────────────────────────────────
  abrirResolver(): void {
    if (!this.reporteActivo) return;
    this.resolviendo = true;
    this.resolverJustificacion = '';
    this.resolverSeleccion = new Set<string>();
    this.resolverError = null;
    this._cargarResolverCandidatos(this.reporteActivo._id);
  }

  private _cargarResolverCandidatos(id: string): void {
    this.resolverCandidatosLoading = true;
    this.resolverCandidatosError = null;
    this.bankService.buscarCandidatosNetpayReporte(id, 'ventana').subscribe({
      next: (res) => {
        this.resolverCandidatos = res.candidatos;
        this.resolverCandidatosLoading = false;
      },
      error: (err) => {
        this.resolverCandidatosError = err?.error?.error || 'Error al buscar candidatos para este reporte';
        this.resolverCandidatosLoading = false;
      },
    });
  }

  cerrarResolver(): void {
    this._cerrarResolverEstado();
  }

  private _cerrarResolverEstado(): void {
    this.resolviendo = false;
    this.resolverJustificacion = '';
    this.resolverCandidatos = [];
    this.resolverCandidatosLoading = false;
    this.resolverCandidatosError = null;
    this.resolverSeleccion = new Set<string>();
    this.resolverEnviando = false;
    this.resolverError = null;
  }

  puedeResolver(): boolean {
    return this.resolverJustificacion.trim().length > 0 && !this.resolverEnviando;
  }

  // Cardinalidad de reporte: a lo sumo 1 movimiento (NetpayReporte.movementIdConfirmado
  // no es un array, a diferencia de NetpayMatch.movementIdsConfirmados[]) — elegir uno
  // nuevo reemplaza al anterior en vez de acumular.
  toggleSeleccionCandidato(movementId: string): void {
    if (this.resolverSeleccion.has(movementId)) {
      this.resolverSeleccion.delete(movementId);
      return;
    }
    this.resolverSeleccion = new Set([movementId]);
  }

  confirmarResolver(): void {
    if (!this.reporteActivo || !this.puedeResolver()) return;
    this.resolverEnviando = true;
    this.resolverError = null;
    this.bankService.resolverNetpayReporte(this.reporteActivo._id, {
      justificacion: this.resolverJustificacion.trim(),
      movementIds: [...this.resolverSeleccion],
    }).subscribe({
      next: (res) => {
        this.reporteActivo = res.reporte;
        this._cerrarResolverEstado();
      },
      error: (err) => {
        this.resolverEnviando = false;
        this.resolverError = err?.error?.error || 'Error al resolver este reporte';
      },
    });
  }

  // ── Rechazar ─────────────────────────────────────────────────────────────────
  abrirRechazar(): void {
    this.rechazando = true;
    this.rechazarMotivo = '';
    this.rechazarError = null;
  }

  cerrarRechazar(): void {
    this._cerrarRechazarEstado();
  }

  private _cerrarRechazarEstado(): void {
    this.rechazando = false;
    this.rechazarMotivo = '';
    this.rechazarEnviando = false;
    this.rechazarError = null;
  }

  confirmarRechazar(): void {
    if (!this.reporteActivo || this.rechazarEnviando) return;
    this.rechazarEnviando = true;
    this.rechazarError = null;
    this.bankService.rechazarNetpayReporte(this.reporteActivo._id, this.rechazarMotivo.trim() || undefined).subscribe({
      next: (res) => {
        this.reporteActivo = res.reporte;
        this._cerrarRechazarEstado();
      },
      error: (err) => {
        this.rechazarEnviando = false;
        this.rechazarError = err?.error?.error || 'Error al rechazar este reporte';
      },
    });
  }

  // ── Ocultar (soft-delete, 2 pasos) / Restaurar ──────────────────────────────
  togglePedirOcultar(): void {
    this.pideOcultar = !this.pideOcultar;
    if (!this.pideOcultar) this.motivoOcultar = '';
  }

  confirmarOcultar(): void {
    if (!this.reporteActivo || this.ocultando) return;
    this.ocultando = true;
    this.ocultarError = null;
    this.bankService.eliminarNetpayReporte(this.reporteActivo._id, this.motivoOcultar.trim() || undefined).subscribe({
      next: (res) => {
        this.reporteActivo = res.reporte;
        this.pideOcultar = false;
        this.motivoOcultar = '';
        this.ocultando = false;
      },
      error: (err) => {
        this.ocultando = false;
        this.ocultarError = err?.error?.error || 'Error al ocultar este reporte';
      },
    });
  }

  restaurar(): void {
    if (!this.reporteActivo || this.restaurando) return;
    this.restaurando = true;
    this.restaurarError = null;
    this.bankService.restaurarNetpayReporte(this.reporteActivo._id).subscribe({
      next: (res) => {
        this.reporteActivo = res.reporte;
        this.restaurando = false;
      },
      error: (err) => {
        this.restaurando = false;
        this.restaurarError = err?.error?.error || 'Error al restaurar este reporte';
      },
    });
  }

  // ── Consulta puntual a Kore por folio ────────────────────────────────────────
  // Bug real 2026-09-25: un depósito real trajo folios con `referencia: null` — `_id`
  // (subdocumento de Mongo, siempre presente) es la clave estable de identidad de UI.
  folioKey(f: NetpayReporteFolio): string {
    return f._id ?? '';
  }

  toggleFolio(folio: NetpayReporteFolio): void {
    const key = this.folioKey(folio);
    if (!key) return;
    this.folioExpandido = this.folioExpandido === key ? null : key;
  }

  consultarKore(folio: NetpayReporteFolio): void {
    const key = this.folioKey(folio);
    if (!this.reporteActivo || !folio.referencia || !key || this.consultandoFolio) return;
    this.consultandoFolio = key;
    delete this.folioKoreError[key];

    this.bankService.consultarFolioNetpayKore(this.reporteActivo._id, folio.referencia).subscribe({
      next: (res) => {
        this.consultandoFolio = null;
        folio.koreCache = { consultadoEn: res.consultadoEn, cuenta: res.cuenta };
        this.folioExpandido = key;
      },
      error: (err) => {
        this.consultandoFolio = null;
        this.folioKoreError[key] = err?.error?.error || 'Error al consultar Kore para este folio';
      },
    });
  }

  // ── Revertir — solo tiene sentido si hay un movementIdConfirmado real (poblado en
  // resuelto_por_reporte/vinculo:'erp-link' o resuelto_manual con movimiento vinculado;
  // 'corroborado' nunca lo puebla, ahí no hay link que desvincular) ────────────────────
  togglePedirConfirmarRevertir(): void {
    this.pideConfirmarRevertir = !this.pideConfirmarRevertir;
  }

  revertir(): void {
    if (!this.reporteActivo || this.revirtiendo) return;
    if (!this.reporteActivo.movementIdConfirmado) return;
    this.revirtiendo = true;
    this.revertirError = null;
    const id = this.reporteActivo._id;
    const erpId = `NETPAYRPT-${this.reporteActivo.claveRastreo}`;

    this.bankService.removeErpId(this.reporteActivo.movementIdConfirmado, erpId).subscribe({
      next: () => {
        this.revirtiendo = false;
        this.pideConfirmarRevertir = false;
        // El hook de netpay-reporte-revert.service.js ya volvió el reporte a
        // discrepancia/revertido server-side — se refresca el detalle para traer el
        // estatus real.
        this._refrescarDetalle(id);
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
