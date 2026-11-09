import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** Depósito de Bancos tal como sale en la pestaña MOSTRADOR de la póliza. */
export interface DepositoMostrador {
  fecha:        string | null;
  descripcion:  string;
  importe:      number;
  aplicado?:    number;
  banco:        string;
  remisiones:   string[];
  cliente:      string;
  idNumo:       string;
  estatus?:     string;
  /** Solo en "CON PENDIENTES DE PAGO": lo que todavía deben las remisiones. */
  saldo?:       number;
  /** PENDIENTE GENERAR FACTURA / CON PENDIENTES DE PAGO del reporte: última
   *  identificación/vinculación (los de fecha anterior identificados en el rango también salen). */
  identificadoEl?: string | null;
  /** Reporte "Por facturar" (2026-10-28): cobro de sus remisiones por forma de pago (null = sin datos de Kore). */
  formasPago?: FormasPago | null;
  /** Folio de la factura (global / a nombre del cliente) en las secciones. */
  factura?: string;
  /** REF. / FACT ESPECIALES: a nombre de quién salió la factura (receptor del CFDI). */
  clienteFacturado?: string;
  /** "COBRADAS EN OTRA CAJA": serie de la caja que cobró (O0…). */
  caja?: string;
  /** 2026-10-30: forma de pago del renglón ('EFECTIVO', 'MIXTO: TRANSFERENCIA $x + EFECTIVO $y', '—'…). */
  formaPago?: string;
  /** Cobro en EFECTIVO / SALDO A FAVOR traído de Kore (no es depósito de Bancos). */
  deKore?: boolean;
}

/** 2026-10-29: depósito en efectivo con columna propia; abonos en efectivo de notas sin facturar o con saldo → abonos. */
export type FormaPago = 'efectivo' | 'depositoEfectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'abonos' | 'otras';
export type FormasPago = Record<FormaPago, number> & { mixto: boolean };

/** Pestañas con el formato del Excel "MOSTRADOR 2026" del usuario (2026-10-29). */
export type SeccionPorFacturar = 'mostrador' | 'ref' | 'especiales' | 'ficha' | 'efectivo' | 'otraCaja';

export interface GrupoCliente {
  cliente:   string;
  depositos: DepositoMostrador[];
  total:     number;
}

/**
 * Un bloque de una pestaña: en MOSTRADOR, una factura global (`tipo: 'global'`)
 * o los pendientes de generar factura (`tipo: 'pendiente'`); en REF. / FACT
 * ESPECIALES, un día (`fecha`) de un almacén.
 */
export interface BloquePorFacturar {
  tipo?:         'global' | 'pendiente';
  serie?:        string;
  sucursal?:     string | null;
  factura?:      string;
  fechaFactura?: string | null;
  totalFactura?: number | null;
  /** Refacturada (2026-10-30): otras facturas que amparan sus mismas remisiones. */
  otrasFacturas?: string[];
  /** 2026-10-30: importe del bloque por forma de pago (efectivo, depositoEfectivo, transferencia…). */
  formas?: Record<string, number>;
  fecha?:        string | null;
  grupos:        GrupoCliente[];
  total:         number;
}

/** Hoja MOSTRADOR o REF. de un almacén (A0, B0…). */
export interface AlmacenPorFacturar {
  serie:    string;
  sucursal: string | null;
  bloques:  BloquePorFacturar[];
  /** "COBRADAS EN OTRA CAJA": 'A0 COBRADAS EN PUERTO'. */
  titulo?:  string;
}

export interface FacturaMostrador {
  uuid:          string;
  serie:         string | null;
  folio:         string | null;
  fechaFactura:  string | null;
  esGlobal?:     boolean;
  totalFactura:  number;
  totalAplicado: number;
  depositos:     DepositoMostrador[];
}

