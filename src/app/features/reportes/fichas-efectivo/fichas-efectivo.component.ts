import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, BancoFicha, FichaEfectivo, MontosFicha, DetalleFicha,
  FichaGuardada, FichaGuardadaResumen, BancoFichaImporte,
} from '../../../core/services/reportes-por-facturar.service';

const CLASE_IMPRIMIENDO = 'fe-imprimiendo';
/** Rango máximo de la ficha (igual que el backend): Kore tarda ~3 s por día. */
const MAX_DIAS = 10;

interface RenglonFicha {
  clave: keyof MontosFicha;
  etiqueta: string;
  /** Resta del total (devoluciones, faltante). */
  resta?: boolean;
  /** No suma al total a entregar (depósito en efectivo, saldo a favor). */
  informativo?: boolean;
}

/** Lo que se muestra / imprime: una ficha recién calculada o una guardada. */
interface FichaVista extends FichaEfectivo {
  folio?: number;
  estado?: 'vigente' | 'cancelada';
  guardada?: FichaGuardada;
}

/** Una tabla del anexo: los cobros / salidas de un renglón de la ficha (2026-11-25). */
interface GrupoAnexo {
  clave:    string;
  etiqueta: string;
  /** Para el renglón "Total …". */
  corta:    string;
  filas:    DetalleFicha[];
  total:    number;
  /** Suma de lo facturado (2026-11-26); null si ningún renglón lo trae (sin factura, fichas viejas). */
  totalFacturado: number | null;
}

/** Logos en public/bancos (Wikimedia Commons); los demás bancos salen con su nombre. */
const LOGOS_BANCO = new Set(['BBVA', 'Banamex', 'Santander', 'Azteca', 'Banorte']);


// "Por facturar" ahora se llama CONSIGNACIÓN y el orden es facturado, consignación,
// cobranza, abonos, venta miscelánea y luego lo demás (2026-11-06, pedido del usuario).
// 2026-11-25 (pedido del usuario): facturado, consignación facturada, cobranza facturado, abonos;
// la consignación SIN factura ya no suma y va al final del anexo.
const ETIQUETA_CONCEPTO: Partial<Record<keyof MontosFicha, string>> = {
  efectivoFacturado:   'Facturado',
  consignacionFacturada: 'Consignación facturada',
  efectivoPorFacturar: 'Consignación sin factura',
  cobranzaEfectivo:    'Cobranza facturado',
  abonosEfectivo:      'Abono',
  miscelaneaEfectivo:  'Venta miscelánea',
  cobroOtraSucursal:   'Cobro de otra sucursal',
  cobroOtraSucursalSinFactura: 'Cobro de otra sucursal sin factura',
  devoluciones:        'Devolución',
  retiroEfectivo:      'Retiro de efectivo',
  faltante:            'Faltante',
};

/**
 * 2026-11-17 (pedido del usuario): ya NO se elige banco ni se captura la
 * denominación; la ficha trae TODOS los bancos de Bancos (con su cuenta) y el
 * importe / total recibido se llenan a mano.
 *
 * "Fichas de efectivo" (2026-11-04, pedido del usuario con la foto de su ficha
 * de entrega a traslado de valores). 2026-11-05: solo sucursal + rango de
 * fechas + banco (los de Bancos) + denominaciones; el efectivo de la CAJA de
 * la sucursal en cada día del rango (corte de caja de Kore) con un ANEXO de
 * cada venta → factura / global. Al imprimir se GUARDA con folio (rastro
 * venta → global → ficha); historial con buscador por folio, remisión o
 * factura / global; cancelar solo administrador.
 * Permiso propio que solo el administrador asigna.
 */
@Component({
  standalone: false,
  selector: 'app-fichas-efectivo',
  templateUrl: './fichas-efectivo.component.html',
  // Sin encapsular: el @media print tiene que alcanzar <body> (todo va con prefijo fe-).
  encapsulation: ViewEncapsulation.None,
})
export class FichasEfectivoComponent implements OnInit, OnDestroy {
  vistaActual: 'nueva' | 'historial' = 'nueva';

  centros: CentroCosto[] = [];
  centroCostoId: number | null = null;
  fechaInicio = this.hoy();
  fechaFin    = this.hoy();

  /** Todos los bancos de Bancos: salen todos en la ficha (2026-11-17). */
  bancos: BancoFicha[] = [];

