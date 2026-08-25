/**
 * Configuraciones Globales — configuración runtime (Postgres, ver
 * global-config.service.js en el backend) que reemplaza gradualmente al .env,
 * editable desde esta pantalla de administración sin redeploy.
 */

export type GlobalConfigTipo = 'url' | 'ruta' | 'texto' | 'numero' | 'booleano';

/** Catálogo relacional estricto: cada GlobalConfig pertenece a UNA sección vía FK real. */
export interface ConfigSection {
  id:               number;
  clave:            string;
  nombre:           string;
  descripcion:      string | null;
  // Lista explícita de qué módulos/acciones de la app consumen esta sección —
  // se muestra ANTES de los valores editables, para que quien edite sepa qué
  // puede romper (requisito explícito del usuario, no un detalle secundario).
  modulosAfectados: string[];
  createdAt:        string;
  updatedAt:        string;
}

/**
 * Un valor dentro de una sección. Si `esSecreto`, `valor` NO es el valor real
 * — el backend ya lo devuelve enmascarado ('••••••••'); el valor real solo se
 * obtiene con ConfigService.revealSecret(), que además queda auditado.
 */
export interface GlobalConfig {
  id:          number;
  sectionId:   number;
  clave:       string;
  valor:       string | null;
  esSecreto:   boolean;
  tipo:        GlobalConfigTipo;
  descripcion: string | null;
  updatedBy:   string | null;
  updatedAt:   string;
}

export type ConfigAuditAccion = 'creado' | 'editado' | 'secreto_revelado';

export interface ConfigAuditLog {
  id:            number;
  configId:      number;
  usuarioId:     string | null;
  usuarioNombre: string | null;
  accion:        ConfigAuditAccion;
  // Para configs esSecreto=true, SIEMPRE vienen null — el log registra que
  // hubo un cambio, nunca el valor real (evita una segunda puerta trasera).
  valorAnterior: string | null;
  valorNuevo:    string | null;
  fecha:         string;
}
