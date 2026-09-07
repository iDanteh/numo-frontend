import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ConfigService } from '../../core/services/config.service';
import { SocketService } from '../../core/services/socket.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfigSection, GlobalConfig, GlobalConfigTipo, ConfigAuditLog } from '../../core/models/config.model';

interface EditModalState {
  show:         boolean;
  mode:         'create' | 'edit';
  sectionId:    number | null;
  sectionClave: string;
  configId:     number | null;   // solo en modo 'edit'
  clave:        string;
  valor:        string;
  esSecreto:    boolean;
  tipo:         GlobalConfigTipo;
  descripcion:  string;
  saving:       boolean;
  error:        string | null;
  // Solo para tipo 'lista' — chips ya confirmados y texto en construcción en el
  // input. `valor` sigue siendo la fuente real que se manda a guardarValor()
  // (JSON.stringify de valorListaChips, mismo criterio que abajo mantiene sincronizado).
  valorListaChips: string[];
  nuevoValorLista: string;
}

interface AuditModalState {
  show:     boolean;
  clave:    string;
  loading:  boolean;
  error:    string | null;
  logs:     ConfigAuditLog[];
}

interface NewSectionModalState {
  show:              boolean;
  mode:              'create' | 'edit';
  sectionId:         number | null;  // solo en modo 'edit'
  clave:             string;
  nombre:            string;
  descripcion:       string;
  modulosAfectados:  string[];       // chips ya confirmados
  nuevoModulo:       string;         // texto en construcción en el input de chips
  saving:            boolean;
  error:             string | null;
}

const EMPTY_EDIT_MODAL: EditModalState = {
  show: false, mode: 'create', sectionId: null, sectionClave: '', configId: null,
  clave: '', valor: '', esSecreto: false, tipo: 'texto', descripcion: '',
  saving: false, error: null,
  valorListaChips: [], nuevoValorLista: '',
};

