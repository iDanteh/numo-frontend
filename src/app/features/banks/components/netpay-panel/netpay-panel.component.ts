import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  NetpayConsultaResultado, NetpayBandejaResultado, NetpayMatch, NetpayEstatusMatch,
  NetpayCandidatoMovimiento, NetpayStatusFiltro,
} from '../../../../core/models/netpay-transaccion.model';

// Los 6 estados válidos de un bucket NetpayMatch (ver design.md "Reconciliation State
// Model") — usados tanto para los chips de filtro como para las etiquetas de la tabla de
// auditoría. Orden: automáticos primero, luego pendientes/discrepancia, luego terminales.
const ESTADOS_BANDEJA: NetpayEstatusMatch[] = [
  'confirmado_automatico', 'pendiente_por_marca', 'discrepancia',
  'resuelto_por_reporte', 'resuelto_manual', 'rechazado',
];

const MAX_MOVIMIENTOS_RESOLVER = 2;

@Component({
  standalone: false,
  selector: 'app-netpay-panel',
  templateUrl: './netpay-panel.component.html',
  styleUrls: ['./netpay-panel.component.css'],
})
export class NetpayPanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();
  // Relay — feature "navegación al movimiento bancario" (2026-10-01): netpay-reporte-panel
  // (pestaña "Reportes") lo emite, acá solo sube la cadena hacia banks.component.ts#openBank.
  @Output() verMovimiento = new EventEmitter<{ banco: string; movId: string }>();

  // Pestañas: "Consulta" (Fase 1, sin cambios), "Matching" (bandeja Netpay↔BBVA, ver
  // netpay-evaluacion.service.js) y "Reportes" (consolidación 2026-09-29, pedido explícito
  // del usuario: netpay-reporte-panel deja de ser un sidebar propio en banks.component y se
  // anida acá como 3ra pestaña — mismo componente, sin reescribir su lógica interna).
  // Consulta/Matching comparten dateFrom/dateTo/terminalID (responseCode/almacenes son
  // exclusivos de Consulta); Reportes tiene sus propios filtros internos (chips de estatus,
  // dropzone) — no comparte NADA de los filtros de arriba (ver .np-filtros en el HTML).
  tab: 'consulta' | 'matching' | 'reportes' = 'consulta';

  // Filtros manuales (Fase 1) — el usuario todavía está diseñando el resto del catálogo
  // de parámetros de Kore, por ahora estos 6. terminalID (2026-09-15): primer paso
  // hacia el matching contra BankMovement. status (2026-09-21): filtra por el estatus
  // de Kore tal cual viene en NetpayTransaccion.status.
  responseCode = '';
  almacenes    = '';
  terminalID   = '';
  status: NetpayStatusFiltro | '' = '';
  // Bindeados a <app-date-range-popover> — YYYY-MM-DD, se mandan pelados al backend (ver
  // buscar()); es netpay-transacciones.service.js quien arma el instante UTC real de
  // inicio/fin de día en hora MX.
  dateFrom = '';
  dateTo   = '';

  resultado: NetpayConsultaResultado | null = null;
  loading = false;
  error: string | null = null;

  // ── Matching (bandeja Netpay↔BBVA, netpay-matching-v2) — GET /netpay/bandeja YA NO
  // llama a Kore: solo lee buckets NetpayMatch ya evaluados por POST .../evaluar. El
  // candidate picker manual (confirmar/descartarManual) fue reemplazado por Resolver/
  // Rechazar sobre un bucket 'discrepancia' identificado por :id.
  bandeja: NetpayBandejaResultado | null = null;
  bandejaLoading = false;
  bandejaError: string | null = null;
  estatusFiltro: NetpayEstatusMatch | '' = '';
  readonly estados = ESTADOS_BANDEJA;

  evaluando = false;
  evaluarError: string | null = null;

  // ── Exportar Excel de la bandeja (pedido explícito del usuario, 2026-09-30) — mismos
  // filtros que _buscarBandeja, enriquecido con Kore (ver bank.service.ts#exportarNetpayBandeja).
  exportandoBandeja = false;
  exportarBandejaError: string | null = null;
  // Aviso NO bloqueante — la descarga ya se disparó igual, solo informa que algunos folios
  // quedaron sin consultar contra Kore (fallo real o corte por tiempo, ver
  // X-Netpay-Export-Incompleto en la ruta). Distinto de exportarBandejaError, que es un
  // fallo total (la descarga ni siquiera se generó).
  exportarBandejaAviso: string | null = null;

  // ── Resolver — cierra un bucket 'discrepancia' con justificación humana obligatoria,
  // opcionalmente vinculando 0-2 movimientos elegidos desde /candidatos (preserva la
  // capacidad de split manual de v1). NUNCA produce 'confirmado_automatico'.
  resolviendoId: string | null = null;
  resolverJustificacion = '';
  resolverCandidatos: NetpayCandidatoMovimiento[] = [];
  resolverCandidatosLoading = false;
  resolverCandidatosError: string | null = null;
  resolverSeleccion = new Set<string>();
  resolverEnviando = false;
  resolverError: string | null = null;

  // ── Rechazar — permitido desde cualquier estado activo (spec.md "any active state ->
  // rechazado"), nunca vincula nada contra Kore/CxC.
  rechazandoId: string | null = null;
  rechazarMotivo = '';
  rechazarEnviando = false;
  rechazarError: string | null = null;

  // ── Revertir (pedido explícito del usuario, 2026-09-30) — desvincula el/los movimiento(s)
  // de un bucket confirmado_automatico/resuelto_manual, mismo mecanismo que ya usa
  // netpay-reporte-panel#revertir (PATCH .../erp-ids vía bankService.removeErpId, dispara
  // netpay-match-revert.service.js server-side) — NO hay endpoint nuevo, no hace falta.
  pideConfirmarRevertirId: string | null = null;
  revirtiendoId: string | null = null;
  revertirError: string | null = null;

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  // Mismo criterio que transferencias-caja-panel: recargar SIEMPRE que el panel se
  // vuelve a mostrar, sin guardar estado cacheado de una apertura anterior — nunca un
  // guard tipo "if (!this.resultado)".
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._reset();
  }

  private _reset(): void {
    this.resultado = null;
    this.error     = null;
    this.bandeja      = null;
    this.bandejaError = null;
    this.estatusFiltro = '';
    this.evaluarError = null;
    this.exportandoBandeja = false;
    this.exportarBandejaError = null;
    this.exportarBandejaAviso = null;
    this._cerrarResolverEstado();
    this._cerrarRechazarEstado();
    this.pideConfirmarRevertirId = null;
    this.revirtiendoId = null;
    this.revertirError = null;
  }

  cambiarTab(tab: 'consulta' | 'matching' | 'reportes'): void {
    this.tab = tab;
  }

  // Un solo botón "Buscar" en el head — dispara la consulta de la pestaña activa. Reportes
  // no tiene botón "Buscar" propio (usa su propia carga/filtros internos), así que nunca
  // llega acá con tab==='reportes'.
  buscar(): void {
    if (this.tab === 'consulta') this._buscarTransacciones();
    else if (this.tab === 'matching') this._buscarBandeja();
  }

  private _buscarTransacciones(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.consultarNetpayTransacciones(
      this.responseCode.trim() || undefined,
      this.almacenes.trim() || undefined,
      this.dateFrom || undefined,
      this.dateTo || undefined,
      this.terminalID.trim() || undefined,
      this.status || undefined,
    ).subscribe({
      next: (resultado) => { this.resultado = resultado; this.loading = false; },
      error: (err) => {
        this.error   = err?.error?.error || 'Error al consultar transacciones Netpay';
        this.loading = false;
      },
    });
  }

  private _buscarBandeja(): void {
    this.bandejaLoading = true;
    this.bandejaError   = null;
    this.bankService.obtenerNetpayBandeja(
      this.dateFrom || undefined,
      this.dateTo || undefined,
      this.terminalID.trim() || undefined,
      this.estatusFiltro || undefined,
    ).subscribe({
      next: (bandeja) => { this.bandeja = bandeja; this.bandejaLoading = false; },
      error: (err) => {
        this.bandejaError   = err?.error?.error || 'Error al cargar la bandeja de matching Netpay';
        this.bandejaLoading = false;
      },
    });
  }

  cerrar(): void {
    this.closed.emit();
  }

  // ── Chips de filtro por estatus (6 estados + "Todos") ───────────────────────────────
  cambiarFiltroEstatus(estatus: NetpayEstatusMatch | ''): void {
    this.estatusFiltro = estatus;
    this._buscarBandeja();
  }

  // ── Evaluar — POST /netpay/bandeja/evaluar: persiste una decisión (incluida
  // discrepancia) por cada bucket todavía reevaluable, nunca side effects en el GET.
  // Fix 2026-09-29 (pedido explícito del usuario): responseCode/almacenes/status —
  // mismos filtros crudos de Kore que ya usaba solo Consulta, reusados acá (mismas
  // propiedades del componente, sin duplicar estado).
  evaluar(): void {
    if (this.evaluando) return;
    this.evaluando    = true;
    this.evaluarError = null;
    this.bankService.evaluarNetpayBandeja({
      dateFrom: this.dateFrom || undefined,
      dateTo: this.dateTo || undefined,
      terminalID: this.terminalID.trim() || undefined,
      responseCode: this.responseCode.trim() || undefined,
      almacenes: this.almacenes.trim() || undefined,
      status: this.status || undefined,
    }).subscribe({
      next: () => {
        this.evaluando = false;
        this._buscarBandeja();
      },
      error: (err) => {
        this.evaluando    = false;
        this.evaluarError = err?.error?.error || 'Error al evaluar la bandeja Netpay';
      },
    });
  }

  // ── Exportar Excel ───────────────────────────────────────────────────────────────────
  exportarBandeja(): void {
    if (this.exportandoBandeja) return;
    this.exportandoBandeja    = true;
    this.exportarBandejaError = null;
    this.exportarBandejaAviso = null;

    this.bankService.exportarNetpayBandeja(
      this.dateFrom || undefined,
      this.dateTo || undefined,
      this.terminalID.trim() || undefined,
      this.estatusFiltro || undefined,
    ).subscribe({
      next: ({ blob, incompletos }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netpay-bandeja-${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        this.exportandoBandeja = false;
        // La descarga ya salió igual — esto es un aviso, no un error. El koreCache ya
        // persistido para los folios que SÍ se resolvieron hace que un re-export futuro
        // tenga menos pendientes (nunca se vuelve a consultar lo ya cacheado).
        if (incompletos > 0) {
          this.exportarBandejaAviso = `El Excel se generó, pero ${incompletos} folio(s) no se pudieron consultar contra Kore (por saturación o corte por tiempo). Podés volver a exportar para completarlos — los que ya se consultaron quedan en caché y no se vuelven a pedir.`;
        }
      },
      error: (err) => {
        this.exportandoBandeja = false;
        // exportarNetpayBandeja pide responseType:'blob' (ver ApiService#downloadBlobWithHeaders) —
        // Angular también entrega el cuerpo de ERROR como Blob en vez de JSON ya parseado.
        if (err?.error instanceof Blob) {
          err.error.text().then((text: string) => {
            let msg = 'Error al generar el Excel de la bandeja';
            try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
            this.exportarBandejaError = msg;
          });
          return;
        }
        this.exportarBandejaError = err?.error?.error || err?.message || 'Error al generar el Excel de la bandeja';
      },
    });
  }

  // ── Resolver ─────────────────────────────────────────────────────────────────────────
  abrirResolver(bucket: NetpayMatch): void {
    this.resolviendoId          = bucket._id;
    this.resolverJustificacion  = '';
    this.resolverSeleccion      = new Set<string>();
    this.resolverError          = null;
    this._cargarResolverCandidatos(bucket._id);
  }

  private _cargarResolverCandidatos(id: string): void {
    this.resolverCandidatosLoading = true;
    this.resolverCandidatosError   = null;
    this.bankService.candidatosNetpayMatch(id).subscribe({
      next: (res) => {
        this.resolverCandidatos        = res.candidatos;
        this.resolverCandidatosLoading = false;
      },
      error: (err) => {
        this.resolverCandidatosError   = err?.error?.error || 'Error al buscar candidatos para este bucket';
        this.resolverCandidatosLoading = false;
      },
    });
  }

  cerrarResolver(): void {
    this._cerrarResolverEstado();
  }

  private _cerrarResolverEstado(): void {
    this.resolviendoId             = null;
    this.resolverJustificacion     = '';
    this.resolverCandidatos        = [];
    this.resolverCandidatosLoading = false;
    this.resolverCandidatosError   = null;
    this.resolverSeleccion         = new Set<string>();
    this.resolverEnviando          = false;
    this.resolverError             = null;
  }

  puedeResolver(): boolean {
    return this.resolverJustificacion.trim().length > 0 && !this.resolverEnviando;
  }

  // A lo sumo 2 movimientos (design.md "Resolve movement cardinality") — preserva la
  // capacidad de split manual de v1. Un 3er intento se ignora (no reemplaza selección).
  toggleSeleccionCandidato(movementId: string): void {
    if (this.resolverSeleccion.has(movementId)) {
      this.resolverSeleccion.delete(movementId);
      return;
    }
    if (this.resolverSeleccion.size >= MAX_MOVIMIENTOS_RESOLVER) return;
    this.resolverSeleccion.add(movementId);
  }

  confirmarResolver(bucket: NetpayMatch): void {
    if (!this.puedeResolver()) return;
    this.resolverEnviando = true;
    this.resolverError    = null;
    this.bankService.resolverNetpayMatch(bucket._id, {
      justificacion: this.resolverJustificacion.trim(),
      movementIds: [...this.resolverSeleccion],
    }).subscribe({
      next: (res) => {
        this._reemplazarBucket(res.bucket);
        this._cerrarResolverEstado();
      },
      error: (err) => {
        this.resolverEnviando = false;
        this.resolverError    = err?.error?.error || 'Error al resolver este bucket';
      },
    });
  }

  // ── Rechazar ─────────────────────────────────────────────────────────────────────────
  abrirRechazar(bucket: NetpayMatch): void {
    this.rechazandoId  = bucket._id;
    this.rechazarMotivo = '';
    this.rechazarError  = null;
  }

  cerrarRechazar(): void {
    this._cerrarRechazarEstado();
  }

  private _cerrarRechazarEstado(): void {
    this.rechazandoId    = null;
    this.rechazarMotivo  = '';
    this.rechazarEnviando = false;
    this.rechazarError   = null;
  }

  confirmarRechazar(bucket: NetpayMatch): void {
    if (this.rechazarEnviando) return;
    this.rechazarEnviando = true;
    this.rechazarError    = null;
    this.bankService.rechazarNetpayMatch(bucket._id, { motivo: this.rechazarMotivo.trim() || undefined }).subscribe({
      next: (res) => {
        this._reemplazarBucket(res.bucket);
        this._cerrarRechazarEstado();
      },
      error: (err) => {
        this.rechazarEnviando = false;
        this.rechazarError    = err?.error?.error || 'Error al rechazar este bucket';
      },
    });
  }

  // ── Revertir ─────────────────────────────────────────────────────────────────────────
  // erpId sintético — replica letra por letra las funciones del backend (NUNCA persistidas
  // en el bucket, se calculan): netpay-evaluacion.service.js#_erpIdAutomatico (confirmado_
  // automatico, siempre bucket 'general', sin sufijo) y netpay-resolver.service.js#_erpIdManual
  // (resuelto_manual, sufijo de bucket si no es 'general', + '-MANUAL').
  private _erpIdDeBucket(bucket: NetpayMatch): string {
    const fecha = new Date(bucket.dia).toISOString().slice(0, 10);
    if (bucket.estatusMatch === 'confirmado_automatico') {
      return `NETPAY-${bucket.terminalID}-${fecha}`;
    }
    const sufijoBucket = bucket.bucket === 'general' ? '' : `-${bucket.bucket}`;
    return `NETPAY-${bucket.terminalID}-${fecha}${sufijoBucket}-MANUAL`;
  }

  // Solo tiene sentido si HAY un movimiento vinculado — un resuelto_manual cerrado solo con
  // justificación (sin elegir movimiento en el diálogo de Resolver) no tiene erpLink que
  // desvincular por este camino, y hoy no existe otro.
  puedeRevertir(bucket: NetpayMatch): boolean {
    return (bucket.estatusMatch === 'confirmado_automatico' || bucket.estatusMatch === 'resuelto_manual')
      && (bucket.movementIdsConfirmados?.length ?? 0) > 0
      && this.auth.hasPermission('banks:erp:unlink');
  }

  bucketPendienteRevertir(): NetpayMatch | null {
    if (!this.pideConfirmarRevertirId || !this.bandeja) return null;
    return this.bandeja.buckets.find(b => b._id === this.pideConfirmarRevertirId) ?? null;
  }

  abrirRevertir(bucket: NetpayMatch): void {
    this.pideConfirmarRevertirId = bucket._id;
    this.revertirError = null;
  }

  cerrarRevertir(): void {
    this.pideConfirmarRevertirId = null;
  }

  // Secuencial (no en paralelo): el primer unlink ya dispara el hook que cierra el bucket a
  // discrepancia (netpay-match-revert.service.js#_revertirPorDesvinculacion solo encuentra
  // match mientras estatusMatch siga confirmado_automatico/resuelto_manual) — llamadas
  // siguientes para el resto de movimientos del mismo bucket ya no vuelven a tocarlo, solo
  // desvinculan su propio erpLink. Encadenado a mano (sin operadores RxJS) para no introducir
  // una dependencia nueva en un componente que ya maneja todo con .subscribe() plano.
  revertir(bucket: NetpayMatch | null): void {
    if (!bucket || this.revirtiendoId) return;
    const movementIds = (bucket.movementIdsConfirmados ?? [])
      .map(m => (typeof m === 'string' ? m : m._id));
    if (movementIds.length === 0) return;

    this.revirtiendoId = bucket._id;
    this.revertirError = null;
    const erpId = this._erpIdDeBucket(bucket);

    const ejecutar = (idx: number): void => {
      if (idx >= movementIds.length) {
        this.revirtiendoId = null;
        this.pideConfirmarRevertirId = null;
        this._buscarBandeja();
        return;
      }
      this.bankService.removeErpId(movementIds[idx], erpId).subscribe({
        next: (res) => {
          // vinculoRemovido:false (bank.service.js#updateErpIds): el backend no encontró
          // ningún erpLink real que quitar para este movimiento — pasa, por ejemplo, si un
          // resolver() sin movimiento seleccionado dejó movementIdsConfirmados apuntando a un
          // registro sin este erpId real vinculado (revisión de confiabilidad, 2026-09-30).
          // Se corta acá: seguir como si hubiera sido exitoso dejaría creer al usuario que
          // revirtió algo que en realidad no cambió.
          if (res.vinculoRemovido === false) {
            this.revirtiendoId = null;
            this.pideConfirmarRevertirId = null;
            this.revertirError = 'Este match ya no tiene un vínculo real con este movimiento — puede que ya se haya revertido antes o el registro esté desactualizado. Refrescá la bandeja.';
            this._buscarBandeja();
            return;
          }
          ejecutar(idx + 1);
        },
        error: (err) => {
          this.revirtiendoId = null;
          if (idx === 0) {
            // Nada cambió de verdad — mismo comportamiento que ya existía, sin refrescar.
            this.revertirError = err?.error?.error || 'Error al revertir este match';
            return;
          }
          // El hook del primer movimiento YA cerró el bucket a discrepancia/revertido del
          // lado del servidor (netpay-match-revert.service.js) — refrescar para mostrar el
          // estado real en vez de dejar la fila vieja con el botón "Revertir" todavía visible.
          this.pideConfirmarRevertirId = null;
          this.revertirError = idx === 1
            ? 'Se revirtió el vínculo con el primer movimiento, pero falló al revertir el segundo — revisá el estado de ese movimiento en Bancos manualmente.'
            : `Se revirtió el vínculo con los primeros ${idx} movimientos, pero falló al revertir el siguiente — revisá el estado de ese movimiento en Bancos manualmente.`;
          this._buscarBandeja();
        },
      });
    };
    ejecutar(0);
  }

  // Punto (c): GET /netpay/bandeja puebla movementIdsConfirmados (ver erp.routes.js), pero
  // POST resolver/rechazar NO — un bucket recién reemplazado vía _reemplazarBucket puede
  // traer IDs crudos hasta el próximo refresco. Devuelve null en ese caso (la tabla cae al
  // conteo plano de respaldo) en vez de intentar formatear un string como si fuera un objeto.
  movimientosDetalle(bucket: NetpayMatch): NetpayCandidatoMovimiento[] | null {
    const lista = bucket.movementIdsConfirmados ?? [];
    if (lista.length === 0 || typeof lista[0] === 'string') return null;
    return lista as NetpayCandidatoMovimiento[];
  }

  private _reemplazarBucket(actualizado: NetpayMatch): void {
    if (!this.bandeja) return;
    this.bandeja = {
      buckets: this.bandeja.buckets.map(b => (b._id === actualizado._id ? actualizado : b)),
    };
  }

  // ── Presentación (tabla de auditoría) ───────────────────────────────────────────────
  quienCuando(bucket: NetpayMatch): { nombre: string | null; en: string | null } | null {
    if (bucket.estatusMatch === 'confirmado_automatico' && bucket.confirmadoPor) {
      return { nombre: bucket.confirmadoPor.nombre, en: bucket.confirmadoEn };
    }
    if (bucket.estatusMatch === 'resuelto_manual' && bucket.resueltoManualPor) {
      return { nombre: bucket.resueltoManualPor.nombre, en: bucket.resueltoManualEn };
    }
    if (bucket.estatusMatch === 'rechazado' && bucket.descartadoManualmentePor) {
      return { nombre: bucket.descartadoManualmentePor.nombre, en: bucket.descartadoManualmenteEn };
    }
    return null;
  }
}
