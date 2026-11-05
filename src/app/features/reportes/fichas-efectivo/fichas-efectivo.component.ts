import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, BancoFicha, FichaEfectivo, MontosFicha, DetalleFicha,
  FichaGuardada, FichaGuardadaResumen, DenominacionFicha,
} from '../../../core/services/reportes-por-facturar.service';

const CLASE_IMPRIMIENDO = 'fe-imprimiendo';
/** Diferencia aceptada entre lo contado y la ficha: solo los centavos que no se juntan con monedas (igual que el backend). */
const TOLERANCIA = 1;

interface RenglonFicha {
  clave: keyof MontosFicha;
  etiqueta: string;
  /** Resta del total (devoluciones, faltante). */
  resta?: boolean;
  /** No suma al total a entregar (depósito en efectivo, saldo a favor). */
  informativo?: boolean;
}

interface Denominacion {
  valor: number;
  tipo: 'Billete' | 'Moneda';
  cantidad: number | null;
}

/** Lo que se muestra / imprime: una ficha recién calculada o una guardada. */
interface FichaVista extends FichaEfectivo {
  folio?: number;
  estado?: 'vigente' | 'cancelada';
  guardada?: FichaGuardada;
}

const ETIQUETA_CONCEPTO: Partial<Record<keyof MontosFicha, string>> = {
  efectivoFacturado:   'Facturado',
  efectivoPorFacturar: 'Por facturar',
  cobranzaEfectivo:    'Cobranza',
  abonosEfectivo:      'Abono',
  devoluciones:        'Devolución',
  faltante:            'Faltante',
};

