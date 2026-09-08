import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { BankMovement } from '../../../../core/models/bank.model';
import {
  CajaTransferenciaBandeja, CajaTransferenciaPendiente, CajaTransferenciaCandidatoMovimiento,
} from '../../../../core/models/caja-transferencia.model';

@Component({
  standalone: false,
  selector: 'app-transferencias-caja-panel',
  templateUrl: './transferencias-caja-panel.component.html',
  styleUrls: ['./transferencias-caja-panel.component.css'],
})
export class TransferenciasCajaPanelComponent implements OnChanges {
  @Input() visible = false;
  @Output() closed = new EventEmitter<void>();
  // El padre (banks.component) ya tiene el erp-modal existente (ficha + comprobante
  // de respaldo) — reusamos ESE modal en vez de duplicar su UI acá. Este panel solo
  // pregunta y, si el usuario acepta, reenvía el movimiento recién confirmado.
  @Output() abrirFicha = new EventEmitter<BankMovement>();

  bandeja: CajaTransferenciaBandeja | null = null;
  loading = false;
  error: string | null = null;

  // Buscador por importe (parcial, no exacto) — pedido explícito del usuario: escribir
  // "100" debe encontrar 10000, 1000.50, etc. Se normaliza a solo dígitos (se ignoran
  // puntos/comas) para que no importe cómo el usuario tipee el número.
  montoFiltro = '';

  // Filtro por candidatos (pedido explícito del usuario): "con" incluye TANTO 1 candidato
  // como ambiguos (2+) — el criterio es "tiene algo que revisar", no una cantidad exacta.
  candidatoFiltro: 'todos' | 'con' | 'sin' = 'todos';

  // _id de la transferencia con una confirmación en curso — deshabilita SOLO sus propios
  // botones (evita doble-click sobre el mismo grupo mientras el resto de la bandeja sigue usable).
  confirmandoId: string | null = null;
  confirmError: string | null = null;

  // Mensaje flotante tras confirmar un match — pedido explícito del usuario: ofrecer
  // cargar la ficha + comprobante de una vez, sin que el usuario tenga que ir a buscar
  // el movimiento manualmente en la tabla principal de Bancos.
  postConfirmPrompt: { movimiento: BankMovement } | null = null;

  // CORRECCIÓN 2026-09-08 (pedido explícito del usuario): cuando hay 2+ candidatos
  // empatados en monto, mostrarlos todos SIEMPRE expandidos hacía crecer la tarjeta sin
  // límite y desplazaba el resto de la bandeja. Ahora quedan colapsados por defecto (cero
  // desplazamiento al cargar) — el usuario decide expandir, y ahí adentro elige UNA opción
  // (radio) antes de poder confirmar, en vez de un botón "Confirmar" por cada candidato.
  private _expandidas   = new Set<string>();
  private _seleccionAmbiguo = new Map<string, number>();

  estaExpandido(transferenciaId: string): boolean {
    return this._expandidas.has(transferenciaId);
  }

  toggleExpandido(transferenciaId: string): void {
    if (this._expandidas.has(transferenciaId)) this._expandidas.delete(transferenciaId);
    else this._expandidas.add(transferenciaId);
  }

  seleccionActiva(transferenciaId: string): number | null {
    return this._seleccionAmbiguo.get(transferenciaId) ?? null;
  }

  seleccionar(transferenciaId: string, index: number): void {
    this._seleccionAmbiguo.set(transferenciaId, index);
  }

  confirmarSeleccionActiva(item: CajaTransferenciaPendiente): void {
    const idx = this.seleccionActiva(item.transferencia._id);
    if (idx === null) return;
    this.confirmar(item, item.candidatos[idx]);
  }

  // Sincronización manual (banks:admin) — pedido explícito del usuario 2026-09-01: elegir
  // fechaDesde/fechaHasta a mano en vez de esperar al cron diario.
  syncFechaDesde = '';
  syncFechaHasta = '';
  syncing        = false;
  syncError:   string | null = null;
  syncResultado: { sincronizadas: number; descartadas: number } | null = null;

  constructor(
    private bankService: BankService,
    public  auth:        AuthService,
  ) {}