export interface ResumenPorFacturar {
  facturasGlobales:    { facturas: number; depositos: number; importe: number };
  ppdFacturadoCliente: { facturas: number; depositos: number; importe: number };
  depositosPendientes: { depositos: number; importe: number };
  depositosEfectivo?:  { depositos: number; importe: number };
  pendientesPago?:     { depositos: number; importe: number };
}

/** Depósito en efectivo sin asociar a ninguna venta en Bancos. */
export interface DepositoEfectivoSinAsociar {
  fecha:       string | null;
  descripcion: string;
  importe:     number;
  banco:       string;
  ficha:       string;
  idNumo:      string;
}

export interface ReportePorFacturarRow {
  id:            number;
  rfc:           string;
  centroCostoId: number | null;
  sucursal:      string | null;
  fechaInicio:   string;
  fechaFin:      string;
  resumen:       ResumenPorFacturar | null;
  advertencias:  string[] | null;
  creadoPor?:    { nombre: string; email: string } | null;
  createdAt:     string;
  /** Último "Actualizar" (recálculo del mismo reporte). */
  actualizadoPor?: { nombre: string; email: string } | null;
  actualizadoEn?:  string | null;
  /** Cálculo en segundo plano (2026-10-29): paso actual mientras calcula, o el error. */
  estado?: 'calculando' | 'listo' | 'error';
  avance?: string | null;
  error?:  string | null;
}

export interface ReportePorFacturarDetalle extends ReportePorFacturarRow {
  /** Datos guardados (null mientras se calcula por primera vez). */
  datos?: unknown | null;
  secciones: {
    /** Una hoja por almacén (2026-10-30). */
    mostrador:  AlmacenPorFacturar[];
    ref:        AlmacenPorFacturar[];
    especiales: BloquePorFacturar[];
    ficha:      BloquePorFacturar;
    efectivo:   DepositoEfectivoSinAsociar[];
    /** "A0 COBRADAS EN PUERTO" (2026-10-30): una entrada por almacén + caja que cobró. */
    otraCaja?:  AlmacenPorFacturar[];
  };
  tablas: {
    facturasGlobales:    FacturaMostrador[];
    ppdFacturadoCliente: FacturaMostrador[];
    depositosPendientes: DepositoMostrador[];
    pendientesPago:      DepositoMostrador[];
    depositosEfectivo:   DepositoEfectivoSinAsociar[];
  };
}

@Injectable({ providedIn: 'root' })
export class ReportesPorFacturarService {
  private readonly path = '/reportes-por-facturar';

  constructor(private api: ApiService) {}

  /** Historial paginado, más recientes primero. */
  listar(rfc: string | null, page = 1, limit = 5): Observable<{ data: ReportePorFacturarRow[]; total: number; page: number; limit: number }> {
    return this.api.get<{ data: ReportePorFacturarRow[]; total: number; page: number; limit: number }>(this.path, { ...(rfc ? { rfc } : {}), page, limit });
  }

  generar(params: { rfc: string; centroCostoId: number | null; fechaInicio: string; fechaFin: string }): Observable<ReportePorFacturarDetalle> {
    return this.api.post<ReportePorFacturarDetalle>(this.path, params);
  }

  obtener(id: number): Observable<ReportePorFacturarDetalle> {
    return this.api.get<ReportePorFacturarDetalle>(`${this.path}/${id}`);
  }

  /** Vuelve a calcular el mismo reporte (misma sucursal y fechas) con la información actual — en segundo plano. */
  actualizar(id: number): Observable<ReportePorFacturarDetalle> {
    return this.api.post<ReportePorFacturarDetalle>(`${this.path}/${id}/actualizar`, {});
  }

  /** Borrado lógico: deja de verse; el backend guarda quién lo eliminó. */
  eliminar(id: number): Observable<{ ok: boolean; id: number }> {
    return this.api.delete<{ ok: boolean; id: number }>(`${this.path}/${id}`);
  }

  /** Excel de una pestaña (`seccion`) o de todas. */
  descargarExcel(id: number, seccion?: SeccionPorFacturar): Observable<Blob> {
    return this.api.downloadBlob(`${this.path}/${id}/excel`, seccion ? { seccion } : undefined);
  }

