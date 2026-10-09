import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SocketService } from '../../../../core/services/socket.service';
import { NetpayCandidatoMovimiento } from '../../../../core/models/netpay-transaccion.model';
import {
  NetpayReporte, NetpayReporteFolio, NetpayReporteEstatus,
  NetpayReporteCargaItem, NetpayReporteUploadResumen, NetpayReporteUploadResultado,
  NetpayUltimaCarga,
} from '../../../../core/models/netpay-reporte.model';

// Recuperación tras reload a mitad de una carga (pedido explícito del usuario, 2026-10-08) —
// mismo criterio que admin-ops-panel.component.ts#erpSyncJobId con sessionStorage.
const UPLOAD_JOB_ID_STORAGE_KEY = 'netpayUploadJobId';

// Agrupación por archivo cargado (pedido explícito del usuario, 2026-10-08): dentro de una
// MISMA carga, todos los depósitos comparten el mismo nombreArchivoOriginal exacto (el
// backend lo garantiza, ver netpay-reporte.service.js#cargarReporte/_procesarDeposito, que
// hilan el mismo string a todo el lote) — agrupar por ese campo identifica correctamente
// "los depósitos de este archivo", sin necesitar un concepto de lote aparte en el modelo.
// Reportes viejos sin este campo (anteriores a netpay-reporte-global) caen en SIN_ARCHIVO_CLAVE
// — nunca se descartan, solo quedan agrupados aparte para no romper el histórico.
const SIN_ARCHIVO_CLAVE = '__sin_archivo__';

export interface NetpayReporteGrupo {
  clave: string;
  nombreArchivo: string | null;
  reportes: NetpayReporte[];
  montoTotal: number;
}

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
export class NetpayReportePanelComponent implements OnChanges, OnDestroy {
  @Input() visible = false;

  // "Volver a Netpay" (2026-10-07, pedido explícito del usuario): cuando se vuelve desde
  // Bancos tras "Ver movimiento bancario" (ver navegarAMovimiento más abajo), banks.component
  // reabre este panel directo en el detalle de ESTE reporte en vez de la lista — evita tener
  // que volver a buscarlo. Se consume en ngOnChanges, igual que `visible`.
  @Input() reporteIdAbrir: string | null = null;

  // Feature "navegación al movimiento bancario" (2026-10-01, pedido explícito del
  // usuario): este panel vive ANIDADO dentro de netpay-panel -> banks.component (no es una
  // ruta aparte), así que no sirve un router.navigate acá — sube el dato por @Output y
  // quien sabe cómo abrir Bancos (banks.component.ts#openBank, deep-link ya existente,
  // mismo patrón que poliza-traspasos.component.ts#irABanco) lo hace. `reporteId` (2026-10-07)
  // es lo que banks.component necesita para ofrecer "Volver a Netpay" (ver reporteIdAbrir).
  @Output() verMovimiento = new EventEmitter<{ banco: string; movId: string; reporteId: string }>();

  view: 'lista' | 'detalle' | 'resultados' = 'lista';

  // ── Resultados (netpay-reporte-global: un archivo con N>1 depósitos) ────────────────────
  resultadosItems: NetpayReporteCargaItem[] | null = null;
  resultadosResumen: NetpayReporteUploadResumen | null = null;
  // Excel del lote completo (pedido explícito del usuario, 2026-10-07) — mismo patrón de
  // estado que exportando/exportError del detalle individual, abajo.
  exportandoLote = false;
  exportLoteError: string | null = null;
  // Distingue si el detalle actual se abrió desde esta vista efímera (drill-down de una
  // carga recién hecha) o desde la lista persistida — determina a dónde vuelve "Volver".
  // Público a propósito: el template lee este flag para decidir el texto
  // del botón "Volver" — el compilador de Angular (ng build) rechaza el
  // acceso desde la plantilla si el campo es private (NG1, no lo detecta
  // tsc --noEmit ni Karma, solo el build real).
  detalleDesdeResultados = false;

  // ── Lista ──────────────────────────────────────────────────────────────────
  reportes: NetpayReporte[] | null = null;
  loadingLista = false;
  listaError: string | null = null;
  filtroEstatus: NetpayReporteEstatus | '' = '';
  // "Mostrar ocultos" — expone reportes con eliminado:true (soft-delete), ocultos por
  // default (ver design.md "Report Soft-Delete").
  mostrarOcultos = false;
  // Filtro de fechas (pedido explícito del usuario, 2026-10-07) — bindeado a
  // <app-date-range-popover>, YYYY-MM-DD, filtra por fechaMovimiento server-side (ver
  // bank.service.ts#listarNetpayReportes). Para no tener que scrollear toda la lista
  // buscando un depósito de una fecha puntual.
  fechaDesde = '';
  fechaHasta = '';

