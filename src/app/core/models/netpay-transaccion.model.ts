/**
 * Netpay — Fase 1: consulta en vivo (sin persistencia) de transacciones vía
 * GET /transactions/search de Kore (ver numo-backend
 * netpay-transacciones.service.js). Filtros manuales por ahora (responseCode,
 * almacenes); más filtros y cualquier matching contra BankMovement quedan para
 * una siguiente iteración.
 */

/** Tal cual viene de Kore — sin remapear nombres de campo. */
export interface NetpayTransaccion {
  ID: number;
  orderID: string;
  transactionID: string;
  cardTypeName: string;
  cardType: string;
  folio: string;
  bank: string;
  amount: number;
  responseCode: string;
  message: string;
  customerName: string;
  terminalID: string;
  ticketDate: string;
  transactionDate: string;
  reprintCount: number;
  status: string;
  userID: string;
  userName: string;
  almacen: string | null;
  idDetalleOperacion: string;
  reprintCancelCount: number;
  formaPagoId: string;
  commission: number | null;
}

export interface NetpayPorAlmacen {
  almacen: string;
  totalMonto: number;
  totalComision: number;
  neto: number;
}

export interface NetpayConsultaResultado {
  transacciones: NetpayTransaccion[];
  totales: { monto: number; comision: number; neto: number };
  porAlmacen: NetpayPorAlmacen[];
}