  generando = false;
  guardando = false;
  ficha: FichaVista | null = null;
  verAnexo = true;
  /** Anexo › Actualizar en curso (2026-11-06). */
  actualizandoAnexo = false;

  // Ventana de cancelación (homologada, antes window.prompt).
  cancelarTarget: { id: string; folio: number } | null = null;
  motivoCancelacion = '';
  cancelando = false;

  // Historial
  buscandoHistorial = false;
  historial: FichaGuardadaResumen[] | null = null;
  qHistorial = '';
  centroHistorial: number | null = null;

  readonly esAdmin: boolean;
  /** El usuario solo puede ver algunas sucursales: en el historial no hay "Todas". */
  sucursalesRestringidas = false;
  /** Sin sucursales asignadas y sin "Todas" → no puede consultar ninguna (2026-11-06). */
  sinSucursales = false;
  /** Anexo de ventas: solo administrador o permiso reportes:fichas-efectivo:anexo (el backend tampoco lo manda). */
  readonly puedeAnexo: boolean;

  /** Fichas desde 2026-11-25: consignación facturada; la de sin factura ya no suma (va al anexo). */
  readonly renglones: RenglonFicha[] = [
    { clave: 'efectivoFacturado',     etiqueta: 'Efectivo facturado' },
    { clave: 'consignacionFacturada', etiqueta: 'Consignación facturada' },
    { clave: 'cobranzaEfectivo',      etiqueta: 'Cobranza facturado' },
    { clave: 'abonosEfectivo',        etiqueta: 'Abonos en efectivo' },
    { clave: 'miscelaneaEfectivo',    etiqueta: 'Venta miscelánea en efectivo' },
    { clave: 'cobroOtraSucursal',     etiqueta: 'Cobros de otras sucursales' },
    { clave: 'devoluciones',          etiqueta: 'Menos: devoluciones en efectivo', resta: true },
    { clave: 'retiroEfectivo',        etiqueta: 'Menos: retiro de efectivo', resta: true },
    { clave: 'faltante',              etiqueta: 'Menos: faltante en el cierre de caja', resta: true },
  ];

  /** Fichas guardadas antes del 2026-11-25: la consignación (sin factura) sí sumaba. */
  readonly renglonesAnteriores: RenglonFicha[] = [
    { clave: 'efectivoFacturado',   etiqueta: 'Efectivo facturado' },
    { clave: 'efectivoPorFacturar', etiqueta: 'Efectivo consignación' },
    { clave: 'cobranzaEfectivo',    etiqueta: 'Cobranza en efectivo' },
    { clave: 'abonosEfectivo',      etiqueta: 'Abonos en efectivo' },
    { clave: 'miscelaneaEfectivo',  etiqueta: 'Venta miscelánea en efectivo' },
    { clave: 'cobroOtraSucursal',   etiqueta: 'Cobros de otras sucursales' },
    { clave: 'devoluciones',        etiqueta: 'Menos: devoluciones en efectivo', resta: true },
    { clave: 'retiroEfectivo',      etiqueta: 'Menos: retiro de efectivo', resta: true },
    { clave: 'faltante',            etiqueta: 'Menos: faltante en el cierre de caja', resta: true },
  ];

  /** No suman: se muestran aparte, solo de referencia. */
  readonly informativos: RenglonFicha[] = [
    { clave: 'depositoEfectivo', etiqueta: 'Depósito en efectivo (no pasa por la caja)', informativo: true },
    { clave: 'saldoFavor',       etiqueta: 'Saldo a favor aplicado (no es efectivo)', informativo: true },
    // 2026-11-26: lo cobrado de más sobre lo facturado en las globales (BN de Kore); no se deposita.
    { clave: 'bonificacionGlobal', etiqueta: 'Bonificación de globales BN (cobrado que no se factura ni se deposita)', informativo: true },
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private svc: ReportesPorFacturarService,
    private centrosSvc: CentrosCostoService,
    private entidadActiva: EntidadActivaService,
    private toast: ToastService,
    private auth: AuthService,
  ) {
    this.esAdmin = auth.hasPermission('*');
    this.puedeAnexo = auth.hasPermission('reportes:fichas-efectivo:anexo');
  }

