import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  BankService, BankMovement, ErpCxC, ErpLink, ErpFormaPago,
  CobroBanco, CobroConcepto, AplicarCobroPayload, AplicarCobroPayloadMulti, DetalleFormaPago, ErpSaldoFavor,
  KoreCuentaPPD, KoreDescuento, DesgloseFormaPago,
} from '../../../../core/services/bank.service';
import { ErpModalComponent } from '../erp-modal/erp-modal.component';

interface FormaPagoOpcion {
  id:                 string;
  codigo:             string;
  descripcion:        string;
  requiereReferencia: boolean;
  requiereBanco:      boolean;
}

interface AsignacionPago {
  formaPago:  FormaPagoOpcion | null;
  importe:    number;
  referencia: string;
  banco:      string;
  bancoKore:  CobroBanco | null;
}

interface CxCCobroDato {
  cxc:             ErpCxC;
  numeroCuenta:    string;
  tipoVenta:       string;
  metodoPago:      string;
  fechaRealPago:   string;
  fechaAfectacion: string;
  asignacion:      AsignacionPago;
}

interface CobroRegla {
  concepto:   string;
  formasPago: string[];
  esDefault?: boolean;
}

@Component({
  standalone: false,
  selector: 'app-cobro-panel',
  templateUrl: './cobro-panel.component.html',
  styleUrls: ['./cobro-panel.component.css'],
})
export class CobroPanelComponent implements OnInit, OnDestroy {
  @Input() movement: BankMovement | null = null;
  @Input() erpModal: ErpModalComponent | undefined = undefined;

  // ── Sesión / login ──────────────────────────────────────────────────────────
  showCobroLogin      = false;
  cobroLoginError: string | null = null;
  cobroLoginLoading   = false;
  cobroAutenticado    = false;
  cajaSesionId: string | null = null;

  // ── Panel principal ─────────────────────────────────────────────────────────
  showCobroPanel          = false;
  cobroItems: CxCCobroDato[] = [];
  cobroModoGlobal         = true;
  cobroGlobalFormaPago: FormaPagoOpcion | null = null;
  cobroGlobalReferencia   = '';
  cobroGlobalBanco        = '';
  cobroGlobalImporte      = 0;
  cobroAsignacionesSingle: AsignacionPago[] = [];
  cobroFechaRealPago      = '';
  cobroFechaAfectacion    = '';
  cobroAplicando          = false;
  cobroSuccessMsg: string | null = null;
  formasPago: FormaPagoOpcion[]  = [];
  formasPagoLoading              = false;
  cobroBancos: CobroBanco[]      = [];
  cobroBancosLoading             = false;
  cobroBancoDefault: CobroBanco | null = null;
  cobroConceptos: CobroConcepto[] = [];
  cobroConceptosLoading          = false;
  cobroConceptoId                = '';
  cobroConceptosFiltrados: CobroConcepto[]  = [];
  cobroFormasPagoPermitidas = new Set<string>();
  cobroGlobalBancoKore: CobroBanco | null = null;

  // ── Alert ──────────────────────────────────────────────────────────────────
  cobroAlertMsg: string | null   = null;
  private _cobroAlertTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Pronto pago (descuento PPD) ────────────────────────────────────────────
  ppdLoading               = false;
  ppdError: string | null  = null;
  // Solo CxC con Descuentos[] no vacío
  ppdCuentas: KoreCuentaPPD[] = [];
  // ids de ppdCuentas con el descuento aplicado ahora mismo — control por CxC individual,
  // no todo-o-nada: el usuario decide cuenta por cuenta cuál recibe el pronto pago.
  ppdAplicadas = new Set<string>();

  // ── Panel saldo especial ────────────────────────────────────────────────────
  cobroSaldoEspecialVisible              = false;
  cobroSaldoEspecialTipo: 'saldo_favor' | 'compensacion' | 'anticipo' | null = null;
  cobroSaldosDisponibles: ErpSaldoFavor[] = [];
  cobroSaldoEspecialSeleccion: { saldo: ErpSaldoFavor; montoUsar: number; activo: boolean }[] = [];
  cobroSaldoEspecialGrupos: Array<{
    cuenta: string | null;
    items: Array<{ saldo: ErpSaldoFavor; montoUsar: number; activo: boolean }>;
    totalDisponible: number;
  }> = [];
  cobroSaldosLoading                     = false;
  cobroSaldoEspecialError: string | null = null;
  cobroSaldoBusquedaSerie                = '';
  cobroSaldoBusquedaFolio                = '';
  cobroSaldoBusquedaLoading              = false;
  cobroSaldoBusquedaError: string | null = null;
  private cobroSaldoEspecialIsGlobal     = false;
  private cobroSaldoEspecialTarget: AsignacionPago | null = null;
  private _saldosFetchGen                = 0;
  cobroSaldoImporteObjetivo              = 0;
  private cobroSaldosAFavorConfirmados: Record<string, number> = {};
  private cobroAnticiposConfirmados:    Record<string, number> = {};

  private destroy$ = new Subject<void>();

  private static readonly _FORMAS_PAGO_EXCLUIDAS =
    /condonaci[oóÒ]n|compensaci[oó]n|cr[eé]dito|por definir/i;

