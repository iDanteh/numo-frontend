/**
 * Helpers puros de formato/color para indicadores de tiempo de identificación —
 * compartidos por BankIndicadoresPanelComponent (Solicitudes de Cobro) y
 * BankCobranzaPanelComponent (2026-09-17), ambos declarados en BanksModule. Extraídos
 * acá recién ahora que existe un segundo consumidor real en el MISMO módulo lazy-loaded
 * — antes de esto, duplicar era la decisión correcta (encapsulación de Angular impide
 * importar entre módulos lazy-loaded distintos, ver comentario histórico en
 * bank-indicadores-panel.component.css sobre .indp-contador-filtro).
 */

export type PromedioTone = 'good' | 'warn' | 'warn2' | 'critical';

/** Mismos cortes que el resto del dashboard de Bancos (24h / 72h / 168h). */
export function promedioTone(horas: number): PromedioTone {
  if (horas < 24) return 'good';
  if (horas < 72) return 'warn';
  if (horas < 168) return 'warn2';
  return 'critical';
}

export function promedioToneLabel(tone: PromedioTone): string {
  switch (tone) {
    case 'good':     return 'En objetivo';
    case 'warn':     return 'Elevado';
    case 'warn2':    return 'Alto';
    case 'critical': return 'Crítico';
  }
}

/**
 * "2h 15m" / "4 días 5h 42m" — SIEMPRE con minutos, sin importar la magnitud (pedido
 * explícito del usuario: "quiero ver los minutos, no solo el promedio en horas"). El
 * caso multi-día se deriva del total de MINUTOS (no de horas ya redondeadas) para que
 * el acarreo entre horas/días sea siempre consistente.
 */
export function formatPromedioHoras(horas: number): string {
  const totalMinutos = Math.round(horas * 60);
  const dias    = Math.floor(totalMinutos / 1440);
  const restoMin = totalMinutos % 1440;
  const h = Math.floor(restoMin / 60);
  const m = restoMin % 60;
  if (dias > 0) return `${dias} día${dias === 1 ? '' : 's'} ${h}h ${m}m`;
  return `${h}h ${m}m`;
}
