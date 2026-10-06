import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { BankService } from '../../../../core/services/bank.service';
import { BankCorteConciliacion } from '../../../../core/models/bank.model';
import { ToastService } from '../../../../core/services/toast.service';
import { SocketService } from '../../../../core/services/socket.service';

export type CortePeriodo = 'semanal' | 'mensual';

/**
 * Slide del dashboard de Bancos — "corte" de conciliación (2026-10-02, pedido explícito
 * del usuario): control periódico de EQUIPO para que cobranza (semanal) y contabilidad
 * (mensual) sepan, del periodo en curso (lunes / día 1 del mes → ahora), cuántos depósitos
 * siguen rezagados de ANTES del periodo, cuántos nuevos llegaron y en qué estatus están, y
 * cuántos se identificaron — separado por si eran rezago viejo o del lote nuevo, para no
 * mezclarlos en un solo número.
 *
 * Periodo por rol (decisión de UX, mismo criterio que la visibilidad de slides del carousel
 * — ver bank-dashboard-carousel.component.ts): cobranza/contabilidad quedan fijos al periodo
 * configurado para su rol, cualquier otro rol (admin, etc.) puede alternar entre ambos. Desde
 * 2026-10-05 esta decisión la resuelve el BACKEND (GET /banks/cortes/periodo-rol, ver
 * bank-indicadores.service.js#getPeriodoCortePorRol — configurable desde Configuraciones
 * Globales), ya no `AuthService.hasRole()` acá: el backend conoce el rol autenticado y es
 * el único lado con permiso para leer Configuraciones Globales.
 *
 * Sin navegación a periodos pasados (confirmado con el usuario, AskUserQuestion) — siempre
 * el periodo EN CURSO, recargable con el resto del dashboard (banco/fetch perezoso por el
 * carousel padre), mismo patrón que los demás slides.
 *
 * Refresco en vivo (2026-10-05): si un admin cambia CORTE_PERIODO_COBRANZA/CONTABILIDAD desde
 * Configuraciones Globales mientras este panel ya está abierto, `config:updated` (socket, mismo
 * evento que usa config-admin.component.ts) invalida el fetch perezoso y vuelve a resolver
 * periodo-rol — sin esto, un usuario con la pestaña abierta se quedaría con el periodo viejo
 * hasta recargar.
 */
@Component({
  standalone: false,
  selector: 'app-bank-corte-panel',
  templateUrl: './bank-corte-panel.component.html',
  styleUrls: ['./bank-corte-panel.component.css'],
})
export class BankCortePanelComponent implements OnInit, OnDestroy {
  @Input() banco: string | null = null;

  data:    BankCorteConciliacion | null = null;
  loading = false;
  error   = false;

  periodoActivo: CortePeriodo = 'semanal';
  puedeAlternarPeriodo = false;
  descargandoReporte = false;

  // Corte histórico personalizado (2026-10-06, pedido explícito del usuario): ambos null =
  // modo tiempo real de siempre (periodo EN CURSO). Ambos vienen juntos o ninguno — ver
  // seleccionarFechaHistorica()/volverATiempoReal().
  fechaInicioCustom: string | null = null;
  fechaFinCustom:    string | null = null;

  private periodoRolCargado = false;
  private loadTrigger$ = new Subject<void>();
  private destroy$     = new Subject<void>();

  constructor(
    private bankService: BankService,
    private toast: ToastService,
    private socket: SocketService,
  ) {}