  private static readonly _COBRO_TIPO_MAP: Record<string, CobroRegla[]> = {
    'venta especial': [
      { concepto: 'cobro factura',                formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','anticipo','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'aplicacion de anticipos',      formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','anticipo','puntos','deposito en efectivo'] },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','anticipo','puntos','deposito en efectivo'] },
    ],
    'facturado': [
      { concepto: 'cobro factura',                formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','anticipo','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'aplicacion de anticipos',      formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','anticipo','puntos','deposito en efectivo'] },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','anticipo','puntos','deposito en efectivo'] },
      { concepto: 'cobro factura contado',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','puntos','deposito en efectivo'] },
    ],
    'licitacion por facturar': [
      { concepto: 'cobro de por facturar',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','saldo a favor','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'cobro factura contado',        formasPago: ['condonacion'] },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['saldo a favor'] },
      { concepto: 'aplicacion de anticipos',       formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','tarjeta de debito','puntos','condonacion','deposito en efectivo'] },
    ],
    'ventas especiales por facturar': [
      { concepto: 'cobro de por facturar',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','saldo a favor','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['saldo a favor'] },
      { concepto: 'aplicacion de anticipos',       formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','tarjeta de debito','puntos','condonacion','deposito en efectivo'] },
    ],
    'por facturar': [
      { concepto: 'cobro de por facturar',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','saldo a favor','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['saldo a favor'] },
    ],
    'orden de consignacion': [
      { concepto: 'cobro de por facturar',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','saldo a favor','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['saldo a favor'] },
    ],
    'venta miscelanea': [
      { concepto: 'tiendita tyc',                 formasPago: ['efectivo'], esDefault: true },
    ],
    'ticket sencillo': [
      { concepto: 'cobro ticket sencillo',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','puntos','deposito en efectivo','saldo a favor'], esDefault: true },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['saldo a favor'] },
    ],
    'licitacion': [
      { concepto: 'cobro factura',                formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','cheque nominativo','compensacion','tarjeta de debito','saldo a favor','puntos','deposito en efectivo'], esDefault: true },
      { concepto: 'cobro factura contado',        formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','puntos','deposito en efectivo'] },
      { concepto: 'aplicacion de saldo a favor',  formasPago: ['saldo a favor'] },
    ],
    'anticipo': [
      { concepto: 'orden de pago de anticipo',    formasPago: ['efectivo','cheque','transferencia','tarjeta de credito','tarjeta de debito','deposito en efectivo'], esDefault: true },
    ],
  };

  constructor(private bankService: BankService) {}

  ngOnInit(): void {
    const savedSesionId = localStorage.getItem('numo_caja_sesion_id');
    if (savedSesionId) {
      this.cajaSesionId     = savedSesionId;
      this.cobroAutenticado = true;
      console.log('[cobros] sesionId restaurado de localStorage:', savedSesionId);
      console.log('[cobros] koreToken en localStorage:', !!localStorage.getItem('numo_kore_token'));
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this._cobroAlertTimer) clearTimeout(this._cobroAlertTimer);
  }

  get cobroClienteNombre(): string | null {
    return this.cobroItems[0]?.cxc?.nombrePersona ?? null;
  }

  // ── Alert ──────────────────────────────────────────────────────────────────

  showCobroAlert(msg: string): void {
    if (this._cobroAlertTimer) clearTimeout(this._cobroAlertTimer);
    this.cobroAlertMsg = msg;
    this._cobroAlertTimer = setTimeout(() => { this.cobroAlertMsg = null; }, 5000);
  }

  dismissCobroAlert(): void {
    if (this._cobroAlertTimer) clearTimeout(this._cobroAlertTimer);
    this.cobroAlertMsg = null;
  }

  // ── Login de caja ──────────────────────────────────────────────────────────

  openCobroLogin(): void {
    const error = this._validateCobroCliente();
    if (error) { this.showCobroAlert(error); return; }

    if (this.cajaSesionId && this.cobroConceptos.length > 0 && this.formasPago.length > 0) {
      this._openCobroPanel();
      return;
    }

    this.cobroLoginError   = null;
    this.cobroLoginLoading = true;
    this.showCobroLogin    = true;
    this._iniciarVerificacionCaja();
  }

  // Delegado a erp-modal.cobroIds (fuente única — ver ese getter para el criterio
  // completo): así el botón "Aplicar cobro" y este panel nunca pueden desacordar en
  // qué CxC se está cobrando.
  private get _cobroIds(): string[] {
    return this.erpModal?.cobroIds ?? (this.movement?.erpIds ?? []);
  }

  private _validateCobroCliente(): string | null {
    const cobroIds       = this._cobroIds;
    const hasPreExisting = (this.erpModal?.erpIdsOriginal ?? []).length > 0;

    if (hasPreExisting && cobroIds.length === 0) {
      return 'No hay ninguna CxC marcada para cobrar. Las CxC ya vinculadas en sesiones anteriores no se incluyen solas — márcalas en la lista si querés cobrarles otra parcialidad.';
    }
    if (cobroIds.length <= 1) return null;

    const personas = new Set<string>();
    for (const id of cobroIds) {
      const cxc = this.erpModal?.getCxcFromCache(id) ?? this.erpModal?.erpCxcList.find(c => c.id === id);
      const key  = cxc?.personaId ?? cxc?.nombrePersona ?? '';
      if (key) personas.add(key);
    }
    return personas.size > 1
      ? 'Las cuentas seleccionadas pertenecen a clientes distintos. Solo se puede cobrar múltiples CxC del mismo cliente.'
      : null;
  }

  private _mapFormaPago(f: ErpFormaPago): FormaPagoOpcion {
    return {
      id:                 f.id,
      codigo:             f.claveSAT,
      descripcion:        f.nombre,
      requiereReferencia: f.claveSAT === '03',
      requiereBanco:      f.claveSAT === '03',
    };
  }

  closeCobroLogin(): void {
    if (this.cobroLoginLoading) return;
    this.showCobroLogin    = false;
    this.cobroLoginError   = null;
    this.cobroLoginLoading = false;
  }

  submitCobroLogin(): void {
    if (this.cobroLoginLoading) return;
    this.cobroLoginError   = null;
    this.cobroLoginLoading = true;
    this._iniciarVerificacionCaja();
  }

  private _iniciarVerificacionCaja(): void {
    this.bankService.verificarSesionCaja()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ sesionId, koreToken }) => {
          this.cajaSesionId      = sesionId;
          localStorage.setItem('numo_caja_sesion_id', sesionId);
          localStorage.setItem('numo_kore_token', koreToken);
          this.cobroAutenticado  = true;
          console.log('[cobros] sesión verificada, sesionId:', sesionId);
          this.cobroLoginLoading = false;
          this.showCobroLogin    = false;
          this._openCobroPanel();
        },
        error: (err) => {
          this.cobroLoginLoading = false;
          this.cobroLoginError   = err?.error?.error
            ?? 'No se pudo verificar la sesión de caja. Intenta de nuevo.';
        },
      });
  }

  // ── Panel de aplicación ────────────────────────────────────────────────────

  private _refDepositoBancario(): string {
    return String(this.movement?.folio ?? '');
  }

  // La fecha real de pago es la fecha del depósito bancario, no la fecha en que se
  // captura el cobro — si el movimiento no trae fecha válida, cae en hoy.
  private _fechaRealPagoDefault(): string {
    const d = new Date(this.movement?.fecha ?? '');
    return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
  }

  private _extraDataFromCxC(cxc: ErpCxC): Omit<CxCCobroDato, 'cxc' | 'asignacion'> {
    const today = new Date().toISOString().slice(0, 10);
    return {
      numeroCuenta:    cxc.serie && cxc.folio ? `${cxc.serie}-${cxc.folio}` : '—',
      tipoVenta:       cxc.nombreTipoMovimiento ?? '—',
      metodoPago:      cxc.tipoPago             ?? '—',
      fechaRealPago:   this._fechaRealPagoDefault(),
      fechaAfectacion: today,
    };
  }

  private _openCobroPanel(): void {
    const ids   = this._cobroIds;
    const today = new Date().toISOString().slice(0, 10);

    this.cobroItems = ids.map(id => {
      const cached = this.erpModal?.getCxcFromCache(id);
      const inPage = this.erpModal?.erpCxcList.find(c => c.id === id);
      const link   = (this.movement?.erpLinks ?? []).find((l: ErpLink) => l.erpId === id);
      const cxcSource: ErpCxC = cached ?? inPage ?? {
        id, serie: null, folio: null, serieExterna: null, folioExterno: link?.folioExterno ?? null,
        tipoPago: null, subtotal: 0, impuesto: 0, total: link?.total ?? 0,
        saldoActual: link?.saldoActual ?? 0, fechaVencimiento: null,
        folioFiscal: link?.folioFiscal ?? null, nombrePersona: null,
      } as ErpCxC;
      // Shallow copy: permite ajustar saldoActual para pronto pago sin mutar el caché
      const cxc: ErpCxC = { ...cxcSource };
      // Si ya existe un cobro previo en este CxC (saldoPagado no-null — se determinó en un
      // cobro anterior, aunque haya sido $0 bancario porque se pagó en efectivo de caja), el
      // erpLink tiene el saldo residual más reciente; el caché de Kore puede estar desactualizado.
      // OJO: es "!= null", NO "> 0" — un abono previo 100% no-bancario deja saldoPagado en 0,
      // y aun así ese 0 es más confiable que el caché de Kore.
      if (link && link.saldoPagado != null) {
        cxc.saldoActual = link.saldoActual;
      }
      return {
        cxc,
        ...this._extraDataFromCxC(cxc),
        asignacion: { formaPago: null, importe: cxc.saldoActual || cxc.total, referencia: '', banco: '', bancoKore: null },
      };
    }).filter(item => {
      // Excluir CxC completamente saldados en un cobro anterior (mismo criterio que arriba:
      // saldoPagado != null, no > 0 — un abono previo enteramente en efectivo también cuenta).
      const lnk = (this.movement?.erpLinks ?? []).find((l: ErpLink) => l.erpId === item.cxc.id);
      return !(lnk && lnk.saldoPagado != null && item.cxc.saldoActual === 0);
    }).sort((a, b) => {
      const ts = (cxc: ErpCxC): number => {
        if (cxc.fechaVencimiento) return new Date(cxc.fechaVencimiento).getTime();
        const s = String(cxc.folioExterno ?? '').trim();
        if (s.length >= 4) {
          const yy = parseInt(s.slice(0, 2), 10);
          const mm = parseInt(s.slice(2, 4), 10);
          if (!isNaN(yy) && mm >= 1 && mm <= 12) return Date.UTC(2000 + yy, mm - 1, 1);
        }
        return Infinity;
      };
      return ts(a.cxc) - ts(b.cxc);
    });

    const totalSaldo = this.cobroItems.reduce((s, i) => s + (i.cxc.saldoActual || i.cxc.total), 0);
    this.cobroModoGlobal         = true;
    this.cobroGlobalFormaPago    = null;
    this.cobroGlobalReferencia   = '';
    this.cobroGlobalBanco        = '';
    this.cobroGlobalBancoKore    = null;
    const deposito = this.movement?.deposito ?? 0;
    this.cobroGlobalImporte      = deposito > 0 ? Math.min(deposito, totalSaldo) : totalSaldo;
    this.cobroFechaRealPago      = this._fechaRealPagoDefault();
    this.cobroFechaAfectacion    = today;
    this.cobroSuccessMsg         = null;
    this.cobroAplicando          = false;
    this.cobroConceptoId         = '';
    this.cobroBancoDefault       = null;
    this.cobroConceptosFiltrados   = [];
    this.cobroFormasPagoPermitidas = new Set();
    this.ppdLoading              = false;
    this.ppdError                = null;
    this.ppdCuentas              = [];
    this.ppdAplicadas            = new Set();

    const saldoSingle = this.cobroItems[0] ? (this.cobroItems[0].cxc.saldoActual || this.cobroItems[0].cxc.total) : 0;
    this.cobroAsignacionesSingle = [{
      formaPago:  null,
      importe:    deposito > 0 ? Math.min(deposito, saldoSingle) : saldoSingle,
      referencia: '',
      banco:      '',
      bancoKore:  null,
    }];

    this.distribuirProporcionalmente();
    this.showCobroPanel = true;
    this._loadFormasPago();
    this._loadCobroBancos();
    this._loadCobroConceptos();
    this._aplicarMapeoTipoMovimiento();
    this._cargarDescuentosPPD();
  }

  // ── Pronto pago ───────────────────────────────────────────────────────────

  private _cargarDescuentosPPD(): void {
    const ppdIds = this.cobroItems
      .filter(i => /^PPD$/i.test(i.cxc.tipoPago ?? ''))
      .map(i => i.cxc.id)
      .filter(id => !!id);

    if (ppdIds.length === 0) return;

    this.ppdLoading = true;
    this.bankService.getCuentasPPD(ppdIds)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (cuentas) => {
          this.ppdLoading = false;
          this.ppdCuentas = cuentas
            .filter(c => c.descuentos.length > 0)
            .map(c => {
              const item = this.cobroItems.find(i => i.cxc.id === c.id);
              return { ...c, serieExterna: item?.cxc.serieExterna ?? null, folioExterno: item?.cxc.folioExterno ?? null };
            });
        },
        error: (err) => {
          this.ppdLoading = false;
          // Falla silenciosa: el cobro sigue funcionando sin descuento
          this.ppdError = err?.error?.error ?? 'No se pudieron cargar las políticas de pronto pago.';
        },
      });
  }

  // Aplica o quita el descuento de UNA cuenta puntual — no toca las demás.
  private _setDescuentoPPD(cuenta: KoreCuentaPPD, aplicar: boolean): void {
    const item = this.cobroItems.find(i => i.cxc.id === cuenta.id);
    if (!item) return;
    // Actualiza la copia local del saldo — no muta el caché del ERP modal
    if (aplicar) {
      this.ppdAplicadas.add(cuenta.id);
      item.cxc = { ...item.cxc, saldoActual: cuenta.saldoActualCalculado };
    } else {
      this.ppdAplicadas.delete(cuenta.id);
      item.cxc = { ...item.cxc, saldoActual: cuenta.saldoActual };
    }
  }

  private _recalcularImportesTrasPPD(): void {
    if (this.cobroItems.length === 1) {
      // Single CxC: actualizar también las asignaciones individuales
      const saldoAjustado = this.cobroItems[0].cxc.saldoActual;
      if (this.cobroAsignacionesSingle.length > 0) {
        const deposito = this.movement?.deposito ?? 0;
        this.cobroAsignacionesSingle[0].importe =
          deposito > 0 ? Math.min(deposito, saldoAjustado) : saldoAjustado;
      }
    } else {
      // Multi-CxC: redistribuir con los saldos ya ajustados
      this.distribuirProporcionalmente();
    }
  }

  // Toggle individual — botón por CxC en el panel de pronto pago.
  toggleDescuentoPPD(cuenta: KoreCuentaPPD): void {
    this._setDescuentoPPD(cuenta, !this.ppdAplicadas.has(cuenta.id));
    this._recalcularImportesTrasPPD();
  }

  // Atajos "aplicar/quitar a todas" — útiles cuando sí se quiere el mismo criterio
  // para todo el conjunto, pero el control real es por CxC vía toggleDescuentoPPD().
  aplicarDescuentoPPD(): void {
    for (const cuenta of this.ppdCuentas) this._setDescuentoPPD(cuenta, true);
    this._recalcularImportesTrasPPD();
  }

  rechazarDescuentoPPD(): void {
    for (const cuenta of this.ppdCuentas) this._setDescuentoPPD(cuenta, false);
    this._recalcularImportesTrasPPD();
  }

  // La única cuenta con PPD cuando el panel está en modo single (o null si no aplica) —
  // usada para el bloque inline junto a la información de la cuenta.
  get ppdCuentaUnica(): KoreCuentaPPD | null {
    return this.cobroItems.length === 1 ? (this.ppdCuentas[0] ?? null) : null;
  }

  // Localiza la política de PPD de una fila de la tabla multi-CxC por el id de su cuenta —
  // evita repetir un .find() en cada interpolación del template.
  ppdCuentaPorId(cxcId: string): KoreCuentaPPD | null {
    return this.ppdCuentas.find(c => c.id === cxcId) ?? null;
  }

  // El nivel de descuento vigente a mostrar en línea. Cuando Kore devuelve varias franjas
  // (ej. 3% a 10 días y 1.5% a 5 días) solo se resalta la iniciada; el resto se ve en el
  // detalle del icono "i" para no apilar una insignia por franja en la fila.
  ppdDescuentoPrincipal(c: KoreCuentaPPD): KoreDescuento | null {
    return c.descuentos.find(d => d.iniciado) ?? c.descuentos[0] ?? null;
  }

  ppdDescuentosSecundarios(c: KoreCuentaPPD): KoreDescuento[] {
    const principal = this.ppdDescuentoPrincipal(c);
    return c.descuentos.filter(d => d !== principal);
  }

  ppdAhorro(c: KoreCuentaPPD): number {
    return Math.round((c.saldoActual - c.saldoActualCalculado) * 100) / 100;
  }

  get ppdAhorroTotalAplicado(): number {
    return this.ppdCuentas
      .filter(c => this.ppdAplicadas.has(c.id))
      .reduce((sum, c) => sum + this.ppdAhorro(c), 0);
  }

  // ── Catálogos ──────────────────────────────────────────────────────────────

  get formasPagoDisponibles(): FormaPagoOpcion[] {
    if (this.cobroFormasPagoPermitidas.size > 0) {
      return this.formasPago.filter(fp => this.cobroFormasPagoPermitidas.has(this._norm(fp.descripcion)));
    }
    return this.formasPago.filter(fp => !CobroPanelComponent._FORMAS_PAGO_EXCLUIDAS.test(fp.descripcion));
  }

  // Si el banco ya identificó el depósito como efectivo en el concepto (ej. "DEPOSITO
  // EN EFECTIVO"), no tiene sentido default a transferencia — usamos esa forma de pago.
  private _movementEsDepositoEfectivo(): boolean {
    return /deposito.*efectivo/.test(this._norm(this.movement?.concepto ?? ''));
  }

  private _findDefaultFormaPago(): FormaPagoOpcion | null {
    const disponibles = this.formasPagoDisponibles;
    if (this._movementEsDepositoEfectivo()) {
      const efectivo = disponibles.find(f => /deposito.*efectivo/.test(this._norm(f.descripcion)));
      if (efectivo) return efectivo;
    }
    return disponibles.find(f => f.codigo === '03')
      ?? disponibles.find(f => /transferencia/i.test(f.descripcion))
      ?? null;
  }

  private _applyDefaultFormaPago(): void {
    const fp = this._findDefaultFormaPago();
    if (!fp) return;

    const single = this.cobroAsignacionesSingle[0];
    if (single && !single.formaPago) {
      single.formaPago = fp;
      if (fp.requiereReferencia && !single.referencia) single.referencia = this._refDepositoBancario();
      if (fp.requiereBanco && !single.bancoKore) {
        single.bancoKore = this.cobroBancoDefault;
        single.banco     = this.cobroBancoDefault?.descripcion ?? this.movement?.banco ?? '';
      }
    }

    if (!this.cobroGlobalFormaPago) {
      this.cobroGlobalFormaPago = fp;
      if (fp.requiereReferencia && !this.cobroGlobalReferencia) this.cobroGlobalReferencia = this._refDepositoBancario();
      if (fp.requiereBanco && !this.cobroGlobalBancoKore) {
        this.cobroGlobalBancoKore = this.cobroBancoDefault;
        this.cobroGlobalBanco     = this.cobroBancoDefault?.descripcion ?? this.movement?.banco ?? '';
      }
    }

    this._applyDefaultBanco();
  }

  private _loadFormasPago(): void {
    if (this.formasPago.length > 0) return;
    this.formasPagoLoading = true;
    this.bankService.getFormasPago()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (raw) => {
          this.formasPago        = raw.map(f => this._mapFormaPago(f));
          this.formasPagoLoading = false;
          if (this.showCobroPanel) this._aplicarMapeoTipoMovimiento();
        },
        error: () => { this.formasPagoLoading = false; },
      });
  }

  private _loadCobroBancos(): void {
    if (this.cobroBancos.length > 0) {
      // Catálogo ya cargado — solo re-detectar el banco para este movimiento
      this.cobroBancoDefault = this._matchBancoDefault(this.cobroBancos);
      this._applyDefaultBanco();
      return;
    }
    this.cobroBancosLoading = true;
    this.bankService.getCobroBancos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (bancos) => {
          this.cobroBancos        = bancos;
          this.cobroBancosLoading = false;
          this.cobroBancoDefault  = this._matchBancoDefault(bancos);
          this._applyDefaultBanco();
        },
        error: (err) => {
          console.error('[cobros] error cargando bancos:', err?.status, err?.error);
          this.cobroBancosLoading = false;
        },
      });
  }

  private _loadCobroConceptos(): void {
    if (this.cobroConceptos.length > 0) return;
    this.cobroConceptosLoading = true;
    this.bankService.getCobroConceptos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (conceptos) => {
          this.cobroConceptos        = conceptos;
          this.cobroConceptosLoading = false;
          if (this.showCobroPanel) this._aplicarMapeoTipoMovimiento();
        },
        error: (err) => {
          console.error('[cobros] error cargando conceptos:', err?.status, err?.error);
          this.cobroConceptosLoading = false;
        },
      });
  }

  private _matchBancoDefault(bancos: CobroBanco[]): CobroBanco | null {
    const movBanco = (this.movement?.banco ?? '').toUpperCase().trim();
    if (!movBanco) return bancos[0] ?? null;
    return (
      bancos.find(b => b.claveBanco.toUpperCase() === movBanco) ??
      bancos.find(b => movBanco.includes(b.claveBanco.toUpperCase()) || b.claveBanco.toUpperCase().includes(movBanco)) ??
      bancos.find(b => b.descripcion.toUpperCase().includes(movBanco) || movBanco.includes(b.descripcion.toUpperCase())) ??
      bancos[0] ?? null
    );
  }

  private _applyDefaultBanco(): void {
    const banco = this.cobroBancoDefault;
    if (!banco) return;
    for (const a of this.cobroAsignacionesSingle) {
      if (a.formaPago?.requiereBanco && !a.bancoKore) {
        a.bancoKore = banco;
        a.banco     = banco.descripcion;
      }
    }
    if (this.cobroGlobalFormaPago?.requiereBanco && !this.cobroGlobalBancoKore) {
      this.cobroGlobalBancoKore = banco;
      this.cobroGlobalBanco     = banco.descripcion;
    }
    this.cobroItems.forEach(item => {
      if (item.asignacion.formaPago?.requiereBanco && !item.asignacion.bancoKore) {
        item.asignacion.bancoKore = banco;
        item.asignacion.banco     = banco.descripcion;
      }
    });
  }

  // ── Mapeo tipo de movimiento ─────────────────────────────────────────────

  private _aplicarMapeoTipoMovimiento(): void {
    if (!this.showCobroPanel) return;
    if (!this.formasPago.length || !this.cobroConceptos.length) return;

    const tipoRaw  = this.cobroItems[0]?.cxc.nombreTipoMovimiento ?? '';
    const tipoNorm = this._norm(tipoRaw);
    const reglas   = CobroPanelComponent._COBRO_TIPO_MAP[tipoNorm];

    if (!reglas?.length) {
      this.cobroConceptosFiltrados   = [...this.cobroConceptos];
      this.cobroFormasPagoPermitidas = new Set();
      this._applyDefaultFormaPago();
      return;
    }

    const conceptosValidos = new Set(reglas.map(r => r.concepto));
    this.cobroConceptosFiltrados = this.cobroConceptos.filter(
      c => conceptosValidos.has(this._norm(c.nombre)),
    );

    if (!this.cobroConceptoId) {
      const reglaDefault = reglas.find(r => r.esDefault);
      const autoConcepto = reglaDefault
        ? this.cobroConceptosFiltrados.find(c => this._norm(c.nombre) === reglaDefault.concepto)
        : this.cobroConceptosFiltrados.length === 1 ? this.cobroConceptosFiltrados[0] : null;
      if (autoConcepto) {
        this.cobroConceptoId = autoConcepto.id;
        this._actualizarFormasPagoPermitidas(tipoNorm, autoConcepto);
      }
    } else {
      const c = this.cobroConceptosFiltrados.find(x => x.id === this.cobroConceptoId);
      if (c) this._actualizarFormasPagoPermitidas(tipoNorm, c);
    }

    this._applyDefaultFormaPago();
  }

  private _actualizarFormasPagoPermitidas(tipoNorm: string, concepto: CobroConcepto): void {
    const reglas = CobroPanelComponent._COBRO_TIPO_MAP[tipoNorm];
    if (!reglas?.length) { this.cobroFormasPagoPermitidas = new Set(); return; }
    const regla = reglas.find(r => r.concepto === this._norm(concepto.nombre));
    this.cobroFormasPagoPermitidas = regla ? new Set(regla.formasPago) : new Set();
  }

  private _resetFormasPagoInvalidas(): void {
    const ok = this.cobroFormasPagoPermitidas;
    if (!ok.size) return;

    const isValid = (fp: FormaPagoOpcion | null) => !fp || ok.has(this._norm(fp.descripcion));
    const clearAsignacion = (a: AsignacionPago) => {
      if (!isValid(a.formaPago)) { a.formaPago = null; a.referencia = ''; a.banco = ''; a.bancoKore = null; }
    };

    this.cobroAsignacionesSingle.forEach(clearAsignacion);
    this.cobroItems.forEach(item => clearAsignacion(item.asignacion));
    if (!isValid(this.cobroGlobalFormaPago)) {
      this.cobroGlobalFormaPago = null; this.cobroGlobalReferencia = ''; this.cobroGlobalBanco = ''; this.cobroGlobalBancoKore = null;
    }
  }

  onConceptoChange(conceptoId: string): void {
    this.cobroConceptoId = conceptoId;

    if (!conceptoId) {
      this.cobroFormasPagoPermitidas = new Set();
      this._resetFormasPagoInvalidas();
      return;
    }

    const tipoNorm = this._norm(this.cobroItems[0]?.cxc.nombreTipoMovimiento ?? '');
    const concepto = this.cobroConceptosFiltrados.find(c => c.id === conceptoId);
    if (concepto) this._actualizarFormasPagoPermitidas(tipoNorm, concepto);

    this._resetFormasPagoInvalidas();
    this._applyDefaultFormaPago();
  }

  // ── Construcción de payloads ───────────────────────────────────────────────

  private _buildDetalleFormaPago(asignacion: AsignacionPago): DetalleFormaPago {
    const d: DetalleFormaPago = {
      FormaPagoID:     asignacion.formaPago!.id,
      FormaPagoNombre: asignacion.formaPago!.descripcion,
      Monto:           asignacion.importe,
      Recibido:        asignacion.importe,
      Comision:        0,
      transactionID:   '',
    };
    if (asignacion.bancoKore) {
      d.BancoID          = asignacion.bancoKore.id;
      d.BancoDescripcion = asignacion.bancoKore.descripcion;
    }
    if (asignacion.referencia) {
      const datos: { Nombre: string; Valor: string }[] = [{ Nombre: 'Aut', Valor: asignacion.referencia }];
      const autBanco = this.movement?.numeroAutorizacion;
      if (autBanco) datos.push({ Nombre: 'Numo', Valor: autBanco });
      d.DatosAdicionales = datos;
    }
    return d;
  }

  private _buildCobroPayload(cxc: ErpCxC, asignaciones: AsignacionPago[]): AplicarCobroPayload {
    const toISO = (d: string) => d ? `${d}T00:00:00Z` : new Date().toISOString();
    return {
      anotacion:               `Pago de pedido ${cxc.serieExterna ?? cxc.serie}-${cxc.folioExterno ?? cxc.folio}`,
      anticipoTimbrar:         false,
      anticipos: Object.keys(this.cobroAnticiposConfirmados).length > 0
        ? { ...this.cobroAnticiposConfirmados }
        : { additionalProp1: 0, additionalProp2: 0, additionalProp3: 0 },
      cantAnticipoAutomatico:  0,
      codigo:                  '',
      cuenta:                  cxc.id,
      datoFiscalID:            0,
      detalle: {
        DetalleFormaPago:  asignaciones.map(a => this._buildDetalleFormaPago(a)),
        Total:             asignaciones.reduce((s, a) => s + a.importe, 0),
        autorizo:          '',
        concepto:          this.cobroConceptoId,
        encargado:         '',
        fecha_afectacion:  toISO(this.cobroFechaAfectacion),
        fecha_aplicacion:  toISO(this.cobroFechaRealPago),
        fecha_real_pago:   toISO(this.cobroFechaRealPago),
      },
      formaPagoAnticipoAutoID: '',
      saldosAFavorAUsar:       { ...this.cobroSaldosAFavorConfirmados },
      sesionId:                this.cajaSesionId!,
      usoCFDI:                 'G03',
    };
  }

  private _buildCobroPayloadMulti(): AplicarCobroPayloadMulti {
    const toISO = (d: string) => d ? `${d}T00:00:00Z` : new Date().toISOString();

    const cuentas = this.cobroItems.map(item => ({
      CuentaID: item.cxc.id,
      Monto:    item.asignacion.importe || (item.cxc.saldoActual || item.cxc.total),
    }));
    const total = Math.round(cuentas.reduce((s, c) => s + c.Monto, 0) * 100) / 100;

    const fp = this.cobroGlobalFormaPago!;
    const detalleFP: DetalleFormaPago = {
      FormaPagoID:     fp.id,
      FormaPagoNombre: fp.descripcion,
      Monto:           total,
      Recibido:        total,
      Comision:        0,
      transactionID:   '',
    };
    if (this.cobroGlobalBancoKore) {
      detalleFP.BancoID          = this.cobroGlobalBancoKore.id;
      detalleFP.BancoDescripcion = this.cobroGlobalBancoKore.descripcion;
    }
    if (this.cobroGlobalReferencia) {
      const datos: { Nombre: string; Valor: string }[] = [{ Nombre: 'Aut', Valor: this.cobroGlobalReferencia }];
      const autBanco = this.movement?.numeroAutorizacion;
      if (autBanco) datos.push({ Nombre: 'Numo', Valor: autBanco });
      detalleFP.DatosAdicionales = datos;
    }

    return {
      MotivoAutorizacion:      '',
      anotacion:               '',
      anticipos: Object.keys(this.cobroAnticiposConfirmados).length > 0
        ? { ...this.cobroAnticiposConfirmados }
        : {},
      cantAnticipoAutomatico:  0,
      cuentas,
      datoFiscalID:            0,
      detalle: {
        DetalleFormaPago: [detalleFP],
        Total:            total,
        autorizo:         '',
        concepto:         this.cobroConceptoId,
        encargado:        '',
        fecha_afectacion: toISO(this.cobroFechaAfectacion),
        fecha_aplicacion: toISO(this.cobroFechaRealPago),
        fecha_real_pago:  toISO(this.cobroFechaRealPago),
      },
      formaPagoAnticipoAutoID: '',
      idUsuarioAutoriza:       '',
      saldosAFavorAUsar:       { ...this.cobroSaldosAFavorConfirmados },
    };
  }

  // ── Panel: abrir / cerrar ─────────────────────────────────────────────────

  closeCobroPanel(): void {
    this.showCobroPanel              = false;
    this.cobroItems                  = [];
    this.cobroSuccessMsg             = null;
    this.cobroSaldosAFavorConfirmados = {};
    this.cobroAnticiposConfirmados    = {};
    this.ppdLoading                  = false;
    this.ppdError                    = null;
    this.ppdCuentas                  = [];
    this.ppdAplicadas                = new Set();
  }

  /** Public: called by parent (via @ViewChild) when ERP modal emits closeCobroPanel */
  closePanel(): void { this.closeCobroPanel(); }

  addAsignacionSingle(): void {
    const pendiente = Math.max(0, Math.round(this.cobroDiferenciaSingle * 100) / 100);
    this.cobroAsignacionesSingle.push({ formaPago: null, importe: pendiente, referencia: '', banco: '', bancoKore: null });
  }

  removeAsignacionSingle(i: number): void {
    this.cobroAsignacionesSingle.splice(i, 1);
  }

  // ── Getters de cálculo ────────────────────────────────────────────────────

  get cobroTotalSingle(): number {
    return this.cobroAsignacionesSingle.reduce((s, a) => s + (a.importe || 0), 0);
  }

  get cobroDiferenciaSingle(): number {
    const cxc = this.cobroItems[0]?.cxc;
    const raw = (cxc ? (cxc.saldoActual || cxc.total) : 0) - this.cobroTotalSingle;
    return Math.round(raw * 100) / 100;
  }

  get cobroTotalCxCs(): number {
    return this.cobroItems.reduce((s, i) => s + (i.cxc.saldoActual || i.cxc.total), 0);
  }

  get cobroTotalIndividual(): number {
    return this.cobroItems.reduce((s, i) => s + (i.asignacion.importe || 0), 0);
  }

  get cobroDiferenciaMulti(): number {
    const asignado = this.cobroModoGlobal ? this.cobroGlobalImporte : this.cobroTotalIndividual;
    const raw = this.cobroTotalCxCs - asignado;
    return Math.round(raw * 100) / 100;
  }

  get cobroDiferenciaConDeposito(): number {
    const deposito = this.movement?.deposito ?? 0;
    const asignado = this.cobroItems.length === 1
      ? this.cobroTotalSingle
      : (this.cobroModoGlobal ? this.cobroGlobalImporte : this.cobroTotalIndividual);
    return deposito - asignado;
  }

  get cobroResumenSingle(): { formaPago: FormaPagoOpcion; importe: number }[] {
    const map = new Map<string, { formaPago: FormaPagoOpcion; importe: number }>();
    for (const a of this.cobroAsignacionesSingle) {
      if (!a.formaPago || !a.importe) continue;
      const prev = map.get(a.formaPago.codigo);
      if (prev) prev.importe += a.importe;
      else map.set(a.formaPago.codigo, { formaPago: a.formaPago, importe: a.importe });
    }
    return [...map.values()];
  }

  // ── Interacciones del formulario ──────────────────────────────────────────

  distribuirProporcionalmente(): void {
    if (this.cobroItems.length <= 1) return;
    const deposito  = this.movement?.deposito ?? 0;
    const totalCxCs = this.cobroTotalCxCs;
    const base      = deposito > 0 ? Math.min(deposito, totalCxCs) : this.cobroGlobalImporte;
    if (!base) return;
    this.cobroGlobalImporte = Math.round(base * 100) / 100;
    let restante = Math.round(base * 100);
    for (const item of this.cobroItems) {
      const saldo    = Math.round((item.cxc.saldoActual || item.cxc.total) * 100);
      const asignado = Math.min(saldo, Math.max(0, restante));
      item.asignacion.importe = asignado / 100;
      restante -= asignado;
    }
  }

  onCobroModoChange(global: boolean): void {
    this.cobroModoGlobal = global;
    this.distribuirProporcionalmente();
  }

  restanteItem(item: CxCCobroDato): number {
    return Math.round(((item.cxc.saldoActual || item.cxc.total) - (item.asignacion.importe || 0)) * 100) / 100;
  }

  onFormaPagoChange(event: Event, asignacion: AsignacionPago): void {
    const val = (event.target as HTMLSelectElement).value;
    const fp  = this.formasPago.find(f => f.id === val) ?? null;
    asignacion.formaPago = fp;
    if (fp?.requiereReferencia) {
      if (!asignacion.referencia) asignacion.referencia = this._refDepositoBancario();
    } else {
      asignacion.referencia = '';
    }
    if (fp?.requiereBanco && !asignacion.bancoKore) {
      asignacion.bancoKore = this.cobroBancoDefault;
      asignacion.banco     = this.cobroBancoDefault?.descripcion ?? (this.movement?.banco ?? '');
    }
    const tipoEspecial = this.esSaldoEspecial(fp);
    if (tipoEspecial) {
      this._sincronizarConceptoConFormaPago(tipoEspecial);
      this.abrirPanelSaldoEspecial(asignacion, tipoEspecial, false);
    }
    this._limpiarSaldosEspecialesHuerfanos();
  }

  onGlobalFormaPagoChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    const fp  = this.formasPago.find(f => f.id === val) ?? null;
    this.cobroGlobalFormaPago = fp;
    if (fp?.requiereReferencia) {
      if (!this.cobroGlobalReferencia) this.cobroGlobalReferencia = this._refDepositoBancario();
    } else {
      this.cobroGlobalReferencia = '';
    }
    if (fp?.requiereBanco && !this.cobroGlobalBancoKore) {
      this.cobroGlobalBancoKore = this.cobroBancoDefault;
      this.cobroGlobalBanco     = this.cobroBancoDefault?.descripcion ?? (this.movement?.banco ?? '');
    }
    this.cobroItems.forEach(i => { i.asignacion.formaPago = fp; });
    const tipoEspecial = this.esSaldoEspecial(fp);
    if (tipoEspecial) {
      this._sincronizarConceptoConFormaPago(tipoEspecial);
      this.abrirPanelSaldoEspecial(null, tipoEspecial, true);
    }
    this._limpiarSaldosEspecialesHuerfanos();
  }

  // Limpia mapas de saldos/anticipos confirmados que ya no corresponden a ninguna
  // forma de pago activa. Evita que un rechazo de Kore deje estado huérfano que
  // contamina el siguiente intento con diferente forma de pago.
  private _limpiarSaldosEspecialesHuerfanos(): void {
    const fps: Array<FormaPagoOpcion | null> = this.cobroItems.length === 1
      ? this.cobroAsignacionesSingle.map(a => a.formaPago)
      : [this.cobroGlobalFormaPago, ...this.cobroItems.map(i => i.asignacion.formaPago)];

    if (!fps.some(fp => this.esSaldoEspecial(fp) === 'anticipo'))
      this.cobroAnticiposConfirmados = {};
    if (!fps.some(fp => this.esSaldoEspecial(fp) === 'saldo_favor'))
      this.cobroSaldosAFavorConfirmados = {};
  }

  private _sincronizarConceptoConFormaPago(tipo: 'saldo_favor' | 'compensacion' | 'anticipo'): void {
    if (tipo === 'compensacion') return;

    const prioridad: string[] = tipo === 'saldo_favor'
      ? ['aplicacion de saldo a favor', 'aplicacion de anticipos']
      : ['aplicacion de anticipos',     'aplicacion de saldo a favor'];

    const conceptoActualNorm = this._norm(
      this.cobroConceptosFiltrados.find(c => c.id === this.cobroConceptoId)?.nombre ?? ''
    );
    if (prioridad.includes(conceptoActualNorm)) return;

    for (const objetivo of prioridad) {
      const dest = this.cobroConceptosFiltrados.find(c => this._norm(c.nombre) === objetivo);
      if (dest) {
        this.cobroConceptoId = dest.id;
        const tipoNorm = this._norm(this.cobroItems[0]?.cxc.nombreTipoMovimiento ?? '');
        this._actualizarFormasPagoPermitidas(tipoNorm, dest);
        return;
      }
    }
  }

  // ── Panel de saldo especial ──────────────────────────────────────────────

  esSaldoEspecial(fp: FormaPagoOpcion | null): 'saldo_favor' | 'compensacion' | 'anticipo' | null {
    if (!fp) return null;
    const n = this._norm(fp.descripcion);
    if (n.includes('saldo a favor')) return 'saldo_favor';
    if (n.includes('compensacion'))  return 'compensacion';
    if (n === 'anticipo')            return 'anticipo';
    return null;
  }

  // saldoPagado (badge/dropdown "CxC vinculadas" en la tabla de movimientos) solo debe
  // reflejar lo cobrado por una forma de pago que realmente pasa por el banco —
  // transferencia, depósito en efectivo o cheque (un cheque cobrado también es dinero
  // real que entró vía el banco). Efectivo en caja, tarjeta, compensación, etc. no
  // corresponden a ese depósito bancario y no deben contribuir ahí, aunque sí liquiden
  // la CxC en Kore y sí cuenten para saldoErp (ver saldosPagadoTotal abajo).
  private _esFormaBancaria(fp: FormaPagoOpcion | null): boolean {
    if (!fp) return false;
    if (fp.codigo === '03' || /transferencia/i.test(fp.descripcion)) return true;
    if (fp.codigo === '02' || /cheque/i.test(fp.descripcion)) return true;
    return /deposito.*efectivo/.test(this._norm(fp.descripcion));
  }

  private _buildCobroSaldosErp(): {
    saldosActual: Record<string, number>;
    saldosPagado: Record<string, number>;
    saldosPagadoTotal: Record<string, number>;
    desglosePorFormaPago: Record<string, DesgloseFormaPago[]>;
  } {
    const saldosActual: Record<string, number> = {};
    const saldosPagado: Record<string, number> = {};
    const saldosPagadoTotal: Record<string, number> = {};
    const desglosePorFormaPago: Record<string, DesgloseFormaPago[]> = {};

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const fechaCobro = new Date().toISOString();

    if (this.cobroItems.length === 1) {
      const cxc   = this.cobroItems[0]?.cxc;
      const erpId = cxc?.id;
      if (erpId) {
        const totalPaid  = this.cobroAsignacionesSingle.reduce((s, a) => s + (a.importe || 0), 0);
        const bancoPaid  = this.cobroAsignacionesSingle
          .filter(a => this._esFormaBancaria(a.formaPago))
          .reduce((s, a) => s + (a.importe || 0), 0);

        // Remaining balance after this payment (used by the next cobro on a PPD CxC) —
        // refleja TODO lo pagado, sin importar la forma, porque es el saldo real de la CxC.
        const prevSaldo = cxc.saldoActual || cxc.total;
        saldosActual[erpId] = round2(Math.max(0, prevSaldo - totalPaid));

        const link = (this.movement?.erpLinks ?? []).find((l: ErpLink) => l.erpId === erpId);

        // Cumulative amount pagado por transferencia/depósito/cheque — solo suma la
        // porción bancaria de este cobro; alimenta el badge de la tabla (saldoPagado).
        saldosPagado[erpId] = round2((link?.saldoPagado ?? 0) + bancoPaid);

        // Cumulative amount pagado por CUALQUIER forma — alimenta saldoErp (aplicarLogicaErp
        // en backend), que debe reflejar que la CxC quedó cubierta sin importar la forma.
        saldosPagadoTotal[erpId] = round2((link?.saldoPagadoTotal ?? 0) + totalPaid);

        // Bitácora de auditoría: una entrada por cada forma de pago usada AHORA, agregada
        // a lo que ya traía el erpLink de cobros anteriores (nunca se sobreescribe).
        const nuevoDesglose: DesgloseFormaPago[] = this.cobroAsignacionesSingle
          .filter(a => (a.importe || 0) > 0 && a.formaPago)
          .map(a => ({
            formaPagoId:          a.formaPago!.id,
            formaPagoDescripcion: a.formaPago!.descripcion,
            monto:                round2(a.importe),
            fecha:                fechaCobro,
          }));
        desglosePorFormaPago[erpId] = [...(link?.desglosePorFormaPago ?? []), ...nuevoDesglose];
      }
    } else {
      const esBancaria = this._esFormaBancaria(this.cobroGlobalFormaPago);
      for (const item of this.cobroItems) {
        const erpId = item.cxc.id;
        if (!erpId) continue;
        const paid     = item.asignacion.importe || 0;
        const prevSaldo = item.cxc.saldoActual || item.cxc.total;
        saldosActual[erpId] = round2(Math.max(0, prevSaldo - paid));
        const link = (this.movement?.erpLinks ?? []).find((l: ErpLink) => l.erpId === erpId);
        saldosPagado[erpId]      = round2((link?.saldoPagado ?? 0) + (esBancaria ? paid : 0));
        saldosPagadoTotal[erpId] = round2((link?.saldoPagadoTotal ?? 0) + paid);

        // Multi-CxC solo permite UNA forma de pago para todo el cobro — una sola entrada
        // por CxC, con la porción (paid) que le tocó a esa cuenta específica.
        const nuevoDesglose: DesgloseFormaPago[] = paid > 0 && this.cobroGlobalFormaPago
          ? [{
              formaPagoId:          this.cobroGlobalFormaPago.id,
              formaPagoDescripcion: this.cobroGlobalFormaPago.descripcion,
              monto:                round2(paid),
              fecha:                fechaCobro,
            }]
          : [];
        desglosePorFormaPago[erpId] = [...(link?.desglosePorFormaPago ?? []), ...nuevoDesglose];
      }
    }

    return { saldosActual, saldosPagado, saldosPagadoTotal, desglosePorFormaPago };
  }

  get cobroSaldoEspecialTotal(): number {
    return this.cobroSaldoEspecialSeleccion
      .filter(s => s.activo)
      .reduce((sum, s) => sum + (s.montoUsar || 0), 0);
  }

  // Stored property — avoids returning new object references on each CD check (NG0100 fix).
  // Updated explicitly from event handlers; never mutated during Angular's render/verify phases.
  saldoProgreso: { percent: number; pendiente: number; exceso: number; completo: boolean } | null = null;

  private _refreshSaldoProgreso(): void {
    if (this.cobroSaldosLoading || this.cobroSaldoEspecialError ||
        this.cobroSaldoImporteObjetivo <= 0 || this.cobroSaldoEspecialSeleccion.length === 0) {
      this.saldoProgreso = null;
      return;
    }
    const total     = this.cobroSaldoEspecialTotal;
    const obj       = this.cobroSaldoImporteObjetivo;
    const percent   = Math.min(100, total / obj * 100);
    const pendiente = Math.max(0, Math.round((obj - total) * 100) / 100);
    const exceso    = Math.max(0, Math.round((total - obj) * 100) / 100);
    const completo  = total >= obj - 0.001;
    const prev      = this.saldoProgreso;
    if (prev && prev.percent === percent && prev.pendiente === pendiente &&
        prev.exceso === exceso && prev.completo === completo) return;
    this.saldoProgreso = { percent, pendiente, exceso, completo };
  }

  onToggleSaldoItem(item: { saldo: ErpSaldoFavor; montoUsar: number; activo: boolean }): void {
    item.montoUsar = item.activo ? item.saldo.monto : 0;
    this._refreshSaldoProgreso();
  }

  seleccionarTodosSaldos(): void {
    for (const item of this.cobroSaldoEspecialSeleccion) {
      item.activo    = true;
      item.montoUsar = item.saldo.monto;
    }
    this._refreshSaldoProgreso();
  }

  desmarcarTodosSaldos(): void {
    for (const item of this.cobroSaldoEspecialSeleccion) {
      item.activo    = false;
      item.montoUsar = 0;
    }
    this._refreshSaldoProgreso();
  }

  limpiarSaldosSeleccion(): void { this.desmarcarTodosSaldos(); }

  trackBySaldoGrupo(_: number, g: { cuenta: string | null }): string {
    return g.cuenta ?? '__sin_cuenta__';
  }

  trackBySaldoItem(_: number, item: { saldo: ErpSaldoFavor }): string {
    return item.saldo.id;
  }

  private _autoSeleccionarSaldos(importeObjetivo: number): void {
    let pendiente = Math.round(importeObjetivo * 100) / 100;
    for (const item of this.cobroSaldoEspecialSeleccion) {
      if (pendiente <= 0) {
        item.activo    = false;
        item.montoUsar = 0;
      } else if (item.saldo.monto <= pendiente) {
        item.activo    = true;
        item.montoUsar = item.saldo.monto;
        pendiente      = Math.round((pendiente - item.saldo.monto) * 100) / 100;
      } else {
        item.activo    = true;
        item.montoUsar = Math.round(pendiente * 100) / 100;
        pendiente      = 0;
      }
    }
  }

  private _recalcSaldoGrupos(): void {
    const seleccion = this.cobroSaldoEspecialSeleccion;
    if (!seleccion.length) { this.cobroSaldoEspecialGrupos = []; return; }
    const map = new Map<string, Array<{ saldo: ErpSaldoFavor; montoUsar: number; activo: boolean }>>();
    for (const item of seleccion) {
      const key = item.saldo.cuentaDescripcion ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    this.cobroSaldoEspecialGrupos = Array.from(map.entries()).map(([key, items]) => ({
      cuenta:          key || null,
      items,
      totalDisponible: items.reduce((s, i) => s + i.saldo.monto, 0),
    }));
  }

  abrirPanelSaldoEspecial(
    asignacion: AsignacionPago | null,
    tipo: 'saldo_favor' | 'compensacion' | 'anticipo',
    isGlobal: boolean,
  ): void {
    const personaId = this.cobroItems[0]?.cxc.personaId ?? '';
    if (!personaId) {
      this.showCobroAlert('No se puede cargar el historial: el cliente no tiene ID registrado.');
      return;
    }
    this.cobroSaldoEspecialTarget   = asignacion;
    this.cobroSaldoEspecialIsGlobal = isGlobal;

    if (isGlobal) {
      this.cobroSaldoImporteObjetivo = this.cobroGlobalImporte;
    } else if (asignacion && asignacion.importe > 0) {
      this.cobroSaldoImporteObjetivo = asignacion.importe;
    } else {
      this.cobroSaldoImporteObjetivo = Math.max(0, this.cobroDiferenciaSingle);
    }
    this.cobroSaldoEspecialTipo      = tipo;
    this.cobroSaldoEspecialVisible   = true;
    this.cobroSaldosLoading          = true;
    this.cobroSaldoEspecialError     = null;
    this.cobroSaldosDisponibles      = [];
    this.cobroSaldoEspecialSeleccion = [];
    this.saldoProgreso               = null;
    this._recalcSaldoGrupos();

    const gen = ++this._saldosFetchGen;
    this.bankService.getSaldosAFavor(personaId, tipo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (saldos) => {
          if (gen !== this._saldosFetchGen) return;
          this.cobroSaldosDisponibles      = saldos;
          this.cobroSaldoEspecialSeleccion = saldos
            .map(s => ({ saldo: s, montoUsar: s.monto, activo: true }))
            .sort((a, b) => {
              const fa = a.saldo.fecha ? new Date(a.saldo.fecha).getTime() : Infinity;
              const fb = b.saldo.fecha ? new Date(b.saldo.fecha).getTime() : Infinity;
              return fa - fb;
            });
          if (this.cobroSaldoImporteObjetivo > 0) this._autoSeleccionarSaldos(this.cobroSaldoImporteObjetivo);
          this._recalcSaldoGrupos();
          this.cobroSaldosLoading = false;
          this._refreshSaldoProgreso();
        },
        error: (err) => {
          if (gen !== this._saldosFetchGen) return;
          this.cobroSaldoEspecialError = err?.error?.error ?? 'No se pudieron cargar los saldos disponibles.';
          this.cobroSaldosLoading      = false;
        },
      });
  }

  cerrarPanelSaldoEspecial(): void {
    this.cobroSaldoEspecialVisible   = false;
    this.cobroSaldoEspecialTipo      = null;
    this.cobroSaldosDisponibles      = [];
    this.cobroSaldoEspecialSeleccion = [];
    this.cobroSaldoEspecialGrupos    = [];
    this.cobroSaldoImporteObjetivo   = 0;
    this.cobroSaldoEspecialError     = null;
    this.cobroSaldoEspecialTarget    = null;
    this.cobroSaldoBusquedaSerie     = '';
    this.cobroSaldoBusquedaFolio     = '';
    this.cobroSaldoBusquedaLoading   = false;
    this.cobroSaldoBusquedaError     = null;
    this.saldoProgreso               = null;
  }

  buscarSaldosPorFolio(): void {
    const serie = this.cobroSaldoBusquedaSerie.trim();
    const folio = this.cobroSaldoBusquedaFolio.trim();
    if (!serie || !folio) return;

    this.cobroSaldoBusquedaLoading = true;
    this.cobroSaldoBusquedaError   = null;

    const esAnticipo = this.cobroSaldoEspecialTipo === 'anticipo';

    this.bankService.buscarSaldosPorFolio(serie, folio, esAnticipo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (saldos) => {
          this.cobroSaldoBusquedaLoading = false;
          if (saldos.length === 0) {
            this.cobroSaldoBusquedaError = `No se encontraron saldos para ${serie}-${folio}.`;
            return;
          }
          const existingIds = new Set(this.cobroSaldoEspecialSeleccion.map(s => s.saldo.id));
          const nuevos = saldos
            .filter(s => !existingIds.has(s.id))
            .map(s => ({ saldo: s, montoUsar: s.monto, activo: false }));
          if (nuevos.length === 0) {
            this.cobroSaldoBusquedaError = 'Los saldos encontrados ya están en la lista.';
            return;
          }
          this.cobroSaldoEspecialSeleccion = [...this.cobroSaldoEspecialSeleccion, ...nuevos];
          this._recalcSaldoGrupos();
          this.cobroSaldoBusquedaSerie = '';
          this.cobroSaldoBusquedaFolio = '';
        },
        error: (err) => {
          this.cobroSaldoBusquedaLoading = false;
          this.cobroSaldoBusquedaError   = err?.error?.error ?? 'Error al buscar saldos.';
        },
      });
  }

  confirmarSaldoEspecial(): void {
    const total = this.cobroSaldoEspecialTotal;

    if (this.cobroSaldoEspecialTipo === 'saldo_favor') {
      this.cobroSaldosAFavorConfirmados = {};
      for (const item of this.cobroSaldoEspecialSeleccion) {
        if (item.activo && item.montoUsar > 0) {
          this.cobroSaldosAFavorConfirmados[item.saldo.id] = item.montoUsar;
        }
      }
    } else if (this.cobroSaldoEspecialTipo === 'anticipo') {
      this.cobroAnticiposConfirmados = {};
      for (const item of this.cobroSaldoEspecialSeleccion) {
        if (item.activo && item.montoUsar > 0) {
          this.cobroAnticiposConfirmados[item.saldo.id] = item.montoUsar;
        }
      }
    }

    if (this.cobroSaldoEspecialIsGlobal) {
      this.cobroGlobalImporte = total;
    } else if (this.cobroSaldoEspecialTarget) {
      this.cobroSaldoEspecialTarget.importe = total;
    }
    this.cerrarPanelSaldoEspecial();
  }

  compareBancoKore(a: CobroBanco | null, b: CobroBanco | null): boolean {
    return a?.id === b?.id;
  }

  // ── Aplicar cobro ─────────────────────────────────────────────────────────

  aplicarCobro(): void {
    if (this.cobroAplicando) return;

    if (!this.cobroConceptoId) {
      this.showCobroAlert('Selecciona un concepto antes de aplicar el cobro.');
      return;
    }

    const TOLERANCIA = 0.015;
    // PPD (Pago en Parcialidades o Diferido) acepta abonos parciales — el backend
    // valida el monto y genera el complemento de pago correspondiente.
    const esPPD = this.cobroItems.length > 0 &&
      this.cobroItems.every(i => /^PPD$/i.test(i.cxc.tipoPago ?? ''));
    if (!esPPD) {
      if (this.cobroItems.length === 1) {
        const diff = this.cobroDiferenciaSingle;
        if (diff > TOLERANCIA) {
          this.showCobroAlert(
            `Debe saldarse la cuenta por completo. Pendiente: $${diff.toFixed(2)}. Ajusta el importe para cubrir el saldo total.`,
          );
          return;
        }
      } else {
        const diff = this.cobroDiferenciaMulti;
        if (diff > TOLERANCIA) {
          this.showCobroAlert(
            `Deben saldarse todas las cuentas por completo. Pendiente: $${diff.toFixed(2)}. Ajusta los importes para cubrir el saldo total.`,
          );
          return;
        }
      }
    }

    {
      // Para multi-CxC siempre se llama _buildCobroPayloadMulti() que usa cobroGlobalFormaPago,
      // por lo que la validación debe reflejar eso independientemente del modo (Global/Individual).
      const asignaciones: AsignacionPago[] = this.cobroItems.length === 1
        ? this.cobroAsignacionesSingle
        : [{ formaPago: this.cobroGlobalFormaPago,
             importe:   this.cobroModoGlobal ? this.cobroGlobalImporte : this.cobroTotalIndividual,
             referencia: '', banco: '', bancoKore: null }];

      const sinFormaPago = asignaciones.find(a => !a.formaPago);
      if (sinFormaPago) {
        this.showCobroAlert('Selecciona una forma de pago antes de aplicar el cobro.');
        return;
      }

      if (this.cobroFormasPagoPermitidas.size > 0) {
        const conceptoNombre = this.cobroConceptosFiltrados.find(c => c.id === this.cobroConceptoId)?.nombre ?? 'el concepto seleccionado';
        const invalida = asignaciones.find(
          a => a.formaPago && !this.cobroFormasPagoPermitidas.has(this._norm(a.formaPago.descripcion)),
        );
        if (invalida) {
          this.showCobroAlert(
            `"${invalida.formaPago!.descripcion}" no está permitido para "${conceptoNombre}". Elige una forma de pago válida.`,
          );
          return;
        }
      }

      const usaSaldoFavor = asignaciones.some(a => this.esSaldoEspecial(a.formaPago) === 'saldo_favor');
      if (usaSaldoFavor && Object.keys(this.cobroSaldosAFavorConfirmados).length === 0) {
        this.showCobroAlert('Debes seleccionar los saldos a favor a aplicar. Haz clic en "Seleccionar saldos →" antes de continuar.');
        return;
      }
      const usaAnticipo = asignaciones.some(a => this.esSaldoEspecial(a.formaPago) === 'anticipo');
      if (usaAnticipo && Object.keys(this.cobroAnticiposConfirmados).length === 0) {
        this.showCobroAlert('Debes seleccionar los anticipos a aplicar. Haz clic en "Seleccionar anticipos →" antes de continuar.');
        return;
      }
    }

    this.cobroAplicando  = true;
    this.cobroSuccessMsg = null;

    const sesionId = this.cajaSesionId!;
    const req$ = this.cobroItems.length === 1
      ? this.bankService.aplicarCobroOperacion(sesionId, this._buildCobroPayload(this.cobroItems[0].cxc, this.cobroAsignacionesSingle))
      : this.bankService.aplicarCobroOperacionMultiple(sesionId, this._buildCobroPayloadMulti());

    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.cobroAplicando = false;
        this.erpModal?.setCobroSaldosErp(this._buildCobroSaldosErp());
        this.erpModal?.activateCobro();
        this.erpModal?.confirmErp();
      },
      error: (err) => {
        this.cobroAplicando = false;
        const status  = err?.status;
        const koreMsg = err?.error?.error ?? err?.error?.kore?.Mensaje ?? err?.error?.Mensaje;
        const msg = koreMsg
          ?? (status === 0 ? 'Sin conexión con el servidor de caja. Verifica tu red.' : 'Error al aplicar el cobro en el sistema de caja.');
        this.showCobroAlert(msg);
      },
    });
  }

  // ── Utilidad ───────────────────────────────────────────────────────────────

  private _norm(s: string): string {
    return (s ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
}
