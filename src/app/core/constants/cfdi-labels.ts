export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Crítica',
  high:     'Alta',
  medium:   'Media',
  low:      'Baja',
  warning:  'Advertencia',
  info:     'Info',
};

export const SEVERITY_CLASS: Record<string, string> = {
  critical: 'badge-danger',
  high:     'badge-warning',
  medium:   'badge-info',
  low:      'badge-secondary',
  warning:  'badge-warning',
  info:     'badge-info',
};

export const COMPARISON_STATUS_LABEL: Record<string, string> = {
  match:            'Coincide',
  match_cancelled:  'Cancelado (coincide)',
  discrepancy:      'Con discrepancias',
  warning:          'Advertencias',
  not_in_sat:       'No en SAT',
  not_in_erp:            'No en ERP',
  cancelled_not_in_erp:  'Coincide',
  cancelled:        'Cancelado en SAT',
  pending:          'Pendiente',
  error:            'Error',
  conciliado:       'Conciliado',
};

export const COMPARISON_STATUS_CLASS: Record<string, string> = {
  match:            'badge-success',
  match_cancelled:  'badge-match-cancelled',
  discrepancy:      'badge-danger',
  warning:          'badge-minimal',
  not_in_sat:       'badge-danger',
  not_in_erp:            'badge-danger',
  cancelled_not_in_erp:  'badge-match-cancelled',
  cancelled:        'badge-danger',
  pending:          'badge-info',
  error:            'badge-secondary',
  conciliado:       'badge-conciliado',
};

export const SAT_STATUS_CLASS: Record<string, string> = {
  'Vigente':            'badge-success',
  'Cancelado':          'badge-danger',
  'No Encontrado':      'badge-warning',
  'Pendiente':          'badge-info',
  'Error':              'badge-secondary',
  'Expresión Inválida': 'badge-secondary',
  'Desconocido':        'badge-secondary',
  'Deshabilitado':      'badge-disabled',
};

export const ERP_STATUS_CLASS: Record<string, string> = {
  'Timbrado':            'badge-success',
  'Habilitado':          'badge-success',
  'Cancelado':           'badge-danger',
  'Deshabilitado':       'badge-disabled',
  'Cancelacion Pendiente': 'badge-warning',
};

export const DISCREPANCY_TYPE_LABEL: Record<string, string> = {
  AMOUNT_MISMATCH:       'Diferencia de monto',
  RFC_MISMATCH:          'RFC no coincide',
  DATE_MISMATCH:         'Fecha diferente',
  CANCELLED_IN_SAT:      'Cancelado en SAT',
  UUID_NOT_FOUND_SAT:    'En ERP, no en SAT',
  DUPLICATE_UUID:        'UUID duplicado',
  MISSING_IN_ERP:        'En SAT, no en ERP',
  TAX_CALCULATION_ERROR: 'Error en impuestos',
  CFDI_VERSION_MISMATCH: 'Versión incorrecta',
  SIGNATURE_INVALID:     'Firma inválida',
  COMPLEMENT_MISSING:    'Complemento faltante',
  REGIME_MISMATCH:       'Régimen fiscal diferente',
  OTHER:                 'Otra diferencia',
  RFC_AMPERSAND:         'RFC con & (validación local)',
};

