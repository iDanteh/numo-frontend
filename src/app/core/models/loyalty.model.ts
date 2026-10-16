/**
 * Sistema de Lealtad (phone-as-card) — interfaces que reflejan los nombres de
 * campo REALES del backend (ver design.md "Data Model" y
 * `numo-backend/src/shared/models/postgres/{LoyaltyCard,LoyaltyPointsLedger,
 * LoyaltyTierHistory,LoyaltyAdjustmentReason}.js`). El teléfono de 10 dígitos
 * ES la identidad de la tarjeta — no existe `numeroTarjeta` (D1).
 */

export type LoyaltyNivel = 'Bronce' | 'Plata' | 'Oro';

export type LoyaltyMovimientoTipo = 'ACUMULACION' | 'CANJE' | 'AJUSTE' | 'MIGRACION';

export type LoyaltySignoPermitido = 'POSITIVO' | 'NEGATIVO' | 'AMBOS';

export interface LoyaltyCard {
  id: number;
  telefono: string;
  nombre: string;
  nivel: LoyaltyNivel;
  saldoPuntos: number;
  activa: boolean;
  createdById?: string | null;
  createdByNombre?: string | null;
  updatedById?: string | null;
  updatedByNombre?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoyaltyMovimiento {
  id: number;
  cardId: number;
  tipo: LoyaltyMovimientoTipo;
  puntos: number;
  saldoResultante: number;
  montoVenta: number | null;
  porcentajeAplicado: number | null;
  nivelAplicado: LoyaltyNivel | null;
  centroCostoId: number | null;
  reasonId: number | null;
  justificacion: string | null;
  origen: string;
  referenciaExterna: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  createdAt: string;
}

export interface LoyaltyTierHistoryEntry {
  id: number;
  cardId: number;
  nivelAnterior: LoyaltyNivel;
  nivelNuevo: LoyaltyNivel;
  motivo: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  at: string;
}

export interface LoyaltyAdjustmentReason {
  id: number;
  clave: string;
  nombre: string;
  signoPermitido: LoyaltySignoPermitido;
  activo: boolean;
}

export interface LoyaltySucursal {
  id: number;
  clave: string;
  sucursal: string;
  participaLealtad: boolean;
  permiteCanjeLealtad: boolean;
}

export interface LoyaltyPorcentajes {
  Bronce: number | null;
  Plata: number | null;
  Oro: number | null;
}

export interface LoyaltyCardListFilter {
  search?: string;
  nivel?: LoyaltyNivel | '';
  activa?: boolean | '';
  page?: number;
  limit?: number;
}

export interface LoyaltyCardListResult {
  data: LoyaltyCard[];
  pagination: { page: number; totalPaginas: number; total: number };
}

export interface LoyaltyMovimientoListResult {
  data: LoyaltyMovimiento[];
  pagination: { page: number; totalPaginas: number; total: number };
}

export interface LoyaltyCrearTarjetaPayload {
  telefono: string;
  nombre: string;
  nivel?: LoyaltyNivel;
}

export interface LoyaltyCrearTarjetaResult {
  card: LoyaltyCard;
  nip: string;
}

export interface LoyaltyEditarTarjetaPayload {
  nombre?: string;
  telefono?: string;
  activa?: boolean;
}

export interface LoyaltyCambiarNipResult {
  nip: string;
}

export interface LoyaltyAcumulacionPayload {
  montoVenta: number;
  centroCostoId: number;
}

export interface LoyaltyCanjePayload {
  puntos: number;
  centroCostoId: number;
}

export interface LoyaltyAjustePayload {
  puntos: number;
  reasonId: number;
  justificacion: string;
}

export interface LoyaltyMovimientoResult {
  movimiento: LoyaltyMovimiento;
  saldoPuntos: number;
}

// ── PR7: Config UI (tier %, reasons CRUD, sucursal flags) ───────────────────

export interface LoyaltyGuardarPorcentajesPayload {
  Bronce?: number;
  Plata?: number;
  Oro?: number;
}

export interface LoyaltyCrearReasonPayload {
  clave: string;
  nombre: string;
  signoPermitido: LoyaltySignoPermitido;
}

export interface LoyaltyEditarReasonPayload {
  nombre?: string;
  signoPermitido?: LoyaltySignoPermitido;
  activo?: boolean;
}

export interface LoyaltyActualizarSucursalPayload {
  participaLealtad?: boolean;
  permiteCanjeLealtad?: boolean;
}

// ── PR7: Public lookup (POST /api/loyalty/public/consulta, D8: never recent
// activity in the response — spec loyalty-public-lookup "Minimal Response
// Payload", confirmed with the user 2026-10-15) ─────────────────────────────

export interface LoyaltyConsultaPublicaResult {
  nombre: string;
  nivel: LoyaltyNivel;
  saldoPuntos: number;
}
