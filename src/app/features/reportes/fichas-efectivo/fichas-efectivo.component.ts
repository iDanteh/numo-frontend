import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, BancoFicha, FichaEfectivo, MontosFicha,
} from '../../../core/services/reportes-por-facturar.service';

const CLASE_IMPRIMIENDO = 'fe-imprimiendo';
/** Diferencia aceptada entre lo contado y la ficha: solo los centavos que no se juntan con monedas. */
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

/**
 * "Fichas de efectivo" (2026-11-04, pedido del usuario con la foto de su ficha
 * de entrega a traslado de valores). 2026-11-05: solo sucursal + rango de
 * fechas + banco (los de Bancos) + denominaciones (cuántos billetes / monedas
 * de cada valor). La ficha trae el efectivo de la CAJA de la sucursal en cada
 * día del rango (corte de caja de Kore) y lo contado en denominaciones tiene
 * que dar lo mismo que el total a entregar para poder imprimirla.
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
  centros: CentroCosto[] = [];
  centroCostoId: number | null = null;
  fechaInicio = this.hoy();
  fechaFin    = this.hoy();

  bancos: BancoFicha[] = [];
  banco: BancoFicha | null = null;
  sucursalBanco = '';

  generando = false;
  ficha: FichaEfectivo | null = null;

  verDenominaciones = false;
  denominaciones: Denominacion[] = this.denominacionesVacias();

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
  ) {}

  ngOnInit(): void {
    this.centrosSvc.list().subscribe({
      next: cs => { this.centros = cs.filter(c => c.isActive && c.serieFacturacion).sort((a, b) => a.sucursal.localeCompare(b.sucursal)); },
    });
    this.svc.bancosParaFicha().subscribe({
      next: bs => { this.bancos = bs; },
      error: () => this.toast.error('No se pudieron traer los bancos'),
    });
    this.entidadActiva.entidadActiva$.pipe(takeUntil(this.destroy$)).subscribe(() => this.limpiar());
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

  limpiar(): void {
    this.ficha = null;
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
  importe(d: Denominacion): number {
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
    this.denominaciones = this.denominacionesVacias();
  }

  get motivoNoImprimir(): string | null {
    if (!this.ficha) return 'Genera la ficha';
    if (!this.banco) return 'Elige el banco';
    if (!this.totalContado) return 'Captura las denominaciones';
    if (!this.cuadra) return 'Las denominaciones no dan el total a entregar';
    return null;
  }

  /** Imprime solo la ficha (desde ahí se puede guardar en PDF). */
  imprimir(): void {
    const motivo = this.motivoNoImprimir;
    if (motivo) { this.toast.error(motivo); return; }
    const quitar = () => {
      document.body.classList.remove(CLASE_IMPRIMIENDO);
      window.removeEventListener('afterprint', quitar);
    };
    document.body.classList.add(CLASE_IMPRIMIENDO);
    window.addEventListener('afterprint', quitar);
    window.print();
  }

  private corto(d: string): string {
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y.slice(2)}`;
  }

  /** "DEL DÍA 04/11/26" / "DEL 01/11/26 AL 04/11/26". */
  periodoTexto(f: FichaEfectivo): string {
    return f.fechaInicio === f.fechaFin ? `DEL DÍA ${this.corto(f.fechaInicio)}` : `DEL ${this.corto(f.fechaInicio)} AL ${this.corto(f.fechaFin)}`;
  }
}