  // ── Estadística por facturar (2026-10-29) ────────────────────────────────
  /** Arranca el cálculo en segundo plano; luego se consulta con `estadistica(id)`. */
  iniciarEstadistica(params: { rfc: string; centroCostoId: number | null; fechaInicio: string; fechaFin: string }): Observable<TrabajoEstadistica> {
    return this.api.post<TrabajoEstadistica>(`${this.path}/estadistica`, params);
  }

  estadistica(id: string): Observable<TrabajoEstadistica> {
    return this.api.get<TrabajoEstadistica>(`${this.path}/estadistica/${id}`);
  }

  descargarExcelEstadistica(id: string): Observable<Blob> {
    return this.api.downloadBlob(`${this.path}/estadistica/${id}/excel`);
  }

  /** Mes en curso ya calculado (2026-10-30): la última guardada, al instante. */
  estadisticaMesEnCurso(rfc: string, centroCostoId: number | null): Observable<EstadisticaMesEnCurso> {
    return this.api.get<EstadisticaMesEnCurso>(`${this.path}/estadistica/mes-en-curso`, { rfc, ...(centroCostoId != null ? { centroCostoId } : {}) });
  }

  actualizarEstadisticaMesEnCurso(rfc: string, centroCostoId: number | null): Observable<EstadisticaMesEnCurso> {
    return this.api.post<EstadisticaMesEnCurso>(`${this.path}/estadistica/mes-en-curso/actualizar`, { rfc, centroCostoId });
  }

  descargarExcelEstadisticaMesEnCurso(rfc: string, centroCostoId: number | null): Observable<Blob> {
    return this.api.downloadBlob(`${this.path}/estadistica/mes-en-curso/excel`, { rfc, ...(centroCostoId != null ? { centroCostoId } : {}) });
  }

  // ── Fichas de efectivo (2026-11-04; 2026-11-05 por sucursal + rango) ──────
  /** Bancos dados de alta en Bancos, con su número de cuenta. */
  bancosParaFicha(): Observable<BancoFicha[]> {
    return this.api.get<BancoFicha[]>(`${this.path}/fichas/bancos`);
  }

  /** Efectivo de la caja de la sucursal en cada día del rango, y la suma. */
  generarFicha(params: { rfc: string; centroCostoId: number; fechaInicio: string; fechaFin: string }): Observable<FichaEfectivo> {
    return this.api.post<FichaEfectivo>(`${this.path}/fichas`, params);
  }

  /** Recalcula, valida las denominaciones y guarda la ficha con folio (2026-11-05). */
  guardarFicha(body: { rfc: string; centroCostoId: number; fechaInicio: string; fechaFin: string; bancos: { banco: string; importe?: number }[]; sucursalBanco: string; denominaciones: DenominacionFicha[] }): Observable<FichaGuardada> {
    return this.api.post<FichaGuardada>(`${this.path}/fichas/guardar`, body);
  }

  /** Historial; q = folio de ficha, remisión o factura / global. */
  fichasGuardadas(params: { rfc: string; centroCostoId?: number | null; q?: string }): Observable<FichaGuardadaResumen[]> {
    const { centroCostoId, q, rfc } = params;
    return this.api.get<FichaGuardadaResumen[]>(`${this.path}/fichas/guardadas`, { rfc, ...(centroCostoId != null ? { centroCostoId } : {}), ...(q ? { q } : {}) });
  }

  fichaGuardada(rfc: string, id: string): Observable<FichaGuardada> {
    return this.api.get<FichaGuardada>(`${this.path}/fichas/guardadas/${id}`, { rfc });
  }

