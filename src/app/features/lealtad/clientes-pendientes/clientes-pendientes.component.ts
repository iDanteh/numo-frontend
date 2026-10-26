import { Component, OnInit } from '@angular/core';
import { LoyaltyService, LoyaltyPendingEnrollment, LoyaltyPendingEnrollmentGrupo } from '../../../core/services/loyalty.service';
import { TELEFONO_RE, escapeHtml } from '../lealtad.constants';

/**
 * Clientes pendientes de teléfono — decisión de negocio 2026-10-19: clientes
 * legados ("Club Tuberos") sin Celular NI Telefono en clientes.csv quedan acá
 * (loyalty_pending_enrollments) en vez de descartarse. Se marcan en AMARILLO
 * (pedido explícito del usuario) para que el admin les actualice el dato y
 * complete el registro — eso crea la LoyaltyCard real y acredita el saldo
 * legado (ver loyalty-import-apply.service.js#completarRegistroPendiente).
 * Gateado por loyalty:importar (admin-only), mismo permiso que importar-clientes.
 *
 * Ampliado 2026-10-23 (pedido explícito del usuario): también recibe registros de motivo
 * 'telefono_duplicado' (2+ Tarjetas legadas distintas que comparten el mismo teléfono),
 * agrupados por `grupoId` — el backend pagina por GRUPO, no por fila (ver listarPendientes() en
 * loyalty-import-apply.service.js), así un par en conflicto nunca queda partido entre dos
 * páginas. Las filas de motivo 'sin_telefono' siguen viniendo cada una en su propio grupo de 1,
 * así que la UI para ellas es idéntica a antes — el wrapper visual de "conflicto" (.cp-grupo) solo
 * aparece cuando un grupo tiene 2+ items.
 */
@Component({
  standalone: false,
  selector: 'app-clientes-pendientes',
  templateUrl: './clientes-pendientes.component.html',
  styleUrls: ['./clientes-pendientes.component.css'],
})
export class ClientesPendientesComponent implements OnInit {
  grupos: LoyaltyPendingEnrollmentGrupo[] = [];
  loading = false;
  error = '';

  page = 1;
  pages = 1;
  total = 0; // cantidad de GRUPOS (para paginación) — ver totalRegistros para la cantidad de filas reales.
  totalRegistros = 0;
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

  // Exportación a Excel (2026-10-26, pedido explícito del usuario): comparte el padrón completo de
  // pendientes para resolverlo a mano fuera del sistema. Mismo patrón 100% frontend (exceljs
  // dinámico) que descargarBloqueantes()/_descargarExcelKoreMatch() en importar-clientes.component.
  exportando = false;
  errorExportar = '';

  private static readonly MOTIVO_LABEL: Record<string, string> = {
    sin_telefono: 'Sin teléfono',
    telefono_duplicado: 'Teléfono duplicado',
  };