  ngOnInit(): void {
    // Si Configuraciones Globales cambia el periodo de ESTE rol mientras el panel ya está
    // abierto, invalida el fetch perezoso y vuelve a resolverlo — mismo patrón que
    // config-admin.component.ts con este mismo evento.
    this.socket.configUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ sectionClave, clave }) => {
        if (sectionClave === 'bancos' && (clave === 'CORTE_PERIODO_COBRANZA' || clave === 'CORTE_PERIODO_CONTABILIDAD')) {
          this.periodoRolCargado = false;
          this.loadTrigger$.next();
        }
      });

    this.loadTrigger$.pipe(
      switchMap(() => {
        this.loading = true;
        this.error   = false;
        // Periodo/puedeAlternar solo se piden UNA VEZ (fetch perezoso, igual que el resto de
        // este slide): no cambian durante la vida del componente, así que recargar banco o
        // alternar periodo manualmente no debe volver a pedirlos.
        const periodoRol$: Observable<void> = this.periodoRolCargado
          ? of(undefined)
          : this.bankService.periodoCorteRol().pipe(
              map(res => {
                this.periodoActivo      = res.periodo;
                this.puedeAlternarPeriodo = res.puedeAlternar;
                this.periodoRolCargado   = true;
              }),
            );
        return periodoRol$.pipe(
          switchMap(() => this.bankService.corteConciliacion(this.periodoActivo, this.banco, this.fechaInicioCustom, this.fechaFinCustom)),
          catchError(() => { this.error = true; return of(null); }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => {
      this.loading = false;
      if (res) this.data = res;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Dispara el fetch — llamado por el carousel (padre) al activar/recargar este slide. */
  load(banco?: string | null): void {
    if (banco !== undefined) this.banco = banco;
    this.loadTrigger$.next();
  }

  cambiarPeriodo(periodo: CortePeriodo): void {
    if (periodo === this.periodoActivo || !this.puedeAlternarPeriodo) return;
    this.periodoActivo = periodo;
    // Un rango histórico elegido en una granularidad (semana/mes) no tiene sentido en la
    // otra — que el usuario vuelva a elegir en la nueva granularidad en vez de arrastrar un
    // rango que ya no corresponde.
    this.fechaInicioCustom = null;
    this.fechaFinCustom    = null;
    this.loadTrigger$.next();
  }

  /** Dispara la carga de un corte histórico personalizado — el usuario hace click en
   *  CUALQUIER día de la semana/mes que quiere ver (vía app-date-range-popover en modo
   *  singleDayOnly), y se "ajusta" ese click al rango completo del periodo correspondiente. */
  seleccionarFechaHistorica(iso: string): void {
    const { fechaInicio, fechaFin } = this.snapAPeriodo(iso);
    this.fechaInicioCustom = fechaInicio;
    this.fechaFinCustom    = fechaFin;
    this.loadTrigger$.next();
  }

  /** Vuelve al modo tiempo real (periodo EN CURSO) — limpia el rango histórico custom. */
  volverATiempoReal(): void {
    this.fechaInicioCustom = null;
    this.fechaFinCustom    = null;
    this.loadTrigger$.next();
  }

  // Ajusta el día clickeado al rango completo semanal (lunes-domingo) o mensual (día 1-último),
  // MISMA convención de lunes que _inicioSemanaMexico() en bank-indicadores.service.js (backend).
  // Trabaja en fecha LOCAL del navegador (solo para computar qué semana/mes eligió el usuario al
  // hacer click en el calendario, no para el cálculo real del corte — eso lo hace el backend con
  // su propio offset fijo de México).
  private snapAPeriodo(iso: string): { fechaInicio: string; fechaFin: string } {
    const d = new Date(iso + 'T12:00:00');
    if (this.periodoActivo === 'mensual') {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const last  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { fechaInicio: this.toIso(first), fechaFin: this.toIso(last) };
    }
    const dow = d.getDay(); // 0=domingo..6=sábado
    const diasDesdeLunes = dow === 0 ? 6 : dow - 1;
    const lunes   = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diasDesdeLunes);
    const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
    return { fechaInicio: this.toIso(lunes), fechaFin: this.toIso(domingo) };
  }

  private toIso(d: Date): string {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** "lunes 5 de octubre" / "1 de octubre" — sin hora, sin año (el periodo nunca es tan
   *  viejo como para necesitarlo). `timeZone` explícito: el `inicio` que manda el backend
   *  ya es el instante UTC correcto de medianoche México, pero el navegador del usuario
   *  puede correr en cualquier TZ — sin esto, un navegador fuera de México podría mostrar
   *  el día anterior o siguiente. */
  formatInicio(inicioIso: string): string {
    const d = new Date(inicioIso);
    const texto = d.toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric', month: 'long',
      weekday: this.periodoActivo === 'semanal' ? 'long' : undefined,
    });
    return texto;
  }

  /** Análogo a formatInicio() para el cierre del corte histórico (`data.fin`). */
  formatFin(finIso: string): string {
    const d = new Date(finIso);
    return d.toLocaleDateString('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric', month: 'long',
      weekday: this.periodoActivo === 'semanal' ? 'long' : undefined,
    });
  }

  /** Mismo patrón que descargarBlob() en bank-cobranza-panel.component.ts: blob ->
   *  URL.createObjectURL -> click en <a> temporal -> revoke. */
  descargarReporte(): void {
    if (this.descargandoReporte) return;
    this.descargandoReporte = true;
    const fecha = new Date().toISOString().slice(0, 10);
    this.bankService.reporteCorte(this.periodoActivo, this.banco, this.fechaInicioCustom, this.fechaFinCustom).pipe(takeUntil(this.destroy$)).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `Corte-Conciliacion-${fecha}.xlsx`;
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
}