  ngOnInit(): void {
    this.centrosSvc.list().subscribe({
      next: cs => {
        // Usuario con sucursales asignadas (2026-11-05): solo ve las suyas — también el administrador.
        // 2026-11-06: casilla "Todas" = todas; sin ella solo las asignadas ([] = ninguna).
        const todas = this.auth.currentUser.todasSucursales === true;
        const permitidas = this.auth.currentUser.sucursalIds ?? [];
        this.centros = cs.filter(c => c.isActive && c.serieFacturacion && (todas || permitidas.includes(c.id)))
          .sort((a, b) => a.sucursal.localeCompare(b.sucursal));
        this.sucursalesRestringidas = !todas;
        this.sinSucursales = !todas && !permitidas.length;
        if (this.centros.length === 1) { this.centroCostoId = this.centros[0].id; this.centroHistorial = this.centros[0].id; }
      },
    });
    this.svc.bancosParaFicha().subscribe({
      next: bs => { this.bancos = bs; },
      error: () => this.toast.error('No se pudieron traer los bancos'),
    });
    this.entidadActiva.entidadActiva$.pipe(takeUntil(this.destroy$)).subscribe(() => { this.nuevaFicha(); this.historial = null; });
  }

  ngOnDestroy(): void {
    document.body.classList.remove(CLASE_IMPRIMIENDO);
    this.destroy$.next();
    this.destroy$.complete();
  }

  private hoy(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  }

  private get rfc(): string | null {
    return this.entidadActiva.snapshot?.rfc ?? null;
  }

  /** Una ficha guardada se ve en modo lectura (no se editan banco ni denominaciones). */
  get soloLectura(): boolean {
    return !!this.ficha?.folio;
  }

  limpiar(): void {
    if (!this.soloLectura) this.ficha = null;
  }

  nuevaFicha(): void {
    this.ficha = null;
    this.vistaActual = 'nueva';
  }

  generar(): void {
    const rfc = this.rfc;
    if (!rfc) { this.toast.error('Selecciona una empresa'); return; }
    if (this.centroCostoId == null) { this.toast.error('Elige la sucursal'); return; }
    if (!this.fechaInicio || !this.fechaFin || this.fechaFin < this.fechaInicio) { this.toast.error('Revisa las fechas'); return; }
    const dias = Math.round((Date.parse(this.fechaFin + 'T00:00:00Z') - Date.parse(this.fechaInicio + 'T00:00:00Z')) / 86400000) + 1;
    if (dias > MAX_DIAS) { this.toast.error(`El rango no puede pasar de ${MAX_DIAS} días (elegiste ${dias})`); return; }
    this.generando = true;
    this.ficha = null;
    this.svc.generarFicha({ rfc, centroCostoId: this.centroCostoId, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin }).subscribe({
      next: f => {
        this.generando = false;
        this.ficha = f;
      },
      error: err => { this.generando = false; this.toast.error(err?.error?.message || 'No se pudo generar la ficha'); },
    });
  }

  get motivoNoGuardar(): string | null {
    const f = this.ficha;
    if (!f) return 'Genera la ficha';
    if (f.incompleta) return 'Kore no respondió alguna caja: vuelve a generar la ficha';
    if (!f.cortes.length) return 'No hay efectivo en esas fechas';
    if (f.yaEnFicha?.length) return `Ya hay días en la ficha ${this.foliosYaEnFicha(f)}`;
    return null;
  }

  foliosYaEnFicha(f: FichaEfectivo): string {
    return [...new Set((f.yaEnFicha ?? []).map(x => this.folioTexto(x.folio)))].join(', ');
  }

  /** Folio de 5 dígitos (al azar, único — 2026-11-05). */
  folioTexto(n: number | null | undefined): string {
    return n == null ? '' : String(n).padStart(5, '0');
  }

  /** Guarda la ficha con folio (el servidor la recalcula y valida) y la imprime. */
  guardarEImprimir(): void {
    const motivo = this.motivoNoGuardar;
    const rfc = this.rfc;
    if (motivo || !rfc || !this.ficha) { if (motivo) this.toast.error(motivo); return; }
    this.guardando = true;
    this.svc.guardarFicha({
      rfc, centroCostoId: this.ficha.centroCostoId, fechaInicio: this.ficha.fechaInicio, fechaFin: this.ficha.fechaFin,
    }).subscribe({
      next: g => {
        this.guardando = false;
        this.mostrarGuardada(g);
        this.toast.success(`Ficha ${this.folioTexto(g.folio)} guardada`);
        setTimeout(() => this.imprimir(), 50);
      },
      error: err => { this.guardando = false; this.toast.error(err?.error?.message || 'No se pudo guardar la ficha'); },
    });
  }

