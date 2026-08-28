import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PolizaService, Poliza, PolizaEstado, PolizaMovimiento, CuentaPuentePendiente } from '../../core/services/poliza.service';
import { AccountPlanService, AccountPlan } from '../../core/services/account-plan.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Fase 2 (2026-08-25): ya NO es un stub — genera/lista/cancela pólizas reales
 * tipo='T', mismo ciclo de vida (folio, estado) que Ingreso/Cobranza. Único
 * filtro visible: rango de fechas — rfc sale de EntidadActivaService (mismo
 * contexto activo global que ya usa el resto de la app), sin selector propio
 * en esta página (pedido explícito del usuario).
 */
@Component({
  standalone: false,
  selector: 'app-poliza-traspasos',
  templateUrl: './poliza-traspasos.component.html',
})
export class PolizaTraspasosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  fechaInicio = '';
  fechaFin    = '';

  // Mismo default que Ingreso/Cobranza: solo borradores (confirmado con el
  // usuario 2026-07-28, ver poliza-list.component.ts).
  estadoFiltro: PolizaEstado | '' = 'borrador';

  generando   = false;
  loading     = false;
  cancelando  = new Set<number>();
  exportando  = new Set<number>();

  polizas: Poliza[] = [];
  error:   string | null = null;

  // ── Ver movimientos ─────────────────────────────────────────────────────────
  // Mismo dato que ya trae openEdit() en poliza-list.component.ts (GET /polizas/:id
  // ya incluye movimientos con cuenta.codigo/nombre resueltos) — pero un modal propio,
  // simple y de solo lectura, en vez de reusar el editor gigante de CFDIs (acoplado a
  // reglas/autocomplete de cuentas/filtros que acá no aplican).
  verModal = { show: false, loading: false, poliza: null as Poliza | null };

  // ── Resolver cuenta puente pendiente (antes de contabilizar) ────────────────
  // A diferencia de Ingreso/Cobranza, acá "Bancos por identificar" NO se resuelve
  // solo al conciliar el banco (`resolverCuentasPorCfdisIdentificados` matchea por
  // cfdiUuid, que un Traspaso no tiene) — es un hueco real del catálogo
  // (BANCO_A_CODIGO_CUENTA, poliza.service.js) que solo se destraba asignando la
  // cuenta a mano acá. Reusa `resolverCuentasBanco`/`reemplazarCuenta` tal cual
  // (ya son genéricos, sin acople a CFDI) — mismo patrón simple de este
  // componente (confirm()/estado local) en vez del modal grande de poliza-list.
  showResolverCuentas = false;
  polizaEnContabilizacion: Poliza | null = null;
  cuentasPendientes: CuentaPuentePendiente[] = [];
  cuentasPendientesDestino: Record<number, number | null> = {};
  cuentasDisponiblesBanco: AccountPlan[] = [];

  // ── Navegación al banco desde un movimiento ("ver movimientos") ─────────────
  // El id de banco/movimiento no vive en PolizaMovimiento — se resuelve en el
  // backend (Poliza.traspasosPares + orden, ver poliza.service.js) recién al
  // clickear, para no pagar ese costo en cada `cargar()`.
  resolviendoMovId: number | null = null;

  // ── Cancelar todas (con selección manual) — mismo patrón que
  // poliza-compensaciones-intereses.component.ts: sin acotar a un periodo,
  // Traspasos genera 1 póliza por día y puede haber varias en borrador a la vez.
  showCancelarTodasModal  = false;
  cancelarTodasLoading    = false;
  cancelarTodasEnviando   = false;
  cancelarTodasCandidatas: Poliza[] = [];
  cancelarTodasSeleccion  = new Set<number>();
  cancelarTodasMotivo     = '';

  // ── Confirmación modal ───────────────────────────────────────────────────────
  // Mismo componente compartido (app-confirm-modal, extraído de poliza-list) en
  // vez de confirm()/prompt() nativos del navegador — ya no aplica la razón por
  // la que este componente los usaba antes (vivía separado de poliza-list).
  showConfirm       = false;
  confirmTitle      = '';
  confirmMsg        = '';
  confirmBtn        = '';
  confirmClass      = '';
  confirmShowMotivo = false;
  confirmMotivo     = '';
  private confirmCb: (() => void) | null = null;

  constructor(
    private polizaSvc: PolizaService,
    private accountSvc: AccountPlanService,
    private entidadActiva: EntidadActivaService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.cargar();

    // Volver desde Bancos con el modal de la póliza que se estaba consultando
    // (ver irABanco()/banks.component.ts#volverAPoliza) — se reabre una sola vez,
    // sin depender de que `polizas` ya esté cargada (getById trae la póliza
    // puntual directo, más rápido que esperar a `cargar()`).
    const openPolizaId = Number(this.route.snapshot.queryParamMap.get('openPoliza'));
    if (openPolizaId) {
      this.verMovimientos({ id: openPolizaId } as Poliza);
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private get rfc(): string | null {
    return this.entidadActiva.snapshot?.rfc ?? null;
  }

  cargar(): void {
    const rfc = this.rfc;
    if (!rfc) return;
    this.loading = true;
    this.polizaSvc.list({ rfc, tipo: 'T', estado: this.estadoFiltro || undefined, limit: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.polizas = res.polizas; this.loading = false; },
        error: () => { this.loading = false; },
      });
  }

  onEstadoFiltroChange(estado: PolizaEstado | ''): void {
    this.estadoFiltro = estado;
    this.cargar();
  }

  generarPoliza(): void {
    const rfc = this.rfc;
    if (!rfc || !this.fechaInicio || !this.fechaFin || this.generando) return;
    this.generando = true;
    this.error = null;
    this.polizaSvc.generarTraspasos({ rfc, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.generando = false;
          this.fechaInicio = '';
          this.fechaFin    = '';
          this.cargar();
        },
        error: (err) => {
          this.generando = false;
          this.error = err?.error?.error || 'No se pudo generar la póliza.';
        },
      });
  }

  // Antes de confirmar, resuelve el cruce automático de cuenta puente → banco
  // real (mismo `resolverCuentasBanco` que usa Ingreso/Cobranza); si algo
  // queda pendiente, pide la cuenta destino primero (ver `abrirResolverCuentas`).
  contabilizar(poliza: Poliza): void {
    if (!poliza.id) return;
    this.polizaSvc.resolverCuentasBanco(poliza.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.pendientes.length === 0) {
            this.confirmarContabilizar(poliza);
          } else {
            this.abrirResolverCuentas(poliza, res.pendientes);
          }
        },
        error: (err) => this.toast.error(err?.error?.error || 'No se pudo resolver las cuentas bancarias.'),
      });
  }

  private confirmarContabilizar(poliza: Poliza): void {
    this.openConfirm({
      title: 'Contabilizar póliza',
      msg:   `¿Contabilizar la póliza T${poliza.numero}? Esta acción cambiará su estado a <strong>Contabilizada</strong> y no podrá editarse.`,
      btn:   'Contabilizar',
      cls:   'btn-confirm-success',
      cb:    () => this.polizaSvc.contabilizar(poliza.id!)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next:  () => { this.toast.success('Póliza contabilizada'); this.cargar(); },
          error: (err) => this.toast.error(err?.error?.error || 'No se pudo contabilizar la póliza.'),
        }),
    });
  }

  // ── Confirmación modal (compartido con poliza-list) ─────────────────────────
  private openConfirm(opts: { title: string; msg: string; btn: string; cls: string; showMotivo?: boolean; cb: () => void }): void {
    this.confirmTitle      = opts.title;
    this.confirmMsg        = opts.msg;
    this.confirmBtn        = opts.btn;
    this.confirmClass      = opts.cls;
    this.confirmShowMotivo = opts.showMotivo ?? false;
    this.confirmMotivo     = '';
    this.confirmCb         = opts.cb;
    this.showConfirm       = true;
  }

  closeConfirm(): void { this.showConfirm = false; this.confirmCb = null; this.confirmMotivo = ''; }

  runConfirm(): void {
    if (this.confirmCb) this.confirmCb();
    this.showConfirm = false;
    this.confirmCb   = null;
  }

  abrirResolverCuentas(poliza: Poliza, pendientes: CuentaPuentePendiente[]): void {
    this.polizaEnContabilizacion  = poliza;
    this.cuentasPendientes        = pendientes;
    this.cuentasPendientesDestino = {};
    pendientes.forEach(x => this.cuentasPendientesDestino[x.cuentaId] = null);
    this.showResolverCuentas = true;
    if (this.cuentasDisponiblesBanco.length === 0) {
      // Solo Bancos (1102) — un traspaso siempre es transferencia entre cuentas
      // bancarias, nunca Caja (a diferencia de Ingreso/Cobranza).
      this.accountSvc.list({ tipo: 'ACTIVO' })
        .pipe(takeUntil(this.destroy$))
        .subscribe(cuentas => {
          this.cuentasDisponiblesBanco = cuentas.filter(c => c.codigo.startsWith('1102'));
        });
    }
  }

  closeResolverCuentas(): void {
    this.showResolverCuentas    = false;
    this.polizaEnContabilizacion = null;
  }

  // Igual que poliza-list: la cuenta puente que el usuario deja sin asignar se
  // omite (la póliza igual se puede contabilizar, la línea sigue "por
  // identificar" hasta que alguien la resuelva más adelante).
  confirmarResolverCuentas(): void {
    const p = this.polizaEnContabilizacion;
    if (!p?.id) return;

    const reemplazos = this.cuentasPendientes
      .filter(x => !!this.cuentasPendientesDestino[x.cuentaId])
      .map(x => ({ cuentaPuenteId: x.cuentaId, cuentaDestinoId: this.cuentasPendientesDestino[x.cuentaId]! }));

    if (reemplazos.length === 0) {
      this.showResolverCuentas = false;
      this.confirmarContabilizar(p);
      return;
    }

    const llamadas = reemplazos.map(r => this.polizaSvc.reemplazarCuenta(p.id!, r.cuentaPuenteId, r.cuentaDestinoId));
    forkJoin(llamadas)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showResolverCuentas = false;
          this.confirmarContabilizar(p);
        },
        error: (err) => this.toast.error(err?.error?.error || 'No se pudo reemplazar las cuentas.'),
      });
  }

  cancelar(poliza: Poliza): void {
    if (!poliza.id || this.cancelando.has(poliza.id)) return;
    this.openConfirm({
      title:      'Cancelar póliza',
      msg:        `¿Cancelar la póliza T${poliza.numero}? Los movimientos bancarios que relacionó vuelven a "no identificado". Esta acción es <strong>irreversible</strong>.`,
      btn:        'Cancelar póliza',
      cls:        'btn-confirm-danger',
      showMotivo: true,
      cb: () => {
        this.cancelando.add(poliza.id!);
        this.polizaSvc.cancelar(poliza.id!, this.confirmMotivo || undefined)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => { this.cancelando.delete(poliza.id!); this.toast.success('Póliza cancelada'); this.cargar(); },
            error: (err) => {
              this.cancelando.delete(poliza.id!);
              this.toast.error(err?.error?.error || 'No se pudo cancelar la póliza.');
            },
          });
      },
    });
  }

  abrirCancelarTodasModal(): void {
    const rfc = this.rfc;
    if (!rfc) {
      this.toast.error('Selecciona una entidad activa primero');
      return;
    }
    this.cancelarTodasCandidatas = [];
    this.cancelarTodasSeleccion  = new Set();
    this.cancelarTodasMotivo     = '';
    this.cancelarTodasLoading    = true;
    this.showCancelarTodasModal  = true;

    this.polizaSvc.listBorradorCandidatasTraspasos(rfc)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (polizas) => {
          this.cancelarTodasCandidatas = polizas;
          this.cancelarTodasSeleccion  = new Set(polizas.map(p => p.id!));
          this.cancelarTodasLoading    = false;
        },
        error: (err) => {
          this.cancelarTodasLoading   = false;
          this.showCancelarTodasModal = false;
          this.toast.error(err?.error?.error || 'Error al cargar las pólizas en borrador');
        },
      });
  }

  cerrarCancelarTodasModal(): void {
    this.showCancelarTodasModal = false;
  }

  isCancelarTodasSeleccionada(id: number): boolean {
    return this.cancelarTodasSeleccion.has(id);
  }

  toggleCancelarTodasPoliza(id: number): void {
    if (this.cancelarTodasSeleccion.has(id)) this.cancelarTodasSeleccion.delete(id);
    else this.cancelarTodasSeleccion.add(id);
  }

  get cancelarTodasTodasMarcadas(): boolean {
    return this.cancelarTodasCandidatas.length > 0
      && this.cancelarTodasSeleccion.size === this.cancelarTodasCandidatas.length;
  }

  toggleCancelarTodasMarcarTodas(): void {
    this.cancelarTodasSeleccion = this.cancelarTodasTodasMarcadas
      ? new Set()
      : new Set(this.cancelarTodasCandidatas.map(p => p.id!));
  }

  confirmarCancelarTodas(): void {
    const rfc = this.rfc;
    const ids = Array.from(this.cancelarTodasSeleccion);
    if (!rfc || !ids.length || this.cancelarTodasEnviando) return;

    this.cancelarTodasEnviando  = true;
    this.showCancelarTodasModal = false;

    this.polizaSvc.cancelarTodasTraspasos({
      rfc, motivo: this.cancelarTodasMotivo || undefined, polizaIds: ids,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.cancelarTodasEnviando = false;
          const detalle = `${res.canceladas} de ${res.total} póliza(s)`
            + (res.errores.length ? ` — ${res.errores.length} con error` : '');
          this.toast.success(`Pólizas canceladas: ${detalle}`);
          this.cargar();
        },
        error: (err) => {
          this.cancelarTodasEnviando = false;
          this.toast.error(err?.error?.error || 'Error al cancelar las pólizas');
        },
      });
  }

  verMovimientos(poliza: Poliza): void {
    if (!poliza.id) return;
    this.verModal = { show: true, loading: true, poliza: null };
    this.polizaSvc.getById(poliza.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (full) => { this.verModal = { show: true, loading: false, poliza: full }; },
        error: () => { this.verModal = { show: false, loading: false, poliza: null }; },
      });
  }

  cerrarVer(): void {
    this.verModal = { show: false, loading: false, poliza: null };
  }

  // Navega al registro real en Bancos del BankMovement del que salió este cargo/
  // abono — pasa `volverA`/`volverPolizaId` en queryParams para que banks.component
  // muestre un botón "Volver" que reabra esta póliza puntual (ver ngOnInit arriba).
  irABanco(m: PolizaMovimiento): void {
    const poliza = this.verModal.poliza;
    if (!poliza?.id || !m.id || this.resolviendoMovId) return;
    this.resolviendoMovId = m.id;
    this.polizaSvc.resolverBankMovimientoDeTraspaso(poliza.id, m.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ bankMovementId, banco }) => {
          this.resolviendoMovId = null;
          this.router.navigate(['/banks'], {
            queryParams: { banco, movId: bankMovementId, volverA: 'traspasos', volverPolizaId: poliza.id },
          });
        },
        error: (err) => {
          this.resolviendoMovId = null;
          this.error = err?.error?.error || 'No se pudo ubicar el movimiento bancario relacionado.';
        },
      });
  }

  exportar(poliza: Poliza): void {
    if (!poliza.id || this.exportando.has(poliza.id)) return;
    this.exportando.add(poliza.id);
    this.polizaSvc.exportarContpaqTraspasos(poliza.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.exportando.delete(poliza.id!);
          const blob = response.body!;
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url;
          a.download = `Poliza_T${poliza.numero}_${poliza.fecha}_CONTPAQ.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err) => {
          this.exportando.delete(poliza.id!);
          // Angular entrega el body de error también como Blob cuando responseType
          // es 'blob' — mismo fix ya aplicado en admin-ops-panel.component.ts.
          if (err?.error instanceof Blob) {
            err.error.text().then((text: string) => {
              let msg = 'No se pudo exportar la póliza.';
              try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
              this.error = msg;
            });
            return;
          }
          this.error = err?.error?.error || 'No se pudo exportar la póliza.';
        },
      });
  }
}
