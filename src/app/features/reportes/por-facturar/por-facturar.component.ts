import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

/** Cada cuánto se revisa el historial mientras hay reportes calculando (2026-10-29). */
const INTERVALO_MS = 5000;
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, ReportePorFacturarRow, ReportePorFacturarDetalle, FacturaMostrador,
  AlmacenRef, BloquePorFacturar, SeccionPorFacturar,
} from '../../../core/services/reportes-por-facturar.service';

/** Pestañas con el formato del Excel "MOSTRADOR 2026" del usuario (2026-10-29), cada una con su Excel. */
interface PestanaPorFacturar {
  id:       SeccionPorFacturar;
  etiqueta: string;
  titulo:   string;
  nota:     string;
}

const PESTANAS: PestanaPorFacturar[] = [
  { id: 'mostrador', etiqueta: 'Mostrador', titulo: 'MOSTRADOR',
    nota: 'Un bloque por factura global (como tu hoja MOSTRADOR): depósitos de Bancos y cobros en EFECTIVO / SALDO A FAVOR de Kore de las remisiones PPD por facturar. Al final, los depósitos pendientes de generar factura.' },
  { id: 'ref', etiqueta: 'REF. por sucursal', titulo: 'REF. — PPD YA FACTURADO A NOMBRE DEL CLIENTE',
    nota: 'PPD por facturar que ya se facturó a nombre del cliente: una hoja por almacén (como REF. HIDG1 / REF. CONTRU.), un bloque por día.' },
  { id: 'especiales', etiqueta: 'Fact especiales', titulo: 'FACT ESPECIALES',
    nota: 'Igual que REF., pero la factura salió a nombre de otro (CTE FACTURADO distinto del cliente de la remisión).' },
  { id: 'ficha', etiqueta: 'X fac con ficha de dep', titulo: 'X FAC CON FICHA DE DEP',
    nota: 'Depósitos identificados que solo abonan: las remisiones PPD por facturar todavía deben saldo. Cuando el saldo llegue a 0 pasan a pendientes de generar factura.' },
  { id: 'efectivo', etiqueta: 'Depósitos en efectivo', titulo: 'DEPÓSITOS EN EFECTIVO — SIN ASOCIAR A NINGUNA VENTA',
    nota: 'Depósitos en efectivo del periodo que todavía no están ligados a ninguna venta en Bancos. Sin vínculo no se sabe de qué sucursal son, por eso salen todos.' },
];

/**
 * Reporte "Por facturar" (2026-10-22): lo mismo que la pestaña MOSTRADOR de la
 * póliza de Ingreso, por día o rango y sucursal, con historial de quién lo creó.
 */
@Component({
  standalone: false,
  selector: 'app-por-facturar',
  templateUrl: './por-facturar.component.html',
})
export class PorFacturarComponent implements OnInit, OnDestroy {
  centros: CentroCosto[] = [];
  centroCostoId: number | null = null;
  modo: 'dia' | 'rango' = 'dia';
  fechaInicio = this.hoy();
  fechaFin    = this.hoy();

  rows: ReportePorFacturarRow[] = [];
  /** Historial: 5 por página, más recientes primero. */
  readonly porPagina = 5;
  pagina = 1;
  total  = 0;
  loading    = false;
  generando  = false;
  abriendoId: number | null = null;
  eliminandoId: number | null = null;
  /** Reporte a eliminar mientras está abierto el modal de confirmación. */
  pideEliminar: ReportePorFacturarRow | null = null;
  descargandoId: number | null = null;
  actualizandoId: number | null = null;

  detalle: ReportePorFacturarDetalle | null = null;
  readonly pestanas = PESTANAS;
  seccionSel: SeccionPorFacturar = 'mostrador';
  /** Almacén elegido en REF. (A0, B0…). */
  almacenSel: string | null = null;
  descargandoSeccion: SeccionPorFacturar | null = null;

