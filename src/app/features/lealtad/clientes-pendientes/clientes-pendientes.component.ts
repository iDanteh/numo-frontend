import { Component, OnInit } from '@angular/core';
import { LoyaltyService, LoyaltyPendingEnrollment } from '../../../core/services/loyalty.service';
import { TELEFONO_RE, escapeHtml } from '../lealtad.constants';

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

  // Confirmación vía app-confirm-modal (mismo patrón que tarjetas-list/
  // tarjeta-detail para "Cambiar NIP") en vez de confirm() nativo del
  // navegador — consistente con el resto del módulo y auditable/testeable.
  confirmRechazarCard: LoyaltyPendingEnrollment | null = null;
  confirmRechazarTodos = false;

  // Salida animada al completar/rechazar (ver .cp-card--saliendo) — confirma
  // visualmente que la acción tuvo efecto, importante sobre todo para
  // "Rechazar", que es irreversible, antes de sacar la fila del array.
  salientes: Record<number, boolean> = {};
  private readonly SALIDA_MS = 280;

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
    if (!TELEFONO_RE.test(telefono)) {
      this.errorPorFila[pendiente.id] = 'El teléfono debe tener 10 dígitos.';
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
        this.quitarConAnimacion(pendiente.id);
        this.total = Math.max(0, this.total - 1);
      },
      error: (err) => {
        this.completando[pendiente.id] = false;
        this.errorPorFila[pendiente.id] = err?.error?.error || 'No se pudo completar el registro.';
      },
    });
  }

  /** Pide confirmación antes de rechazar (irreversible) — abre el modal,
   *  confirmarRechazar() ejecuta la acción real. */
  rechazar(pendiente: LoyaltyPendingEnrollment): void {
    this.confirmRechazarCard = pendiente;
  }

  cerrarConfirmRechazar(): void {
    this.confirmRechazarCard = null;
  }

  // app-confirm-modal bindea [msg] con [innerHTML] — nombre es texto libre
  // (viene de clientes.csv importado), hay que escaparlo antes de concatenar
  // el <strong>, mismo criterio que confirmNipMsg en tarjetas-list.
  get confirmRechazarMsg(): string {
    if (!this.confirmRechazarCard) return '';
    const nombreSeguro = escapeHtml(this.confirmRechazarCard.nombre || 'este cliente');
    const saldo = this.confirmRechazarCard.saldoLegado.toLocaleString('es-MX');
    return `¿Rechazar a <strong>${nombreSeguro}</strong>? Ya no se le creará una tarjeta ni se le acreditará su saldo legado de ${saldo} puntos.`;
  }

  /** Rechazo individual (2026-10-19) — el admin decide que este cliente legado
   *  ya no se va a migrar. Thin wrapper: toda la regla de negocio vive en
   *  LoyaltyService.rechazarPendiente()/backend. */
  confirmarRechazar(): void {
    const pendiente = this.confirmRechazarCard;
    if (!pendiente) return;
    this.confirmRechazarCard = null;

    this.rechazando[pendiente.id] = true;
    this.errorPorFila[pendiente.id] = '';

    this.loyalty.rechazarPendiente(pendiente.id).subscribe({
      next: () => {
        this.rechazando[pendiente.id] = false;
        // Mismo patrón que completar(): se quita de la lista en vez de recargar.
        this.quitarConAnimacion(pendiente.id);
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
    if (!this.total) return;
    this.confirmRechazarTodos = true;
  }

  cerrarConfirmRechazarTodos(): void {
    this.confirmRechazarTodos = false;
  }

  // `total` viene de la paginación del backend (número, no texto libre de
  // usuario) — no necesita escapeHtml, a diferencia de confirmRechazarMsg.
  get confirmRechazarTodosMsg(): string {
    return `Esto va a rechazar los ${this.total} clientes pendientes actuales (en TODAS las páginas, no solo la que estás viendo). `
      + 'Ya no se les creará tarjeta ni se les acreditará su saldo legado. Esta acción no se puede deshacer fácilmente.';
  }

  confirmarRechazarTodos(): void {
    this.confirmRechazarTodos = false;

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

  private quitarConAnimacion(id: number): void {
    this.salientes[id] = true;
    const ms = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : this.SALIDA_MS;
    setTimeout(() => {
      this.pendientes = this.pendientes.filter((p) => p.id !== id);
      delete this.salientes[id];
    }, ms);
  }
}
