import { Component, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyImportConcentrado, LoyaltyImportClasificacion, LoyaltyImportAplicarResult,
  LoyaltyImportCorreccionClasificacion, LoyaltyImportClasificacionResumen, LoyaltyKoreMatchResult,
} from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';

/** Nombre de cada una de las 4 listas truncadas (≤100 items) de LoyaltyKoreMatchResult que se
 *  pueden expandir en el modal reusable — ver koreMatchModalLista()/abrirKoreMatchLista(). */
type KoreMatchListaKey = 'sinMatchEnKore' | 'sinMatchEnLealtad' | 'monederosDuplicadosEnKore' | 'erroresActualizacion';

/** Progreso del job de match contra Kore — más simple que ProgresoAplicarJob (sin
 *  loteActual/totalLotes: el backend no particiona esta corrida en lotes/transacciones, ver
 *  loyalty-kore-match.service.js). */
interface ProgresoKoreMatchJob {
  procesados: number;
  total: number;
  pct: number;
}

/** Progreso de un job en background (lotes de 200 filas) — mismo shape para la migración
 *  principal y para la re-aplicación de correcciones (ambas comparten la misma máquina de
 *  batching en el backend, ver _iniciarJobDesdeFilasClasificadas). */
interface ProgresoAplicarJob {
  procesados: number;
  total: number;
  loteActual: number;
  totalLotes: number;
  pct: number;
}

/**
 * Migración de clientes legados ("Club Tuberos") — sube clientes.csv y/o
 * puntos.pdf, los cruza por Tarjeta y muestra un concentrado de revisión.
 * SOLO lectura: no hay botón de "aplicar", la carga a producción queda para
 * un paso posterior (ver loyalty-import.service.js en el backend). Gateado
 * por loyalty:importar (admin-only, rbac.js).
 *
 * Dropzones calcadas del patrón inline de ImportModalComponent (banks) — este
 * código base no tiene todavía un componente de dropzone reutilizable.
 */
@Component({
  standalone: false,
  selector: 'app-importar-clientes',
  templateUrl: './importar-clientes.component.html',
  styleUrls: ['./importar-clientes.component.css'],
})
export class ImportarClientesComponent implements OnDestroy {
  clientesFile: File | null = null;
  puntosFile: File | null = null;

  isDraggingClientes = false;
  isDraggingPuntos = false;

  generando = false;
  error: string | null = null;
  resultado: LoyaltyImportConcentrado | null = null;

  // ── Paso 2: clasificar contra la DB real (dry-run) ───────────────────────
  clasificando = false;
  errorClasificar: string | null = null;
  clasificacion: LoyaltyImportClasificacion | null = null;

  // ── Paso 3: aplicar de verdad (escribe en producción, EN BACKGROUND) ─────
  // Desde 2026-10-19 aplicarImportacion() ya no devuelve el resultado directo — arranca un
  // job (migrar ~9,633 filas tarda ~22min, partido en lotes de 200) y responde de inmediato
  // con jobId/total/totalLotes. El progreso/resultado final llega por socket, ver el
  // constructor (mismo patrón que netpay-reporte-panel.component.ts#uploadJobId).
  aplicando = false;
  aplicandoJobId: string | null = null;
  aplicarProgreso: ProgresoAplicarJob | null = null;
  errorAplicar: string | null = null;
  aplicarResultado: LoyaltyImportAplicarResult | null = null;

  // ── Flujo automático: generar → clasificar → aplicar sin pasos manuales ──
  // Pedido explícito del usuario (2026-10-19): no depender de ir presionando cada botón en
  // cada corrida — una sola acción encadena las tres etapas y arranca el job de aplicar SIN
  // el diálogo de confirmación manual. Es seguro re-correr las veces que haga falta: las filas
  // ya migradas se omiten solas (omitidasYaMigradas) y las bloqueantes quedan excluidas sin
  // abortar nada (excluidasBloqueantes) — la corrida automática en sí ya es la confirmación.
  importandoAutomatico = false;

  exportandoBloqueantes = false;

  // ── Rediseño visual: wizard de 3 pasos (Subir · Clasificar · Confirmar) ──────────────────
  // Puramente de presentación — no reemplaza ni duplica la lógica de arriba, solo refleja en
  // qué punto del flujo está el usuario. Se avanza en los mismos puntos donde generar()/
  // clasificar()/_iniciarAplicar() ya tienen éxito (incluyendo la cadena automática de
  // importarAutomatico(), que reusa esos mismos métodos privados).
  pasoActivo: 1 | 2 | 3 = 1;

  /** Pasos ya completados que el usuario reabrió a mano con "Editar" (ver reabrirPaso()) —
   *  solo afecta visibilidad, nunca reinicia ningún estado ni lógica. */
  pasosReabiertos: Partial<Record<1 | 2 | 3, boolean>> = {};

  // ── Correcciones: re-subida del Excel de filas bloqueantes corregidas a mano ─────────────
  // Flujo independiente del par clientes.csv/puntos.pdf — su propio dropzone, su propio
  // dry-run/clasificar y su propio apply-job (mismos eventos de socket genéricos por jobId,
  // ver _wireJobEvents() reusado dos veces abajo).
  correccionesFile: File | null = null;
  isDraggingCorrecciones = false;

  clasificandoCorrecciones = false;
  errorClasificarCorrecciones: string | null = null;
  clasificacionCorrecciones: LoyaltyImportCorreccionClasificacion | null = null;

  aplicandoCorrecciones = false;
  aplicandoCorreccionesJobId: string | null = null;
  aplicarCorreccionesProgreso: ProgresoAplicarJob | null = null;
  errorAplicarCorrecciones: string | null = null;
  aplicarCorreccionesResultado: LoyaltyImportAplicarResult | null = null;