  private mostrarGuardada(g: FichaGuardada): void {
    this.ficha = {
      generadoEn: g.createdAt, centroCostoId: g.centroCostoId, sucursal: g.sucursal, series: g.series,
      fechaInicio: g.fechaInicio, fechaFin: g.fechaFin, cortes: g.cortes, totales: g.totales, detalle: g.detalle,
      yaEnFicha: [], incompleta: false, advertencias: null, anexoActualizadoEn: g.anexoActualizadoEn ?? null,
      folio: g.folio, estado: g.estado, guardada: g,
    };
    this.vistaActual = 'nueva';
  }

  /** Imprime solo la ficha (desde ahí se puede guardar en PDF). */
  imprimir(): void {
    const quitar = () => {
      document.body.classList.remove(CLASE_IMPRIMIENDO);
      window.removeEventListener('afterprint', quitar);
    };
    document.body.classList.add(CLASE_IMPRIMIENDO);
    window.addEventListener('afterprint', quitar);
    window.print();
  }

  // ── Bancos ────────────────────────────────────────────────────────────────
  logoBanco(banco: string): string | null {
    return LOGOS_BANCO.has(banco) ? `bancos/${banco}.svg` : null;
  }

  /**
   * Bancos que salen en la ficha: al generar, todos los de Bancos; en una ficha
   * guardada, los que se guardaron con ella (las viejas traen el banco elegido y su importe).
   */
  get bancosFicha(): BancoFichaImporte[] {
    const g = this.ficha?.guardada;
    if (g) return g.bancos ?? [];
    return this.bancos.map(b => ({ ...b, importe: null }));
  }

  /** Total recibido: solo en fichas viejas (con denominación); en las nuevas se llena a mano. */
  get totalRecibido(): number | null {
    return this.ficha?.guardada?.totalContado ?? null;
  }

  // ── Historial ─────────────────────────────────────────────────────────────
  verHistorial(): void {
    this.vistaActual = 'historial';
    if (!this.historial) this.buscarHistorial();
  }

  buscarHistorial(): void {
    const rfc = this.rfc;
    if (!rfc) { this.toast.error('Selecciona una empresa'); return; }
    this.buscandoHistorial = true;
    this.svc.fichasGuardadas({ rfc, centroCostoId: this.centroHistorial, q: this.qHistorial.trim() }).subscribe({
      next: r => { this.buscandoHistorial = false; this.historial = r; },
      error: err => { this.buscandoHistorial = false; this.toast.error(err?.error?.message || 'No se pudo traer el historial'); },
    });
  }

  abrir(h: FichaGuardadaResumen): void {
    const rfc = this.rfc;
    if (!rfc) return;
    this.svc.fichaGuardada(rfc, h.id).subscribe({
      next: g => this.mostrarGuardada(g),
      error: err => this.toast.error(err?.error?.message || 'No se pudo abrir la ficha'),
    });
  }

  bancosTexto(bs: BancoFichaImporte[] | undefined): string {
    // Fichas viejas: el banco elegido (con importe). Desde 2026-11-17 llevan todos → "Todos".
    const elegidos = (bs ?? []).filter(b => b.importe != null);
    if (!elegidos.length) return bs?.length ? 'Todos' : '—';
    return elegidos.map(b => b.banco + (b.numeroCuenta ? ' · ' + b.numeroCuenta : '')).join(', ');
  }

  cancelar(h: { id: string; folio: number }): void {
    this.cancelarTarget = { id: h.id, folio: h.folio };
    this.motivoCancelacion = '';
  }

  cerrarCancelar(): void {
    if (this.cancelando) return;
    this.cancelarTarget = null;
  }

  confirmarCancelar(): void {
    const rfc = this.rfc;
    const h = this.cancelarTarget;
    const motivo = this.motivoCancelacion.trim();
    if (!rfc || !h || motivo.length < 5) return;
    this.cancelando = true;
    this.svc.cancelarFicha(rfc, h.id, motivo).subscribe({
      next: g => {
        this.cancelando = false;
        this.cancelarTarget = null;
        this.toast.success(`Ficha ${this.folioTexto(g.folio)} cancelada`);
        if (this.ficha?.folio === g.folio) this.mostrarGuardada({ ...this.ficha.guardada!, estado: 'cancelada', canceladaEn: g.canceladaEn, motivoCancelacion: g.motivoCancelacion });
        if (this.historial) this.buscarHistorial();
      },
      error: err => { this.cancelando = false; this.toast.error(err?.error?.message || 'No se pudo cancelar la ficha'); },
    });
  }