  private readonly destroy$ = new Subject<void>();
  private vigilancia?: Subscription;

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
    this.entidadActiva.entidadActiva$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.detalle = null;
      this.load(1);
    });
  }

  ngOnDestroy(): void {
    this.vigilancia?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private get rfc(): string | null {
    return this.entidadActiva.snapshot?.rfc ?? null;
  }

  private hoy(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  }

  get paginas(): number {
    return Math.max(1, Math.ceil(this.total / this.porPagina));
  }

  get numerosPagina(): (number | null)[] {
    const pages = this.paginas, page = this.pagina;
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const left = Math.max(2, page - 2), right = Math.min(pages - 1, page + 2);
    const result: (number | null)[] = [1];
    if (left > 2) result.push(null);
    for (let i = left; i <= right; i++) result.push(i);
    if (right < pages - 1) result.push(null);
    result.push(pages);
    return result;
  }

  /** `silencioso`: sin el aviso de "Consultando historial…" (refresco automático). */
  load(pagina = this.pagina, silencioso = false): void {
    if (!silencioso) this.loading = true;
    this.svc.listar(this.rfc, pagina, this.porPagina).subscribe({
      next: res => {
        this.rows = res.data;
        this.total = res.total;
        this.pagina = res.page;
        this.loading = false;
        // Si la página pedida ya no existe, regresa a la última con datos.
        if (!res.data.length && res.page > 1) this.load(this.paginas);
        this.vigilar();
      },
      error: () => { this.loading = false; },
    });
  }

  /**
   * Cálculo en segundo plano (2026-10-29): mientras algún reporte del
   * historial (o el abierto) siga "calculando", refresca cada pocos segundos;
   * al terminar el abierto, lo recarga con sus datos nuevos.
   */
  private vigilar(): void {
    const hay = this.rows.some(r => r.estado === 'calculando') || this.detalle?.estado === 'calculando';
    if (!hay) { this.vigilancia?.unsubscribe(); this.vigilancia = undefined; return; }
    if (this.vigilancia) return;
    this.vigilancia = timer(INTERVALO_MS).subscribe(() => {
      this.vigilancia = undefined;
      const abierto = this.detalle;
      if (abierto?.estado === 'calculando') {
        this.svc.obtener(abierto.id).subscribe({
          next: r => {
            if (this.detalle?.id !== r.id) return;
            if (r.estado === 'listo') this.toast.success('Reporte calculado');
            if (r.estado === 'error') this.toast.error(r.error || 'No se pudo calcular el reporte');
            this.mostrar(r);
          },
        });
      }
      this.load(this.pagina, true);
    });
  }

  cambiarPagina(p: number): void {
    if (p < 1 || p > this.paginas || p === this.pagina) return;
    this.load(p);
  }

  generar(): void {
    const rfc = this.rfc;
    if (!rfc) { this.toast.warning('Selecciona una empresa'); return; }
    const fechaFin = this.modo === 'dia' ? this.fechaInicio : this.fechaFin;
    if (!this.fechaInicio || !fechaFin) { this.toast.warning('Indica la fecha'); return; }
    if (fechaFin < this.fechaInicio) { this.toast.warning('La fecha final no puede ser anterior a la inicial'); return; }

    this.generando = true;
    this.svc.generar({ rfc, centroCostoId: this.centroCostoId, fechaInicio: this.fechaInicio, fechaFin }).subscribe({
      next: r => {
        this.generando = false;
        this.mostrar(r);
        // El nuevo queda primero: se regresa a la página 1 para verlo.
        this.load(1);
        this.toast.success('Calculando el reporte en segundo plano — se completa solo');
      },
      error: err => {
        this.generando = false;
        this.toast.error(err?.error?.message || err?.error?.error || 'No se pudo generar el reporte');
        this.load(1);
      },
    });
  }

  /**
   * Botón "Actualizar" (2026-10-23): con un reporte abierto lo vuelve a
   * calcular (Bancos + Kore, misma sucursal y fechas) y refresca la vista y
   * el historial; sin reporte abierto solo recarga el historial.
   */
  actualizarTodo(): void {
    if (this.detalle) this.actualizar(this.detalle);
    else this.load();
  }

  actualizar(row: ReportePorFacturarRow): void {
    if (this.actualizandoId) return;
    this.actualizandoId = row.id;
    this.svc.actualizar(row.id).subscribe({
      next: r => {
        this.actualizandoId = null;
        // Abre el reporte (con sus datos anteriores) mientras se recalcula.
        this.mostrar(r);
        this.load();
        this.toast.success('Actualizando en segundo plano — se refresca solo');
      },
      error: err => {
        this.actualizandoId = null;
        this.toast.error(err?.error?.message || err?.error?.error || 'No se pudo actualizar el reporte');
        this.load();
      },
    });
  }

  ver(row: ReportePorFacturarRow): void {
    this.abriendoId = row.id;
    this.svc.obtener(row.id).subscribe({
      next: r => { this.abriendoId = null; this.mostrar(r); },
      error: () => { this.abriendoId = null; this.toast.error('No se pudo abrir el reporte'); },
    });
  }

  eliminar(row: ReportePorFacturarRow): void {
    this.pideEliminar = row;
  }

  get mensajeEliminar(): string {
    const r = this.pideEliminar;
    return r ? `Se va a eliminar el reporte de <b>${r.sucursal || 'Todas'}</b> (${this.periodo(r)}). Ya no aparecerá en el historial. ¿Continuar?` : '';
  }

  confirmarEliminar(): void {
    const row = this.pideEliminar;
    this.pideEliminar = null;
    if (!row) return;
    this.eliminandoId = row.id;
    this.svc.eliminar(row.id).subscribe({
      next: () => {
        this.eliminandoId = null;
        if (this.detalle?.id === row.id) this.detalle = null;
        this.toast.success('Reporte eliminado');
        this.load();
      },
      error: () => { this.eliminandoId = null; this.toast.error('No se pudo eliminar el reporte'); },
    });
  }

  cerrarDetalle(): void {
    this.detalle = null;
  }

  /** Excel de todo el reporte (historial) o solo de una pestaña (`seccion`). */
  descargar(row: { id: number; sucursal: string | null; fechaInicio: string; fechaFin: string }, seccion?: SeccionPorFacturar): void {
    if (seccion) this.descargandoSeccion = seccion;
    else this.descargandoId = row.id;
    const fin = () => { this.descargandoId = null; this.descargandoSeccion = null; };
    const parte = seccion ? `_${this.pestanas.find(p => p.id === seccion)!.etiqueta.replace(/\s+/g, '_')}` : '';
    this.svc.descargarExcel(row.id, seccion).subscribe({
      next: blob => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = `Por_facturar${parte}_${(row.sucursal || 'Todas').replace(/[^\w-]+/g, '_')}_${this.periodo(row).replace(/ al /, '_')}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        fin();
      },
      error: () => { fin(); this.toast.error('No se pudo descargar el Excel'); },
    });
  }

  periodo(row: { fechaInicio: string; fechaFin: string }): string {
    return row.fechaInicio === row.fechaFin ? row.fechaInicio : `${row.fechaInicio} al ${row.fechaFin}`;
  }

  folio(f: FacturaMostrador): string {
    return `${f.serie ?? ''}-${f.folio ?? ''}`;
  }

  suma(filas: { importe?: number; aplicado?: number; saldo?: number }[], campo: 'importe' | 'aplicado' | 'saldo'): number {
    return Math.round(filas.reduce((s, d) => s + (Number(d[campo]) || 0), 0) * 100) / 100;
  }

  get pestana(): PestanaPorFacturar {
    return this.pestanas.find(p => p.id === this.seccionSel)!;
  }

  /** Hojas REF. (una por almacén) — solo en esa pestaña. */
  get almacenesRef(): AlmacenRef[] {
    return this.seccionSel === 'ref' ? this.detalle?.secciones.ref ?? [] : [];
  }

  get almacen(): AlmacenRef | null {
    const lista = this.almacenesRef;
    return lista.find(a => a.serie === this.almacenSel) ?? lista[0] ?? null;
  }

  etiquetaAlmacen(a: { serie?: string; sucursal?: string | null }): string {
    return [a.serie || 'SIN SERIE', a.sucursal].filter(Boolean).join(' - ');
  }

  /** Bloques de la pestaña abierta (en REF., del almacén elegido). */
  get bloques(): BloquePorFacturar[] {
    const s = this.detalle?.secciones;
    if (!s) return [];
    switch (this.seccionSel) {
      case 'mostrador':  return s.mostrador;
      case 'ref':        return this.almacen?.bloques ?? [];
      case 'especiales': return s.especiales;
      case 'ficha':      return s.ficha.grupos.length ? [s.ficha] : [];
      default:           return [];
    }
  }

  depositosDe(bloques: BloquePorFacturar[]): number {
    return bloques.reduce((n, b) => n + b.grupos.reduce((m, g) => m + g.depositos.length, 0), 0);
  }

  /** Renglones de cada pestaña, para el contador. */
  cuantos(id: SeccionPorFacturar): number {
    const s = this.detalle?.secciones;
    if (!s) return 0;
    switch (id) {
      case 'mostrador':  return this.depositosDe(s.mostrador);
      case 'ref':        return s.ref.reduce((n, a) => n + this.depositosDe(a.bloques), 0);
      case 'especiales': return this.depositosDe(s.especiales);
      case 'ficha':      return this.depositosDe([s.ficha]);
      default:           return s.efectivo.length;
    }
  }

  /** Columnas de la tabla de la pestaña abierta (para los colspan). */
  get columnas(): number {
    return this.seccionSel === 'mostrador' ? 7 : 9;
  }

  private mostrar(r: ReportePorFacturarDetalle): void {
    const mismo = this.detalle?.id === r.id;
    this.detalle = r;
    // Al actualizar se queda en la misma pestaña y almacén; al abrir otro,
    // la primera pestaña con algo.
    if (!mismo) {
      this.almacenSel = null;
      this.seccionSel = this.pestanas.find(p => this.cuantos(p.id) > 0)?.id ?? 'mostrador';
    }
    this.vigilar();
  }
}