  /** Anexo › Actualizar de una ficha generada sin guardar: ¿las ventas sin factura ya se facturaron? */
  actualizarAnexo(body: { rfc: string; centroCostoId: number; detalle: DetalleFicha[] }): Observable<ResultadoActualizarAnexo & { detalle: DetalleFicha[]; actualizadoEn: string }> {
    return this.api.post<ResultadoActualizarAnexo & { detalle: DetalleFicha[]; actualizadoEn: string }>(`${this.path}/fichas/anexo/actualizar`, body);
  }

  /** Anexo › Actualizar de una ficha guardada (se guarda la factura nueva). */
  actualizarAnexoGuardada(rfc: string, id: string): Observable<FichaGuardada & { resultadoActualizar: ResultadoActualizarAnexo }> {
    return this.api.post<FichaGuardada & { resultadoActualizar: ResultadoActualizarAnexo }>(`${this.path}/fichas/guardadas/${id}/actualizar-anexo`, { rfc });
  }

  cancelarFicha(rfc: string, id: string, motivo: string): Observable<FichaGuardada> {
    return this.api.post<FichaGuardada>(`${this.path}/fichas/guardadas/${id}/cancelar`, { rfc, motivo });
  }
}

// ── Fichas de efectivo ─────────────────────────────────────────────────────
export interface BancoFicha {
  banco:        string;
  numeroCuenta: string | null;
}

/** Efectivo de la caja de una sucursal en un día (corte de caja de Kore). */
export interface MontosFicha {
  efectivoFacturado:   number;
  efectivoPorFacturar: number;
  /** Ventas misceláneas (MIS, "TIENDITA TYC") — 2026-11-05. */
  miscelaneaEfectivo:  number;
  cobranzaEfectivo:    number;
  abonosEfectivo:      number;
  /** Cobros y abonos de remisiones de OTRA sucursal hechos en esta caja (2026-11-06; fichas viejas no lo traen). */
  cobroOtraSucursal?:  number;
  /** Restan: devoluciones en efectivo (RETD), retiro de efectivo (RETEF) y faltante en el cierre (RPF). */
  devoluciones:        number;
  /** Fichas guardadas antes del 2026-11-06 no lo traen. */
  retiroEfectivo?:     number;
  faltante:            number;
  /** Informativos: no suman al total a entregar. */
  depositoEfectivo:    number;
  saldoFavor:          number;
  totalEntregar:       number;
}

export interface CorteFicha extends MontosFicha {
  serie:    string;
  dia:      string;
  sucursal: string | null;
}

/** Un cobro / salida de la caja que forma la ficha (rastro venta → factura / global). */
export interface DetalleFicha {
  dia:          string;
  serie:        string;
  concepto:     keyof MontosFicha;
  remision:     string | null;
  factura:      string | null;
  facturaUuid?: string | null;
  esGlobal?:    boolean | null;
  /** Estaba sin factura al hacer la ficha y se facturó después (Anexo › Actualizar, 2026-11-06). */
  facturadaDespues?: boolean | null;
  cliente?:     string | null;
  cobro:        string | null;
  origen?:      string | null;
  usuario?:     string | null;
  fecha:        string;
  importe:      number;
}

export interface FichaEfectivo {
  generadoEn:    string;
  centroCostoId: number;
  sucursal:      string | null;
  series:        string[];
  fechaInicio:   string;
  fechaFin:      string;
  cortes:        CorteFicha[];
  totales:       MontosFicha;
  /** Solo para administrador o permiso reportes:fichas-efectivo:anexo. */
  detalle?:      DetalleFicha[];
  /** Cajas (SERIE|DIA) que ya están en una ficha guardada vigente. */
  yaEnFicha:     { caja: string; folio: number; id: string }[];
  incompleta:    boolean;
  advertencias:  string[] | null;
  /** Última vez que se actualizó el anexo (facturas de las ventas sin factura). */
  anexoActualizadoEn?: string | null;
}

/** Resultado de Anexo › Actualizar. */
export interface ResultadoActualizarAnexo {
  nuevas:           number;
  siguenSinFactura: number;
  advertencias:     string[] | null;
}

export interface DenominacionFicha {
  tipo:     'Billete' | 'Moneda';
  valor:    number;
  cantidad: number;
  importe?: number;
}