  // ── Anexo › Actualizar (2026-11-06) ───────────────────────────────────────
  /** Ventas del anexo que siguen sin factura. */
  /** Ficha con los renglones del 2026-11-25 (trae consignación facturada). */
  esFichaNueva(f: FichaVista): boolean {
    return f.totales?.consignacionFacturada != null;
  }

  renglonesDe(f: FichaVista): RenglonFicha[] {
    return this.esFichaNueva(f) ? this.renglones : this.renglonesAnteriores;
  }

  private gruposCache = new WeakMap<FichaVista, { detalle: DetalleFicha[] | undefined; grupos: GrupoAnexo[] }>();
  private globalesCache = new WeakMap<FichaVista, { detalle: DetalleFicha[] | undefined; r: { total: number; porGlobal: { factura: string; importe: number }[] } | null }>();

  /**
   * Total "Facturación global en efectivo" (2026-11-26, pedido del usuario): lo facturado
   * de los cobros que suman y están en una factura GLOBAL, por global — para compararlo con
   * "Mostrador Kore - Efectivo" del reporte. Ya va incluido en los renglones; no suma aparte.
   */
  globalesEfectivo(f: FichaVista): { total: number; porGlobal: { factura: string; importe: number }[] } | null {
    const cache = this.globalesCache.get(f);
    if (cache && cache.detalle === f.detalle) return cache.r;
    const suman = new Set<string>(this.renglones.filter(x => !x.resta).map(x => x.clave as string));
    const por = new Map<string, number>();
    for (const d of f.detalle ?? []) {
      if (!d.esGlobal || !d.factura || !suman.has(d.concepto as string)) continue;
      por.set(d.factura, (por.get(d.factura) ?? 0) + (d.facturado ?? d.importe ?? 0));
    }
    const porGlobal = [...por.entries()].map(([factura, importe]) => ({ factura, importe: Math.round(importe * 100) / 100 }))
      .sort((a, b) => b.importe - a.importe);
    const r = porGlobal.length ? { total: Math.round(porGlobal.reduce((s, x) => s + x.importe, 0) * 100) / 100, porGlobal } : null;
    this.globalesCache.set(f, { detalle: f.detalle, r });
    return r;
  }

  /**
   * Anexo por renglón de la ficha (2026-11-25, pedido del usuario): una tabla por
   * concepto (efectivo facturado, consignación facturada, cobranza, abonos…), en
   * el orden de la ficha y con su total; la consignación sin factura (no suma) al final.
   */
  gruposAnexo(f: FichaVista): GrupoAnexo[] {
    const cache = this.gruposCache.get(f);
    if (cache && cache.detalle === f.detalle) return cache.grupos;
    const detalle = f.detalle ?? [];
    const orden: { clave: string; etiqueta: string; filtro?: (d: DetalleFicha) => boolean }[] =
      this.renglonesDe(f).map(r => ({ clave: r.clave, etiqueta: r.etiqueta }));
    if (this.esFichaNueva(f)) {
      // 2026-11-26 (pedido del usuario): la consignación sin factura se separa en la que dejó
      // saldo pendiente y la que quedó en saldo 0. Fichas sin el saldo guardado → en la primera.
      const saldo0 = (d: DetalleFicha) => d.saldoDespues != null && d.saldoDespues < 0.01;
      orden.push({ clave: 'efectivoPorFacturar', etiqueta: 'Efectivo consignación sin factura — no suma al total a entregar', filtro: d => !saldo0(d) });
      orden.push({ clave: 'efectivoPorFacturar', etiqueta: 'Efectivo consignación sin factura PERO CON SALDO 0 — no suma al total a entregar', filtro: saldo0 });
      // 2026-11-26: cobros de otras sucursales sin factura; suman en esta caja el día que se facturen.
      orden.push({ clave: 'cobroOtraSucursalSinFactura', etiqueta: 'Cobros de otras sucursales sin factura — no suma al total a entregar' });
    }
    const grupos: GrupoAnexo[] = [];
    for (const r of orden) {
      const filas = detalle.filter(d => d.concepto === r.clave && (!r.filtro || r.filtro(d)));
      if (filas.length) grupos.push({ clave: r.clave, etiqueta: r.etiqueta, corta: this.etiquetaCorta(r.etiqueta), filas, total: this.sumaImportes(filas), totalFacturado: this.sumaFacturado(filas) });
    }
    const conocidas = new Set(orden.map(r => r.clave));
    const otras = detalle.filter(d => !conocidas.has(d.concepto));
    if (otras.length) grupos.push({ clave: 'otros', etiqueta: 'Otros', corta: 'otros', filas: otras, total: this.sumaImportes(otras), totalFacturado: this.sumaFacturado(otras) });
    this.gruposCache.set(f, { detalle: f.detalle, grupos });
    return grupos;
  }

