import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subject, forkJoin, of } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { BankService } from '../../../../core/services/bank.service';
import { BankIndicadoresIdentificacion } from '../../../../core/models/bank.model';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService, AppUserRecord } from '../../../../core/services/user.service';
import { ToastService } from '../../../../core/services/toast.service';
import { formatPromedioHoras, promedioTone, promedioToneLabel, PromedioTone } from '../../shared/bank-tiempo-identificacion.util';

interface LoadRequest {
  banco:     string | null;
  categoria: string | null;
  year:      number | null;
  month:     number | null;
}

/**
 * Slide 3 del dashboard de Bancos — tiempo de identificación del equipo de COBRANZA
 * (2026-09-17, pedido explícito del usuario). A diferencia de Solicitudes de Cobro (que
 * mide desde una solicitud de la tienda), acá no hay un evento externo que dé el punto de
 * partida — reusa el indicador GENERAL (BankService#indicadores(), createdAt del propio
 * BankMovement → primeraIdentificacionAt) que quedó sin consumidor cuando se separó el
 * panel de Solicitudes de Cobro (ver bank-indicadores-panel.component.ts). Confirmado con
 * el usuario (AskUserQuestion): mide TODA identificación del equipo, sin importar la vía
 * (manual, cobro-panel, ficha, etc.) — no se excluyen fichas/traspasos/motores automáticos.
 *
 * Default de fecha (2026-09-18, pedido explícito del usuario): sin `year`/`month` (el caso
 * default, `banks.component#dashboardYear/Month` arrancan en null), el BACKEND ya NO
 * promedia todo el histórico desde INDICADORES_DESDE — se acota a HOY (México), anclado por
 * `primeraIdentificacionAt` (identificados hoy, no creados hoy — ver JSDoc de
 * getIndicadoresIdentificacion() en bank-indicadores.service.js para el porqué del ancla).
 * Este componente no recalcula nada — solo ajusta el subtítulo (`cob-dashboard-sub` en el
 * HTML) para que no diga "todo el histórico" cuando en realidad está mostrando hoy. Con
 * `year` explícito (período elegido por chips), el comportamiento es el de siempre.
 *
 * Rango de días + descarga (2026-09-18, pedido explícito del usuario: "el rango de fechas
 * que ya tiene Solicitudes de Cobro, para medir el día o días que se deseen y poder
 * descargar esta información") — calca el patrón de `rangoFechas()`/`descargarBlob()` de
 * `bank-indicadores-panel.component.ts` (panel hermano): `fechaInicioFiltro`/
 * `fechaFinFiltro` son estado LOCAL de este panel (NO `@Input()`, no dependen del carousel
 * padre) y, cuando el usuario elige un rango explícito vía `<app-date-range-popover>`, GANAN
 * sobre `year`/`month` y sobre el default "hoy" — mismo criterio de precedencia que el
 * backend (`_resolverMatchTiempo`, bank-indicadores.service.js). `descargarReporte()` pide
 * el Excel con EXACTAMENTE los mismos filtros que están en pantalla en ese momento.
 *
 * A diferencia del panel hermano, acá SÍ se reenvían banco/categoria al backend — el
 * indicador general sí los soporta (getIndicadoresIdentificacion), a diferencia de
 * CollectionRequest, que no se filtra por banco.
 *
 * Scope del equipo (decisión del backend, ver bank.routes.js#_resolverScopeUserIdBancos):
 * con permiso `banks:config` (contabilidad/admin) se puede acotar a ?userIds= elegidos a
 * mano, o dejarlo sin acotar (ve TODO el equipo de Numo, no solo cobranza); sin ese
 * permiso, el backend fuerza el scope al propio usuario sin importar qué se mande. Por
 * eso este panel NO deja "sin filtro" como comportamiento default para quien SÍ tiene el
 * permiso — a diferencia del panel de Solicitudes de Cobro, acá "sin filtro" significaría
 * mezclar tienda/otros roles con cobranza, exactamente lo que el usuario pidió evitar. El
 * default real (ver userIdsFiltro()) es "todo el equipo de cobranza con actividad real",
 * y el filtro de chips solo sirve para ACOTAR más, nunca para "quitar" el scope de equipo.
 *
 * Fetch perezoso: igual patrón que el panel hermano — el padre (carousel) llama a load()
 * cuando este slide se activa, nunca en ngOnInit.
 */
@Component({
  standalone: false,
  selector: 'app-bank-cobranza-panel',
  templateUrl: './bank-cobranza-panel.component.html',
  styleUrls: ['./bank-cobranza-panel.component.css'],
})
export class BankCobranzaPanelComponent implements OnInit, OnDestroy {
  @Input() banco:     string | null = null;
  @Input() categoria: string | null = null;
  @Input() year:      number | null = null;
  @Input() month:     number | null = null;