// JSON.parse defensivo — un valor 'lista' mal escrito a mano (antes de que existiera
// este editor) no debe romper el modal, solo mostrarse como lista vacía.
function _parsearValorLista(valor: string | null): string[] {
  if (!valor) return [];
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const EMPTY_AUDIT_MODAL: AuditModalState = { show: false, clave: '', loading: false, error: null, logs: [] };

const EMPTY_NEW_SECTION_MODAL: NewSectionModalState = {
  show: false, mode: 'create', sectionId: null,
  clave: '', nombre: '', descripcion: '', modulosAfectados: [], nuevoModulo: '',
  saving: false, error: null,
};

@Component({
  standalone: false,
  selector: 'app-config-admin',
  templateUrl: './config-admin.component.html',
  styleUrls: ['./config-admin.component.css'],
})
export class ConfigAdminComponent implements OnInit, OnDestroy {

  sections: ConfigSection[] = [];
  configsBySection = new Map<number, GlobalConfig[]>();
  loadingSections = false;
  error: string | null = null;

  // Sección activa en el rail — puramente de presentación (no hay ruta por sección,
  // todo el catálogo se sigue cargando de una).
  selectedSection: ConfigSection | null = null;

  // Valores desenmascarados temporalmente vía "Revelar" — puramente en memoria de
  // este componente, se pierden al navegar fuera (nunca se persisten ni se cachean
  // más allá de esto). Clave: configId.
  revealedValues = new Map<number, string>();
  revealing      = new Set<number>();

  // Búsqueda global — cruza TODAS las secciones ya cargadas (no pega al backend,
  // todo el catálogo ya vive en memoria vía configsBySection). Pedido explícito:
  // encontrar cualquier valor sin tener que saber antes en qué sección vive.
  searchQuery = '';

  editModal: EditModalState        = { ...EMPTY_EDIT_MODAL };
  auditModal: AuditModalState      = { ...EMPTY_AUDIT_MODAL };
  newSectionModal: NewSectionModalState = { ...EMPTY_NEW_SECTION_MODAL };

  readonly tipos: GlobalConfigTipo[] = ['url', 'ruta', 'texto', 'numero', 'booleano', 'lista'];

  private destroy$ = new Subject<void>();

  constructor(
    private configSvc: ConfigService,
    private socket:    SocketService,
    public  auth:      AuthService,
  ) {}

  ngOnInit(): void {
    this.load();

    // Si el usuario tiene esta pantalla abierta en dos pestañas (o alguien más
    // edita mientras tanto), refrescar la sección tocada — mismo patrón que
    // roleDefinitionUpdated$ en users.component.ts.
    this.socket.configUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ sectionClave }) => {
        const section = this.sections.find(s => s.clave === sectionClave);
        if (section) this.loadConfigs(section.id);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loadingSections = true;
    this.error = null;
    this.configSvc.listSections().subscribe({
      next: (sections) => {
        this.sections = sections;
        this.loadingSections = false;
        if (!this.selectedSection && sections.length > 0) this.selectedSection = sections[0];
        for (const s of sections) this.loadConfigs(s.id);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Error al cargar las secciones de configuración';
        this.loadingSections = false;
      },
    });
  }

  private loadConfigs(sectionId: number): void {
    this.configSvc.listConfigsBySection(sectionId).subscribe({
      next: (configs) => this.configsBySection.set(sectionId, configs),
      error: (err) => { this.error = err?.error?.error || 'Error al cargar los valores de una sección'; },
    });
  }

  configsFor(sectionId: number): GlobalConfig[] {
    return this.configsBySection.get(sectionId) ?? [];
  }

  // Colapsado por defecto: una sección con muchos módulos afectados empujaba los
  // valores (lo que el admin realmente vino a tocar) fuera de la vista sin scroll.
  // Se reinicia al cambiar de sección — cada sección nueva merece la misma
  // advertencia visible, no arrastrar el estado de la anterior.
  impactCollapsed = true;

  seleccionar(section: ConfigSection): void {
    this.selectedSection = section;
    this.impactCollapsed = true;
  }

  toggleImpact(): void {
    this.impactCollapsed = !this.impactCollapsed;
  }

  // Estado visual del rail — no viene del backend, se deriva de los valores ya
  // cargados: sin valores, con al menos un secreto, o completa (todo en claro).
  estadoSeccion(section: ConfigSection): 'vacia' | 'con-secretos' | 'completa' {
    const configs = this.configsFor(section.id);
    if (configs.length === 0) return 'vacia';
    return configs.some(c => c.esSecreto) ? 'con-secretos' : 'completa';
  }

  // ── Revelar / ocultar secreto ─────────────────────────────────────────────────

  isRevealed(configId: number): boolean {
    return this.revealedValues.has(configId);
  }

  isRevealing(configId: number): boolean {
    return this.revealing.has(configId);
  }

  displayValue(cfg: GlobalConfig): string {
    if (!cfg.esSecreto) return cfg.valor ?? '—';
    return this.revealedValues.get(cfg.id) ?? (cfg.valor ?? '••••••••');
  }

  revelar(cfg: GlobalConfig): void {
    if (this.isRevealing(cfg.id) || this.isRevealed(cfg.id)) return;
    this.revealing.add(cfg.id);
    this.configSvc.revealSecret(cfg.id).subscribe({
      next: ({ valor }) => {
        this.revealedValues.set(cfg.id, valor);
        this.revealing.delete(cfg.id);
      },
      error: (err) => {
        this.error = err?.error?.error || 'No se pudo revelar el valor';
        this.revealing.delete(cfg.id);
      },
    });
  }

  ocultar(cfg: GlobalConfig): void {
    this.revealedValues.delete(cfg.id);
  }

  // ── Búsqueda global ────────────────────────────────────────────────────────────

  isSearching(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  limpiarBusqueda(): void {
    this.searchQuery = '';
  }

  // Sale del modo búsqueda y deja a la vista la sección del resultado elegido —
  // "encontrar" siempre debe terminar en un lugar navegable, no solo en una lista suelta.
  irASeccion(section: ConfigSection): void {
    this.searchQuery = '';
    this.seleccionar(section);
  }

  searchResults(): Array<{ section: ConfigSection; cfg: GlobalConfig }> {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{ section: ConfigSection; cfg: GlobalConfig }> = [];
    for (const section of this.sections) {
      const matchSeccion = section.nombre.toLowerCase().includes(q) || section.clave.toLowerCase().includes(q);
      for (const cfg of this.configsFor(section.id)) {
        const matches = matchSeccion
          || cfg.clave.toLowerCase().includes(q)
          || (cfg.descripcion?.toLowerCase().includes(q) ?? false);
        if (matches) results.push({ section, cfg });
      }
    }
    return results;
  }

  // ── Franja de estadísticas (header) ───────────────────────────────────────────

  totalValues(): number {
    return this.sections.reduce((acc, s) => acc + this.configsFor(s.id).length, 0);
  }

  totalSecrets(): number {
    return this.sections.reduce((acc, s) => acc + this.configsFor(s.id).filter(c => c.esSecreto).length, 0);
  }

  ultimoCambio(): GlobalConfig | null {
    let ultimo: GlobalConfig | null = null;
    for (const s of this.sections) {
      for (const cfg of this.configsFor(s.id)) {
        if (!ultimo || new Date(cfg.updatedAt) > new Date(ultimo.updatedAt)) ultimo = cfg;
      }
    }
    return ultimo;
  }

  // Placa de casillero para el rail — monograma derivado del nombre, sin depender de
  // un ícono curado por sección (las secciones se crean libremente desde la UI, no
  // hay un catálogo fijo al que mapear íconos).
  monogram(section: ConfigSection): string {
    const base = (section.nombre || section.clave || '?').trim();
    const palabras = base.split(/\s+/).filter(Boolean);
    if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
    return base.slice(0, 2).toUpperCase();
  }

  // ── Editar / crear valor ──────────────────────────────────────────────────────

  abrirEditarValor(section: ConfigSection, cfg: GlobalConfig): void {
    const valorInicial = cfg.esSecreto ? '' : (cfg.valor ?? '');
    this.editModal = {
      show: true, mode: 'edit',
      sectionId: section.id, sectionClave: section.clave, configId: cfg.id,
      clave: cfg.clave,
      // Nunca precargar un secreto enmascarado como si fuera el valor real —
      // el usuario tiene que escribir el valor nuevo desde cero para editar uno.
      valor: valorInicial,
      esSecreto: cfg.esSecreto, tipo: cfg.tipo, descripcion: cfg.descripcion ?? '',
      saving: false, error: null,
      valorListaChips: cfg.tipo === 'lista' ? _parsearValorLista(valorInicial) : [],
      nuevoValorLista: '',
    };
  }

  seleccionarTipo(tipo: GlobalConfigTipo): void {
    this.editModal.tipo = tipo;
    // Al pasar a booleano el valor libre puede traer texto que no es 'true'/'false'
    // (ej. venía de tipo texto) — el toggle Sí/No solo entiende esos dos strings.
    if (tipo === 'booleano' && this.editModal.valor !== 'true' && this.editModal.valor !== 'false') {
      this.editModal.valor = 'false';
    }
    // Al pasar a lista: reinterpretar lo que ya había como JSON array (si venía de
    // 'lista' antes, o si alguien escribió el JSON a mano en 'texto') — si no
    // parsea, arranca vacía en vez de romper el modal.
    if (tipo === 'lista') {
      this.editModal.valorListaChips = _parsearValorLista(this.editModal.valor);
      this.editModal.valor = JSON.stringify(this.editModal.valorListaChips);
    }
  }

  agregarValorLista(): void {
    const valor = this.editModal.nuevoValorLista.trim();
    if (!valor) return;
    this.editModal.valorListaChips = [...this.editModal.valorListaChips, valor];
    this.editModal.nuevoValorLista = '';
    this.editModal.valor = JSON.stringify(this.editModal.valorListaChips);
  }

  quitarValorLista(index: number): void {
    this.editModal.valorListaChips = this.editModal.valorListaChips.filter((_, i) => i !== index);
    this.editModal.valor = JSON.stringify(this.editModal.valorListaChips);
  }

  abrirNuevoValor(section: ConfigSection): void {
    this.editModal = {
      ...EMPTY_EDIT_MODAL,
      show: true, mode: 'create',
      sectionId: section.id, sectionClave: section.clave,
    };
  }

  cerrarEditModal(): void {
    this.editModal = { ...EMPTY_EDIT_MODAL };
  }

  guardarValor(): void {
    const { sectionClave, clave, valor, esSecreto, tipo, descripcion, sectionId } = this.editModal;
    if (!clave.trim() || !valor.trim()) {
      this.editModal.error = 'Se requiere clave y valor.';
      return;
    }
    this.editModal.saving = true;
    this.editModal.error  = null;
    this.configSvc.setValue(sectionClave, clave.trim(), {
      valor: valor.trim(), esSecreto, tipo, descripcion: descripcion.trim() || undefined,
    }).subscribe({
      next: () => {
        this.editModal.saving = false;
        this.cerrarEditModal();
        if (sectionId != null) this.loadConfigs(sectionId);
      },
      error: (err) => {
        this.editModal.saving = false;
        this.editModal.error  = err?.error?.error || 'Error al guardar el valor';
      },
    });
  }

  // ── Historial ──────────────────────────────────────────────────────────────────

  abrirHistorial(cfg: GlobalConfig): void {
    this.auditModal = { ...EMPTY_AUDIT_MODAL, show: true, clave: cfg.clave, loading: true };
    this.configSvc.listAuditLog(cfg.id).subscribe({
      next: (logs) => { this.auditModal = { ...this.auditModal, logs, loading: false }; },
      error: (err) => {
        this.auditModal = {
          ...this.auditModal, loading: false,
          error: err?.error?.error || 'Error al cargar el historial',
        };
      },
    });
  }

  cerrarAuditModal(): void {
    this.auditModal = { ...EMPTY_AUDIT_MODAL };
  }

  accionLabel(accion: ConfigAuditLog['accion']): string {
    switch (accion) {
      case 'creado':            return 'Creado';
      case 'editado':           return 'Editado';
      case 'secreto_revelado':  return 'Secreto revelado';
      default:                  return accion;
    }
  }

  // ── Nueva sección / editar sección (piloto: migrar más adelante otras partes del .env) ──

  abrirNuevaSeccion(): void {
    this.newSectionModal = { ...EMPTY_NEW_SECTION_MODAL, show: true, mode: 'create' };
  }

  abrirEditarSeccion(section: ConfigSection): void {
    this.newSectionModal = {
      ...EMPTY_NEW_SECTION_MODAL, show: true, mode: 'edit', sectionId: section.id,
      clave: section.clave, nombre: section.nombre, descripcion: section.descripcion ?? '',
      modulosAfectados: [...(section.modulosAfectados ?? [])],
    };
  }

  cerrarNuevaSeccion(): void {
    this.newSectionModal = { ...EMPTY_NEW_SECTION_MODAL };
  }

  // ── Chips de "módulos/acciones afectados" ─────────────────────────────────────

  agregarModulo(): void {
    const valor = this.newSectionModal.nuevoModulo.trim();
    if (!valor) return;
    this.newSectionModal.modulosAfectados = [...this.newSectionModal.modulosAfectados, valor];
    this.newSectionModal.nuevoModulo = '';
  }

  quitarModulo(index: number): void {
    this.newSectionModal.modulosAfectados = this.newSectionModal.modulosAfectados.filter((_, i) => i !== index);
  }

  guardarSeccion(): void {
    const { mode, sectionId, clave, nombre, descripcion, modulosAfectados } = this.newSectionModal;
    if (!clave.trim() || !nombre.trim()) {
      this.newSectionModal.error = 'Se requiere clave y nombre.';
      return;
    }
    this.newSectionModal.saving = true;
    this.newSectionModal.error  = null;

    if (mode === 'edit' && sectionId != null) {
      this.configSvc.updateSection(sectionId, {
        nombre: nombre.trim(), descripcion: descripcion.trim() || undefined, modulosAfectados,
      }).subscribe({
        next: (section) => {
          this.newSectionModal.saving = false;
          this.cerrarNuevaSeccion();
          this.sections = this.sections.map(s => s.id === section.id ? section : s);
          if (this.selectedSection?.id === section.id) this.selectedSection = section;
        },
        error: (err) => {
          this.newSectionModal.saving = false;
          this.newSectionModal.error  = err?.error?.error || 'Error al guardar la sección';
        },
      });
      return;
    }

    this.configSvc.createSection({
      clave: clave.trim(), nombre: nombre.trim(),
      descripcion: descripcion.trim() || undefined,
      modulosAfectados,
    }).subscribe({
      next: (section) => {
        this.newSectionModal.saving = false;
        this.cerrarNuevaSeccion();
        this.sections = [...this.sections, section];
        this.configsBySection.set(section.id, []);
        this.selectedSection = section;
      },
      error: (err) => {
        this.newSectionModal.saving = false;
        this.newSectionModal.error  = err?.error?.error || 'Error al crear la sección';
      },
    });
  }
}