  // Buscador por clave de rastreo o importe (pedido explícito del usuario, 2026-10-08) —
  // necesario una vez que la lista se agrupa por archivo: la clave de rastreo sola ya no
  // ubica un depósito puntual entre varios del mismo archivo. Debounced (mismo patrón que
  // banks.component.ts#_wireGlobalSearch) para no pegarle al backend en cada tecla.
  search = '';
  private _search$ = new Subject<string>();
  private _destroy$ = new Subject<void>();

  // ── Grupos (archivo cargado) ─────────────────────────────────────────────────
  // Colapsados por clave de grupo — todos arrancan expandidos (mismo look que la lista plana
  // de siempre); el usuario colapsa a mano los que no le interesan en esta sesión.
  gruposColapsados = new Set<string>();
  exportandoGrupo: Record<string, boolean> = {};
  exportGrupoError: Record<string, string> = {};

  // ── Carga (dropzone) ───────────────────────────────────────────────────────
  selectedFile: File | null = null;
  isDragging = false;
  uploading = false;
  uploadError: string | null = null;
  // Progreso de la SUBIDA del archivo en sí (pedido explícito del usuario, 2026-10-08) —
  // distinto del progreso de PROCESAMIENTO de abajo: esto es la transferencia de bytes al
  // servidor (HttpEventType.UploadProgress), antes de que exista siquiera un jobId. Con un
  // Excel grande puede tardar lo suyo y se quedaba sin ningún feedback visual.
  subiendoArchivo = false;
  subidaPct = 0;
  // Progreso EN BACKGROUND (pedido explícito del usuario, 2026-10-08) — ver incidente real:
  // un archivo de 33 depósitos/897 folios se cortó a los 5 minutos por el timeout de la ruta
  // de upload. uploadJobId null = no hay carga en curso (ni propia ni recuperada de otra
  // sesión); uploadProgreso solo existe mientras uploadJobId no es null.
  uploadJobId: string | null = null;
  uploadProgreso: { procesados: number; total: number; pct: number } | null = null;
  // Mensaje "último reporte cargado" (pedido explícito del usuario, 2026-10-08) — best-effort:
  // un fallo acá no debe bloquear ni ensuciar la pantalla de carga, solo no se muestra el aviso.
  ultimaCarga: NetpayUltimaCarga | null = null;

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
    private bankService:   BankService,
    public  auth:          AuthService,
    private socketService: SocketService,
  ) {
    this._search$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this._destroy$),
    ).subscribe(() => this.cargarLista());

    // Progreso de la carga EN BACKGROUND (pedido explícito del usuario, 2026-10-08) — mismo
    // patrón que admin-ops-panel.component.ts para Sync ERP-Kore: el jobId filtra el evento
    // (emitToUser llega a TODO lo que el usuario tenga abierto, no solo a esta pestaña/panel).
    this.socketService.netpayUploadProgress$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== this.uploadJobId) return;
      this.uploadProgreso = { procesados: ev.procesados, total: ev.total, pct: ev.pct };
    });

    this.socketService.netpayUploadDone$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== this.uploadJobId) return;
      this._finalizarUpload();
      this.cargarLista();
      this._cargarUltimaCarga();
      this._manejarResultadoUpload(ev.resultado);
    });

    this.socketService.netpayUploadError$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== this.uploadJobId) return;
      this.uploadError = ev.error;
      this._finalizarUpload();
    });

    // Recuperación tras un reload a mitad de una carga (fallback del socket, mismo criterio
    // que admin-ops-panel.component.ts#erpSyncJobId) — el job sigue corriendo del lado del
    // servidor sin importar qué pase acá, así que recargar la página nunca lo pierde.
    this._recuperarJobDeSessionStorage();
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }

  private _finalizarUpload(): void {
    this.uploading = false;
    this.subiendoArchivo = false;
    this.subidaPct = 0;
    this.uploadJobId = null;
    this.uploadProgreso = null;
    this.selectedFile = null;
    try { sessionStorage.removeItem(UPLOAD_JOB_ID_STORAGE_KEY); } catch { /* storage bloqueado (modo privado) — no crítico */ }
  }

  private _recuperarJobDeSessionStorage(): void {
    let jobId: string | null = null;
    try { jobId = sessionStorage.getItem(UPLOAD_JOB_ID_STORAGE_KEY); } catch { /* storage bloqueado — simplemente no hay nada que recuperar */ }
    if (!jobId) return;

    this.uploadJobId = jobId;
    this.uploading = true;
    this.bankService.obtenerEstadoJobCargaNetpay(jobId).subscribe({
      next: (estado) => {
        if (estado.status === 'running') {
          this.uploadProgreso = { procesados: estado.procesados, total: estado.total, pct: Math.round((estado.procesados / estado.total) * 100) };
          return; // sigue corriendo — el socket (ya suscrito arriba) va a avisar cuando termine
        }
        if (estado.status === 'done' && estado.resultado) {
          this._finalizarUpload();
          this.cargarLista();
          this._cargarUltimaCarga();
          this._manejarResultadoUpload(estado.resultado);
          return;
        }
        // 'error', o 'done' sin resultado (no debería pasar, pero no hay nada que mostrar).
        this.uploadError = estado.error ?? null;
        this._finalizarUpload();
      },
      // Job expirado (pasaron más de 2h) o ya no encontrado — no es un error real para el
      // usuario, solo no queda nada que recuperar.
      error: () => this._finalizarUpload(),
    });
  }

  // Bindeado a (ngModelChange) del input de búsqueda — nunca a (input) directo, para pasar
  // por el debounce de arriba.
  onBuscarChange(valor: string): void {
    this.search = valor;
    this._search$.next(valor);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this._reset();
      // 2026-10-07: "Volver a Netpay" — si venimos con un reporte puntual a reabrir, saltamos
      // directo a su detalle (mismo patrón que abrirDetalleDesdeResultado() para 'ya_cargado')
      // en vez de quedarnos en la lista recién reseteada.
      if (this.reporteIdAbrir) {
        this.view = 'detalle';
        this.reporteActivo = null;
        this._refrescarDetalle(this.reporteIdAbrir);
      }
    }
  }

  private _reset(): void {
    this.view = 'lista';
    this.reportes = null;
    this.listaError = null;
    this.filtroEstatus = '';
    this.mostrarOcultos = false;
    this.fechaDesde = '';
    this.fechaHasta = '';
    this.search = '';
    this.gruposColapsados = new Set<string>();
    this.exportandoGrupo = {};
    this.exportGrupoError = {};
    this.selectedFile = null;
    this.uploadError = null;
    this.reporteActivo = null;
    this.detalleError = null;
    this.resultadosItems = null;
    this.resultadosResumen = null;
    this.exportandoLote = false;
    this.exportLoteError = null;
    this.detalleDesdeResultados = false;
    this._resetDetalleUiState();
    this.cargarLista();
    this._cargarUltimaCarga();
  }

  // Best-effort: si falla, simplemente no se muestra el aviso (no es información crítica
  // para poder cargar un reporte nuevo).
  private _cargarUltimaCarga(): void {
    this.bankService.obtenerUltimaCargaNetpay().subscribe({
      next: (res) => { this.ultimaCarga = res.ultimaCarga; },
      error: () => { this.ultimaCarga = null; },
    });
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
    this.bankService.listarNetpayReportes(
      this.filtroEstatus || undefined, this.mostrarOcultos || undefined,
      this.fechaDesde || undefined, this.fechaHasta || undefined,
      this.search.trim() || undefined,
    ).subscribe({
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

  // Pedido explícito del usuario (2026-10-07): filtro de rango de fechas sobre la lista de
  // reportes, para no tener que scrollear buscando un depósito de una fecha puntual —
  // mismo patrón de uso de <app-date-range-popover> que netpay-panel.component.html.
  cambiarRangoFechas(rango: { fechaInicio: string; fechaFin: string }): void {
    this.fechaDesde = rango.fechaInicio;
    this.fechaHasta = rango.fechaFin;
    this.cargarLista();
  }

  // ── Agrupación por archivo cargado ──────────────────────────────────────────
  // `reportes` ya llega ordenado por fechaMovimiento desc (ver bank.service.ts) — el primer
  // grupo visto en ese orden queda primero acá también, sin necesitar un re-sort de grupos.
  get gruposReportes(): NetpayReporteGrupo[] {
    if (!this.reportes) return [];
    const porArchivo = new Map<string, NetpayReporteGrupo>();
    for (const r of this.reportes) {
      const clave = r.nombreArchivoOriginal ?? SIN_ARCHIVO_CLAVE;
      let grupo = porArchivo.get(clave);
      if (!grupo) {
        grupo = { clave, nombreArchivo: r.nombreArchivoOriginal, reportes: [], montoTotal: 0 };
        porArchivo.set(clave, grupo);
      }
      grupo.reportes.push(r);
      grupo.montoTotal += r.montoDepositoTotal;
    }
    return [...porArchivo.values()];
  }

  toggleGrupoColapsado(clave: string): void {
    if (this.gruposColapsados.has(clave)) this.gruposColapsados.delete(clave);
    else this.gruposColapsados.add(clave);
  }

  // ── Exportar Excel (todos) por grupo — SIEMPRE visible (pedido explícito del usuario,
  // 2026-10-08), a diferencia de la vista "resultados" (solo tras una carga recién hecha).
  // Reusa exactamente el mismo endpoint/mecanismo que exportarLote() (GET .../export-lote,
  // que ya consulta Kore SOLO para los folios sin koreCache antes de generar el Excel — ver
  // consultarFoliosPendientesDeLote en el backend, nunca repite una consulta ya cacheada) —
  // estado de carga/error PROPIO por grupo (no el exportandoLote/exportLoteError de
  // resultados), para que exportar un grupo no bloquee ni confunda el estado de otro.
  exportarGrupo(grupo: NetpayReporteGrupo): void {
    const ids = grupo.reportes.map(r => r._id);
    if (ids.length === 0 || this.exportandoGrupo[grupo.clave]) return;
    this.exportandoGrupo[grupo.clave] = true;
    delete this.exportGrupoError[grupo.clave];

    this.bankService.exportarNetpayReportesLote(ids).subscribe({
      next: (blob) => {
        this.exportandoGrupo[grupo.clave] = false;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpay-reportes-${grupo.nombreArchivo ?? 'sin-archivo'}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.exportandoGrupo[grupo.clave] = false;
        // exportarNetpayReportesLote pide responseType:'blob' — Angular entrega el cuerpo de
        // ERROR también como Blob en vez de JSON ya parseado (mismo patrón que exportarLote()).
        if (err?.error instanceof Blob) {
          err.error.text().then((text: string) => {
            let msg = 'Error al generar el Excel de este grupo';
            try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
            this.exportGrupoError[grupo.clave] = msg;
          });
          return;
        }
        this.exportGrupoError[grupo.clave] = err?.error?.error || err?.message || 'Error al generar el Excel de este grupo';
      },
    });
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

  // EN BACKGROUND (pedido explícito del usuario, 2026-10-08) — ver incidente real: un archivo
  // de 33 depósitos/897 folios se cortó a los 5 minutos por el timeout de la ruta de upload.
  // Esta llamada ahora solo ARRANCA el job (responde casi al instante, incluso con el parseo
  // de un Excel grande) — el progreso y el resultado final llegan por socket, ver el
  // constructor (netpayUploadProgress$/Done$/Error$).
  subir(): void {
    if (!this.selectedFile || this.uploading) return;
    this.uploading = true;
    this.uploadError = null;
    this.uploadProgreso = null;
    this.subiendoArchivo = true;
    this.subidaPct = 0;

    this.bankService.uploadNetpayReporte(this.selectedFile).subscribe({
      next: (event) => {
        // Progreso de la TRANSFERENCIA de bytes (pedido explícito del usuario, 2026-10-08) —
        // event.total puede venir ausente en algún caso raro del navegador; sin eso no hay
        // de dónde sacar un % real, se deja el spinner genérico para ese caso puntual.
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.subidaPct = Math.round((event.loaded / event.total) * 100);
          return;
        }
        if (event.type === HttpEventType.Response && event.body) {
          this.subiendoArchivo = false;
          const { jobId, total } = event.body;
          this.uploadJobId = jobId;
          this.uploadProgreso = { procesados: 0, total, pct: 0 };
          try { sessionStorage.setItem(UPLOAD_JOB_ID_STORAGE_KEY, jobId); } catch { /* storage bloqueado (modo privado) — no crítico, solo se pierde la recuperación tras reload */ }
        }
      },
      // Solo puede fallar acá la SUBIDA en sí o el PARSEO del archivo (Excel inválido/
      // corrupto) — eso sigue siendo síncrono e instantáneo; cualquier falla DESPUÉS de
      // arrancar el job llega por el evento de error del socket, no por acá.
      error: (err) => {
        this.uploading = false;
        this.subiendoArchivo = false;
        this.uploadError = err?.error?.error || 'Error al procesar el archivo';
      },
    });
  }

  // netpay-reporte-global: un archivo puede traer 1 o N depósitos (hoja "Resumen" con
  // varias filas, ver design.md "Data Flow"). Si trae exactamente 1 y se creó (caso legacy
  // de archivo por terminal), abre su detalle directo — SIN pasar por la lista de
  // resultados, para no romper la UX actual de un solo depósito. En cualquier otro caso
  // (N>1, o el único resultado no fue 'creado') muestra la lista de resultados.
  private _manejarResultadoUpload(resultado: NetpayReporteUploadResultado): void {
    const unico = resultado.reportes.length === 1 ? resultado.reportes[0] : null;
    if (unico && unico.estatusCarga === 'creado') {
      const reporte = resultado.reporte ?? unico.reporte;
      if (reporte) {
        this.abrirDetalle(reporte);
        return;
      }
    }
    this.resultadosItems = resultado.reportes;
    this.resultadosResumen = resultado.resumen;
    this.view = 'resultados';
  }

  // ── Detalle ────────────────────────────────────────────────────────────────
  // origen==='resultados' marca que este detalle se abrió por drill-down desde la vista de
  // resultados — determina a dónde regresa "Volver" (ver volverALista()).
  abrirDetalle(reporte: NetpayReporte, origen: 'lista' | 'resultados' = 'lista'): void {
    this.detalleDesdeResultados = origen === 'resultados';
    this._resetDetalleUiState();
    this.view = 'detalle';
    this.reporteActivo = reporte;
    this._refrescarDetalle(reporte._id);
  }

  // Click-handler de una fila de la vista de resultados. 'creado' ya trae el reporte
  // completo en memoria (el mismo upload lo devolvió); 'ya_cargado' solo trae reporteId (el
  // depósito ya existía de una carga previa) y hay que pedir el detalle completo al
  // backend; 'error' no tiene reporte que abrir (la fila no hace nada).
  abrirDetalleDesdeResultado(item: NetpayReporteCargaItem): void {
    if (item.estatusCarga === 'creado' && item.reporte) {
      this.abrirDetalle(item.reporte, 'resultados');
      return;
    }
    if (item.estatusCarga === 'ya_cargado' && item.reporteId) {
      this.detalleDesdeResultados = true;
      this._resetDetalleUiState();
      this.view = 'detalle';
      this.reporteActivo = null;
      this._refrescarDetalle(item.reporteId);
    }
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

  // Si el detalle actual se abrió por drill-down desde la vista de resultados (carga
  // recién hecha, efímera — no re-pedir la lista persistida), vuelve ahí en vez de a la
  // lista. En cualquier otro caso, comportamiento de siempre: vuelve a la lista y recarga.
  volverALista(): void {
    if (this.detalleDesdeResultados) {
      this.view = 'resultados';
      this.reporteActivo = null;
      this.detalleDesdeResultados = false;
      return;
    }
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

  // ── Ver movimiento bancario vinculado ────────────────────────────────────────
  // Banco hardcodeado a 'BBVA' a propósito — el matching de Netpay es BBVA-only por
  // diseño (ver netpay-reporte.service.js#_buscarCandidatosParaReporte), no hace falta
  // resolverlo dinámicamente desde el folio/movimiento.
  navegarAMovimiento(reporte: NetpayReporte | null | undefined): void {
    if (!reporte?.movementIdConfirmado) return;
    this.verMovimiento.emit({ banco: 'BBVA', movId: reporte.movementIdConfirmado, reporteId: reporte._id });
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

  // ── Exportar Excel del LOTE completo (vista "resultados") ────────────────────────────
  // Pedido explícito del usuario (2026-10-07): "excel general" con todos los depósitos del
  // archivo recién cargado. 'error' no tiene ningún _id que exportar (ese depósito nunca se
  // persistió) — se excluye de la lista.
  idsExportablesDelLote(): string[] {
    if (!this.resultadosItems) return [];
    return this.resultadosItems
      .map(item => (item.estatusCarga === 'creado' ? item.reporte?._id : item.reporteId))
      .filter((id): id is string => !!id);
  }

  exportarLote(): void {
    const ids = this.idsExportablesDelLote();
    if (ids.length === 0 || this.exportandoLote) return;
    this.exportandoLote = true;
    this.exportLoteError = null;

    this.bankService.exportarNetpayReportesLote(ids).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpay-reportes-lote-${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportandoLote = false;
      },
      error: (err) => {
        this.exportandoLote = false;
        // exportarNetpayReportesLote pide responseType:'blob' (ver ApiService#downloadBlob)
        // — Angular también entrega el cuerpo de ERROR como Blob en vez de JSON ya parseado.
        if (err?.error instanceof Blob) {
          err.error.text().then((text: string) => {
            let msg = 'Error al generar el Excel del lote';
            try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
            this.exportLoteError = msg;
          });
          return;
        }
        this.exportLoteError = err?.error?.error || err?.message || 'Error al generar el Excel del lote';
      },
    });
  }
}