  data:    BankIndicadoresIdentificacion | null = null;
  loading = false;
  error   = false;

  private loadTrigger$ = new Subject<LoadRequest>();
  private destroy$     = new Subject<void>();

  // Último request disparado — se reusa para recargar cuando cambia SOLO el scope
  // (filtro de chips, o la corrección automática tras resolver cobranzaDisponibles),
  // sin depender de que los @Input() del carousel hayan cambiado.
  private ultimoRequest: LoadRequest = { banco: null, categoria: null, year: null, month: null };

  // Filtro por integrante del equipo — SOLO visible/relevante para quien tiene
  // `banks:config` (contabilidad/admin); para cualquier otro rol el backend fuerza el
  // scope al propio usuario sin importar qué mande el frontend, así que ni se calcula.
  // `cobranzaDisponibles` = intersección de rol actual 'cobranza' Y actividad real
  // (BankService#usuariosConIdentificaciones()) — a diferencia del filtro de Solicitudes
  // de Cobro (que terminó sacando el requisito de rol), acá el propósito explícito es
  // "ver al equipo de COBRANZA", así que el rol actual SÍ es parte del criterio para la
  // v1 — se puede ampliar más adelante si el usuario lo pide.
  cobranzaDisponibles:   AppUserRecord[] = [];
  cobranzaSeleccionados: string[] = [];

  get cobranzaParaSeleccionar(): AppUserRecord[] {
    return this.cobranzaDisponibles.filter(u => !this.cobranzaSeleccionados.includes(u.auth0Sub));
  }

  private static readonly POR_USUARIO_COLLAPSED_KEY = 'numo_bank_cobranza_collapsed';
  porUsuarioCollapsed = this.readPorUsuarioCollapsed();

  // Rango de días explícito (2026-09-18, ver JSDoc de clase) — estado LOCAL, igual criterio
  // que fechaInicioDescarga/fechaFinDescarga del panel hermano. Vacío = sin rango explícito
  // (cae a year/month/default-hoy, como siempre).
  fechaInicioFiltro = '';
  fechaFinFiltro    = '';
  descargandoReporte = false;