  // ── Match contra Kore (cruce tarjetaLegada↔monedero, 2026-10-22) ─────────────────────────
  // Pedido explícito del dueño de producto: vive en esta misma vista (no una pantalla aparte)
  // porque a futuro se van a re-subir CSVs actualizados desde acá y el match con Kore debe ser
  // parte natural de ese flujo. Por eso es independiente del wizard de 3 pasos de arriba — se
  // puede disparar en cualquier momento, no solo justo después de aplicar un CSV nuevo (es
  // idempotente, se puede re-correr cuantas veces haga falta). Mismo patrón de job en background
  // + progreso por socket que aplicarImportacion()/aplicarCorrecciones() arriba, solo que sin
  // archivo de por medio (POST sin body) y sin loteActual/totalLotes (ver ProgresoKoreMatchJob).
  koreMatching = false;
  koreMatchJobId: string | null = null;
  koreMatchProgreso: ProgresoKoreMatchJob | null = null;
  errorKoreMatch: string | null = null;
  koreMatchResultado: LoyaltyKoreMatchResult | null = null;

  // ── Resiliencia de la descarga del Excel (hallazgo 2026-10-23) ───────────────────────────
  // Antes la descarga automática no tenía manejo de error ni forma de reintentar — si fallaba
  // (bloqueador del navegador, falla del import dinámico de exceljs), el único entregable visible
  // de la corrida se perdía sin aviso y sin botón para volver a pedirlo. `errorDescargaExcel`
  // muestra el aviso; `reintentarDescargaExcelKoreMatch()`/`recuperarUltimoMatchKore()` dan dos
  // vías de recuperación: con el resultado todavía en memoria, o tras un reload de página (usando
  // el jobId persistido en localStorage + el fallback GET /kore-match-job/:jobId que el backend ya
  // exponía pero nadie consumía).
  errorDescargaExcel: string | null = null;
  recuperandoUltimoMatchKore = false;
  private static readonly ULTIMO_KORE_MATCH_JOB_ID_KEY = 'lealtad-ultimo-kore-match-job-id';

  /** Qué lista truncada (≤100 items) está expandida en el modal reusable (app-modal) — null =
   *  cerrado. Preferido sobre 4 banderas booleanas sueltas: un solo modal a la vez. */
  koreMatchModalLista: KoreMatchListaKey | null = null;

  private _destroy$ = new Subject<void>();