  private etiquetaCorta(etiqueta: string): string {
    return etiqueta.replace(/^Menos:\s*/i, '').replace(/\s+—.*$/, '').replace(/^./, c => c.toLowerCase());
  }

  /** Suma de lo facturado; null si ningún renglón trae `facturado`. */
  sumaFacturado(d: DetalleFicha[]): number | null {
    if (!d.some(x => x.facturado != null)) return null;
    return Math.round(d.reduce((s, x) => s + (x.facturado ?? x.importe ?? 0), 0) * 100) / 100;
  }

  sumaImportes(d: DetalleFicha[]): number {
    return Math.round(d.reduce((s, x) => s + (x.importe || 0), 0) * 100) / 100;
  }

  sinFacturaAnexo(f: FichaVista): number {
    return (f.detalle ?? []).filter(d => d.remision && !d.factura && d.concepto !== 'devoluciones' && d.concepto !== 'retiroEfectivo' && d.concepto !== 'faltante').length;
  }

  /** Pregunta a Kore si las ventas sin factura ya se facturaron (los importes no cambian). */
  actualizarAnexo(): void {
    const f = this.ficha;
    const rfc = this.rfc;
    if (!f?.detalle || !rfc || this.actualizandoAnexo) return;
    this.actualizandoAnexo = true;
    const aviso = (r: { nuevas: number; siguenSinFactura: number; advertencias: string[] | null }) => {
      this.actualizandoAnexo = false;
      if (r.advertencias?.length) this.toast.error(r.advertencias.join(' '));
      if (r.nuevas) this.toast.success(`${r.nuevas} venta${r.nuevas === 1 ? '' : 's'} ya facturada${r.nuevas === 1 ? '' : 's'}; siguen sin factura: ${r.siguenSinFactura}`);
      else if (!r.advertencias?.length) this.toast.success(r.siguenSinFactura ? `Ninguna nueva: siguen sin factura ${r.siguenSinFactura}` : 'Todas las ventas ya tienen factura');
    };
    const error = (err: any) => { this.actualizandoAnexo = false; this.toast.error(err?.error?.message || 'No se pudo actualizar el anexo'); };
    if (f.folio && f.guardada) {
      this.svc.actualizarAnexoGuardada(rfc, f.guardada.id).subscribe({
        next: g => {
          const { resultadoActualizar, ...guardada } = g;
          this.ficha = { ...f, detalle: guardada.detalle, anexoActualizadoEn: guardada.anexoActualizadoEn ?? null, guardada: { ...f.guardada!, ...guardada } };
          aviso(resultadoActualizar);
        },
        error,
      });
    } else {
      this.svc.actualizarAnexo({ rfc, centroCostoId: f.centroCostoId, detalle: f.detalle }).subscribe({
        next: r => { this.ficha = { ...f, detalle: r.detalle, anexoActualizadoEn: r.actualizadoEn }; aviso(r); },
        error,
      });
    }
  }

  // ── Textos ────────────────────────────────────────────────────────────────
  etiquetaConcepto(d: DetalleFicha): string {
    return ETIQUETA_CONCEPTO[d.concepto] ?? d.concepto;
  }

  private corto(d: string): string {
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y.slice(2)}`;
  }

  /** Fecha de entrega: la de hoy al generar; en una ficha guardada, la del día en que se guardó. */
  fechaEntrega(f: FichaVista): string {
    return f.guardada?.createdAt ?? f.generadoEn ?? new Date().toISOString();
  }

  /** "DEL DÍA 04/11/26" / "DEL 01/11/26 AL 04/11/26". */
  periodoTexto(f: { fechaInicio: string; fechaFin: string }): string {
    return f.fechaInicio === f.fechaFin ? `DEL DÍA ${this.corto(f.fechaInicio)}` : `DEL ${this.corto(f.fechaInicio)} AL ${this.corto(f.fechaFin)}`;
  }

}
