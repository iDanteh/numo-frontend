import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, GlobalParaFicha, FichaEfectivo, MontosFicha,
} from '../../../core/services/reportes-por-facturar.service';

const CLASE_IMPRIMIENDO = 'fe-imprimiendo';

interface RenglonFicha {
  clave: keyof MontosFicha;
  etiqueta: string;
  /** Resta del total (devoluciones, faltante). */
  resta?: boolean;
  /** No suma al total a entregar (depósito en efectivo, saldo a favor). */
  informativo?: boolean;
}

/**
 * "Fichas de efectivo" (2026-11-04, pedido del usuario con la foto de su ficha
 * de entrega a traslado de valores): sucursal + periodo → facturas globales
 * (buscador y casillas) → una ficha imprimible con el efectivo de la CAJA de
 * cada sucursal / día de las globales elegidas (corte de caja de Kore):
 * facturado, por facturar, cobranza y abonos, menos devoluciones y faltante.
 * Permiso propio que solo el administrador asigna. Se imprime / guarda en PDF
 * desde el navegador.
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

  buscando = false;
  globales: GlobalParaFicha[] | null = null;
  avisosLista: string[] | null = null;
  filtro = '';
  seleccion = new Set<string>();

  generando = false;
  ficha: FichaEfectivo | null = null;

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

  limpiar(): void {
    this.globales = null;
    this.avisosLista = null;
    this.seleccion.clear();
    this.ficha = null;
  }

  buscar(): void {
    const rfc = this.rfc;
    if (!rfc) { this.toast.error('Selecciona una empresa'); return; }
    if (!this.fechaInicio || !this.fechaFin || this.fechaFin < this.fechaInicio) { this.toast.error('Revisa las fechas'); return; }
    this.buscando = true;
    this.limpiar();
    this.svc.globalesParaFicha({ rfc, centroCostoId: this.centroCostoId, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin }).subscribe({
      next: r => { this.buscando = false; this.globales = r.globales; this.avisosLista = r.advertencias; },
      error: err => { this.buscando = false; this.toast.error(err?.error?.message || 'No se pudieron traer las facturas globales'); },
    });
  }

  /** Busca por folio (con o sin serie), fecha (dd/mm/aa) o importe. */
  get globalesFiltradas(): GlobalParaFicha[] {
    const lista = this.globales ?? [];
    const q = this.filtro.trim().toLowerCase().replace(/[$,\s]/g, '');
    if (!q) return lista;
    return lista.filter(g => {
      const [y, m, d] = g.dia.split('-');
      const textos = [`${g.serie}-${g.folio}`, g.folio, `${d}/${m}/${y.slice(2)}`, `${d}/${m}/${y}`, g.total.toFixed(2), String(g.total), g.sucursal ?? '']
        .map(t => t.toLowerCase().replace(/[$,\s]/g, ''));
      return textos.some(t => t.includes(q));
    });
  }

  marcado(g: GlobalParaFicha): boolean {
    return this.seleccion.has(g.uuid);
  }

  alternar(g: GlobalParaFicha): void {
    if (this.seleccion.has(g.uuid)) this.seleccion.delete(g.uuid); else this.seleccion.add(g.uuid);
  }

  get todasFiltradasMarcadas(): boolean {
    const f = this.globalesFiltradas;
    return f.length > 0 && f.every(g => this.seleccion.has(g.uuid));
  }

  alternarTodas(): void {
    const f = this.globalesFiltradas;
    if (this.todasFiltradasMarcadas) f.forEach(g => this.seleccion.delete(g.uuid));
    else f.forEach(g => this.seleccion.add(g.uuid));
  }

  get totalSeleccion(): number {
    return (this.globales ?? []).filter(g => this.seleccion.has(g.uuid)).reduce((s, g) => s + g.total, 0);
  }

  generar(): void {
    const rfc = this.rfc;
    if (!rfc || !this.seleccion.size) return;
    this.generando = true;
    this.ficha = null;
    this.svc.generarFicha(rfc, [...this.seleccion]).subscribe({
      next: f => { this.generando = false; this.ficha = f; },
      error: err => { this.generando = false; this.toast.error(err?.error?.message || 'No se pudo generar la ficha'); },
    });
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

  /** "31/10/26 y 01/11/26" / "31/10/26, 01/11/26 y 02/11/26". */
  diasTexto(f: FichaEfectivo): string {
    const cortos = f.dias.map(d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y.slice(2)}`; });
    return cortos.length > 1 ? `${cortos.slice(0, -1).join(', ')} y ${cortos[cortos.length - 1]}` : cortos[0] ?? '';
  }
}