export const DISCREPANCY_TYPE_EXPLANATION: Record<string, string> = {
  AMOUNT_MISMATCH:
    'El monto total del CFDI en el ERP no coincide con el valor registrado en el SAT. ' +
    'Puede indicar un error de captura, redondeo incorrecto o una modificación posterior al timbrado.',
  RFC_MISMATCH:
    'El RFC del emisor o receptor difiere entre el sistema ERP y el XML registrado en el SAT. ' +
    'Verifique que no haya un CFDI sustituto con RFC corregido, o que el RFC esté bien capturado en el catálogo del ERP.',
  DATE_MISMATCH:
    'La fecha de emisión del comprobante no coincide. El SAT registra la fecha del timbrado por el PAC; ' +
    'si el ERP guarda una fecha de contabilización distinta se genera esta diferencia.',
  CANCELLED_IN_SAT:
    'El CFDI aparece como cancelado en el SAT pero continúa activo en el ERP. ' +
    'Es necesario reflejar la cancelación en la contabilidad para evitar inconsistencias fiscales y posibles multas.',
  UUID_NOT_FOUND_SAT:
    'El UUID de este CFDI no fue localizado en el SAT. El comprobante podría no haber sido timbrado correctamente, ' +
    'el UUID fue generado de forma local sin pasar por un PAC autorizado, o se usó un entorno de pruebas.',
  DUPLICATE_UUID:
    'Se encontraron dos o más registros con el mismo UUID en el ERP. ' +
    'Un UUID debe ser único a nivel global; revise si hubo una importación duplicada o un error de integración con el PAC.',
  MISSING_IN_ERP:
    'El SAT tiene registrado este CFDI pero no existe en el ERP. ' +
    'Puede ser un CFDI recibido que no se capturó, un error de sincronización, o un comprobante de otro sistema no integrado.',
  TAX_CALCULATION_ERROR:
    'Los impuestos calculados (IVA trasladado, ISR retenido, etc.) no coinciden con los registrados en el SAT. ' +
    'Revise la configuración de tasas impositivas y el método de cálculo en el ERP.',
  CFDI_VERSION_MISMATCH:
    'La versión del CFDI (3.3 ó 4.0) difiere entre ERP y SAT. ' +
    'Verifique que el sistema ERP esté actualizado para emitir y procesar la versión vigente requerida por el SAT.',
  SIGNATURE_INVALID:
    'La firma digital del CFDI no es válida según la verificación del SAT. ' +
    'El sello puede haber sido alterado tras el timbrado, o el certificado del PAC está vencido o revocado.',
  COMPLEMENT_MISSING:
    'Falta un complemento requerido en el CFDI (Carta Porte, Pago, Nómina, etc.). ' +
    'El SAT exige este complemento para el tipo de operación; sin él el CFDI puede considerarse inválido.',
  REGIME_MISMATCH:
    'El régimen fiscal del emisor o receptor no coincide con el registrado ante el SAT. ' +
    'Actualice el RFC y el régimen fiscal en el catálogo maestro del ERP.',
  OTHER:
    'Se detectó una diferencia que no corresponde a una categoría específica. ' +
    'Revise el detalle de los campos comparados en la sección anterior.',
  RFC_AMPERSAND:
    'El RFC del emisor o receptor contiene el carácter "&", lo cual impide la consulta en línea al servicio SOAP del SAT. ' +
    'El estado mostrado fue obtenido de la copia local descargada vía Descarga Masiva y puede no reflejar cambios recientes (cancelaciones tardías). ' +
    'Para confirmar la vigencia, consulte manualmente en el portal del SAT.',
};

/** Array con valor numérico y etiqueta de cada mes — fuente única para todos los componentes */
export const MESES: { value: number; label: string }[] = [
  { value: 1,  label: 'Enero' },
  { value: 2,  label: 'Febrero' },
  { value: 3,  label: 'Marzo' },
  { value: 4,  label: 'Abril' },
  { value: 5,  label: 'Mayo' },
  { value: 6,  label: 'Junio' },
  { value: 7,  label: 'Julio' },
  { value: 8,  label: 'Agosto' },
  { value: 9,  label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

/** Solo las etiquetas (índice 0 = Enero, …, 11 = Diciembre) */
export const MESES_LABELS: string[] = MESES.map(m => m.label);

export const FIELD_LABEL: Record<string, string> = {
  total:                                 'Total',
  subTotal:                              'Subtotal',
  descuento:                             'Descuento',
  'emisor.rfc':                          'RFC Emisor',
  'emisor.nombre':                       'Nombre Emisor',
  'emisor.regimenFiscal':                'Régimen Fiscal Emisor',
  'receptor.rfc':                        'RFC Receptor',
  'receptor.nombre':                     'Nombre Receptor',
  'receptor.usoCFDI':                    'Uso CFDI',
  'impuestos.totalImpuestosTrasladados': 'IVA Trasladado',
  'impuestos.totalImpuestosRetenidos':   'Retenciones',
  fecha:                                 'Fecha',
  moneda:                                'Moneda',
  tipoCambio:                            'Tipo de Cambio',
  tipoDeComprobante:                     'Tipo Comprobante',
  formaPago:                             'Forma de Pago',
  metodoPago:                            'Método de Pago',
  version:                               'Versión CFDI',
  'sat.uuid':                            'UUID SAT',
  'sat.estado':                          'Estado SAT',
};