  // Bug real (reportado por el usuario): con el guard "!this.bandeja" original, reabrir el
  // panel en la MISMA sesión (sin recargar la página) mostraba la bandeja vieja, cacheada
  // desde la primera apertura — un movimiento recién importado (o una transferencia recién
  // sincronizada) no aparecía como candidato hasta refrescar el navegador. Mismo criterio que
  // report-panel/rules-panel: recargar SIEMPRE que el panel se vuelve a mostrar.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) this._cargar();
  }

  private _cargar(): void {
    this.loading = true;
    this.error   = null;
    this.bankService.getTransferenciasCajaBandeja().subscribe({
      next: (bandeja) => { this.bandeja = bandeja; this.loading = false; },
      error: (err) => {
        this.error   = err?.error?.error || 'Error al cargar las transferencias entre cajas';
        this.loading = false;
      },
    });
  }

  recargar(): void {
    this.bandeja = null;
    this._cargar();
  }

  cerrar(): void {
    this.closed.emit();
  }

  sumaGrupo(grupo: CajaTransferenciaCandidatoMovimiento[]): number {
    return grupo.reduce((acc, m) => acc + (m.deposito ?? 0), 0);
  }

  private _normalizarMonto(valor: number | string): string {
    return String(valor).replace(/[^\d]/g, '');
  }

  // CORRECCIÓN 2026-09-08 (bug real, reportado por el usuario): quitar solo los
  // caracteres no-dígito de un filtro con decimales explícitos (ej. "1200.00")
  // AGREGA ceros de más — "1200.00" se convertía en "120000", que ya no calzaba
  // con "1200" (cómo JS serializa el número 1200, sin ceros decimales). Si el
  // filtro trae un punto (separador decimal, mismo criterio que el resto de la
  // app — la coma es separador de miles, ej. "$10,000.00"), se interpreta como
  // el NÚMERO que representa y se re-normaliza con el MISMO criterio que el
  // monto real, para que "1200.00" y "1000.50" calcen exacto contra 1200 y
  // 1000.50 tal como los serializa JS.
  private _normalizarFiltro(filtro: string): string {
    const trimmed = filtro.trim();
    if (trimmed.includes('.')) {
      const limpio = trimmed.replace(/[^\d.]/g, '');
      const numero = parseFloat(limpio);
      if (!Number.isNaN(numero)) return this._normalizarMonto(numero);
    }
    return trimmed.replace(/[^\d]/g, '');
  }

  get pendientesFiltrados(): CajaTransferenciaPendiente[] {
    let pendientes = this.bandeja?.pendientes ?? [];

    const filtro = this._normalizarFiltro(this.montoFiltro);
    if (filtro) pendientes = pendientes.filter(p => this._normalizarMonto(p.transferencia.monto).includes(filtro));

    if (this.candidatoFiltro === 'con') pendientes = pendientes.filter(p => p.candidatos.length > 0);
    else if (this.candidatoFiltro === 'sin') pendientes = pendientes.filter(p => p.candidatos.length === 0);

    return pendientes;
  }

  confirmar(item: CajaTransferenciaPendiente, grupo: CajaTransferenciaCandidatoMovimiento[]): void {
    if (this.confirmandoId) return;
    this.confirmandoId = item.transferencia._id;
    this.confirmError  = null;

    this.bankService.confirmarTransferenciaCajaMatch(
      item.transferencia._id, grupo.map(m => m._id),
    ).subscribe({
      next: (res) => {
        this.confirmandoId = null;
        // Quita esta transferencia de "pendientes" — ya no aplica sin recargar toda la
        // bandeja (los candidatos de las demás no cambiaron).
        if (this.bandeja) {
          this.bandeja = {
            ...this.bandeja,
            pendientes: this.bandeja.pendientes.filter(p => p.transferencia._id !== item.transferencia._id),
          };
        }
        this._expandidas.delete(item.transferencia._id);
        this._seleccionAmbiguo.delete(item.transferencia._id);
        const movimiento = res.movimientos?.[0];
        if (movimiento) this.postConfirmPrompt = { movimiento };
      },
      error: (err) => {
        this.confirmandoId = null;
        this.confirmError  = err?.error?.error || 'Error al confirmar el match';
      },
    });
  }

  cargarFichaAhora(): void {
    if (this.postConfirmPrompt) this.abrirFicha.emit(this.postConfirmPrompt.movimiento);
    this.postConfirmPrompt = null;
  }

  descartarPrompt(): void {
    this.postConfirmPrompt = null;
  }

  sincronizarManual(): void {
    if (this.syncing || !this.syncFechaDesde || !this.syncFechaHasta) return;
    this.syncing        = true;
    this.syncError      = null;
    this.syncResultado  = null;

    this.bankService.sincronizarTransferenciasCajaManual(this.syncFechaDesde, this.syncFechaHasta).subscribe({
      next: (resultado) => {
        this.syncing       = false;
        this.syncResultado = resultado;
        this.recargar();
      },
      error: (err) => {
        this.syncing   = false;
        this.syncError = err?.error?.error || 'Error al sincronizar el rango elegido';
      },
    });
  }

}