  constructor(private loyalty: LoyaltyService) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.loading = true;
    this.error = '';
    this.loyalty.listarPendientes(this.page, this.limit).subscribe({
      next: (res) => {
        this.grupos = res.grupos;
        this.pages = res.pages;
        this.total = res.total;
        this.totalRegistros = res.totalRegistros;
        // Prellena el input de teléfono con el candidato que ya traía el CSV (motivo
        // 'telefono_duplicado') — el admin lo confirma tal cual o lo corrige antes de completar.
        // Nunca pisa un valor que el admin ya esté editando (en la práctica siempre vacío en la
        // primera carga, pero más seguro no asumirlo).
        for (const grupo of this.grupos) {
          for (const item of grupo.items) {
            if (item.telefonoCandidato && !(item.id in this.telefonoPorFila)) {
              this.telefonoPorFila[item.id] = item.telefonoCandidato;
            }
          }
        }
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'No se pudieron cargar los clientes pendientes.';
      },
    });
  }

  /** Tamaño del grupo al que pertenece esta fila — usado por completar()/confirmarRechazar() para
   *  saber si sacarla del grupo también reduce `total` (grupos) o solo `totalRegistros` (filas). */
  private _tamanoGrupoDe(id: number): number {
    const grupo = this.grupos.find((g) => g.items.some((p) => p.id === id));
    return grupo?.items.length ?? 0;
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

    // Tamaño del grupo ANTES de quitar la fila — si era el último item, el grupo entero
    // desaparece y `total` (grupos) también baja; si no, solo baja `totalRegistros` (filas).
    const eraUltimoDelGrupo = this._tamanoGrupoDe(pendiente.id) <= 1;

    this.loyalty.completarPendiente(pendiente.id, telefono).subscribe({
      next: () => {
        this.completando[pendiente.id] = false;
        delete this.telefonoPorFila[pendiente.id];
        // El registro ya no es 'pendiente' — se quita de la lista en vez de
        // recargar toda la página (menos parpadeo, mismo resultado visible).
        this.quitarConAnimacion(pendiente.id);
        this.totalRegistros = Math.max(0, this.totalRegistros - 1);
        if (eraUltimoDelGrupo) this.total = Math.max(0, this.total - 1);
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

    // Mismo criterio que completar(): ver comentario ahí.
    const eraUltimoDelGrupo = this._tamanoGrupoDe(pendiente.id) <= 1;

    this.loyalty.rechazarPendiente(pendiente.id).subscribe({
      next: () => {
        this.rechazando[pendiente.id] = false;
        // Mismo patrón que completar(): se quita de la lista en vez de recargar.
        this.quitarConAnimacion(pendiente.id);
        this.totalRegistros = Math.max(0, this.totalRegistros - 1);
        if (eraUltimoDelGrupo) this.total = Math.max(0, this.total - 1);
      },
      error: (err) => {
        this.rechazando[pendiente.id] = false;
        this.errorPorFila[pendiente.id] = err?.error?.error || 'No se pudo rechazar el registro.';
      },
    });
  }

  /** Rechazo masivo (2026-10-19) — un solo UPDATE en el backend, sin job.
   *  Bug real corregido: el conteo y la confirmación usan `this.totalRegistros` (el total REAL de
   *  FILAS pendientes en todo el sistema, viene de la paginación del backend), NUNCA
   *  `this.grupos.length`/el total de GRUPOS de la página actual. El backend rechaza TODOS los
   *  pendientes, sin importar la página que esté viendo el admin, así que mostrarle un número que
   *  no sea el real (ni de grupos ni de la página actual) sería un diálogo de confirmación que
   *  miente sobre el alcance real. */
  rechazarTodos(): void {
    if (!this.totalRegistros) return;
    this.confirmRechazarTodos = true;
  }

  cerrarConfirmRechazarTodos(): void {
    this.confirmRechazarTodos = false;
  }

  // `totalRegistros` viene de la paginación del backend (número, no texto libre de
  // usuario) — no necesita escapeHtml, a diferencia de confirmRechazarMsg.
  get confirmRechazarTodosMsg(): string {
    return `Esto va a rechazar los ${this.totalRegistros} clientes pendientes actuales (en TODAS las páginas, no solo la que estás viendo). `
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
        this.grupos = [];
        this.total = 0;
        this.totalRegistros = 0;
        this.pages = 1;
        this.ultimoRechazoMsg = `${res.rechazados} registros rechazados.`;
      },
      error: (err) => {
        this.rechazandoTodos = false;
        this.error = err?.error?.error || 'No se pudieron rechazar los clientes pendientes.';
      },
    });
  }

  /** Exporta TODOS los pendientes (no solo la página actual) a un único Excel, agrupados igual
   *  que en pantalla: una columna "Grupo" con el teléfono en conflicto (vacía para los pendientes
   *  sueltos) para que los 2+ clientes que comparten teléfono queden identificables al ordenar o
   *  filtrar, y una fila resaltada para esos grupos — mismo criterio visual que .cp-grupo acá. */
  exportarExcel(): void {
    if (this.exportando) return;
    this.exportando = true;
    this.errorExportar = '';

    this.loyalty.exportarPendientes().subscribe({
      next: async (res) => {
        try {
          await this._generarExcel(res.grupos);
        } catch (err) {
          this.errorExportar = 'No se pudo generar el Excel.';
          // eslint-disable-next-line no-console -- sin Sentry/ErrorHandler en el frontend (mismo
          // criterio que importar-clientes.component), la consola es el único rastro disponible.
          console.error('[ClientesPendientes] Falló la generación del Excel:', err);
        } finally {
          this.exportando = false;
        }
      },
      error: (err) => {
        this.exportando = false;
        this.errorExportar = err?.error?.error || 'No se pudieron traer los pendientes para exportar.';
      },
    });
  }

  private async _generarExcel(grupos: LoyaltyPendingEnrollmentGrupo[]): Promise<void> {
    const ExcelJS = await import('exceljs').then((m) => m.default ?? m);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clientes pendientes');

    ws.columns = [
      { header: 'Grupo (teléfono en conflicto)', key: 'grupo', width: 26 },
      { header: 'Nombre', key: 'nombre', width: 32 },
      { header: 'Correo', key: 'correo', width: 28 },
      { header: 'Teléfono candidato', key: 'telefonoCandidato', width: 18 },
      { header: 'Tarjeta legada', key: 'tarjetaLegada', width: 16 },
      { header: 'Saldo legado', key: 'saldoLegado', width: 14 },
      { header: 'Nivel sugerido', key: 'nivelSugerido', width: 14 },
      { header: 'Motivo', key: 'motivo', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };

    const FILL_CONFLICTO = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF3CD' } };

    for (const grupo of grupos) {
      const enConflicto = grupo.items.length > 1;
      for (const p of grupo.items) {
        const row = ws.addRow({
          grupo: grupo.grupoId || '',
          nombre: p.nombre || '',
          correo: p.correo || '',
          telefonoCandidato: p.telefonoCandidato || '',
          tarjetaLegada: p.tarjetaLegada || '',
          saldoLegado: Number(p.saldoLegado),
          nivelSugerido: p.nivelSugerido,
          motivo: ClientesPendientesComponent.MOTIVO_LABEL[p.motivo] || p.motivo,
        });
        if (enConflicto) row.eachCell((cell) => { cell.fill = FILL_CONFLICTO; });
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lealtad-clientes-pendientes-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private quitarConAnimacion(id: number): void {
    this.salientes[id] = true;
    const ms = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : this.SALIDA_MS;
    setTimeout(() => {
      // Saca la fila de DENTRO de su grupo — si el grupo queda vacío, se saca el grupo entero.
      this.grupos = this.grupos
        .map((g) => ({ ...g, items: g.items.filter((p) => p.id !== id) }))
        .filter((g) => g.items.length > 0);
      delete this.salientes[id];
    }, ms);
  }
}
