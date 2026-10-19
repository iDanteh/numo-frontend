import { Component, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  LoyaltyService, LoyaltyImportConcentrado, LoyaltyImportClasificacion, LoyaltyImportAplicarResult,
  LoyaltyImportCorreccionClasificacion, LoyaltyImportClasificacionResumen,
} from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';

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
    if (file && /\.pdf$/i.test(file.name)) this.setPuntosFile(file);
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

  private _totalBloqueantesDe(r: LoyaltyImportClasificacionResumen | undefined | null): number {
    if (!r) return 0;
    return r.duplicadoBloqueante + r.invalidoBloqueante + r.conflictoBloqueante + r.telefonoDuplicadoBloqueante;
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

  confirmarAplicar(): void {
    if (!this.puedeAplicar()) return;
    const ok = window.confirm(
      'Esto va a crear tarjetas reales y acreditar saldo en producción. '
      + '¿Confirmas que quieres aplicar esta importación?',
    );
    if (!ok) return;
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

  confirmarAplicarCorrecciones(): void {
    if (!this.puedeAplicarCorrecciones() || !this.correccionesFile) return;
    const ok = window.confirm(
      'Esto va a crear tarjetas reales y acreditar saldo en producción con los datos corregidos. '
      + '¿Confirmas que quieres aplicar estas correcciones?',
    );
    if (!ok) return;

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
  };

  etiquetaCategoria(categoria: string): string {
    return this.categoriaLabels[categoria] ?? categoria;
  }

  esBloqueante(categoria: string): boolean {
    return categoria.endsWith('_bloqueante');
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
    return `${r.ok.toLocaleString()} listas, ${r.pendienteSinTelefono.toLocaleString()} pendientes, `
      + `${this.totalBloqueantes().toLocaleString()} bloqueantes`;
  }

  /** La sección "Correcciones" solo aparece como nodo del rail cuando hace falta. */
  correccionesCompletado(): boolean {
    return !!this.aplicarCorreccionesResultado;
  }
}
