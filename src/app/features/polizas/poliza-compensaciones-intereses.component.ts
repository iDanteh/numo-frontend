import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PolizaService, Poliza, PolizaEstado, PolizaTipo, PolizaMovimiento } from '../../core/services/poliza.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Pólizas Compensaciones Bancarias / Intereses Ganados (2026-08-27) — réplica de la
 * póliza mensual que hoy arma contabilidad a mano ("D-185 COMP 186 INT GANADOS.xls").
 * A diferencia de Traspasos C.P. (poliza-traspasos.component.ts), acá NO hace falta el
 * flujo de "cuenta puente" (resolverCuentasBanco/reemplazarCuenta): los movimientos
 * solo salen de BBVA/Banamex (siempre mapeados en BANCO_A_CODIGO_CUENTA) y las 2
 * cuentas de cierre son fijas del catálogo — nunca hay una cuenta sin resolver.
 * Un solo botón "Generar" crea hasta 2 pólizas (tipo='B' y tipo='G', una por cada
 * categoría con candidatos en el rango) — mismo criterio que el Excel real, que
 * siempre las arma juntas. La bandeja mezcla ambos tipos en una sola tabla (2
 * llamadas a list(), una por tipo, mergeadas) porque `list()` solo filtra por un
 * tipo a la vez — mismo patrón que ya resuelve tipo/soloCobranza en poliza-list.
 */
@Component({
  standalone: false,
  selector: 'app-poliza-compensaciones-intereses',
  templateUrl: './poliza-compensaciones-intereses.component.html',
})
export class PolizaCompensacionesInteresesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  fechaInicio = '';
  fechaFin    = '';

  // Mismo default que Ingreso/Cobranza/Traspasos: solo borradores.
  estadoFiltro: PolizaEstado | '' = 'borrador';

  generando   = false;
  loading     = false;
  cancelando  = new Set<number>();
  exportando  = new Set<number>();

  polizas: Poliza[] = [];
  error:   string | null = null;

  verModal = { show: false, loading: false, poliza: null as Poliza | null };

  // Navegación al banco desde un movimiento ("ver movimientos") — mismo patrón que
  // poliza-traspasos.component.ts#irABanco. Solo aplica a las líneas de débito
  // (una por BankMovement real); la línea de cierre agregada (haber) no tiene
  // BankMovement puntual de origen, ver resolverBankMovimientoDeCompensacionIntereses.
  resolviendoMovId: number | null = null;

  // La bandeja mezcla tipo='B' (Compensaciones) y tipo='G' (Intereses Ganados) —
  // mismo motivo por el que Ingreso/Cobranza usa mostrarTipo en poliza-tabla.
  tipoLabel(t: PolizaTipo): string {
    return t === 'B' ? 'Compensaciones' : t === 'G' ? 'Intereses Ganados' : t;
  }

  // ── Cancelar todas (con selección manual) — mismo patrón que
  // poliza-list.component.ts, pero sin acotar a un periodo: acá puede haber
  // varias pólizas de meses distintos en borrador a la vez, por diseño.
  showCancelarTodasModal  = false;
  cancelarTodasLoading    = false;
  cancelarTodasEnviando   = false;
  cancelarTodasCandidatas: Poliza[] = [];
  cancelarTodasSeleccion  = new Set<number>();
  cancelarTodasMotivo     = '';

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
    private entidadActiva: EntidadActivaService,
    private toast: ToastService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.cargar();

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
    const estado = this.estadoFiltro || undefined;
    forkJoin([
      this.polizaSvc.list({ rfc, tipo: 'B', estado, limit: 100 }),
      this.polizaSvc.list({ rfc, tipo: 'G', estado, limit: 100 }),
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ([comp, intereses]) => {
          this.polizas = [...comp.polizas, ...intereses.polizas]
            .sort((a, b) => (b.fecha).localeCompare(a.fecha) || a.tipo.localeCompare(b.tipo));
          this.loading = false;
        },
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
    this.polizaSvc.generarCompensacionesIntereses({ rfc, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ polizas }) => {
          this.generando = false;
          this.fechaInicio = '';
          this.fechaFin    = '';
          const tipos = polizas.map(p => p.tipo === 'B' ? 'Compensaciones' : 'Intereses Ganados').join(' y ');
          this.toast.success(`Póliza${polizas.length > 1 ? 's' : ''} de ${tipos} generada${polizas.length > 1 ? 's' : ''}`);
          this.cargar();
        },
        error: (err) => {
          this.generando = false;
          this.error = err?.error?.error || 'No se pudo generar la póliza.';
        },
      });
  }

  contabilizar(poliza: Poliza): void {
    if (!poliza.id) return;
    this.openConfirm({
      title: 'Contabilizar póliza',
      msg:   `¿Contabilizar la póliza ${poliza.tipo}${poliza.numero}? Esta acción cambiará su estado a <strong>Contabilizada</strong> y no podrá editarse.`,
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

  cancelar(poliza: Poliza): void {
    if (!poliza.id || this.cancelando.has(poliza.id)) return;
    this.openConfirm({
      title:      'Cancelar póliza',
      msg:        `¿Cancelar la póliza ${poliza.tipo}${poliza.numero}? Los movimientos bancarios que relacionó vuelven a "no identificado". Esta acción es <strong>irreversible</strong>.`,
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

    this.polizaSvc.listBorradorCandidatasCompensacionesIntereses(rfc)
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

    this.polizaSvc.cancelarTodasCompensacionesIntereses({
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

  // Navega al registro real en Bancos del BankMovement del que salió esta línea de
  // débito — pasa volverA='compensaciones-intereses'/volverPolizaId para que
  // banks.component muestre el botón "Volver" que reabre esta póliza puntual (ver
  // ngOnInit arriba). Mismo patrón que poliza-traspasos.component.ts#irABanco.
  irABanco(m: PolizaMovimiento): void {
    const poliza = this.verModal.poliza;
    if (!poliza?.id || !m.id || this.resolviendoMovId) return;
    this.resolviendoMovId = m.id;
    this.polizaSvc.resolverBankMovimientoDeCompensacionIntereses(poliza.id, m.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ bankMovementId, banco }) => {
          this.resolviendoMovId = null;
          this.router.navigate(['/banks'], {
            queryParams: { banco, movId: bankMovementId, volverA: 'compensaciones-intereses', volverPolizaId: poliza.id },
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
    this.polizaSvc.exportarContpaqCompensacionesIntereses(poliza.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.exportando.delete(poliza.id!);
          const blob = response.body!;
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url;
          a.download = `Poliza_${poliza.tipo}${poliza.numero}_${poliza.fecha}_CONTPAQ.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err) => {
          this.exportando.delete(poliza.id!);
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