  constructor(
    private loyalty: LoyaltyService,
    private socketService: SocketService,
  ) {
    this._wireJobEvents(
      () => this.aplicandoJobId,
      {
        onProgress: (p) => { this.aplicarProgreso = p; },
        onDone: (resultado) => { this.aplicarResultado = resultado; this._finalizarAplicar(); },
        onError: (errorMsg, progresoParcial) => {
          this.aplicarProgreso = progresoParcial;
          this.errorAplicar = errorMsg;
          this.aplicando = false;
          this.aplicandoJobId = null;
          this.importandoAutomatico = false;
        },
      },
    );

    this._wireJobEvents(
      () => this.aplicandoCorreccionesJobId,
      {
        onProgress: (p) => { this.aplicarCorreccionesProgreso = p; },
        onDone: (resultado) => { this.aplicarCorreccionesResultado = resultado; this._finalizarAplicarCorrecciones(); },
        onError: (errorMsg, progresoParcial) => {
          this.aplicarCorreccionesProgreso = progresoParcial;
          this.errorAplicarCorrecciones = errorMsg;
          this.aplicandoCorrecciones = false;
          this.aplicandoCorreccionesJobId = null;
        },
      },
    );

    // Match contra Kore — mismo criterio de filtrado por jobId que _wireJobEvents arriba, pero
    // inline (no reusa el helper): el shape de progreso difiere (sin loteActual/totalLotes).
    this.socketService.lealtadKoreMatchProgress$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== this.koreMatchJobId) return;
      this.koreMatchProgreso = { procesados: ev.procesados, total: ev.total, pct: ev.pct };
    });

    this.socketService.lealtadKoreMatchDone$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== this.koreMatchJobId) return;
      const { jobId, ...resultado } = ev;
      this.koreMatchResultado = resultado;
      this.koreMatching = false;
      this.koreMatchProgreso = null;
      this._guardarUltimoKoreMatchJobId(jobId);
      // Pedido explícito del usuario (2026-10-23): el Excel de detalle (monedero legado + Kore de
      // TODOS los matcheados) se genera automáticamente al terminar el job, sin un paso/botón
      // aparte — ver _descargarExcelKoreMatch(). `koreMatchJobId` se conserva (antes se limpiaba
      // acá) para que reintentarDescargaExcelKoreMatch() pueda usarlo como fallback de recuperación.
      this._descargarExcelKoreMatch(resultado);
    });

    this.socketService.lealtadKoreMatchError$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== this.koreMatchJobId) return;
      this.errorKoreMatch = ev.error;
      this.koreMatching = false;
      this.koreMatchJobId = null;
      this.koreMatchProgreso = null;
    });
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }

  /**
   * Suscribe las tres señales de progreso de un job de aplicar (lealtadApplyProgress$/Done$/
   * Error$) filtrando por `getJobId()` — mismo criterio que netpay-reporte-panel.component.ts.
   * Reusado tal cual para el job principal y para el job de correcciones: AMBOS comparten
   * exactamente los mismos eventos de socket, genéricos por `jobId` (ver backend
   * _iniciarJobDesdeFilasClasificadas), así que no hace falta duplicar esta lógica.
   */
  private _wireJobEvents(
    getJobId: () => string | null,
    handlers: {
      onProgress: (p: ProgresoAplicarJob) => void;
      onDone: (resultado: LoyaltyImportAplicarResult) => void;
      onError: (errorMsg: string, progresoParcial: ProgresoAplicarJob) => void;
    },
  ): void {
    // jobId filtra el evento (emitToUser llega a TODO lo que el usuario tenga abierto, no
    // solo a esta pantalla) — mismo criterio que netpay-reporte-panel.component.ts.
    this.socketService.lealtadApplyProgress$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== getJobId()) return;
      handlers.onProgress({
        procesados: ev.procesados, total: ev.total,
        loteActual: ev.loteActual, totalLotes: ev.totalLotes, pct: ev.pct,
      });
    });

    this.socketService.lealtadApplyDone$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== getJobId()) return;
      const { jobId, ...resultado } = ev;
      handlers.onDone(resultado);
    });

    this.socketService.lealtadApplyError$.pipe(takeUntil(this._destroy$)).subscribe((ev) => {
      if (ev.jobId !== getJobId()) return;
      // Partial progress ya está comprometido en DB (cada lote es su propia transacción) —
      // se deja visible el avance alcanzado; re-aplicar es idempotente (filas ya migradas
      // se omiten), no hace falta limpiar el progreso acá.
      handlers.onError(ev.error, {
        procesados: ev.procesados, total: ev.total,
        loteActual: ev.loteActual, totalLotes: ev.totalLotes,
        pct: ev.total ? Math.round((ev.procesados / ev.total) * 100) : 0,
      });
    });
  }

  private _finalizarAplicar(): void {
    this.aplicando = false;
    this.aplicandoJobId = null;
    this.aplicarProgreso = null;
    this.importandoAutomatico = false;
  }

  private _finalizarAplicarCorrecciones(): void {
    this.aplicandoCorrecciones = false;
    this.aplicandoCorreccionesJobId = null;
    this.aplicarCorreccionesProgreso = null;
  }

  // ── Clientes.csv ──────────────────────────────────────────────────────────
  onClientesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.setClientesFile(file);
  }

  onClientesDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingClientes = false;
    const file = event.dataTransfer?.files[0];
    if (file && /\.csv$/i.test(file.name)) this.setClientesFile(file);
  }

  onClientesDragOver(event: DragEvent): void { event.preventDefault(); this.isDraggingClientes = true; }
  onClientesDragLeave(): void { this.isDraggingClientes = false; }

  private setClientesFile(file: File | null): void {
    this.clientesFile = file;
    this.resetResultados();
  }

  // ── Puntos.pdf ────────────────────────────────────────────────────────────
  onPuntosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.setPuntosFile(file);
  }

  onPuntosDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingPuntos = false;
    const file = event.dataTransfer?.files[0];
    // Reemplaza a puntos.pdf (2026-10-29, pedido explícito del usuario) — ahora es
    // reporteClientesPorVendedor.xlsx. El nombre de la propiedad/campo se deja sin tocar
    // (puntosFile/'puntos') para no ensanchar el diff, solo cambia qué extensión acepta.
    if (file && /\.xlsx$/i.test(file.name)) this.setPuntosFile(file);
  }

  onPuntosDragOver(event: DragEvent): void { event.preventDefault(); this.isDraggingPuntos = true; }
  onPuntosDragLeave(): void { this.isDraggingPuntos = false; }

  private setPuntosFile(file: File | null): void {
    this.puntosFile = file;
    this.resetResultados();
  }

  /** Cambiar cualquier archivo invalida todo lo ya calculado — evita aplicar
   *  contra datos de un archivo distinto al que se clasificó/vio. */
  private resetResultados(): void {
    this.error = null;
    this.resultado = null;
    this.errorClasificar = null;
    this.clasificacion = null;
    this.errorAplicar = null;
    this.aplicarResultado = null;
    this.aplicarProgreso = null;
    this.pasoActivo = 1;
    this.pasosReabiertos = {};
  }

  // ── Paso 1: generar concentrado ───────────────────────────────────────────
  puedeGenerar(): boolean {
    return (!!this.clientesFile || !!this.puntosFile) && !this.generando && !this.importandoAutomatico;
  }

  generar(): void {
    if (!this.puedeGenerar()) return;
    this.generando = true;
    this.error = null;
    this.resultado = null;
    this.errorClasificar = null;
    this.clasificacion = null;
    this.errorAplicar = null;
    this.aplicarResultado = null;
    this.aplicarProgreso = null;
    this.pasoActivo = 1;
    this.pasosReabiertos = {};

    this.loyalty.generarConcentrado(this.clientesFile, this.puntosFile).subscribe({
      next: (res) => {
        this.resultado = res;
        this.generando = false;
        this.pasoActivo = 2;
      },
      error: (err) => {
        this.error = err?.error?.error || 'No se pudo generar el concentrado.';
        this.generando = false;
      },
    });
  }

  // ── Flujo automático: generar + clasificar + aplicar en una sola acción ──
  puedeImportarAutomatico(): boolean {
    return (!!this.clientesFile || !!this.puntosFile)
      && !this.importandoAutomatico && !this.generando && !this.clasificando && !this.aplicando;
  }

  importarAutomatico(): void {
    if (!this.puedeImportarAutomatico()) return;
    this.importandoAutomatico = true;
    this.generando = true;
    this.error = null;
    this.resultado = null;
    this.errorClasificar = null;
    this.clasificacion = null;
    this.errorAplicar = null;
    this.aplicarResultado = null;
    this.aplicarProgreso = null;
    this.pasoActivo = 1;
    this.pasosReabiertos = {};

    this.loyalty.generarConcentrado(this.clientesFile, this.puntosFile).subscribe({
      next: (res) => {
        this.resultado = res;
        this.generando = false;
        this.pasoActivo = 2;
        this._clasificarAutomatico();
      },
      error: (err) => {
        this.error = err?.error?.error || 'No se pudo generar el concentrado.';
        this.generando = false;
        this.importandoAutomatico = false;
      },
    });
  }

  private _clasificarAutomatico(): void {
    this.clasificando = true;
    this.loyalty.clasificarImportacion(this.clientesFile, this.puntosFile).subscribe({
      next: (res) => {
        this.clasificacion = res;
        this.clasificando = false;
        this.pasoActivo = 3;
        // Sin window.confirm() a propósito: la corrida automática ya ES la confirmación —
        // arranca el job directo, sin esperar un segundo clic.
        this._iniciarAplicar();
      },
      error: (err) => {
        this.clasificacion = err?.error?.errors ?? null;
        this.errorClasificar = err?.error?.error || 'No se pudo clasificar la importación.';
        this.clasificando = false;
        this.importandoAutomatico = false;
      },
    });
  }

  // ── Paso 2: clasificar (dry-run, sin escrituras) ──────────────────────────
  puedeClasificar(): boolean {
    return (!!this.clientesFile || !!this.puntosFile)
      && !this.clasificando && !this.aplicando && !this.importandoAutomatico;
  }

  clasificar(): void {
    if (!this.puedeClasificar()) return;
    this.clasificando = true;
    this.errorClasificar = null;
    this.clasificacion = null;
    this.errorAplicar = null;
    this.aplicarResultado = null;
    this.aplicarProgreso = null;

    this.loyalty.clasificarImportacion(this.clientesFile, this.puntosFile).subscribe({
      next: (res) => {
        this.clasificacion = res;
        this.clasificando = false;
        this.pasoActivo = 3;
      },
      error: (err) => {
        // El backend devuelve la clasificación completa en body.errors incluso
        // cuando el endpoint falla por otra razón (ninguna esperada acá, este
        // es el dry-run) — se muestra igual por si acaso trae algo útil.
        this.clasificacion = err?.error?.errors ?? null;
        this.errorClasificar = err?.error?.error || 'No se pudo clasificar la importación.';
        this.clasificando = false;
      },
    });
  }

  // 'telefonoDuplicadoBloqueante' (2026-10-23) ya NO entra acá — mismo criterio que esBloqueante()
  // de abajo: dejó de ser una fila "excluida que hay que corregir en el Excel", ahora se resuelve
  // en vivo desde "Clientes pendientes". Sumarla acá infla este número por encima de lo que
  // realmente contiene el Excel descargable, mintiendo en el aviso de "N filas se excluirán".
  private _totalBloqueantesDe(r: LoyaltyImportClasificacionResumen | undefined | null): number {
    if (!r) return 0;
    return r.duplicadoBloqueante + r.invalidoBloqueante + r.conflictoBloqueante;
  }

  totalBloqueantes(): number {
    return this._totalBloqueantesDe(this.clasificacion?.clasificacionResumen);
  }

  // ── Paso 3: aplicar de verdad (escribe tarjetas/movimientos/pendientes) ──
  // Decisión de negocio 2026-10-19: ya NO se exige 0 bloqueantes — quedan excluidas
  // automáticamente de la corrida (ver excluidasBloqueantes en el resultado) y se corrigen
  // aparte en la sección "Correcciones".
  puedeAplicar(): boolean {
    return !!this.clasificacion && !this.aplicando && !this.importandoAutomatico;
  }

  // Reemplaza window.confirm() nativo por <app-confirm-modal> (shared/components) — mismo
  // componente que ya usan poliza-list/poliza-traspasos/report-panel, pedido explícito del
  // usuario por estética. Dos flags separados (acá y confirmarAplicarCorrecciones más abajo) en
  // vez de un solo modal genérico: los dos textos/acciones son distintos y no vale la pena la
  // complejidad de un estado compartido para solo dos call sites.
  mostrarConfirmarAplicar = false;

  confirmarAplicar(): void {
    if (!this.puedeAplicar()) return;
    this.mostrarConfirmarAplicar = true;
  }

  aplicarConfirmado(): void {
    this.mostrarConfirmarAplicar = false;
    this._iniciarAplicar();
  }

  /** Arranca el job de aplicar EN BACKGROUND — el progreso/resultado final llegan por socket
   *  (ver constructor: lealtadApplyProgress$/Done$/Error$, filtrados por aplicandoJobId).
   *  Separado de `confirmarAplicar()` para que `_clasificarAutomatico()` lo reuse SIN el
   *  diálogo de confirmación manual. */
  private _iniciarAplicar(): void {
    this.aplicando = true;
    this.aplicandoJobId = null;
    this.errorAplicar = null;
    this.aplicarResultado = null;
    this.aplicarProgreso = null;

    this.loyalty.aplicarImportacion(this.clientesFile, this.puntosFile).subscribe({
      next: (res) => {
        this.aplicandoJobId = res.jobId;
        this.aplicarProgreso = { procesados: 0, total: res.total, loteActual: 0, totalLotes: res.totalLotes, pct: 0 };
      },
      error: (err) => {
        this.errorAplicar = err?.error?.error || 'No se pudo aplicar la importación.';
        if (err?.error?.errors) this.clasificacion = err.error.errors;
        this.aplicando = false;
        this.importandoAutomatico = false;
      },
    });
  }

  // ── Descarga del dataset (telefono,nip,mensaje) — solo cliente, sin tocar backend ──
  descargarDataset(): void {
    const creadas = this.aplicarResultado?.creadas ?? [];
    if (!creadas.length) return;

    const escapar = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lineas = [
      'telefono,nip,mensaje',
      ...creadas.map((c) => [c.telefono, c.nip, c.mensaje].map(escapar).join(',')),
    ];
    const blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lealtad-nips-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Descarga de las filas bloqueantes a Excel — solo cliente, sin tocar backend ───────────
  // El admin corrige a mano (Tarjeta/Celular/Telefono/Categoria/Saldo, o borra filas que no
  // deben migrarse) y vuelve a subir el archivo en la sección "Correcciones" de abajo.
  async descargarBloqueantes(): Promise<void> {
    const filas = this.filasBloqueantes();
    if (!filas.length || this.exportandoBloqueantes) return;

    this.exportandoBloqueantes = true;
    try {
      const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Bloqueantes');

      ws.columns = [
        { header: 'Tarjeta', key: 'tarjeta', width: 14 },
        { header: 'Nombre', key: 'nombre', width: 32 },
        { header: 'Celular', key: 'celular', width: 14 },
        { header: 'Telefono', key: 'telefono', width: 14 },
        { header: 'Categoria', key: 'categoria', width: 16 },
        { header: 'Saldo', key: 'saldo', width: 12 },
        { header: 'Motivo', key: 'motivo', width: 48 },
      ];
      ws.getRow(1).font = { bold: true };

      filas.forEach((fila) => {
        // Decisión de negocio 2026-10-19: el saldo de una fila 'duplicado_bloqueante' es
        // INHERENTEMENTE AMBIGUO — construirConcentrado le asignó el MISMO saldo de puntos.pdf a
        // cada fila de clientes.csv que comparte la Tarjeta legada, sin forma de saber a cuál de
        // las 2+ personas distintas le corresponde de verdad. Nunca se presenta como un número
        // confiable: se resalta en rojo y el Motivo avisa explícitamente, para forzar al admin a
        // decidir/corregir el saldo real de cada persona antes de volver a subir el archivo.
        const esDuplicado = fila.categoria === 'duplicado_bloqueante';
        const motivo = esDuplicado
          ? `${this.etiquetaCategoria(fila.categoria)} (⚠ verificar — compartido con otra fila duplicada)`
          : this.etiquetaCategoria(fila.categoria);

        const row = ws.addRow({
          tarjeta: fila.tarjetaRawClientes ?? '',
          nombre: fila.nombre,
          celular: fila.celular,
          telefono: fila.telefono,
          categoria: fila.categoriaOriginal,
          saldo: fila.saldo,
          motivo,
        });

        if (esDuplicado) {
          row.getCell('saldo').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lealtad-bloqueantes-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      this.exportandoBloqueantes = false;
    }
  }

  // ── Descarga de las filas descartadas automáticamente por duplicidad de teléfono ──────────
  // Pedido explícito del usuario (2026-10-29): dentro de un grupo de 2+ tarjetas con el mismo
  // teléfono, cuando una tiene puntos y el resto no, las de saldo 0 se descartan solas (ya no
  // van a "Clientes pendientes") — esto da visibilidad/auditoría de qué se descartó y por qué.
  // Mismo patrón 100% client-side con exceljs que descargarBloqueantes()/_descargarExcelKoreMatch().
  exportandoDescartadosPorDuplicidad = false;

  // Recibe las filas explícitamente (en vez de leer this.aplicarResultado a ciegas) porque el
  // mismo botón/método se reusa tanto en el resultado del import principal (paso 3) como en el
  // de "Correcciones" más abajo — ambos comparten el mismo shape (LoyaltyImportAplicarResult).
  async descargarDescartadosPorDuplicidad(
    filas: NonNullable<LoyaltyImportAplicarResult['descartadosPorDuplicidad']>,
  ): Promise<void> {
    if (!filas.length || this.exportandoDescartadosPorDuplicidad) return;

    this.exportandoDescartadosPorDuplicidad = true;
    try {
      const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Descartados por duplicidad');

      ws.columns = [
        { header: 'Nombre', key: 'nombre', width: 32 },
        { header: 'Teléfono', key: 'telefono', width: 14 },
        { header: 'Tarjeta legada', key: 'tarjetaLegada', width: 16 },
        { header: 'Saldo descartado', key: 'saldo', width: 16 },
        { header: 'Teléfono en conflicto', key: 'telefonoConflicto', width: 18 },
      ];
      ws.getRow(1).font = { bold: true };

      filas.forEach((fila) => {
        ws.addRow({
          nombre: fila.nombre,
          telefono: fila.telefono,
          tarjetaLegada: fila.tarjetaLegada ?? '',
          saldo: fila.saldo,
          telefonoConflicto: fila.telefonoConflicto ?? '',
        });
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lealtad-descartados-duplicidad-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      this.exportandoDescartadosPorDuplicidad = false;
    }
  }

  // ── Excel de detalle del match con Kore — automático al terminar el job, sin paso aparte ──
  // Pedido explícito del usuario (2026-10-23): monedero legado (tarjetaLegada) + monedero Kore +
  // nombre + código Kore de TODOS los matcheados (matcheadosDetalle nunca viene truncado, a
  // diferencia de las 4 listas de error). Mismo patrón 100% frontend que descargarBloqueantes().
  //
  // FIX 2026-10-23 (hallazgo de legibilidad/resiliencia): antes no tenía try/catch — si fallaba
  // (bloqueador de descargas del navegador, falla del import dinámico de exceljs, etc.), la
  // promesa quedaba sin manejar y el único entregable de la corrida se perdía sin ningún aviso.
  // Ahora el error queda visible en `errorDescargaExcel` y es re-disparable (ver
  // reintentarDescargaExcelKoreMatch()).
  //
  // 2da pestaña "Sin match en Kore" (pedido explícito 2026-10-23): tarjetas de Lealtad con
  // tarjetaLegada que no encontraron monedero en Kore, para que el equipo las resuelva a mano
  // (buscar/crear el monedero correspondiente en Kore). Usa `sinMatchEnKoreDetalle`, que a
  // diferencia de `sinMatchEnKore` nunca viene truncado — mismo criterio que `matcheadosDetalle`.
  private async _descargarExcelKoreMatch(resultado: LoyaltyKoreMatchResult): Promise<void> {
    const matcheadosDetalle = resultado?.matcheadosDetalle ?? [];
    const sinMatchDetalle = resultado?.sinMatchEnKoreDetalle ?? [];
    if (!matcheadosDetalle.length && !sinMatchDetalle.length) return;

    this.errorDescargaExcel = null;
    try {
      const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
      const wb = new ExcelJS.Workbook();

      const wsMatch = wb.addWorksheet('Match Kore');
      wsMatch.columns = [
        { header: 'Nombre', key: 'nombre', width: 32 },
        { header: 'Teléfono', key: 'telefono', width: 14 },
        { header: 'Monedero legado', key: 'tarjetaLegada', width: 18 },
        { header: 'Monedero Kore', key: 'koreMonedero', width: 18 },
        { header: 'Código Kore', key: 'koreClienteId', width: 24 },
      ];
      wsMatch.getRow(1).font = { bold: true };
      matcheadosDetalle.forEach((item) => {
        wsMatch.addRow({
          nombre: item.nombre,
          telefono: item.telefono,
          tarjetaLegada: item.tarjetaLegada,
          koreMonedero: item.koreMonedero,
          koreClienteId: item.koreClienteId,
        });
      });

      const wsSinMatch = wb.addWorksheet('Sin match en Kore');
      wsSinMatch.columns = [
        { header: 'Nombre', key: 'nombre', width: 32 },
        { header: 'Teléfono', key: 'telefono', width: 14 },
        { header: 'Monedero legado', key: 'tarjetaLegada', width: 18 },
      ];
      wsSinMatch.getRow(1).font = { bold: true };
      sinMatchDetalle.forEach((item) => {
        wsSinMatch.addRow({
          nombre: item.nombre,
          telefono: item.telefono,
          tarjetaLegada: item.tarjetaLegada,
        });
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lealtad-match-kore-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.errorDescargaExcel = 'No se pudo generar el Excel de detalle. Podés reintentar sin volver a correr el match con Kore.';
      // eslint-disable-next-line no-console -- mismo criterio que el resto del componente: no hay
      // Sentry/ErrorHandler en el frontend (confirmado en la revisión), así que la consola es el
      // único rastro para diagnosticar un fallo real de generación/descarga.
      console.error('[ImportarClientes] Falló la generación del Excel de match con Kore:', err);
    }
  }

  /** Reintenta la descarga del Excel sin volver a correr el match completo contra Kore (hallazgo
   *  2026-10-23). Primero usa el resultado todavía en memoria (caso común: falló la descarga, el
   *  usuario no recargó la página); si no hay nada en memoria, delega en
   *  recuperarUltimoMatchKore() para traerlo de vuelta vía el fallback GET del backend. */
  reintentarDescargaExcelKoreMatch(): void {
    if (this.koreMatchResultado) {
      this._descargarExcelKoreMatch(this.koreMatchResultado);
      return;
    }
    this.recuperarUltimoMatchKore();
  }

  puedeReintentarDescargaExcel(): boolean {
    return !!this.koreMatchResultado || (!this.recuperandoUltimoMatchKore && !!this._ultimoKoreMatchJobId());
  }

  /** Recupera el resultado del último match con Kore tras un reload de página, vía el fallback
   *  GET /kore-match-job/:jobId que el backend ya exponía (mismo criterio que
   *  GET /aplicar-job/:jobId) pero nadie consumía desde acá. El jobId se persiste en localStorage
   *  (best-effort, puede fallar en modo privado) porque `koreMatchJobId` solo vive en memoria y se
   *  pierde con el reload. Ventana de recuperación limitada al TTL del job en el backend (2h) o
   *  hasta el próximo reinicio del servidor — fuera de eso, se avisa que ya no es recuperable. */
  recuperarUltimoMatchKore(): void {
    const jobId = this._ultimoKoreMatchJobId();
    if (!jobId) return;

    this.recuperandoUltimoMatchKore = true;
    this.errorDescargaExcel = null;

    this.loyalty.obtenerEstadoMatchKoreJob(jobId).subscribe({
      next: (estado) => {
        this.recuperandoUltimoMatchKore = false;
        if (estado.status === 'done' && estado.resultado) {
          this.koreMatchResultado = estado.resultado;
          this._descargarExcelKoreMatch(estado.resultado);
        } else {
          this.errorDescargaExcel = 'El último match con Kore no terminó con éxito — no hay Excel que recuperar.';
        }
      },
      error: (err) => {
        this.recuperandoUltimoMatchKore = false;
        this._limpiarUltimoKoreMatchJobId();
        this.errorDescargaExcel = err?.status === 404
          ? 'Ya pasó demasiado tiempo desde ese match con Kore — hay que volver a correrlo para generar el Excel.'
          : 'No se pudo recuperar el último resultado del match con Kore.';
      },
    });
  }

  private _guardarUltimoKoreMatchJobId(jobId: string): void {
    try {
      localStorage.setItem(ImportarClientesComponent.ULTIMO_KORE_MATCH_JOB_ID_KEY, jobId);
    } catch {
      /* best-effort: localStorage puede fallar en modo privado — no es crítico */
    }
  }

  private _limpiarUltimoKoreMatchJobId(): void {
    try {
      localStorage.removeItem(ImportarClientesComponent.ULTIMO_KORE_MATCH_JOB_ID_KEY);
    } catch {
      /* best-effort: localStorage puede fallar en modo privado — no es crítico */
    }
  }

  private _ultimoKoreMatchJobId(): string | null {
    try {
      return localStorage.getItem(ImportarClientesComponent.ULTIMO_KORE_MATCH_JOB_ID_KEY);
    } catch {
      return null;
    }
  }

  // ── Correcciones: re-subida del Excel de bloqueantes ya corregido a mano ──────────────────
  onCorreccionesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.setCorreccionesFile(file);
  }

  onCorreccionesDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingCorrecciones = false;
    const file = event.dataTransfer?.files[0];
    if (file && /\.xlsx$/i.test(file.name)) this.setCorreccionesFile(file);
  }

  onCorreccionesDragOver(event: DragEvent): void { event.preventDefault(); this.isDraggingCorrecciones = true; }
  onCorreccionesDragLeave(): void { this.isDraggingCorrecciones = false; }

  private setCorreccionesFile(file: File | null): void {
    this.correccionesFile = file;
    this.errorClasificarCorrecciones = null;
    this.clasificacionCorrecciones = null;
    this.errorAplicarCorrecciones = null;
    this.aplicarCorreccionesResultado = null;
    this.aplicarCorreccionesProgreso = null;
  }

  puedeClasificarCorrecciones(): boolean {
    return !!this.correccionesFile && !this.clasificandoCorrecciones && !this.aplicandoCorrecciones;
  }

  clasificarCorrecciones(): void {
    if (!this.puedeClasificarCorrecciones() || !this.correccionesFile) return;
    this.clasificandoCorrecciones = true;
    this.errorClasificarCorrecciones = null;
    this.clasificacionCorrecciones = null;
    this.errorAplicarCorrecciones = null;
    this.aplicarCorreccionesResultado = null;
    this.aplicarCorreccionesProgreso = null;

    this.loyalty.clasificarCorrecciones(this.correccionesFile).subscribe({
      next: (res) => {
        this.clasificacionCorrecciones = res;
        this.clasificandoCorrecciones = false;
      },
      error: (err) => {
        this.clasificacionCorrecciones = err?.error?.errors ?? null;
        this.errorClasificarCorrecciones = err?.error?.error || 'No se pudo clasificar las correcciones.';
        this.clasificandoCorrecciones = false;
      },
    });
  }

  totalBloqueantesCorrecciones(): number {
    return this._totalBloqueantesDe(this.clasificacionCorrecciones?.clasificacionResumen);
  }

  puedeAplicarCorrecciones(): boolean {
    return !!this.clasificacionCorrecciones && !this.aplicandoCorrecciones;
  }

  mostrarConfirmarAplicarCorrecciones = false;

  confirmarAplicarCorrecciones(): void {
    if (!this.puedeAplicarCorrecciones() || !this.correccionesFile) return;
    this.mostrarConfirmarAplicarCorrecciones = true;
  }

  aplicarCorreccionesConfirmado(): void {
    this.mostrarConfirmarAplicarCorrecciones = false;
    // Re-chequeo defensivo: el guard real ya corrió en confirmarAplicarCorrecciones() antes de
    // mostrar el modal, pero TypeScript no propaga ese narrowing a través de otro método —
    // sin esto correccionesFile sigue tipado File | null acá abajo.
    if (!this.correccionesFile) return;
    this.aplicandoCorrecciones = true;
    this.aplicandoCorreccionesJobId = null;
    this.errorAplicarCorrecciones = null;
    this.aplicarCorreccionesResultado = null;
    this.aplicarCorreccionesProgreso = null;

    // Misma máquina de job en background que confirmarAplicar() — el progreso/resultado final
    // llegan por los mismos eventos de socket (ver _wireJobEvents en el constructor).
    this.loyalty.aplicarCorrecciones(this.correccionesFile).subscribe({
      next: (res) => {
        this.aplicandoCorreccionesJobId = res.jobId;
        this.aplicarCorreccionesProgreso = { procesados: 0, total: res.total, loteActual: 0, totalLotes: res.totalLotes, pct: 0 };
      },
      error: (err) => {
        this.errorAplicarCorrecciones = err?.error?.error || 'No se pudo aplicar las correcciones.';
        if (err?.error?.errors) this.clasificacionCorrecciones = err.error.errors;
        this.aplicandoCorrecciones = false;
      },
    });
  }

  // ── Presentación de badges ────────────────────────────────────────────────
  readonly advertenciaLabels: Record<string, string> = {
    sin_contacto: 'Falta actualizar datos de contacto',
    tarjeta_duplicada_en_clientes: 'Tarjeta duplicada',
    posible_registro_prueba: 'Posible registro de prueba',
    tarjeta_sin_match_en_puntos: 'Sin match en puntos',
  };

  readonly infoLabels: Record<string, string> = {
    sin_registro_de_saldo: 'Sin registro de saldo',
    nivel_asignado_por_default: 'Nivel asignado por default (Bronce)',
    nombre_provisional: 'Nombre provisional (sin Nombre/Apellidos en el CSV) — editar después',
  };

  etiquetaAdvertencia(clave: string): string {
    return this.advertenciaLabels[clave] ?? clave;
  }

  etiquetaInfo(clave: string): string {
    return this.infoLabels[clave] ?? clave;
  }

  /** trackBy para las tablas de miles de filas — evita que Angular destruya/recree
   *  cada fila en cada detección de cambios (índice + tarjeta: la tarjeta sola puede
   *  repetirse o venir vacía en los casos de duplicado/huérfano). */
  trackByTarjeta(index: number, fila: { tarjetaNormalizada: string }): string {
    return `${index}-${fila.tarjetaNormalizada}`;
  }

  readonly categoriaLabels: Record<string, string> = {
    ok: 'Lista para crear',
    pendiente_sin_telefono: 'Pendiente (sin teléfono)',
    ya_migrada: 'Ya migrada (se omite)',
    duplicado_bloqueante: 'Bloqueante: tarjeta duplicada',
    invalido_bloqueante: 'Bloqueante: teléfono inválido',
    conflicto_bloqueante: 'Bloqueante: conflicto con tarjeta existente',
    telefono_duplicado_bloqueante: 'Bloqueante: mismo teléfono en 2+ registros distintos',
    // 2026-10-29, pedido explícito del usuario: dentro de un grupo de 'telefono_duplicado_bloqueante'
    // con un ganador claro (saldo > 0), las perdedoras (saldo 0) caen acá — nunca llegan a "Clientes
    // pendientes" ni al Excel de bloqueantes, se descargan aparte (ver descargarDescartadosPorDuplicidad()).
    descartado_duplicado_sin_puntos: 'Descartada automáticamente (duplicada sin puntos)',
  };

  etiquetaCategoria(categoria: string): string {
    return this.categoriaLabels[categoria] ?? categoria;
  }

  // 'telefono_duplicado_bloqueante' (2026-10-23) ya NO cuenta como bloqueante acá: dejó de ser
  // excluida — ahora crea un LoyaltyPendingEnrollment agrupado, resoluble en vivo desde "Clientes
  // pendientes" (reusando "Completar"/"Rechazar"), sin necesidad del round-trip de Excel +
  // Correcciones que sí siguen necesitando duplicado/invalido/conflicto_bloqueante.
  esBloqueante(categoria: string): boolean {
    return categoria.endsWith('_bloqueante') && categoria !== 'telefono_duplicado_bloqueante';
  }

  filasBloqueantes() {
    return this.clasificacion?.filas.filter((f) => this.esBloqueante(f.categoria)) ?? [];
  }

  // ── Presentación: wizard de 3 pasos ───────────────────────────────────────
  // Solo de UI — reflejan pasoActivo/pasosReabiertos, nunca disparan ni reinician lógica.
  /** Un paso se muestra expandido si es el activo o si el usuario lo reabrió a mano
   *  con "Editar" (ver reabrirPaso()) para revisarlo sin perder su resultado. */
  pasoExpandido(paso: 1 | 2 | 3): boolean {
    return this.pasoActivo === paso || !!this.pasosReabiertos[paso];
  }

  pasoCompletado(paso: 1 | 2 | 3): boolean {
    return this.pasoActivo > paso;
  }

  /** Re-expande un paso ya completado para verlo, sin resetear ningún estado. */
  reabrirPaso(paso: 1 | 2 | 3): void {
    this.pasosReabiertos[paso] = true;
  }

  cerrarPaso(paso: 1 | 2 | 3): void {
    this.pasosReabiertos[paso] = false;
  }

  /** Resumen de una línea para la fila colapsada del paso 1 ("Subir"). */
  resumenSubida(): string {
    const nombres = [this.clientesFile?.name, this.puntosFile?.name].filter(Boolean);
    return nombres.length ? nombres.join(', ') : 'Sin archivos';
  }

  /** Resumen de una línea para la fila colapsada del paso 2 ("Clasificar"). */
  resumenClasificacion(): string {
    const r = this.clasificacion?.clasificacionResumen;
    if (!r) return '';
    // 'pendientes' suma sin_telefono + telefono_duplicado (2026-10-23): ambas terminan en
    // "Clientes pendientes" para resolverse ahí, ninguna de las dos es ya un bloqueante excluido.
    const totalPendientes = r.pendienteSinTelefono + r.telefonoDuplicadoBloqueante;
    // 'descartadoDuplicadoSinPuntos' (2026-10-29) es su propio tercer resultado — no es
    // "bloqueante" (no necesita Excel+Correcciones) ni "pendiente" (no necesita resolución manual,
    // ya se resolvió solo), así que se muestra aparte en vez de sumarse a cualquiera de los dos.
    return `${r.ok.toLocaleString()} listas, ${totalPendientes.toLocaleString()} pendientes, `
      + `${this.totalBloqueantes().toLocaleString()} bloqueantes, `
      + `${r.descartadoDuplicadoSinPuntos.toLocaleString()} descartadas automáticamente`;
  }

  /** La sección "Correcciones" solo aparece como nodo del rail cuando hace falta. */
  correccionesCompletado(): boolean {
    return !!this.aplicarCorreccionesResultado;
  }

  // ── Match contra Kore ──────────────────────────────────────────────────────
  puedeSincronizarKore(): boolean {
    return !this.koreMatching;
  }

  /** Arranca el job de match EN BACKGROUND — el progreso/resultado final llegan por socket (ver
   *  constructor: lealtadKoreMatchProgress$/Done$/Error$, filtrados por koreMatchJobId). Sin
   *  diálogo de confirmación: a diferencia de confirmarAplicar(), esto solo actualiza
   *  koreClienteId/koreMonedero (idempotente, no crea tarjetas ni acredita saldo). */
  sincronizarConKore(): void {
    if (!this.puedeSincronizarKore()) return;
    this.koreMatching = true;
    this.koreMatchJobId = null;
    this.errorKoreMatch = null;
    this.errorDescargaExcel = null;
    this.koreMatchResultado = null;
    // total en 0 hasta que llegue el primer evento de progreso — el backend no lo conoce de
    // antemano (a diferencia de aplicarImportacion(), que sí lo devuelve en la respuesta 202).
    this.koreMatchProgreso = { procesados: 0, total: 0, pct: 0 };

    this.loyalty.iniciarMatchKore().subscribe({
      next: (res) => { this.koreMatchJobId = res.jobId; },
      error: (err) => {
        this.errorKoreMatch = err?.error?.error || 'No se pudo iniciar el match con Kore.';
        this.koreMatching = false;
        this.koreMatchProgreso = null;
      },
    });
  }

  abrirKoreMatchLista(lista: KoreMatchListaKey): void {
    this.koreMatchModalLista = lista;
  }

  cerrarKoreMatchModal(): void {
    this.koreMatchModalLista = null;
  }

  readonly koreMatchModalTitulos: Record<KoreMatchListaKey, string> = {
    sinMatchEnKore: 'Tarjetas sin match en Kore',
    sinMatchEnLealtad: 'Clientes de Kore sin match en Lealtad',
    monederosDuplicadosEnKore: 'Monederos duplicados en Kore',
    erroresActualizacion: 'Errores al actualizar',
  };

  koreMatchModalTitulo(): string {
    return this.koreMatchModalLista ? this.koreMatchModalTitulos[this.koreMatchModalLista] : '';
  }
}