  constructor(
    private bankService: BankService,
    public auth: AuthService,
    private userService: UserService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadTrigger$.pipe(
      switchMap(req => {
        this.ultimoRequest = req;
        this.loading = true;
        this.error   = false;
        // Rango explícito gana sobre year/month (mismo criterio de precedencia que el
        // backend) — por prolijidad no se manda year/month si hay rango activo, aunque el
        // backend los ignoraría igual.
        const rangoActivo = this.fechaInicioFiltro && this.fechaFinFiltro;
        return this.bankService.indicadores(
          req.banco, req.categoria,
          rangoActivo ? null : req.year, rangoActivo ? null : req.month,
          this.userIdsFiltro(),
          this.fechaInicioFiltro || undefined, this.fechaFinFiltro || undefined,
        ).pipe(
          catchError(() => { this.error = true; return of(null); }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => {
      this.loading = false;
      if (res) this.data = res;
    });

    // Mismo criterio de "falla en silencio" que el filtro admin del panel hermano — no es
    // un dato crítico, no amerita estado de error propio ni bloquear el resto del panel.
    // banks:cobranza:all (2026-09-23, permiso nuevo): visibilidad de todo el equipo sin
    // necesitar banks:config completo — asignable por persona vía extraPermissions.
    if (this.auth.hasPermission('banks:config') || this.auth.hasPermission('banks:cobranza:all')) {
      forkJoin({
        users: this.userService.listUsers(),
        idsConActividad: this.bankService.usuariosConIdentificaciones(),
      }).pipe(takeUntil(this.destroy$)).subscribe({
        next: ({ users, idsConActividad }) => {
          const idsSet = new Set(idsConActividad.userIds);
          this.cobranzaDisponibles = users.filter(u => u.role === 'cobranza' && idsSet.has(u.auth0Sub));
          // El primer load() (disparado por el carousel) puede haber ocurrido ANTES de que
          // este forkJoin resolviera (es HTTP real, siempre async) — si todavía no hay un
          // filtro manual elegido, ese primer fetch salió sin scope de equipo (ve TODO
          // Numo). Se corrige recargando ahora que ya se conoce el equipo real, sin que el
          // usuario tenga que hacer nada. Si ya había un filtro manual, no lo pisa.
          if (this.cobranzaSeleccionados.length === 0) {
            this.loadTrigger$.next(this.ultimoRequest);
          }
        },
        error: () => {},
      });
    }
  }

  /** userIds a mandar al service: filtro manual explícito si hay uno; si no, TODO el
   *  equipo de cobranza con actividad real (nunca "sin filtro" para quien tiene
   *  banks:config — eso mezclaría otros roles); undefined si `cobranzaDisponibles` todavía
   *  no se resolvió o el usuario no tiene el permiso (el backend decide el scope solo). */
  private userIdsFiltro(): string[] | undefined {
    if (this.cobranzaSeleccionados.length) return this.cobranzaSeleccionados;
    if (this.cobranzaDisponibles.length)   return this.cobranzaDisponibles.map(u => u.auth0Sub);
    return undefined;
  }

  /** Rango elegido en `<app-date-range-popover>` — vacío ({fechaInicio:'',fechaFin:''}) al
   *  limpiar, igual criterio que el panel hermano. Recarga con el request más reciente
   *  (mismo patrón que agregarCobranzaFiltro/quitarCobranzaFiltro). */
  onRangoFechasChange({ fechaInicio, fechaFin }: { fechaInicio: string; fechaFin: string }): void {
    this.fechaInicioFiltro = fechaInicio;
    this.fechaFinFiltro    = fechaFin;
    this.loadTrigger$.next(this.ultimoRequest);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide. */
  load(banco?: string | null, categoria?: string | null, year?: number | null, month?: number | null): void {
    this.loadTrigger$.next({
      banco:     banco     !== undefined ? banco     : this.banco,
      categoria: categoria !== undefined ? categoria : this.categoria,
      year:      year      !== undefined ? year      : this.year,
      month:     month     !== undefined ? month     : this.month,
    });
  }

  promedioTone(horas: number): PromedioTone { return promedioTone(horas); }
  promedioToneLabel(tone: PromedioTone): string { return promedioToneLabel(tone); }
  formatPromedio(horas: number): string { return formatPromedioHoras(horas); }

  nombreCobranza(auth0Sub: string): string {
    return this.cobranzaDisponibles.find(u => u.auth0Sub === auth0Sub)?.nombre ?? auth0Sub;
  }

  agregarCobranzaFiltro(auth0Sub: string): void {
    if (!auth0Sub || this.cobranzaSeleccionados.includes(auth0Sub)) return;
    this.cobranzaSeleccionados = [...this.cobranzaSeleccionados, auth0Sub];
    this.loadTrigger$.next(this.ultimoRequest);
  }

  quitarCobranzaFiltro(auth0Sub: string): void {
    this.cobranzaSeleccionados = this.cobranzaSeleccionados.filter(id => id !== auth0Sub);
    this.loadTrigger$.next(this.ultimoRequest);
  }

  toggleUsuarioTabla(): void {
    this.porUsuarioCollapsed = !this.porUsuarioCollapsed;
    try {
      localStorage.setItem(BankCobranzaPanelComponent.POR_USUARIO_COLLAPSED_KEY, String(this.porUsuarioCollapsed));
    } catch {
      // localStorage puede fallar en modo privado/cuota llena — la preferencia simplemente no persiste.
    }
  }

  private readPorUsuarioCollapsed(): boolean {
    try {
      const v = localStorage.getItem(BankCobranzaPanelComponent.POR_USUARIO_COLLAPSED_KEY);
      // Colapsada por default (a diferencia de "Reparto por fase" del panel hermano, que
      // es la protagonista de ESE panel) — mismo criterio que tenía "Promedio por usuario"
      // antes de eliminarse del panel general (ver memoria del proyecto).
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  }

  /** Mismo patrón que descargarBlob() en bank-indicadores-panel.component.ts: blob ->
   *  URL.createObjectURL -> click en <a> temporal -> revoke. Solo 2 usos en todo el
   *  módulo (este panel + el hermano) — no amerita extraerlo a un servicio compartido. */
  private descargarBlob(fetch$: Observable<Blob>, nombreArchivo: string): void {
    if (this.descargandoReporte) return;
    this.descargandoReporte = true;
    fetch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = nombreArchivo;
        a.click();
        URL.revokeObjectURL(url);
        this.descargandoReporte = false;
      },
      error: () => {
        this.descargandoReporte = false;
        this.toast.error('No se pudo generar el reporte.');
      },
    });
  }

  /** Descarga el Excel con EXACTAMENTE los mismos filtros activos en pantalla (banco/
   *  categoria/scope + rango explícito o year/month, misma precedencia que el fetch de
   *  pantalla — ver ngOnInit). */
  descargarReporte(): void {
    const rangoActivo = this.fechaInicioFiltro && this.fechaFinFiltro;
    const fecha = new Date().toISOString().slice(0, 10);
    this.descargarBlob(
      this.bankService.reporteIndicadores(
        this.ultimoRequest.banco, this.ultimoRequest.categoria,
        rangoActivo ? null : this.ultimoRequest.year, rangoActivo ? null : this.ultimoRequest.month,
        this.fechaInicioFiltro || undefined, this.fechaFinFiltro || undefined,
        this.userIdsFiltro(),
      ),
      `Cobranza-Identificacion-${fecha}.xlsx`,
    );
  }
}