export interface BancoFichaImporte extends BancoFicha { importe: number }

export interface UsuarioFicha { id: string | null; nombre: string | null }

export interface FichaGuardadaResumen {
  id:            string;
  folio:         number;
  sucursal:      string | null;
  series:        string[];
  fechaInicio:   string;
  fechaFin:      string;
  bancos:        BancoFichaImporte[];
  totales:       { totalEntregar: number };
  totalContado:  number;
  estado:        'vigente' | 'cancelada';
  creadoPor:     UsuarioFicha;
  createdAt:     string;
  canceladaEn?:  string | null;
  motivoCancelacion?: string | null;
  /** Renglones que coinciden con la búsqueda (remisión / factura). */
  coincidencias?: DetalleFicha[];
}

export interface FichaGuardada extends Omit<FichaGuardadaResumen, 'totales' | 'coincidencias'> {
  centroCostoId:  number;
  sucursalBanco:  string | null;
  denominaciones: DenominacionFicha[];
  diferencia:     number;
  totales:        MontosFicha;
  cortes:         CorteFicha[];
  detalle?:       DetalleFicha[];
  anexoActualizadoEn?: string | null;
  canceladaPor?:  UsuarioFicha | null;
}

// ── Estadística por facturar ──────────────────────────────────────────────────
export interface ConteoImporte { depositos: number; importe: number }

export interface ResumenEstadistica {
  habia:      ConteoImporte;
  /** REZAGADOS: venían de antes del periodo sin facturar (2026-11-03). */
  arrastre?:  ConteoImporte;
  /** Entraron en el periodo. */
  nuevos?:    ConteoImporte;
  facturados: ConteoImporte & { global: number; cliente: number };
  faltan:     ConteoImporte & { conSaldo: number; saldo: number };
  /** % de depósitos facturados (null sin depósitos). */
  avance:     number | null;
  promedioDiasParaFacturar: number | null;
}

export interface DepositoEstadistica {
  idNumo:           string;
  fecha:            string | null;
  /** Día en que entró al periodo: fecha del depósito o su identificación, la más reciente. */
  entrada:          string;
  /** Entró antes del periodo y seguía sin facturar al empezarlo (2026-11-03). */
  arrastre?:        boolean;
  descripcion:      string;
  banco:            string;
  importe:          number;
  aplicado:         number;
  serie:            string;
  sucursal:         string | null;
  remisiones:       string[];
  cliente:          string;
  estado:           'facturado' | 'falta';
  facturas:         string[];
  tipoFactura:      'global' | 'cliente' | 'mixto' | null;
  fechaFactura:     string | null;
  diasParaFacturar: number | null;
  diasSinFacturar:  number | null;
  saldo:            number;
}

export interface EstadisticaPorFacturar {
  /** Desde cuándo se arrastran los pendientes. */
  arrastreDesde?: string;
  sucursal:      string | null;
  centroCostoId: number | null;
  fechaInicio:   string;
  fechaFin:      string;
  calculadoEn:   string;
  totales:       ResumenEstadistica;
  porAlmacen:    (ResumenEstadistica & { serie: string; sucursal: string | null })[];
  diaADia:       { dia: string; nuevos: ConteoImporte; facturados: ConteoImporte; pendientes: ConteoImporte }[];
  /** Facturados después del fin del rango: no salen en el día a día. */
  facturadosDespues: number;
  depositos:     DepositoEstadistica[];
  advertencias:  string[] | null;
}

export interface EstadisticaMesEnCurso {
  resultado:   EstadisticaPorFacturar | null;
  calculadoEn: string | null;
  calculando:  boolean;
  avance:      string | null;
  error:       string | null;
}

export interface TrabajoEstadistica {
  id:         string;
  estado:     'calculando' | 'listo' | 'error';
  avance:     string | null;
  error?:     string | null;
  resultado?: EstadisticaPorFacturar | null;
}