/**
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

  bancos: BancoFicha[] = [];
  banco: BancoFicha | null = null;
  sucursalBanco = '';

  generando = false;
  guardando = false;
  ficha: FichaVista | null = null;
  verAnexo = true;

  verDenominaciones = false;
  denominaciones: Denominacion[] = this.denominacionesVacias();

  // Historial
  buscandoHistorial = false;
  historial: FichaGuardadaResumen[] | null = null;
  qHistorial = '';
  centroHistorial: number | null = null;

  readonly esAdmin: boolean;

  readonly renglones: RenglonFicha[] = [
    { clave: 'efectivoFacturado',   etiqueta: 'Efectivo facturado' },
    { clave: 'efectivoPorFacturar', etiqueta: 'Efectivo por facturar' },
    { clave: 'cobranzaEfectivo',    etiqueta: 'Cobranza en efectivo' },
    { clave: 'abonosEfectivo',      etiqueta: 'Abonos en efectivo' },
    { clave: 'devoluciones',        etiqueta: 'Menos: devoluciones en efectivo', resta: true },
    { clave: 'faltante',            etiqueta: 'Menos: faltante en el cierre de caja', resta: true },
  ];

  /** No suman: se muestran aparte, solo de referencia. */
  readonly informativos: RenglonFicha[] = [
    { clave: 'depositoEfectivo', etiqueta: 'Depósito en efectivo (no pasa por la caja)', informativo: true },
    { clave: 'saldoFavor',       etiqueta: 'Saldo a favor aplicado (no es efectivo)', informativo: true },
  ];

  private readonly destroy$ = new Subject<void>();

  constructor(
    private svc: ReportesPorFacturarService,
    private centrosSvc: CentrosCostoService,
    private entidadActiva: EntidadActivaService,
    private toast: ToastService,
    auth: AuthService,
  ) {
    this.esAdmin = auth.hasPermission('*');
  }

  ngOnInit(): void {
    this.centrosSvc.list().subscribe({
      next: cs => { this.centros = cs.filter(c => c.isActive && c.serieFacturacion).sort((a, b) => a.sucursal.localeCompare(b.sucursal)); },
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

  private denominacionesVacias(): Denominacion[] {
    const billetes = [1000, 500, 200, 100, 50, 20].map(valor => ({ valor, tipo: 'Billete' as const, cantidad: null }));
    const monedas = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05].map(valor => ({ valor, tipo: 'Moneda' as const, cantidad: null }));
    return [...billetes, ...monedas];
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
    this.banco = null;
    this.sucursalBanco = '';
    this.denominaciones = this.denominacionesVacias();
    this.vistaActual = 'nueva';
  }

  generar(): void {
    const rfc = this.rfc;
    if (!rfc) { this.toast.error('Selecciona una empresa'); return; }
    if (this.centroCostoId == null) { this.toast.error('Elige la sucursal'); return; }
    if (!this.fechaInicio || !this.fechaFin || this.fechaFin < this.fechaInicio) { this.toast.error('Revisa las fechas'); return; }
    this.generando = true;
    this.ficha = null;
    this.svc.generarFicha({ rfc, centroCostoId: this.centroCostoId, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin }).subscribe({
      next: f => { this.generando = false; this.ficha = f; },
      error: err => { this.generando = false; this.toast.error(err?.error?.message || 'No se pudo generar la ficha'); },
    });
  }

  // ── Denominaciones ────────────────────────────────────────────────────────
  importe(d: { valor: number; cantidad: number | null }): number {
    const n = Math.max(0, Math.floor(Number(d.cantidad) || 0));
    return Math.round(n * d.valor * 100) / 100;
  }

  get denominacionesUsadas(): Denominacion[] {
    return this.denominaciones.filter(d => this.importe(d) > 0);
  }

  get totalContado(): number {
    return Math.round(this.denominaciones.reduce((s, d) => s + this.importe(d), 0) * 100) / 100;
  }

  get totalBilletes(): number {
    return this.denominaciones.filter(d => d.tipo === 'Billete').reduce((s, d) => s + this.importe(d), 0);
  }

  get totalMonedas(): number {
    return this.denominaciones.filter(d => d.tipo === 'Moneda').reduce((s, d) => s + this.importe(d), 0);
  }

  /** Contado − total a entregar. */
  get diferencia(): number {
    return Math.round((this.totalContado - (this.ficha?.totales.totalEntregar ?? 0)) * 100) / 100;
  }

  get cuadra(): boolean {
    return !!this.ficha && this.totalContado > 0 && Math.abs(this.diferencia) < TOLERANCIA;
  }

  limpiarDenominaciones(): void {
    if (!this.soloLectura) this.denominaciones = this.denominacionesVacias();
  }

  get motivoNoGuardar(): string | null {
    const f = this.ficha;
    if (!f) return 'Genera la ficha';
    if (f.incompleta) return 'Kore no respondió alguna caja: vuelve a generar la ficha';
    if (!f.cortes.length) return 'No hay efectivo en esas fechas';
    if (f.yaEnFicha?.length) return `Ya hay días en la ficha ${this.foliosYaEnFicha(f)}`;
    if (!this.banco) return 'Elige el banco';
    if (!this.totalContado) return 'Captura las denominaciones';
    if (!this.cuadra) return 'Las denominaciones no dan el total a entregar';
    return null;
  }

  foliosYaEnFicha(f: FichaEfectivo): string {
    return [...new Set((f.yaEnFicha ?? []).map(x => x.folio))].join(', ');
  }

  /** Guarda la ficha con folio (el servidor la recalcula y valida) y la imprime. */
  guardarEImprimir(): void {
    const motivo = this.motivoNoGuardar;
    const rfc = this.rfc;
    if (motivo || !rfc || !this.ficha || !this.banco) { if (motivo) this.toast.error(motivo); return; }
    const denominaciones: DenominacionFicha[] = this.denominacionesUsadas.map(d => ({ tipo: d.tipo, valor: d.valor, cantidad: Math.floor(Number(d.cantidad)) }));
    this.guardando = true;
    this.svc.guardarFicha({
      rfc, centroCostoId: this.ficha.centroCostoId, fechaInicio: this.ficha.fechaInicio, fechaFin: this.ficha.fechaFin,
      banco: this.banco.banco, sucursalBanco: this.sucursalBanco, denominaciones,
    }).subscribe({
      next: g => {
        this.guardando = false;
        this.mostrarGuardada(g);
        this.toast.success(`Ficha ${g.folio} guardada`);
        setTimeout(() => this.imprimir(), 50);
      },
      error: err => { this.guardando = false; this.toast.error(err?.error?.message || 'No se pudo guardar la ficha'); },
    });
  }

  private mostrarGuardada(g: FichaGuardada): void {
    this.ficha = {
      generadoEn: g.createdAt, centroCostoId: g.centroCostoId, sucursal: g.sucursal, series: g.series,
      fechaInicio: g.fechaInicio, fechaFin: g.fechaFin, cortes: g.cortes, totales: g.totales, detalle: g.detalle,
      yaEnFicha: [], incompleta: false, advertencias: null,
      folio: g.folio, estado: g.estado, guardada: g,
    };
    this.banco = { banco: g.banco ?? '', numeroCuenta: g.numeroCuenta };
    this.sucursalBanco = g.sucursalBanco ?? '';
    this.denominaciones = this.denominacionesVacias().map(d => {
      const x = g.denominaciones.find(y => y.tipo === d.tipo && y.valor === d.valor);
      return { ...d, cantidad: x ? x.cantidad : null };
    });
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

  cancelar(h: { id: string; folio: number }): void {
    const rfc = this.rfc;
    if (!rfc) return;
    const motivo = window.prompt(`Motivo para cancelar la ficha ${h.folio} (sus días quedan libres para otra ficha):`);
    if (motivo == null) return;
    this.svc.cancelarFicha(rfc, h.id, motivo).subscribe({
      next: g => {
        this.toast.success(`Ficha ${g.folio} cancelada`);
        if (this.ficha?.folio === g.folio) this.mostrarGuardada({ ...this.ficha.guardada!, estado: 'cancelada', canceladaEn: g.canceladaEn, motivoCancelacion: g.motivoCancelacion });
        if (this.historial) this.buscarHistorial();
      },
      error: err => this.toast.error(err?.error?.message || 'No se pudo cancelar la ficha'),
    });
  }

  // ── Textos ────────────────────────────────────────────────────────────────
  etiquetaConcepto(d: DetalleFicha): string {
    return ETIQUETA_CONCEPTO[d.concepto] ?? d.concepto;
  }

  private corto(d: string): string {
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y.slice(2)}`;
  }

  /** "DEL DÍA 04/11/26" / "DEL 01/11/26 AL 04/11/26". */
  periodoTexto(f: { fechaInicio: string; fechaFin: string }): string {
    return f.fechaInicio === f.fechaFin ? `DEL DÍA ${this.corto(f.fechaInicio)}` : `DEL ${this.corto(f.fechaInicio)} AL ${this.corto(f.fechaFin)}`;
  }

  /** Facturas globales que amparan el efectivo de la ficha (para el encabezado). */
  globales(f: FichaEfectivo): string[] {
    return [...new Set(f.detalle.filter(d => d.esGlobal && d.factura).map(d => d.factura as string))].sort();
  }
}
