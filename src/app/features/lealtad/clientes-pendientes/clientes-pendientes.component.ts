import { Component, OnInit } from '@angular/core';
import { LoyaltyService, LoyaltyPendingEnrollment } from '../../../core/services/loyalty.service';

/**
 * Clientes pendientes de teléfono — decisión de negocio 2026-10-19: clientes
 * legados ("Club Tuberos") sin Celular NI Telefono en clientes.csv quedan acá
 * (loyalty_pending_enrollments) en vez de descartarse. Se marcan en AMARILLO
 * (pedido explícito del usuario) para que el admin les actualice el dato y
 * complete el registro — eso crea la LoyaltyCard real y acredita el saldo
 * legado (ver loyalty-import-apply.service.js#completarRegistroPendiente).
 * Gateado por loyalty:importar (admin-only), mismo permiso que importar-clientes.
 */
@Component({
  standalone: false,
  selector: 'app-clientes-pendientes',
  templateUrl: './clientes-pendientes.component.html',
  styleUrls: ['./clientes-pendientes.component.css'],
})
export class ClientesPendientesComponent implements OnInit {
  pendientes: LoyaltyPendingEnrollment[] = [];
  loading = false;
  error = '';

  page = 1;
  pages = 1;
  total = 0;
  readonly limit = 20;

  // Teléfono en edición por fila (id → valor del input) — evita un FormGroup
  // por fila para un formulario de un solo campo.
  telefonoPorFila: Record<number, string> = {};
  completando: Record<number, boolean> = {};
  errorPorFila: Record<number, string> = {};

  // Estado del flujo de rechazo (2026-10-19) — mismo criterio sin FormGroup.
  rechazando: Record<number, boolean> = {};
  rechazandoTodos = false;
  ultimoRechazoMsg: string | null = null;

  constructor(private loyalty: LoyaltyService) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.listarPendientes(this.page, this.limit).subscribe({
      next: (res) => {
        this.pendientes = res.pendientes;
        this.pages = res.pages;
        this.total = res.total;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudieron cargar los clientes pendientes.';
      },
    });
  }

  cambiarPagina(delta: number): void {
    const nueva = this.page + delta;
    if (nueva < 1 || nueva > this.pages) return;
    this.page = nueva;
    this.cargar();
  }

  completar(pendiente: LoyaltyPendingEnrollment): void {
    const telefono = (this.telefonoPorFila[pendiente.id] ?? '').trim();
    if (!telefono) {
      this.errorPorFila[pendiente.id] = 'Captura un teléfono.';
      return;
    }

    this.completando[pendiente.id] = true;
    this.errorPorFila[pendiente.id] = '';

    this.loyalty.completarPendiente(pendiente.id, telefono).subscribe({
      next: () => {
        this.completando[pendiente.id] = false;
        delete this.telefonoPorFila[pendiente.id];
        // El registro ya no es 'pendiente' — se quita de la lista en vez de
        // recargar toda la página (menos parpadeo, mismo resultado visible).
        this.pendientes = this.pendientes.filter((p) => p.id !== pendiente.id);
        this.total = Math.max(0, this.total - 1);
      },
      error: (err) => {
        this.completando[pendiente.id] = false;
        this.errorPorFila[pendiente.id] = err?.error?.error || 'No se pudo completar el registro.';
      },
    });
  }

  /** Rechazo individual (2026-10-19) — el admin decide que este cliente legado
   *  ya no se va a migrar. Thin wrapper: toda la regla de negocio vive en
   *  LoyaltyService.rechazarPendiente()/backend. */
  rechazar(pendiente: LoyaltyPendingEnrollment): void {
    const confirmado = confirm(
      `¿Rechazar a ${pendiente.nombre || 'este cliente'}? Ya no se le creará una tarjeta ni se le acreditará su saldo legado de ${pendiente.saldoLegado.toLocaleString('es-MX')} puntos.`
    );
    if (!confirmado) return;

    this.rechazando[pendiente.id] = true;
    this.errorPorFila[pendiente.id] = '';

    this.loyalty.rechazarPendiente(pendiente.id).subscribe({
      next: () => {
        this.rechazando[pendiente.id] = false;
        // Mismo patrón que completar(): se quita de la lista en vez de recargar.
        this.pendientes = this.pendientes.filter((p) => p.id !== pendiente.id);
        this.total = Math.max(0, this.total - 1);
      },
      error: (err) => {
        this.rechazando[pendiente.id] = false;
        this.errorPorFila[pendiente.id] = err?.error?.error || 'No se pudo rechazar el registro.';
      },
    });
  }

  /** Rechazo masivo (2026-10-19) — un solo UPDATE en el backend, sin job.
   *  Bug real corregido: el conteo y la confirmación usan `this.total` (el total REAL de
   *  pendientes en todo el sistema, viene de la paginación del backend), NUNCA
   *  `this.pendientes.length` — esa variable solo trae los de la página actual (20 por
   *  default). El backend rechaza TODOS los pendientes, sin importar la página que esté
   *  viendo el admin, así que mostrarle "se van a rechazar 20" cuando en realidad son
   *  cientos sería un diálogo de confirmación que miente sobre el alcance real. */
  rechazarTodos(): void {
    const n = this.total;
    if (!n) return;

    const confirmado = confirm(
      `Esto va a rechazar los ${n} clientes pendientes actuales (en TODAS las páginas, no solo la que estás viendo). `
      + 'Ya no se les creará tarjeta ni se les acreditará su saldo legado. Esta acción no se puede deshacer fácilmente. ¿Confirmas?'
    );
    if (!confirmado) return;

    this.rechazandoTodos = true;
    this.ultimoRechazoMsg = null;
    this.error = '';

    this.loyalty.rechazarTodosPendientes().subscribe({
      next: (res) => {
        this.rechazandoTodos = false;
        this.pendientes = [];
        this.total = 0;
        this.pages = 1;
        this.ultimoRechazoMsg = `${res.rechazados} registros rechazados.`;
      },
      error: (err) => {
        this.rechazandoTodos = false;
        this.error = err?.error?.error || 'No se pudieron rechazar los clientes pendientes.';
      },
    });
  }
}
